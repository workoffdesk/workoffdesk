import XCTest
@testable import WorkOffDeskKit

final class WordsTests: XCTestCase {
  func testFollowsTheMacsFirstLanguage() {
    XCTAssertEqual(Lang.of(["zh-Hans-CN", "en-US"]), .zh)
    XCTAssertEqual(Lang.of(["zh-Hant-TW"]), .zh)
    XCTAssertEqual(Lang.of(["en-GB", "zh-Hans"]), .en)
    XCTAssertEqual(Lang.of([]), .en)
  }

  // The ids doctor checks (apps/server/src/doctor.ts CheckId).
  func testNamesEveryCheckInBothLanguages() {
    for id in ["macos", "node", "tmux", "claude", "codex", "setup", "service", "origin", "sleep", "apns"] {
      XCTAssertNotNil(Words.en.checkNames[id], id)
      XCTAssertNotNil(Words.zh.checkNames[id], id)
    }
  }

  func testCountsProblemsInEachLanguage() {
    XCTAssertEqual(Words.en.problems(1), "1 problem")
    XCTAssertEqual(Words.en.problems(2), "2 problems")
    XCTAssertEqual(Words.zh.problems(2), "2 个问题")
  }
}

final class WordsLocaleTests: XCTestCase {
  func testSaysHowLongAgoInItsOwnLanguage() {
    let f = RelativeDateTimeFormatter()
    f.locale = Words.zh.locale
    XCTAssertTrue(f.localizedString(fromTimeInterval: -300).contains("分钟"))
  }
}
