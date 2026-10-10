import XCTest
@testable import WorkOffDeskKit

// `workoffdesk activity --json` kept running for the menu bar icon, from stand-in CLIs.
final class ActivityWatchTests: XCTestCase {
  private let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)

  override func setUpWithError() throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  // A stand-in that answers only `activity --json`, and writes each run's pid and start time to `runs`.
  private func cli(_ body: String) throws -> CLI {
    let path = dir.appendingPathComponent("workoffdesk").path
    try "#!/bin/sh\n[ \"$*\" = 'activity --json' ] || exit 9\necho \"$$ $(perl -MTime::HiRes=time -e 'printf \"%.3f\", time')\" >> '\(runs)'\n\(body)\n".write(toFile: path, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
    return CLI(path: path)
  }

  private var runs: String { dir.appendingPathComponent("runs").path }
  private var lines: [[Substring]] {
    ((try? String(contentsOfFile: runs, encoding: .utf8)) ?? "").split(separator: "\n").map { $0.split(separator: " ") }
  }
  private var pids: [pid_t] { lines.compactMap { $0.first.flatMap { pid_t($0) } } }
  // How long after each run the next one started.
  private var gaps: [TimeInterval] {
    let starts = lines.compactMap { $0.last.flatMap { TimeInterval($0) } }
    return zip(starts, starts.dropFirst()).map { $1 - $0 }
  }

  private final class Told: @unchecked Sendable {
    private let lock = NSLock()
    private var counts: [Int] = []
    func add(_ n: Int) { lock.withLock { counts.append(n) } }
    var all: [Int] { lock.withLock { counts } }
  }

  private func until(_ timeout: TimeInterval = 5, _ done: () -> Bool) async throws {
    let end = Date().addingTimeInterval(timeout)
    while !done() {
      guard Date() < end else { return XCTFail("not in \(timeout)s") }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
  }

  private func alive(_ pid: pid_t) -> Bool { kill(pid, 0) == 0 }

  func testTellsEachCountInOrderThenZeroWhenItEnds() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: try cli(#"echo '{"working":1}'; echo '{"working":3}'; echo '{"working":0}'"#), restartAfter: 30, onCount: { told.add($0) })
    watch.start()
    try await until { told.all.count == 4 }
    XCTAssertEqual(told.all, [1, 3, 0, 0])
    watch.stop()
  }

  func testSkipsALineItCannotRead() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: try cli(#"echo nope; echo '{"other":1}'; echo '{"working":2}'"#), restartAfter: 30, onCount: { told.add($0) })
    watch.start()
    try await until { told.all.count == 2 }
    XCTAssertEqual(told.all, [2, 0])
    watch.stop()
  }

  func testReadsALineThatComesInPieces() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: try cli(#"printf '{"work'; sleep 0.3; printf 'ing":4}\n'"#), restartAfter: 30, onCount: { told.add($0) })
    watch.start()
    try await until { told.all.count == 2 }
    XCTAssertEqual(told.all, [4, 0])
    watch.stop()
  }

  // The service restarting or being deployed ends the stream; the app asks again of the next one.
  func testRunsItAgainAfterItEnds() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: try cli("exit 1"), restartAfter: 0.1, onCount: { told.add($0) })
    watch.start()
    try await until { pids.count >= 3 }
    watch.stop()
    XCTAssertEqual(Set(told.all), [0])
  }

  // A service that is stopped, or a CLI or server without `activity`, answers nothing: it is asked less and
  // less often, not every few seconds for good.
  func testAsksLessOftenWhileNothingAnswers() async throws {
    let watch = ActivityWatch(cli: try cli("exit 1"), restartAfter: 0.1, maxRestartAfter: 0.8, onCount: { _ in })
    watch.start()
    try await until(20) { pids.count >= 6 }
    watch.stop()
    // At least 0.1, 0.2, 0.4, 0.8, 0.8 seconds apart: twice as late each time, up to the most.
    let g = gaps
    XCTAssertEqual(g.count, 5)
    XCTAssertGreaterThanOrEqual(g[3], 0.75)
    XCTAssertLessThan(g[4], 1.5)
  }

  // One that answered, then ended, is a service restarting or deployed: asked again soon, every time.
  func testAsksAgainSoonAfterARunThatAnswered() async throws {
    let watch = ActivityWatch(cli: try cli(#"echo '{"working":1}'"#), restartAfter: 0.1, maxRestartAfter: 5, onCount: { _ in })
    watch.start()
    try await until(20) { pids.count >= 6 }
    watch.stop()
    // Growing, the fifth wait would be 1.6 seconds.
    XCTAssertLessThan(try XCTUnwrap(gaps.max()), 1)
  }

  // The status is worth asking again then: the service may have stopped.
  func testSaysWhenARunThatAnsweredEnds() async throws {
    let ends = Told()
    let answered = ActivityWatch(cli: try cli(#"echo '{"working":1}'"#), restartAfter: 30, onCount: { _ in }, onEnd: { ends.add(1) })
    answered.start()
    try await until { ends.all == [1] }
    answered.stop()
    let silent = Told()
    let none = ActivityWatch(cli: try cli("exit 1"), restartAfter: 0.05, onCount: { _ in }, onEnd: { silent.add(1) })
    none.start()
    try await until { pids.count >= 3 }
    none.stop()
    XCTAssertEqual(silent.all, [])
  }

  func testTellsZeroWhenTheCLICannotRun() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: CLI(path: dir.appendingPathComponent("missing").path), restartAfter: 30, onCount: { told.add($0) })
    watch.start()
    try await until { told.all == [0] }
    watch.stop()
  }

  func testStopEndsTheRunAndDoesNotRunItAgain() async throws {
    let told = Told()
    let watch = ActivityWatch(cli: try cli(#"echo '{"working":1}'; exec sleep 30"#), restartAfter: 0.1, onCount: { told.add($0) })
    watch.start()
    try await until { told.all == [1] }
    let pid = try XCTUnwrap(pids.first)
    watch.stop()
    try await until { !alive(pid) }
    try await Task.sleep(nanoseconds: 400_000_000)
    XCTAssertEqual(told.all, [1])
    XCTAssertEqual(pids.count, 1)
  }

  func testAWatchLetGoOfEndsItsRun() async throws {
    let told = Told()
    var watch: ActivityWatch? = ActivityWatch(cli: try cli(#"echo '{"working":1}'; exec sleep 30"#), restartAfter: 0.1, onCount: { told.add($0) })
    watch?.start()
    try await until { told.all == [1] }
    let pid = try XCTUnwrap(pids.first)
    watch = nil
    try await until { !alive(pid) }
  }
}
