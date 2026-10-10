import XCTest
@testable import WorkOffDeskKit

// What `workoffdesk account --json` prints: the view the This Mac page has (apps/server/src/agents/claude/accounts.ts).
let accountsSample = """
{"accounts":[
{"id":"","folder":"~/.claude","email":"a@example.com","signedIn":true,"ready":true,"shared":true,"limits":{"fiveHour":{"used":42},"at":1}},
{"id":"/Users/someone/.claude-b","folder":"~/.claude-b","email":"b@example.com","signedIn":true,"ready":true,"shared":true,"limits":null},
{"id":"/Users/someone/.claude-c","folder":"~/.claude-c","email":"c@example.com","signedIn":false,"ready":true,"shared":true,"limits":null},
{"id":"/Users/someone/.claude-d","folder":"~/.claude-d","email":"d@example.com","signedIn":true,"ready":false,"shared":true,"limits":null},
{"id":"/Users/someone/.claude-e","folder":"~/.claude-e","email":"e@example.com","signedIn":true,"ready":true,"shared":false,"limits":null}],
"inUse":"","picked":true,"elsewhere":2,"moving":1}
"""

final class AccountsTests: XCTestCase {
  private func script(_ body: String) throws -> String {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("workoffdesk").path
    try "#!/bin/sh\n\(body)\n".write(toFile: path, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
    return path
  }

  func testDecodesWhatTheCLIPrints() throws {
    let a = try Accounts.decode(Data(accountsSample.utf8))
    XCTAssertEqual(a.accounts.map(\.email), ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"])
    XCTAssertEqual(a.inUse, "")
    XCTAssertEqual([a.elsewhere, a.moving], [2, 1])
    XCTAssertEqual(a.accounts[1].folder, "~/.claude-b")
  }

  func testSaysWhyAnAccountCannotBePicked() throws {
    let a = try Accounts.decode(Data(accountsSample.utf8))
    XCTAssertEqual(a.accounts.map { $0.bar(Words.en) }, [nil, nil, Words.en.accountSignedOut, Words.en.accountNotReady, Words.en.accountApart])
  }

  func testAsksForTheAccountsAsJSON() async throws {
    let cli = CLI(path: try script(#"[ "$*" = "account --json" ] && cat <<'J'"# + "\n\(accountsSample)\nJ"))
    let a = try await cli.accounts()
    XCTAssertEqual(a.accounts.count, 5)
  }

  func testPicksAnAccountByItsFolderAndMovesTheOpenSessions() async throws {
    let log = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    let cli = CLI(path: try script(#"echo "$*" >> "# + "'\(log)'"))
    let account = try Accounts.decode(Data(accountsSample.utf8)).accounts[1]
    try await cli.pick(account)
    try await cli.moveSessions()
    XCTAssertEqual(try String(contentsOfFile: log, encoding: .utf8), "account use ~/.claude-b\naccount move\n")
  }

  func testSaysWhatTheCLISaidWhenAPickFails() async throws {
    let cli = CLI(path: try script("echo 'There is no Claude account ~/.claude-b on this Mac.' >&2; exit 1"))
    let account = try Accounts.decode(Data(accountsSample.utf8)).accounts[1]
    do {
      try await cli.pick(account)
      XCTFail("expected a failure")
    } catch {
      XCTAssertEqual(error.localizedDescription, "There is no Claude account ~/.claude-b on this Mac.")
    }
  }
}
