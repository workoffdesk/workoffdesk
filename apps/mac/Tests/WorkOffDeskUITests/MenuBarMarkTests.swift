import AppKit
import XCTest
@testable import WorkOffDeskUI

// The menu bar icon: the app's mark in one colour, with the bar across its screen while sessions work.
final class MenuBarMarkTests: XCTestCase {
  // How opaque the mark is at a point of the 512 grid the app icon is drawn on.
  private func alpha(_ image: NSImage, _ x: CGFloat, _ y: CGFloat) throws -> CGFloat {
    let rep = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(image.size.width * 2), pixelsHigh: Int(image.size.height * 2),
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
    rep.size = image.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(origin: .zero, size: image.size))
    NSGraphicsContext.restoreGraphicsState()
    let box = MenuBarMark.box
    let px = Int((x - box.minX) / box.width * CGFloat(rep.pixelsWide))
    let py = Int((y - box.minY) / box.height * CGFloat(rep.pixelsHigh))
    return try XCTUnwrap(rep.colorAt(x: px, y: py)).alphaComponent
  }

  // With MENU_SNAPSHOTS set to a folder, each is saved there as a PNG at twice the size.
  func testIsATemplateTheMenuBarTints() throws {
    for working in [false, true] {
      let image = MenuBarMark.image(working: working)
      XCTAssertTrue(image.isTemplate)
      XCTAssertEqual(image.size.height, 18)
      if let dir = ProcessInfo.processInfo.environment["MENU_SNAPSHOTS"],
        let cg = image.cgImage(forProposedRect: nil, context: NSGraphicsContext(attributes: [:]), hints: [.ctm: AffineTransform(scale: 2)]),
        let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) {
        try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("menu-bar-\(working ? "working" : "plain").png"))
      }
    }
  }

  func testTheBarRunsAcrossTheScreenOnlyWhileWorking() throws {
    let plain = MenuBarMark.image(working: false)
    let working = MenuBarMark.image(working: true)
    // The screen, the done part of the bar, the phone's edge: drawn either way.
    for (x, y) in [(300.0, 140.0), (260.0, 197.0), (68.0, 330.0)] {
      XCTAssertGreaterThan(try alpha(plain, x, y), 0.7, "plain \(x),\(y)")
      XCTAssertGreaterThan(try alpha(working, x, y), 0.7, "working \(x),\(y)")
    }
    // The part of the bar still to go: a gap in the screen while working, screen otherwise.
    XCTAssertGreaterThan(try alpha(plain, 350, 197), 0.7)
    XCTAssertLessThan(try alpha(working, 350, 197), 0.3)
    // Inside the phone: empty either way.
    XCTAssertLessThan(try alpha(plain, 122, 330), 0.3)
    XCTAssertLessThan(try alpha(working, 122, 330), 0.3)
  }
}
