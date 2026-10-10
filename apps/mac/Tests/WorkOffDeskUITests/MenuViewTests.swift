import AppKit
import SwiftUI
import XCTest
import WorkOffDeskKit
@testable import WorkOffDeskUI

// The menu drawn for each state the service can be in, from a stand-in CLI that, like the real one, answers
// in the language LC_ALL names. With MENU_SNAPSHOTS set to a folder, each drawing is saved there as a PNG.
@MainActor
final class MenuViewTests: XCTestCase {
  // accounts: what `account --json` prints; working: the count `activity --json` prints, before it waits
  // (writing its pid to `pid`) or, with `ends`, ends; log: a file each run's arguments are written to, a line each.
  private func cli(running: Bool, failing: Bool, lang: Lang = .en, accounts: String? = nil, working: Int? = nil, ends: Bool = false,
    pid: String? = nil, log: String? = nil) throws -> CLI {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("workoffdesk").path
    let answer = { (lang: Lang) in "cat <<'J'\n\(self.status(running: running, failing: failing, lang: lang))\nJ\n" }
    let logged = log.map { "echo \"$*\" >> '\($0)'\n" } ?? ""
    let listed = accounts.map { "[ \"$*\" = 'account --json' ] && { cat <<'J'\n\($0)\nJ\nexit 0; }\n" } ?? ""
    let wait = ends ? "exit 0" : "echo $$ > '\(pid ?? "/dev/null")'; exec sleep 30"
    let counted = working.map { "[ \"$*\" = 'activity --json' ] && { echo '{\"working\":\($0)}'; \(wait); }\n" } ?? ""
    try "#!/bin/sh\n\(logged)\(listed)\(counted)[ \"$1\" = status ] || exit 0\nif [ \"$LC_ALL\" = zh_CN.UTF-8 ]; then\n\(answer(.zh))else\n\(answer(.en))fi\n"
      .write(toFile: path, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
    return CLI(path: path, lang: lang)
  }

  // The default account in use, one to pick, one signed out; and sessions on another account, or moving.
  private func accounts(elsewhere: Int, moving: Int) -> String {
    #"{"accounts":[{"id":"","folder":"~/.claude","email":"someone@example.com","signedIn":true,"ready":true,"shared":true,"limits":null},"#
      + #"{"id":"/Users/someone/.claude-work","folder":"~/.claude-work","email":"work@example.com","signedIn":true,"ready":true,"shared":true,"limits":null},"#
      + #"{"id":"/Users/someone/.claude-old","folder":"~/.claude-old","email":"old@example.com","signedIn":false,"ready":true,"shared":true,"limits":null}],"#
      + #""inUse":"","picked":true,"elsewhere":\#(elsewhere),"moving":\#(moving)}"#
  }

  private func status(running: Bool, failing: Bool, lang: Lang) -> String {
    let zh = lang == .zh
    let tmux = failing ? #"{"id":"tmux","ok":false,"detail":"\#(zh ? "找不到" : "not found")","fix":"brew install tmux"}"# : #"{"id":"tmux","ok":true,"detail":"3.5a"}"#
    let service = running ? (zh ? "在 http://127.0.0.1:7681 上运行" : "running on http://127.0.0.1:7681") : (zh ? "没有在运行" : "not running")
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let at = iso.string(from: Date().addingTimeInterval(-300))
    return """
    {"checks":[{"id":"macos","ok":true,"detail":"darwin"},\(tmux),{"id":"service","ok":\(running),"detail":"\(service)"}],
    "version":"3.0.0","build":null,"release":null,"releases":[],"rollbackTo":null,"lastOp":null,"home":"/tmp/wod",
    "origin":"https://workoffdesk.example.com","port":7681,"running":\(running),
    "problems":[{"at":"\(at)","level":"error","msg":"tmux exited while a session was attached","detail":"{}"}]}
    """
  }

  private func draw(_ name: String, model: Model, showCode: Bool = false) throws -> NSImage {
    let renderer = ImageRenderer(content: MenuView(model: model, showCode: showCode).background(Color(nsColor: .windowBackgroundColor)))
    renderer.scale = 2
    let image = try XCTUnwrap(renderer.nsImage, name)
    XCTAssertEqual(image.size.width, 320, name)
    if let dir = ProcessInfo.processInfo.environment["MENU_SNAPSHOTS"], let tiff = image.tiffRepresentation,
      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
      try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
    return image
  }

  func testDrawsEachState() async throws {
    for (lang, words) in [(Lang.en, Words.en), (Lang.zh, Words.zh)] {
      for (name, running, failing) in [("ok", true, false), ("problems", true, true), ("stopped", false, false)] {
        let fake = try cli(running: running, failing: failing, lang: lang)
        let model = Model(find: { fake }, words: words)
        await model.refresh()
        XCTAssertNotNil(model.status, name)
        _ = try draw("\(name)-\(lang)", model: model, showCode: name == "ok")
      }
      _ = try draw("not-installed-\(lang)", model: Model(find: { nil }, words: words))
    }
  }

  func testDrawsTheClaudeAccounts() async throws {
    for (lang, words) in [(Lang.en, Words.en), (Lang.zh, Words.zh)] {
      for (name, elsewhere, moving) in [("accounts", 0, 0), ("accounts-elsewhere", 2, 0), ("accounts-moving", 0, 3)] {
        let fake = try cli(running: true, failing: false, lang: lang, accounts: accounts(elsewhere: elsewhere, moving: moving))
        let model = Model(find: { fake }, words: words)
        await model.refresh()
        XCTAssertEqual(model.accounts?.accounts.count, 3, name)
        _ = try draw("\(name)-\(lang)", model: model)
      }
    }
  }

  func testReadsTheAccountsOnlyOfAServiceThatRuns() async throws {
    let log = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    let fake = try cli(running: false, failing: false, accounts: accounts(elsewhere: 1, moving: 0), log: log)
    let model = Model(find: { fake }, words: .en)
    await model.refresh()
    XCTAssertNil(model.accounts)
    XCTAssertEqual(try String(contentsOfFile: log, encoding: .utf8), "status --json\n")
  }

  func testPicksAnAccountAndMovesTheOpenSessionsThroughTheCLIThenReadsThemAgain() async throws {
    let log = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    let fake = try cli(running: true, failing: false, accounts: accounts(elsewhere: 1, moving: 0), log: log)
    let model = Model(find: { fake }, words: .en)
    await model.refresh()
    try "".write(toFile: log, atomically: true, encoding: .utf8)
    await model.pick(try XCTUnwrap(model.accounts?.accounts[1]))
    await model.moveSessions()
    XCTAssertEqual(try String(contentsOfFile: log, encoding: .utf8), "account use ~/.claude-work\naccount --json\naccount move\naccount --json\n")
    XCTAssertNil(model.error)
  }

  func testTheIconSaysHowTheServiceIs() async throws {
    let cases: [(Bool, Bool, Mark)] = [(true, false, .plain), (true, true, .symbol("exclamationmark.triangle")), (false, false, .symbol("stop.circle"))]
    for (running, failing, mark) in cases {
      let fake = try cli(running: running, failing: failing)
      let model = Model(find: { fake }, words: .en)
      await model.refresh()
      XCTAssertEqual(model.mark, mark)
    }
    XCTAssertEqual(Model(find: { nil }, words: .en).mark, .symbol("questionmark.circle"))
  }

  // The bar shows while sessions work, and only on a service that is fine: trouble says so first.
  func testTheIconShowsTheBarWhileSessionsWork() async throws {
    let cases: [(Bool, Int, Mark)] = [(false, 2, .working), (false, 0, .plain), (true, 2, .symbol("exclamationmark.triangle"))]
    for (failing, working, mark) in cases {
      let fake = try cli(running: true, failing: failing, working: working)
      let model = Model(find: { fake }, words: .en)
      model.watch()
      let end = Date().addingTimeInterval(5)
      while model.status == nil || model.sessionsWorking != working || model.mark != mark {
        guard Date() < end else { return XCTFail("\(failing) \(working): \(model.mark)") }
        try await Task.sleep(nanoseconds: 20_000_000)
      }
    }
  }

  private func until(_ what: String, _ done: () -> Bool) async throws {
    let end = Date().addingTimeInterval(5)
    while !done() {
      guard Date() < end else { return XCTFail("not in 5s: \(what)") }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
  }

  // Quitting does not run deinit: the CLI it keeps running would be left behind.
  func testQuittingEndsTheActivityRun() async throws {
    let pidFile = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    let fake = try cli(running: true, failing: false, working: 1, pid: pidFile)
    let model = Model(find: { fake }, words: .en)
    model.watch()
    try await until("the run") { model.sessionsWorking == 1 }
    let pid = try XCTUnwrap(pid_t((try String(contentsOfFile: pidFile, encoding: .utf8)).trimmingCharacters(in: .whitespacesAndNewlines)))
    NotificationCenter.default.post(name: NSApplication.willTerminateNotification, object: NSApp)
    try await until("its end") { kill(pid, 0) != 0 }
  }

  // The stream ending is the service stopping or restarting: the status is asked again then, not a minute later.
  func testAsksTheStatusAgainWhenTheActivityStreamEnds() async throws {
    let log = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    let fake = try cli(running: true, failing: false, working: 1, ends: true, log: log)
    let model = Model(find: { fake }, words: .en)
    model.watch()
    let asked = { ((try? String(contentsOfFile: log, encoding: .utf8)) ?? "").split(separator: "\n").filter { $0 == "status --json" }.count }
    try await until("asked twice") { asked() >= 2 }
  }
}
