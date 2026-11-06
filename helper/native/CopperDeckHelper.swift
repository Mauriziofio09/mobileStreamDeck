// Copper Deck Helper – nativer Teil (Hauptprogramm des App-Bundles "Copper Deck Helper.app").
//
// Warum ein eigenes Bundle: macOS-Berechtigungen (Bedienungshilfen, Automation, Mitteilungen) hängen
// am "verantwortlichen" Prozess. launchd startet dieses Programm; es startet node als Kindprozess.
// Kindprozesse (node, osascript, Aufrufe dieses Programms) erben die Verantwortlichkeit. Damit gelten
// die Rechte für dieses kleine, stabile Bundle – nicht für die node-Binary, die sich bei Updates ändert.
//
// Unterbefehle (nur vom Helper aufgerufen, Ausgabe JSON auf stdout):
//   serve                         node-Helper starten und überwachen (LaunchAgent)
//   permissions [--prompt-ax] [--prompt-automation] [--request-notifications]
//   notify <titel> <text>
//   tile-windows
//   stage-manager-state
//   insert-emoji <emoji> <keystroke.applescript>
//   clipboard-digest              (Test: Typen + SHA-256 je Element)
//   app-icon <app> <out.png> <px>

import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Foundation
import UserNotifications

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

// MARK: - Hilfen

func emit(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  emit(["ok": false, "error": message])
  exit(code)
}

/// Wartet auf einen asynchronen Callback, ohne die Haupt-RunLoop zu blockieren.
func waitFor(timeout: TimeInterval, _ done: () -> Bool) {
  let end = Date().addingTimeInterval(timeout)
  while !done() && Date() < end {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
  }
}

let args = Array(CommandLine.arguments.dropFirst())
let cmd = args.first ?? "help"

// MARK: - serve

func serve() -> Never {
  let env = ProcessInfo.processInfo.environment
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  let dataDir = env["COPPER_DECK_HOME"] ?? "\(home)/Library/Application Support/CopperDeck"
  let launchFile = "\(dataDir)/runtime/launch.json"
  guard
    let data = FileManager.default.contents(atPath: launchFile),
    let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: String],
    let node = cfg["node"], let script = cfg["script"]
  else {
    FileHandle.standardError.write(Data("launch.json fehlt oder ungültig: \(launchFile)\n".utf8))
    exit(78)  // EX_CONFIG
  }
  let child = Process()
  child.executableURL = URL(fileURLWithPath: node)
  child.arguments = [script, "serve"]
  var childEnv = env
  childEnv["COPPER_DECK_NATIVE"] = Bundle.main.executablePath ?? CommandLine.arguments[0]
  childEnv["COPPER_DECK_CONTEXT"] = "app"
  child.environment = childEnv

  for sig in [SIGTERM, SIGINT, SIGHUP] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { if child.isRunning { kill(child.processIdentifier, sig) } }
    src.resume()
    signalSources.append(src)
  }
  child.terminationHandler = { p in exit(p.terminationStatus) }
  do { try child.run() } catch {
    FileHandle.standardError.write(Data("node konnte nicht gestartet werden: \(error)\n".utf8))
    exit(1)
  }
  dispatchMain()
}
var signalSources: [DispatchSourceSignal] = []

// MARK: - Berechtigungen

func ensureSystemEventsRunning() {
  let id = "com.apple.systemevents"
  if !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty { return }
  let cfg = NSWorkspace.OpenConfiguration()
  cfg.activates = false
  cfg.hides = true
  var done = false
  NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: "/System/Library/CoreServices/System Events.app"), configuration: cfg) { _, _ in done = true }
  waitFor(timeout: 3) { done }
  waitFor(timeout: 1) { !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty }
}

func automationStatus(prompt: Bool) -> String {
  ensureSystemEventsRunning()
  var addr = AEAddressDesc()
  let bid = "com.apple.systemevents"
  let created = bid.withCString { AECreateDesc(typeApplicationBundleID, $0, bid.utf8.count, &addr) }
  guard created == noErr else { return "unknown" }
  defer { AEDisposeDesc(&addr) }
  let st = AEDeterminePermissionToAutomateTarget(&addr, typeWildCard, typeWildCard, prompt)
  switch st {
  case noErr: return "granted"
  case OSStatus(errAEEventNotPermitted): return "missing"
  case OSStatus(errAEEventWouldRequireUserConsent): return "notDetermined"
  default: return "unknown"
  }
}

func notificationStatus(request: Bool) -> String {
  let center = UNUserNotificationCenter.current()
  var status: UNAuthorizationStatus? = nil
  center.getNotificationSettings { status = $0.authorizationStatus }
  waitFor(timeout: 3) { status != nil }
  if status == .notDetermined && request {
    var finished = false
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in finished = true }
    waitFor(timeout: 60) { finished }
    status = nil
    center.getNotificationSettings { status = $0.authorizationStatus }
    waitFor(timeout: 3) { status != nil }
  }
  switch status {
  case .authorized?, .provisional?, .ephemeral?: return "granted"
  case .denied?: return "missing"
  case .notDetermined?: return "notDetermined"
  default: return "unknown"
  }
}

func permissions() {
  let promptAX = args.contains("--prompt-ax")
  let ax: Bool
  if promptAX {
    // Zeigt den Systemdialog und trägt das Bundle in die Liste der Bedienungshilfen ein.
    let opt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    ax = AXIsProcessTrustedWithOptions([opt: true] as CFDictionary)
  } else {
    ax = AXIsProcessTrusted()
  }
  emit([
    "ok": true,
    "accessibility": ax ? "granted" : "missing",
    "automation": automationStatus(prompt: args.contains("--prompt-automation")),
    "notifications": notificationStatus(request: args.contains("--request-notifications")),
    "bundle": Bundle.main.bundleIdentifier ?? "none",
  ])
}

// MARK: - Mitteilung

func notify() {
  guard args.count >= 3 else { fail("Aufruf: notify <titel> <text>") }
  let center = UNUserNotificationCenter.current()
  let status = notificationStatus(request: true)
  guard status == "granted" else {
    emit(["ok": false, "error": "notifications", "status": status])
    exit(3)
  }
  let content = UNMutableNotificationContent()
  content.title = String(args[1].prefix(120))
  content.body = String(args[2].prefix(400))
  content.sound = .default
  var err: Error?? = nil
  center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { err = .some($0) }
  waitFor(timeout: 5) { err != nil }
  if case .some(.some(let e)) = err { fail("Mitteilung fehlgeschlagen: \(e.localizedDescription)") }
  emit(["ok": true])
}

// MARK: - Fenster anordnen

func axValue<T>(_ el: AXUIElement, _ attr: String) -> T? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
  return v as? T
}

func axFrame(_ el: AXUIElement) -> CGRect? {
  guard let p: AXValue = axValue(el, kAXPositionAttribute), let s: AXValue = axValue(el, kAXSizeAttribute) else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p, .cgPoint, &pt)
  AXValueGetValue(s, .cgSize, &sz)
  return CGRect(origin: pt, size: sz)
}

func setFrame(_ el: AXUIElement, _ r: CGRect) {
  var pt = r.origin, sz = r.size
  if let pv = AXValueCreate(.cgPoint, &pt) { AXUIElementSetAttributeValue(el, kAXPositionAttribute as CFString, pv) }
  if let sv = AXValueCreate(.cgSize, &sz) { AXUIElementSetAttributeValue(el, kAXSizeAttribute as CFString, sv) }
  // Position erneut setzen: manche Apps verschieben beim Vergrössern.
  if let pv = AXValueCreate(.cgPoint, &pt) { AXUIElementSetAttributeValue(el, kAXPositionAttribute as CFString, pv) }
}

func tileWindows() {
  guard AXIsProcessTrusted() else {
    emit(["ok": false, "error": "accessibility"])
    exit(4)
  }
  let me = getpid()
  let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
  // CG liefert die Fenster von vorne nach hinten (Z-Reihenfolge).
  var picked: [(el: AXUIElement, app: String, title: String)] = []
  var axCache: [pid_t: [AXUIElement]] = [:]
  for w in info {
    guard picked.count < 4 else { break }
    guard (w[kCGWindowLayer as String] as? Int) == 0,
      let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != me,
      let num = w[kCGWindowNumber as String] as? CGWindowID,
      (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.01
    else { continue }
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    if ["Window Server", "Dock", "WindowManager", "Control Center", "Kontrollzentrum"].contains(owner) { continue }
    if axCache[pid] == nil {
      let app = AXUIElementCreateApplication(pid)
      axCache[pid] = axValue(app, kAXWindowsAttribute) ?? []
    }
    guard let el = axCache[pid]!.first(where: { el in
      var id: CGWindowID = 0
      return _AXUIElementGetWindow(el, &id) == .success && id == num
    }) else { continue }
    let subrole: String = axValue(el, kAXSubroleAttribute) ?? ""
    let minimized: Bool = axValue(el, kAXMinimizedAttribute) ?? false
    guard subrole == (kAXStandardWindowSubrole as String), !minimized else { continue }
    let title: String = axValue(el, kAXTitleAttribute) ?? ""
    picked.append((el, owner, title))
  }
  if picked.isEmpty {
    emit(["ok": true, "count": 0, "windows": [], "message": "Keine passenden Fenster gefunden."])
    return
  }

  // Nutzbarer Bereich des Hauptbildschirms (mit Menüleiste), in AX-Koordinaten (Ursprung oben links).
  guard let main = NSScreen.screens.first else { fail("Kein Bildschirm") }
  let vf = main.visibleFrame
  let area = CGRect(x: vf.minX, y: main.frame.maxY - vf.maxY, width: vf.width, height: vf.height)
  let halfW = (area.width / 2).rounded(.down), halfH = (area.height / 2).rounded(.down)
  func cell(_ c: Int, _ r: Int, w: Int = 1, h: Int = 1) -> CGRect {
    CGRect(x: area.minX + CGFloat(c) * halfW, y: area.minY + CGFloat(r) * halfH,
           width: c + w == 2 ? area.width - CGFloat(c) * halfW : halfW * CGFloat(w),
           height: r + h == 2 ? area.height - CGFloat(r) * halfH : halfH * CGFloat(h))
  }
  let targets: [CGRect]
  switch picked.count {
  case 1: targets = [area]
  case 2: targets = [cell(0, 0, h: 2), cell(1, 0, h: 2)]
  case 3: targets = [cell(0, 0, h: 2), cell(1, 0), cell(1, 1)]
  default: targets = [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)]
  }

  var results: [[String: Any]] = []
  for (i, w) in picked.enumerated() {
    let target = targets[i]
    var sizable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(w.el, kAXSizeAttribute as CFString, &sizable)
    setFrame(w.el, target)
    usleep(60_000)
    let actual = axFrame(w.el) ?? .zero
    let tol: CGFloat = 12
    let fits = abs(actual.minX - target.minX) <= tol && abs(actual.minY - target.minY) <= tol
      && abs(actual.width - target.width) <= tol && abs(actual.height - target.height) <= tol
    var reason = ""
    if !fits {
      if !sizable.boolValue { reason = "Grösse nicht änderbar" }
      else if actual.width > target.width + tol || actual.height > target.height + tol { reason = "Mindestgrösse zu gross" }
      else { reason = "App hat die Grösse nicht übernommen" }
    }
    results.append(["app": w.app, "title": w.title, "ok": fits, "reason": reason])
  }
  emit(["ok": true, "count": picked.count, "windows": results])
}

// MARK: - Stage Manager

func stageManagerState() {
  CFPreferencesAppSynchronize("com.apple.WindowManager" as CFString)
  let pref = (CFPreferencesCopyAppValue("GloballyEnabled" as CFString, "com.apple.WindowManager" as CFString) as? Bool) ?? false
  // Miniaturen im Stage-Manager-Streifen sind sichtbare Fenster des WindowManager-Prozesses.
  let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
  let strip = info.filter { w in
    guard (w[kCGWindowOwnerName as String] as? String) == "WindowManager", (w[kCGWindowLayer as String] as? Int) == 0,
      let b = w[kCGWindowBounds as String] as? [String: Any], let width = b["Width"] as? Double
    else { return false }
    return width > 20 && width < 400
  }.count
  emit(["ok": true, "pref": pref, "strip": strip])
}

// MARK: - Zwischenablage / Emoji

typealias SavedItem = [(NSPasteboard.PasteboardType, Data)]

func snapshot(_ pb: NSPasteboard) -> [SavedItem] {
  (pb.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
}

func restore(_ pb: NSPasteboard, _ saved: [SavedItem]) {
  pb.clearContents()
  let items: [NSPasteboardItem] = saved.map { pairs in
    let it = NSPasteboardItem()
    for (t, d) in pairs { it.setData(d, forType: t) }
    return it
  }
  if !items.isEmpty { pb.writeObjects(items) }
}

func digest(_ saved: [SavedItem]) -> [[String: String]] {
  saved.map { pairs in
    Dictionary(uniqueKeysWithValues: pairs.map { ($0.0.rawValue, SHA256.hash(data: $0.1).map { String(format: "%02x", $0) }.joined()) })
  }
}

func insertEmoji() {
  guard args.count >= 3 else { fail("Aufruf: insert-emoji <emoji> <script>") }
  let emoji = args[1], script = args[2]
  let pb = NSPasteboard.general
  // Alle Elemente mit allen Datentypen sichern (Bilder, Dateien, RTF …), nicht nur Text.
  let saved = snapshot(pb)
  pb.clearContents()
  let item = NSPasteboardItem()
  item.setString(emoji, forType: .string)
  // Zwischenablage-Manager sollen den Zwischenstand ignorieren.
  item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
  item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"))
  pb.writeObjects([item])
  let ourCount = pb.changeCount

  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  p.arguments = [script, "v", "command"]
  let errPipe = Pipe()
  p.standardError = errPipe
  do { try p.run() } catch {
    restore(pb, saved)
    fail("osascript: \(error)")
  }
  p.waitUntilExit()
  if p.terminationStatus != 0 {
    let stderr = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    restore(pb, saved)
    emit(["ok": false, "error": "keystroke", "stderr": String(stderr.prefix(400))])
    exit(5)
  }
  // Einfügen ist in der Ziel-App asynchron: kurz warten, dann wiederherstellen.
  usleep(450_000)
  if pb.changeCount == ourCount {
    restore(pb, saved)
    emit(["ok": true, "restored": true, "items": saved.count])
  } else {
    // Jemand hat inzwischen etwas Neues kopiert: nicht überschreiben.
    emit(["ok": true, "restored": false, "items": saved.count])
  }
}

func clipboardDigest() {
  emit(["ok": true, "changeCount": NSPasteboard.general.changeCount, "items": digest(snapshot(NSPasteboard.general))])
}

// MARK: - App-Icon

func appIcon() {
  guard args.count == 4, let px = Int(args[3]), px > 0, px <= 1024 else { fail("Aufruf: app-icon <app> <out.png> <px>") }
  let icon = NSWorkspace.shared.icon(forFile: args[1])
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0) else { fail("Bitmap") }
  rep.size = NSSize(width: px, height: px)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  icon.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
  NSGraphicsContext.restoreGraphicsState()
  guard let data = rep.representation(using: .png, properties: [:]) else { fail("PNG") }
  do { try data.write(to: URL(fileURLWithPath: args[2])) } catch { fail("Schreiben: \(error)") }
  emit(["ok": true])
}

// MARK: - Einstieg

switch cmd {
case "serve": serve()
case "permissions": permissions()
case "notify": notify()
case "tile-windows": tileWindows()
case "stage-manager-state": stageManagerState()
case "insert-emoji": insertEmoji()
case "clipboard-digest": clipboardDigest()
case "app-icon": appIcon()
default:
  FileHandle.standardError.write(Data("Copper Deck Helper – nativer Teil. Start erfolgt über launchd.\n".utf8))
  exit(64)
}
