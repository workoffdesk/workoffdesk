import AppKit
import SwiftUI
import XCTest
import WorkOffDeskKit
@testable import WorkOffDeskUI

// The menu drawn for each state the service can be in, from a stand-in CLI that, like the real one, answers
// in the language LC_ALL names. With MENU_SNAPSHOTS set to a folder, each drawing is saved there as a PNG.
@MainActor
final class MenuViewTests: XCTestCase {
  // accounts: what `account --json` prints; log: a file each run's arguments are written to, a line each.
  private func cli(running: Bool, failing: Bool, lang: Lang = .en, accounts: String? = nil, log: String? = nil) throws -> CLI {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("workoffdesk").path
    let answer = { (lang: Lang) in "cat <<'J'\n\(self.status(running: running, failing: failing, lang: lang))\nJ\n" }
    let logged = log.map { "echo \"$*\" >> '\($0)'\n" } ?? ""
    let listed = accounts.map { "[ \"$*\" = 'account --json' ] && { cat <<'J'\n\($0)\nJ\nexit 0; }\n" } ?? ""
    try "#!/bin/sh\n\(logged)\(listed)[ \"$1\" = status ] || exit 0\nif [ \"$LC_ALL\" = zh_CN.UTF-8 ]; then\n\(answer(.zh))else\n\(answer(.en))fi\n"
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
    let cases: [(Bool, Bool, String)] = [(true, false, "apple.terminal"), (true, true, "exclamationmark.triangle"), (false, false, "stop.circle")]
    for (running, failing, symbol) in cases {
      let fake = try cli(running: running, failing: failing)
      let model = Model(find: { fake }, words: .en)
      await model.refresh()
      XCTAssertEqual(model.symbol, symbol)
    }
    XCTAssertEqual(Model(find: { nil }, words: .en).symbol, "questionmark.circle")
  }
}
