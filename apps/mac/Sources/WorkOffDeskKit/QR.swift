import AppKit
import CoreImage

// The address as a code for the phone's camera, square and sharp at the side asked. A local address has
// nothing for a phone to open, so it gets none.
public func qrImage(_ origin: String, side: CGFloat) -> NSImage? {
  guard origin.hasPrefix("https://"), let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
  filter.setValue(Data(origin.utf8), forKey: "inputMessage")
  filter.setValue("M", forKey: "inputCorrectionLevel")
  guard let code = filter.outputImage else { return nil }
  let scale = (side * 2) / code.extent.width
  let scaled = code.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
  return NSImage(cgImage: cg, size: NSSize(width: side, height: side))
}
