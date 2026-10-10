import XCTest
@testable import WorkOffDeskKit

final class QRTests: XCTestCase {
  func testDrawsTheAddressAtTheSizeAsked() throws {
    let image = try XCTUnwrap(qrImage("https://workoffdesk.example.com", side: 180))
    XCTAssertEqual(image.size.width, 180)
    XCTAssertEqual(image.size.height, 180)
  }

  func testDrawsNothingForAnAddressAPhoneCannotOpen() {
    XCTAssertNil(qrImage("http://127.0.0.1:7681", side: 180))
  }
}
