// Rendert das Icon einer App über NSWorkspace als PNG.
// Fallback für Apps, deren aktuelles Icon in Assets.car liegt (sips kann das nicht lesen).
// Aufruf: app-icon <Pfad/zur.app> <Ausgabe.png> <Kantenlänge>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let px = Int(args[3]), px > 0, px <= 1024 else {
  FileHandle.standardError.write("usage: app-icon <app> <out.png> <px>\n".data(using: .utf8)!)
  exit(2)
}
let icon = NSWorkspace.shared.icon(forFile: args[1])
guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)
else { exit(1) }
rep.size = NSSize(width: px, height: px)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
NSGraphicsContext.restoreGraphicsState()
guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
do { try data.write(to: URL(fileURLWithPath: args[2])) } catch { exit(1) }
