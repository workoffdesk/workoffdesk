import XCTest
@testable import WorkOffDeskKit

// What `workoffdesk status --json` prints (apps/server/src/cli.ts, pinned by its test in tests/unit/cli.test.ts).
let sample = """
{"checks":[{"id":"macos","ok":true,"detail":"darwin"},{"id":"tmux","ok":false,"detail":"not found","fix":"brew install tmux"},
{"id":"service","ok":true,"detail":"answers on http://127.0.0.1:7681"}],
"version":"3.0.0","build":{"version":"3.0.0","commit":"abc123","dirty":false},"release":"20261007-150859",
"releases":[{"name":"20261007-150859","version":"3.0.0","activatedAt":"2026-10-07T07:09:00.000Z"}],"rollbackTo":null,"lastOp":null,
"home":"/Users/someone/.workoffdesk","origin":"https://workoffdesk.example.com","port":7681,"running":true,
"problems":[{"at":"2026-10-07T07:10:00.123Z","level":"error","msg":"boom","detail":"{}"},{"at":"2026-10-07T07:09:00.000Z","level":"warn","msg":"slow","detail":"{}"}]}
"""

final class StatusTests: XCTestCase {
  func testDecodesWhatTheCLIPrints() throws {
    let s = try Status.decode(Data(sample.utf8))
    XCTAssertEqual(s.version, "3.0.0")
    XCTAssertEqual(s.build?.commit, "abc123")
    XCTAssertEqual(s.home, "/Users/someone/.workoffdesk")
    XCTAssertEqual(s.origin, "https://workoffdesk.example.com")
    XCTAssertEqual(s.checks.first(where: { $0.id == "tmux" })?.fix, "brew install tmux")
    XCTAssertEqual(s.problems.count, 2)
  }

  func testDecodesAMacNotSetUpYet() throws {
    let json = #"{"checks":[],"version":"3.0.0","build":null,"release":null,"releases":[],"rollbackTo":null,"lastOp":null,"home":"/h","origin":null,"port":null,"running":false,"problems":[]}"#
    let s = try Status.decode(Data(json.utf8))
    XCTAssertNil(s.origin)
    XCTAssertEqual(s.health, .stopped)
  }

  func testHealthIsStoppedWhenNothingRunsWhateverElseFails() throws {
    let s = try Status.decode(Data(sample.replacingOccurrences(of: #""running":true"#, with: #""running":false"#).utf8))
    XCTAssertEqual(s.health, .stopped)
  }

  func testHealthCountsTheFailedChecksOfARunningService() throws {
    XCTAssertEqual(try Status.decode(Data(sample.utf8)).health, .problems(1))
    let fine = sample.replacingOccurrences(of: #""ok":false"#, with: #""ok":true"#)
    XCTAssertEqual(try Status.decode(Data(fine.utf8)).health, .ok)
  }

  func testTheErrorsAreTheErrorsAndWorseNewestFirst() throws {
    let s = try Status.decode(Data(sample.utf8))
    XCTAssertEqual(s.errors.map(\.msg), ["boom"])
    XCTAssertEqual(s.errors.first?.date?.timeIntervalSince1970 ?? 0, 1_791_357_000.123, accuracy: 0.001)
  }

  func testSaysWhatCouldNotBeReadInsteadOfFailingQuietly() {
    XCTAssertThrowsError(try Status.decode(Data("Usage: workoffdesk".utf8)))
  }
}
