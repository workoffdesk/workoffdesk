import XCTest
@testable import WorkOffDeskKit

final class CLITests: XCTestCase {
  private func script(_ body: String) throws -> String {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("workoffdesk").path
    try "#!/bin/sh\n\(body)\n".write(toFile: path, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
    return path
  }

  func testFindsWhatInstallWroteBeforeAnythingOnPath() {
    let found = CLI.find(home: "/Users/a", isExecutable: { ["/Users/a/.local/bin/workoffdesk", "/opt/homebrew/bin/workoffdesk"].contains($0) })
    XCTAssertEqual(found?.path, "/Users/a/.local/bin/workoffdesk")
  }

  func testFindsTheOneHomebrewsNpmPutsOnPath() {
    XCTAssertEqual(CLI.find(home: "/Users/a", isExecutable: { $0 == "/opt/homebrew/bin/workoffdesk" })?.path, "/opt/homebrew/bin/workoffdesk")
  }

  func testFindsNoneWhenItIsNotInstalled() {
    XCTAssertNil(CLI.find(home: "/Users/a", isExecutable: { _ in false }))
  }

  func testRunsItWithTheArgumentsAndTellsHowItEnded() async throws {
    let cli = CLI(path: try script(#"echo "out $*"; echo err >&2; exit 3"#))
    let r = await cli.run(["restart"])
    XCTAssertEqual(r.code, 3)
    XCTAssertEqual(r.out, "out restart\n")
    XCTAssertEqual(r.err, "err\n")
  }

  // A pipe holds 64 KB; a run that read only after the end would wait forever on a long answer.
  func testReadsALongAnswerWhole() async throws {
    let cli = CLI(path: try script("yes x | head -c 300000"))
    let r = await cli.run([])
    XCTAssertEqual(r.code, 0)
    XCTAssertEqual(r.out.count, 300_000)
  }

  func testStopsARunThatTakesTooLong() async throws {
    let cli = CLI(path: try script("sleep 30"))
    let started = Date()
    let r = await cli.run([], timeout: 0.5)
    XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    XCTAssertNotEqual(r.code, 0)
  }

  // An app opened from the Dock or at login has no LANG, and the CLI then answers in English under a
  // Chinese menu; one opened from a terminal may carry another language than the Mac's.
  func testHasTheCLIAnswerInTheMenusLanguageWhateverTheAppInherited() async throws {
    let path = try script(#"echo "$LC_ALL""#)
    for inherited in [nil, "en_US.UTF-8", "zh_CN.UTF-8"] {
      if let inherited { setenv("LC_ALL", inherited, 1) } else { unsetenv("LC_ALL") }
      defer { unsetenv("LC_ALL") }
      let zh = await CLI(path: path, lang: .zh).run([])
      let en = await CLI(path: path, lang: .en).run([])
      XCTAssertEqual([zh.out, en.out], ["zh_CN.UTF-8\n", "en_US.UTF-8\n"], "inherited LC_ALL=\(inherited ?? "none")")
    }
  }

  func testSpeaksTheMacsLanguageUnlessToldOtherwise() {
    XCTAssertEqual(CLI(path: "/x").lang, Lang.current)
  }

  func testStatusSaysWhatTheCLISaidWhenItFails() async throws {
    let cli = CLI(path: try script("echo 'config.json is not JSON' >&2; exit 1"))
    do {
      _ = try await cli.status()
      XCTFail("expected a failure")
    } catch {
      XCTAssertEqual(error.localizedDescription, "config.json is not JSON")
    }
  }

  func testStatusAsksForJSON() async throws {
    let cli = CLI(path: try script(#"[ "$*" = "status --json" ] && cat <<'J'"# + "\n\(sample)\nJ"))
    let s = try await cli.status()
    XCTAssertEqual(s.version, "3.0.0")
  }
}
