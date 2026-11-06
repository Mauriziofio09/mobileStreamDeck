// Testwerkzeug: Zwischenablage sichern/wiederherstellen und Testinhalt (Bild + Datei) setzen.
import AppKit
let a = CommandLine.arguments
let pb = NSPasteboard.general
func save(_ dir: String) {
  let items = (pb.pasteboardItems ?? []).map { it in it.types.compactMap { t -> [String: String]? in
    guard let d = it.data(forType: t) else { return nil }
    return ["type": t.rawValue, "data": d.base64EncodedString()] } }
  try! JSONSerialization.data(withJSONObject: items).write(to: URL(fileURLWithPath: dir + "/clip.json"))
}
func restore(_ dir: String) {
  let raw = try! Data(contentsOf: URL(fileURLWithPath: dir + "/clip.json"))
  let items = try! JSONSerialization.jsonObject(with: raw) as! [[[String: String]]]
  pb.clearContents()
  let objs = items.map { pairs -> NSPasteboardItem in let it = NSPasteboardItem(); for p in pairs { it.setData(Data(base64Encoded: p["data"]!)!, forType: .init(p["type"]!)) }; return it }
  if !objs.isEmpty { pb.writeObjects(objs) }
}
func setTest(_ png: String, _ file: String) {
  pb.clearContents()
  let img = NSPasteboardItem(); img.setData(try! Data(contentsOf: URL(fileURLWithPath: png)), forType: .png)
  let f = NSPasteboardItem(); f.setData(Data(URL(fileURLWithPath: file).absoluteString.utf8), forType: .fileURL)
  pb.writeObjects([img, f])
  // Wie der Finder: schreibender Prozess lebt noch kurz weiter (sonst verwirft macOS die Datei-URL).
  Thread.sleep(forTimeInterval: 1.0)
}
switch a[1] { case "save": save(a[2]); case "restore": restore(a[2]); case "set-test": setTest(a[2], a[3]); default: exit(2) }
