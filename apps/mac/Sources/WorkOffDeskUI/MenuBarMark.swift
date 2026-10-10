import AppKit

// The menu bar icon: the app's mark in one colour, plain, while sessions work, or a system symbol.
public enum Mark: Equatable {
  case plain, working
  case symbol(String)
}

// Drawn on the 512 grid of the app icon (apps/web/public/icon.svg), cut to the glyph and set as a template,
// so the menu bar gives it its colour.
public enum MenuBarMark {
  // The glyph's bounds on the grid.
  static let box = CGRect(x: 56, y: 108, width: 396, height: 330)

  public static func image(working: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 18 * box.width / box.height, height: 18), flipped: true) { rect in
      guard let cg = NSGraphicsContext.current?.cgContext else { return false }
      cg.scaleBy(x: rect.width / box.width, y: rect.height / box.height)
      cg.translateBy(x: -box.minX, y: -box.minY)
      draw(cg, working: working)
      return true
    }
    image.isTemplate = true
    return image
  }

  private static func rounded(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> CGPath {
    CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil)
  }

  private static func draw(_ cg: CGContext, working: Bool) {
    cg.setFillColor(NSColor.black.cgColor)
    cg.setStrokeColor(NSColor.black.cgColor)
    // The screen: a chat bubble with its tail at the bottom left.
    let bubble = CGMutablePath()
    bubble.move(to: CGPoint(x: 208, y: 112))
    bubble.addArc(tangent1End: CGPoint(x: 432, y: 112), tangent2End: CGPoint(x: 432, y: 152), radius: 40)
    bubble.addArc(tangent1End: CGPoint(x: 432, y: 284), tangent2End: CGPoint(x: 392, y: 284), radius: 40)
    bubble.addLine(to: CGPoint(x: 236, y: 284))
    bubble.addLine(to: CGPoint(x: 188, y: 322))
    bubble.addLine(to: CGPoint(x: 188, y: 282))
    bubble.addQuadCurve(to: CGPoint(x: 168, y: 246), control: CGPoint(x: 170, y: 276))
    bubble.addArc(tangent1End: CGPoint(x: 168, y: 112), tangent2End: CGPoint(x: 208, y: 112), radius: 40)
    bubble.closeSubpath()
    cg.addPath(bubble)
    // The laptop's base.
    let base = CGMutablePath()
    base.move(to: CGPoint(x: 160, y: 352))
    base.addLine(to: CGPoint(x: 448, y: 352))
    base.addArc(tangent1End: CGPoint(x: 448, y: 380), tangent2End: CGPoint(x: 426, y: 380), radius: 22)
    base.addArc(tangent1End: CGPoint(x: 160, y: 380), tangent2End: CGPoint(x: 160, y: 358), radius: 22)
    base.closeSubpath()
    cg.addPath(base)
    cg.fillPath()
    // A gap around the phone, and the bar's track cut from the screen with the part done drawn in it.
    cg.setBlendMode(.clear)
    cg.addPath(rounded(48, 206, 148, 240, 44))
    if working { cg.addPath(rounded(212, 180, 172, 34, 17)) }
    cg.fillPath()
    cg.setBlendMode(.normal)
    if working {
      cg.addPath(rounded(219, 187, 96, 20, 10))
      cg.fillPath()
    }
    // The phone, and its speaker.
    cg.setLineWidth(18)
    cg.addPath(rounded(68, 226, 108, 200, 24))
    cg.strokePath()
    cg.addPath(rounded(104, 240, 36, 14, 7))
    cg.fillPath()
  }
}

import SwiftUI

public struct MenuBarLabel: View {
  let mark: Mark
  public init(mark: Mark) { self.mark = mark }

  public var body: some View {
    switch mark {
    case .plain: Image(nsImage: MenuBarMark.image(working: false))
    case .working: Image(nsImage: MenuBarMark.image(working: true))
    case .symbol(let name): Image(systemName: name)
    }
  }
}
