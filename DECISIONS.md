# Entscheidungen

Hier steht, was ich selbst entschieden habe. Neue Einträge kommen jeweils unten dazu.

## System (ermittelt am 2026-11-06)
- macOS 27.0 (26A428), Apple Silicon (arm64), LocalHostName `MacBook-Pro-von-Maurizio` → `MacBook-Pro-von-Maurizio.local`
- Node v26.3.1, npm 12.0.2 (Homebrew), mkcert und Xcode installiert
- Angular 22.2 (aktuelle stabile Version), TypeScript 6.0, Playwright 1.65 (WebKit 27.2)

## Projektstruktur
- npm-Workspaces: `web/` (Angular-PWA), `helper/` (ab Meilenstein 2), `shared/` (Typen).
- `shared` wird direkt als TypeScript eingebunden (Pfad-Mapping `@copper-deck/shared`), es gibt keinen eigenen Build-Schritt.
- `tools/` enthält Entwicklungsskripte: Icon-Extraktion, Screenshots und den Vergleich mit der Vorlage.
- npm 12 führt Install-Skripte nur aus, wenn sie freigegeben sind. sharp und esbuild laufen über ihre vorkompilierten Plattformpakete, deshalb müssen keine Skripte freigegeben werden.
- `npx` startet in npm 12 im Root-Paket. Für Angular-Befehle verwende ich deshalb `node_modules/.bin/ng` direkt.

## Konfigurationsmodell (shared/src/config.ts)
- Es gibt zwei Kachelarten. `app`: Das echte App-Icon füllt den Rahmen. `action`: Verlaufskachel mit Symbol oben rechts und Beschriftung unten links.
- Notion ist wie in der Vorlage eine **Aktions-Kachel** (braun, Notion-Icon oben rechts) mit der Aktion „App öffnen“. Figma ist eine reine App-Kachel. Die Startbelegung „Notion (App)“ ist damit eingehalten, nur die Darstellung folgt der Vorlage.
- Das Symbol einer Aktions-Kachel ist entweder `emoji`, `appIcon` (Icon einer installierten App) oder `image` (Datei, die der Helper gespeichert hat).
- Feste Aktionsliste: `openApp`, `openUrl`, `hotkey`, `tileWindows`, `stageManager`, `timer`, `insertEmoji`. Es gibt keinen Aktionstyp für Befehle oder Skripte.
- Jede Gruppe hat genau 8 Plätze, `null` steht für einen leeren Platz.
- Die Sortierung der Gruppe 2 folgt deiner Liste und nicht der Vorlage. Zeile 1: Stage Manager, Google Fonts, YouTube, Pomodoro. Zeile 2: Notion, Figma, Tile, Break.
- Für Google Fonts und YouTube verwende ich Emojis (🔤, ▶️) statt der Markenlogos aus der Vorlage. Echte Logos kannst du ab Meilenstein 4 als eigenes Bild hinterlegen.
- Die Beispieldaten enthalten zwei zusätzliche Gruppen, damit sich das Blättern testen lässt. Darin steckt bewusst Photoshop: Es ist nicht installiert und zeigt so die Markierung „nicht verfügbar“.

## App-Icons
- `npm run icons` durchsucht /Applications, ~/Applications, /System/Applications und /System/Library/CoreServices (jeweils eine Unterordner-Ebene tief). Die Icons landen in `web/public/app-icons/`, das von Git ignoriert wird.
- Regel: Normalerweise wandelt `sips` die `.icns` um. **Ausnahme:** Hat die App `CFBundleIconName` und eine `Assets.car`, nutze ich NSWorkspace (kleines Swift-Tool unter `tools/native/`). Der Grund: Bei solchen Apps ist die `.icns` oft nur ein veralteter Fallback. Notion liefert dort zum Beispiel ein randloses Electron-Icon ohne macOS-Form. Darum laufen die meisten Icons über NSWorkspace.
- Symlinks werden vorher aufgelöst. `/Applications/Safari.app` zeigt auf den Cryptex, und NSWorkspace würde sonst einen Alias-Pfeil ins Icon zeichnen.
- Dock-Vorschlag: zuerst die Apps aus deinem echten Dock (`persistent-apps`, dann `recent-apps`), danach weitere installierte Apps, insgesamt höchstens 12.
- macOS-Icons haben etwa 10 % transparenten Rand (sichtbare Form 824/1024). Damit das Icon den Rahmen fast ganz füllt, wird es um den Faktor 1.243 vergrössert (`--icon-overscan`). Die Icons werden nicht beschnitten.

## Design
- Alle Farben, Radien, Schatten und Bewegungen sind CSS-Variablen in `web/src/styles.css`. Die Kachelmasse leiten sich von `--frame` ab und folgen den Proportionen aus der Vorlage (`RATIO` in `layout.service.ts`).
- Farbproben aus der Vorlage (Mittel über 5×5 Pixel):

  | Stelle | Wert |
  |---|---|
  | Hintergrund oben links | `#1e0b00` |
  | Hintergrund oben rechts | `#511c00` |
  | Hintergrund Mitte | `#742802` |
  | Hintergrund unten Mitte | `#6f2801` |
  | Braune Kachel | `#8f3905` → `#7d2001` |
  | Violette Kachel | `#5f0c85` → `#4b0375` (iPhone `#561395`) |
  | Kachelrahmen | `#3c220e` (iPad) / `#723507` (iPhone), also transluzentes Kupfer |
- **Squircles:** eigene Implementierung der Bezier-Näherung für Continuous Corners (`core/squircle.ts`). Die `SurfaceDirective` zeichnet Fläche, Rand, Innenleuchten, Bevel und Schatten als SVG-Ebene hinter den Inhalt. Es gibt **kein** `clip-path`, keine Maske und kein `corner-shape`. Rand und Leuchten liegen innerhalb der Form, der Schatten ausserhalb (`overflow: visible`), dadurch wird nichts abgeschnitten.
- Kapseln (Emoji-Leiste, Pille, Uhr-Button) sind Squircles mit maximalem Radius.
- Barlow Condensed 600/700 liegt lokal als woff2 unter `web/public/fonts/` (SIL OFL, Lizenz liegt daneben).
- Animationen nutzen nur `transform` und `opacity`. Es gibt kein `backdrop-filter`. Overlays verwenden stattdessen einen deckenden Verlauf.
- Die SVG-Weichzeichner (Leuchten, Schatten) sind statisch. Beim Blättern und Wackeln werden nur Ebenen verschoben, ohne neu zu zeichnen. Ob das auf echten Geräten 60 fps schafft, muss der Test zeigen.

## Layout
- **Gerät:** Ist die kürzere Bildschirmseite mindestens 600 pt, gilt das Gerät als iPad, sonst als iPhone. Mit `?device=pad|phone` lässt sich das erzwingen.
- **iPad quer:** Zwei Gruppen müssen *vollständig* auf eine Seite passen, und rechts soll die nächste Seite angeschnitten hereinschauen. Bei 1180 pt Breite werden die Kacheln dadurch kleiner als in der Vorlage (Rahmen etwa 105 statt etwa 135 pt). In der Vorlage ist die zweite Gruppe selbst angeschnitten. Ich habe deine Vorgabe „zwei Gruppen pro Seite“ höher gewichtet. → Siehe offene Abweichungen.
- **iPad:** Der Uhr-Button ist in der Vorlage nicht zu sehen. Ich setze ihn wie beim iPhone über die Pille und zentriere beide vertikal zur Gruppenmitte.
- **iPhone quer:** Die Gruppe ist zentriert, rechts sitzen Uhr und Pille, unten die Seitenpunkte. Oben in der Mitte ist ein Griff wie in der Vorlage, der ebenfalls die Bar öffnet.
- **iPhone hoch:** Eine Gruppe mit 2×4 Kacheln, unten Uhr-Button und horizontale Pille.
- **„Bar“-Segment:** Auf dem iPad blendet es Emoji-Leiste und Dock ein oder aus, die Gruppen rücken dabei nach. Auf dem iPhone öffnet es ein Overlay. Das Segment ist hervorgehoben, solange die Bar sichtbar ist.
- **Safe Areas:** Gelesen über `env(safe-area-inset-*)`. Für Screenshots lassen sie sich mit `?safe=oben,rechts,unten,links` simulieren.

## Gesten
- Bewegt sich der Finger mehr als 10 px, ist es kein Tippen mehr. Wischen zählt erst, wenn |dx| > 1.2·|dy|. Langes Drücken braucht 500 ms ohne Bewegung.
- Sobald eine Wischgeste übernimmt, brechen alle Kacheln ihr Tippen und langes Drücken ab (`GestureBus`).
- Dock, Pille, Sheets und Overlays tragen `data-no-swipe`. Das Dock scrollt nativ mit `touch-action: pan-x` und wechselt keine Seite.
- Seitenwechsel über eine unterkritisch gedämpfte Feder (k = 240, c = 26) mit requestAnimationFrame auf `transform`. An den Enden gibt das Blättern leicht nach.

## Meilenstein 1 – bewusst Platzhalter
- Aktionen werden simuliert (`ActionService`). Damit lässt sich das Erfolgs- und Fehler-Feedback prüfen: Eine nicht installierte App liefert einen Fehler. Ab Meilenstein 2 läuft das über WebSocket.
- Der Timer läuft nur lokal im Browser. Ab Meilenstein 3 gibt der Helper die Endzeit vor.
- Langes Drücken zeigt nur den Bearbeitungsmodus (Wackeln, Minus-Symbol, „Fertig“). Verschieben und Bearbeiten kommen in Meilenstein 4.
- Für die Geräte gibt es nur HTTP über den Angular-Dev-Server. Service Worker und eine echte PWA brauchen HTTPS und kommen in Meilenstein 2.

## Meilenstein 2 – Helper, HTTPS, Kopplung

### Aufbau
- Der Helper ist in TypeScript geschrieben und wird mit esbuild zu **einer Datei** gebündelt (`helper/dist/copper-deck.mjs`). Das gibt eine stabile Grundlage für das App-Bundle in M3.
- Typprüfung mit `tsc`, Tests mit `node:test` über tsx.
- Express 5 und `ws` laufen auf **einem** HTTPS-Port, standardmässig **7443**. Der Port lässt sich in `settings.json` oder über `COPPER_DECK_PORT` ändern.
- zod-Schemas liegen in `shared/src/schema.ts`. Der Helper prüft damit Konfiguration, Client-Nachrichten und die Kopplung. Die PWA importiert diese Datei nicht.
- **CLI ↔ Helper:** Die CLI spricht über einen Unix-Socket im Datenordner (`admin.sock`, Rechte 600) mit dem Helper. So kann `copper-deck pair` den Code anzeigen, ohne dass der Helper ein Terminal hat. Der Code wird nie ins Log geschrieben.

### Sicherheit
- **Origin-Whitelist:** genau `https://<localhostname>.local:7443` und `https://localhost:7443`. Den Origin vergleiche ich in Kleinbuchstaben, weil Browser den Host kleingeschrieben senden. Die IP-Adresse ist bewusst **kein** erlaubter Origin, denn die App soll die `.local`-Adresse verwenden.
- **WebSocket:**
  - Origin wird beim Upgrade geprüft; ein fehlender oder falscher Origin wird mit 403 abgelehnt.
  - Query-Parameter in der WebSocket-URL werden mit 400 abgelehnt.
  - Das Token kommt als **erste Nachricht** (`auth`) und muss innerhalb von 5 s eintreffen.
  - Ein ungültiges Token wird mit Close-Code 4401 beantwortet, ein Widerruf mit 4403.
- **HTTP:**
  - Alle `/api`-Endpunkte ausser `POST /api/pair` verlangen `Authorization: Bearer`.
  - Ein vorhandener, aber falscher `Origin` ergibt 403.
  - Öffentlich ist nur die App-Shell (statische Dateien).
- **Icons:** Sie sind ebenfalls geschützt. Die PWA lädt sie per `fetch` mit Header und zeigt sie als Blob-URL, damit `<img src>` nie ein Token braucht. Zusätzlich liegen sie in Cache Storage, damit sie auch offline angezeigt werden.
- **Tokens:** 256 Bit Zufall (base64url). Gespeichert wird nur der SHA-256-Hash in `devices.json` (Rechte 600), Vergleich mit `timingSafeEqual`. Ein langsamer Hash ist bei Zufallstokens dieser Länge nicht nötig.
- **Kopplungscode:** wird mit `crypto.randomInt` erzeugt. Ein neuer `pair`-Aufruf ersetzt den alten Code. Nach einem Fehlversuch wartet der Server 400 ms.
- **Kopplung nur in der installierten PWA:** Auf iOS zeigt Safari ohne Standalone-Modus nur die Installationsanleitung. Auf dem Mac-Browser ist die Kopplung erlaubt (für Entwicklung und Tests).
- **Content Security Policy:** `script-src 'self'`, keine Inline-Skripte. Deshalb ist `inlineCritical` im Angular-Build abgeschaltet. `style-src` braucht `'unsafe-inline'`, weil Angular Styles inline setzt.
- **Datenordner:** Rechte 700. Schlüssel, Konfiguration, Geräte und Log haben die Rechte 600.

### Aktionen
- Der Client sendet nur `run {requestId, actionId}`. Die `actionId` ist eine Kachel-, Dock- oder Emoji-ID. Der Helper sucht die zugehörige Aktion in **seiner** Konfiguration und prüft sie vor der Ausführung erneut gegen das Schema.
- Damit auch Emojis eine Aktions-ID haben, sind sie jetzt `{id, emoji}`-Objekte (Konfigurationsänderung gegenüber M1).
- **App öffnen:** `execFile('/usr/bin/open', ['-b', bundleId])`. Fehlt die App, gibt es die verständliche Fehlermeldung „nicht installiert“.
- **Link öffnen:** `execFile('/usr/bin/open', [url])`, nur http/https, keine Zugangsdaten in der URL.
- **Alle Programme mit absolutem Pfad:** wichtig für launchd, das einen minimalen PATH hat.
- Aktionen aus M3 antworten vorerst mit `not_implemented`.
- **Timeout:** Server 15 s, Client 10 s. Bricht die Verbindung während einer Aktion ab, meldet der Client „Ergebnis unbekannt“ und wiederholt die Aktion **nicht**.
- **App-Verfügbarkeit:** Der Helper schickt die Liste der installierten Apps, die in der Konfiguration vorkommen. Kacheln für fehlende Apps zeigen „Nicht installiert“.
- **Startbelegung:** wird beim ersten Start im Helper angelegt. Das Dock enthält zuerst die Apps aus deinem macOS-Dock, dann zuletzt verwendete, dann Ergänzungen. Die Testgruppen aus M1 (Werkzeuge, Photoshop) sind entfernt.

### Verbindung
- **Reconnect-Backoff:** 0,5 / 1 / 2 / 4 / 8 / 15 s, jeweils plus bis zu 30 % Zufall.
  - Bei `visibilitychange`, `pageshow`, `focus` und `online`: sofort neu verbinden. Ist die Verbindung angeblich offen, schickt der Client ein Ping; kommt nach 4 s kein Pong, verbindet er neu.
  - Im Hintergrund plant der Client keine weiteren Versuche (iOS würde sie ohnehin anhalten).
- **Heartbeat:** Der Server pingt alle 20 s und beendet tote Sockets. Der Client sendet alle 15 s ein Ping auf Anwendungsebene.
- **Offline:**
  - Kacheln, Emoji-Leiste und Dock werden gedimmt, Kacheln zeigen ein Offline-Symbol.
  - Oben erscheint ein Banner; Tippen auf das Banner startet sofort einen neuen Versuch.
  - Tippen auf eine Kachel meldet sofort „Keine Verbindung“. Es wird **nichts** gespeichert oder nachgeholt (per E2E-Test geprüft).
- **Offline-Vollbild:** erscheint, wenn noch nie eine Konfiguration empfangen wurde. Sonst zeigt die App die zuletzt bekannte Konfiguration aus `localStorage` (sie enthält keine Geheimnisse) im Offline-Zustand.
- **Service Worker:** Angular-`ngsw`, die App-Shell wird vorab geladen. Navigation zu `/api` und `/ws` geht nie über den Cache. Beim allerersten Laden braucht der Service Worker einige Sekunden, bis die Shell im Cache liegt.
- **Sichtbarer Status:** Ein Punkt am About-Segment (grün, orange oder rot), das Banner und Details im About-Sheet.

### Zertifikat
- mkcert mit absolutem Pfad (`/opt/homebrew/bin/mkcert`).
- Namen im Zertifikat: `<localhostname>.local`, alle IPv4-Adressen der `en*`-Schnittstellen (keine VPN-Tunnel wie `utun`), `localhost`, `127.0.0.1`.
- Automatische Neuausstellung bei Ablauf in unter 30 Tagen, fehlendem Namen oder neuer IP.
- `copper-deck cert --renew` lädt das Zertifikat im laufenden Helper per `setSecureContext` neu, ohne Neustart.

### Behobener Fehler aus dem E2E-Test
- Ein sofortiger Neustart nach SIGTERM scheiterte: Der alte Prozess beantwortete den Admin-Socket noch bis zu 3 s.
- Jetzt schliesst der Helper beim Beenden zuerst den Socket und trennt offene HTTP-Verbindungen aktiv. Beim Start wartet er bis zu 6 s auf einen auslaufenden Vorgänger. Das ist auch für die launchd-Neustarts in M3 wichtig.

## Meilenstein 3 – Aktionen, LaunchAgent, Berechtigungen, Timer

### Berechtigungen: App-Bundle als verantwortlicher Prozess
- `~/Applications/Copper Deck Helper.app`, Bundle-ID `ch.copperdeck.helper`, ad-hoc signiert, `LSUIElement` (kein Dock-Symbol).
- **Hauptprogramm:** ein kleines Swift-Programm (`helper/native/CopperDeckHelper.swift`).
  - Mit `serve` startet es node als Kindprozess und reicht SIGTERM, SIGINT und SIGHUP weiter.
  - Die anderen Unterbefehle (Fenster, Zwischenablage, Mitteilung, Berechtigungen, Stage-Manager-Zustand, Icons) ruft der Helper per `execFile` auf.
- **Warum:** macOS ordnet Berechtigungen dem verantwortlichen Prozess zu. launchd startet das Bundle, und node, osascript und die Unterbefehle erben diese Verantwortlichkeit. Die Rechte hängen damit am Bundle und nicht an node. **Ein Node-Update ändert sie nicht.**
- **Das Bundle enthält nur Programm und Info.plist.** Bei ad-hoc-Signaturen ist die Identität der Code-Hash. Würde ich JS- oder Web-Dateien ins Bundle legen, wären die Berechtigungen nach jedem Update weg. Diese Dateien liegen deshalb unter `runtime/`.
  - `install.sh` baut das Bundle nur neu, wenn sich der Swift-Code ändert (Quell-Hash in der Info.plist).
  - Ändert sich der Swift-Code, musst du die Berechtigungen neu erteilen. Das Skript weist darauf hin.
- **Geprüft:**
  - Aus dem Terminal meldet das Bundle „Bedienungshilfen erteilt“, weil das Terminal sie hat.
  - Unter launchd meldete es zunächst „fehlt“. Damit ist belegt, dass Terminal-Rechte nicht übertragen werden.
  - Nach dem Erteilen für „Copper Deck Helper“ liefen alle Aktionen unter launchd.
- **node:** wird über den stabilen Homebrew-Symlink `/opt/homebrew/bin/node` gestartet (`runtime/launch.json`).
- **Firewall – Einschränkung:** Die Firewall regelt pro lauschender Binary, und das ist node unter einem versionierten Cellar-Pfad. Nach `brew upgrade node` fragt sie erneut.
  - Alternative: eine node-Kopie in `runtime/`. Das ergibt einen stabilen Pfad, dafür aber keine automatischen Sicherheitsupdates von node.
  - Entscheidung: Ich habe das nicht umgesetzt, weil die Firewall bei dir aus ist. Ich baue es um, wenn du das möchtest.

### Berechtigungsprüfung
- **Was geprüft wird:**
  - Bedienungshilfen: `AXIsProcessTrusted`.
  - Automation: `AEDeterminePermissionToAutomateTarget` für System Events; System Events wird dafür bei Bedarf unsichtbar gestartet.
  - Mitteilungen: `UNUserNotificationCenter`.
- **Wann geprüft wird:**
  - Beim Start und nach jedem passenden Fehler (osascript -1743, 1002 / -1719 / -25211).
  - Solange etwas fehlt, alle 3 s, sonst jede Minute. Änderungen gehen sofort an alle Geräte.
- **Systemdialoge** (Bedienungshilfen-Eintrag, Mitteilungen) erscheinen nur beim **ersten** Start im App-Kontext (Marker `permissions-prompted`), damit KeepAlive-Neustarts nicht ständig Dialoge zeigen. Über die App lassen sie sich erneut auslösen.
- **App:** About zeigt den Stand, den genauen Pfad in den Systemeinstellungen und den Knopf „Am Mac öffnen“ (feste System-Aktion `sys-settings-*`). Fehlt eine Berechtigung, zeigt das About-Segment einen roten Punkt.

### System-Aktionen
- Es gibt feste IDs, die nicht konfigurierbar sind: `sys-timer-*`, `sys-settings-*`, `sys-request-permissions`. Konfigurations-IDs dürfen nicht mit `sys-` beginnen (Schema).
- Für Tests unter launchd führt der Admin-Socket (nur lokal, Rechte 600) mit `runAction` eine streng typisierte Aktion aus.

### App öffnen: kooperative Aktivierung (Fund aus dem Test)
- **Problem:** Seit macOS 14 holt `open -b` die App aus einem Hintergrundprozess heraus **nicht** nach vorne, wenn gerade jemand eine andere App benutzt. Geprüft: Die Claude-App blieb vorne. Der Test aus M2 hatte das nicht bemerkt.
- **Lösung:** Nach `open -b` setzt `activate.applescript` (argv: Bundle-ID) über System Events `frontmost`. Das braucht Bedienungshilfen und Automation.
- **Fehlen diese Rechte,** wird die App trotzdem geöffnet, und die Antwort sagt, dass sie nicht nach vorne kam und warum.

### Tastenkombination
- AppleScript `keystroke.applescript` mit `on run argv`. Die Werte kommen nur als Argumente, das Skript liegt in `runtime/` und nicht im Bundle.
- **Buchstaben:** über `keystroke`, das dem aktiven Layout folgt. Auf Schweizerdeutsch landen Z und Y damit richtig.
- **Ziffern und Sondertasten:** über `key code`. `keystroke "1" using shift down` hat Shift ignoriert und „1“ geschrieben statt „+“. Die Ziffernreihe liegt auf QWERTZ und QWERTY an denselben Tasten.
- **Test unter launchd mit Schweizer Layout:** z, y, ⇧1, Leerzeichen, ⇧7, ⇧a ergaben „zy+ /A“, korrekt.

### Fenster anordnen
- **Auswahl:** CGWindowList in Z-Reihenfolge (von vorne nach hinten), Ebene 0. Eigene Prozesse sowie Dock, WindowManager und Kontrollzentrum zählen nicht. Die passenden AX-Fenster finde ich über `_AXUIElementGetWindow`, eine private, aber gängige API, ohne die sich CG- und AX-Fenster nicht sicher zuordnen lassen. Berücksichtigt werden nur `AXStandardWindow`, die nicht minimiert sind; die ersten 4 davon.
- **Zielbereich:** `visibleFrame` des Hauptbildschirms (mit Menüleiste), also ohne Menüleiste und Dock.
- **Raster:** 1 Fenster = ganzer Bereich; 2 = zwei Spalten; 3 = links eins über die volle Höhe, rechts zwei übereinander; 4 = 2×2.
- **Kontrolle:** Danach lese ich den tatsächlichen Rahmen aus (Toleranz 12 px). Abweichungen kommen in die Antwort, zum Beispiel „IntelliJ IDEA: Mindestgrösse zu gross“ (so beim Test auf deinem Mac).

### Stage Manager – Vergleich
| Variante | Ergebnis |
|---|---|
| `defaults write com.apple.WindowManager GloballyEnabled` | **wirkt unter macOS 27 sofort** (getestet aus dem Terminal und unter launchd) |
| Kurzbefehle-Aktion „Stage Manager festlegen“ | zuverlässig, aber der Kurzbefehl müsste von Hand angelegt werden, weil er sich nicht automatisch erstellen lässt |
| UI-Skripting im Kontrollzentrum | hängt an lokalisierten Bezeichnungen und am Aufbau des Kontrollzentrums, deshalb anfällig |
- **Gewählt:** `defaults`.
- **Kontrolle des tatsächlichen Zustands:**
  - Die Einstellung wird erneut gelesen.
  - Zusätzlich müssen die Miniaturen im Seitenstreifen (sichtbare `WindowManager`-Fenster) erscheinen bzw. verschwinden. Gewartet wird bis zu 6 s; beim ersten Test reichten 3 s nicht.
- **Ein- ohne Streifen:** Ist Stage Manager laut Einstellung an, aber kein Streifen zu sehen (keine weiteren Fenster), sagt die Antwort das ausdrücklich.

### Timer
- Der Helper speichert `{preset, startedAt, endsAt}` in `timer.json` (atomar, Rechte 600) und schickt den Zustand mit `serverNow` an alle Geräte. Die Geräte zählen mit korrigierter Uhrabweichung herunter, damit überall derselbe Countdown läuft.
- Es läuft immer nur ein Timer: derselbe noch einmal = stoppen, der andere = ersetzen.
- Ein Neustart des Helpers (getestet mit `launchctl kickstart -k`) behält den Timer.
- Ist der Timer abgelaufen, während der Helper aus war, wird die Mitteilung nachgeholt, sofern das höchstens 15 Minuten her ist.
- **Mitteilung:** über `UNUserNotificationCenter` aus dem Bundle, damit sie als „Copper Deck Helper“ erscheint und eine eigene Einstellung hat. `osascript display notification` würde dagegen als „Skripteditor“ erscheinen.

### Emoji einfügen
- **Ablauf im nativen Programm:**
  1. Alle Einträge der Zwischenablage mit **allen** Datentypen sichern, nur im Speicher und ohne temporäre Dateien.
  2. Das Emoji mit `org.nspasteboard.TransientType` und `AutoGeneratedType` setzen, damit Zwischenablage-Manager es ignorieren.
  3. ⌘V über System Events senden.
  4. Nach 450 ms wiederherstellen, aber nur, wenn inzwischen niemand etwas Neues kopiert hat (`changeCount`).
- **Test unter launchd:** In der Zwischenablage lagen ein PNG und eine Datei-URL. Danach waren Typen und SHA-256 identisch.
- **Nebenbefund:** Schreibt ein Prozess eine Datei-URL per `setString` und beendet sich sofort, verwirft macOS den Eintrag. Mit `setData`, wie der Helper es macht, bleibt er erhalten. Das ist mit getrennten Prozessen geprüft.

### Testvorfall
- Der erste Lauf von `e2e-m3-perms` hat Tastendrücke gesendet, während die **Claude-App** vorne war, weil TextEdit wegen der kooperativen Aktivierung nicht nach vorne kam. Betroffen waren „🥰zy+ /“, ⌘S und ⌘W.
- Der Test prüft jetzt vor **jedem** Tastendruck, ob TextEdit vorne ist, und bricht sonst ab. ⌘W sendet er nicht mehr.

## Meilenstein 4 – Bearbeiten, App-Icons, Live-Sync

### Speichern und Konflikte
- **Speichern** läuft über WebSocket: `saveConfig {requestId, baseRevision, config}`.
- **Prüfung im Helper:**
  - `baseRevision` muss der aktuellen Revision entsprechen, sonst lehnt der Helper mit `stale` ab und schickt dem Gerät sofort den aktuellen Stand.
  - Danach prüft er gegen das zod-Schema, ob alle verwendeten Bilder existieren, und schreibt atomar mit Backup (`config.backup.json`).
  - Die Revision erhöht er selbst; der Client kann sie nicht setzen.
- **Verteilung:** Jede akzeptierte Änderung geht als `config` an **alle** angemeldeten Geräte (Live-Sync).
- **Client:**
  - Eine Änderung erscheint sofort lokal (optimistisch).
  - Gespeichert wird in einer **Warteschlange**: jede Änderung erst, wenn die vorige bestätigt ist, und immer auf Basis der zuletzt bestätigten Revision. Schnell aufeinanderfolgende eigene Änderungen kollidieren deshalb nicht miteinander.
  - Bei `stale` werden wartende Änderungen verworfen, weil sie auf einem überholten Stand beruhen. Bei `invalid` gilt wieder der bestätigte Stand.
- **Was als Konflikt gilt:** Es gibt kein automatisches Zusammenführen. Ein Konflikt entsteht nur, wenn ein Gerät eine Änderung des anderen noch nicht kennt, und dann gewinnt der Helper-Stand. Kennt das Gerät die fremde Änderung schon, baut seine nächste Änderung darauf auf.
- **Grenzen:** Die maximale WebSocket-Nachricht beträgt jetzt 256 KB. Das Schema begrenzt Gruppen (64), Emojis (16) und Dock-Einträge (40).

### Bearbeitungsmodus
- **Verschieben:** Es gibt feste 8 Plätze pro Gruppe. Ziehen auf eine Kachel **tauscht** die beiden, Ziehen auf einen leeren Platz **verschiebt**. Das ist einfacher vorhersagbar als Nachrücken und passt zum Modell mit festen Plätzen.
- **Ziehen:** Eine Kopie der Kachel (eingehängt in `app-root`, damit die CSS-Variablen gelten) folgt dem Finger, bewegt nur per `transform`. Das Ziel ermittle ich mit `elementFromPoint`.
- **Rand:** 550 ms am Rand verweilen blättert, danach alle 900 ms eine weitere Seite.
- **Gesten:** Im Bearbeitungsmodus gehört eine Berührung auf einer Kachel der Kachel (`stopPropagation` + Pointer-Capture). Wischen auf freier Fläche oder leeren Plätzen blättert weiterhin.
- **Löschen ohne `window.confirm`,** weil Dialoge in einer iOS-PWA blockieren: Das erste Tippen auf „–“ fragt per Hinweis nach, ein zweites Tippen innerhalb von 3 s löscht.
- **Bearbeiten nur online:** Ohne Verbindung startet langes Drücken den Modus nicht. Bricht die Verbindung während der Bearbeitung ab, meldet die App, dass nicht gespeichert wurde, und zeigt wieder den bestätigten Stand.
- **Nicht bearbeitbar:** Emoji-Leiste und Dock sind in diesem Meilenstein nicht im Editor. Deine Vorgabe nennt nur Kacheln.
- **Behobener Fehler aus dem Test:** Das Loslassen nach dem langen Drücken öffnete sofort den Editor dieser Kachel. Jetzt startet es nur den Modus.
- **iPhone:** Quer liegt die Bearbeitungsleiste klein neben den Seitenpunkten. Hochkant ersetzt sie während der Bearbeitung Uhr und Pille.

### Editor
- **Typ:** App-Kachel oder Aktions-Kachel.
- **Aktionen:** feste Liste. App öffnen (über die App-Auswahl), Link öffnen (nur http/https, wird schon im Editor geprüft), Tastenkombination (Schalter für ⌘ ⌥ ⌃ ⇧ plus Tastenliste aus `HOTKEY_KEYS`), Emoji einfügen, Timer, Fenster anordnen, Stage Manager.
- **Weitere Felder:** Beschriftung (höchstens 40 Zeichen), Farbe Braun/Violett, Symbol (Emoji, eigenes Bild, App-Icon nur bei „App öffnen“, oder keines). Eine Live-Vorschau zeigt die echte Kachel.
- **App-Auswahl:** `GET /api/apps` liefert alle Apps aus den vier Ordnern (auf deinem Mac 261), mit Suche nach Name oder Bundle-ID. Die Icons laden einzeln nach. Der Helper extrahiert höchstens 4 gleichzeitig, damit 261 Icons nicht 261 Prozesse auf einmal starten.

### Eigene Bilder
- **Upload:** `POST /api/media` mit Token. Erlaubt sind nur die Content-Types PNG, JPEG und WebP; **zusätzlich** prüfe ich die Magic Bytes, damit ein SVG mit falschem Typ abgelehnt wird. Höchstens 2 MB.
- **Speichern:** Der Helper vergibt einen Zufallsnamen (`<32 hex>.png`). `sips` rechnet das Bild in ein PNG mit höchstens 512 px um. Das prüft zugleich, dass es sich dekodieren lässt, und entfernt Metadaten. Gespeichert wird unter `media/`.
- **Abruf:** Nur mit Token. Den Dateinamen prüfe ich streng, damit kein Pfad-Traversal möglich ist.
- **Aufräumen:** Nicht mehr verwendete Bilder löscht der Helper nach dem Speichern, frische Uploads aber erst nach 15 Minuten, damit ein Upload aus einem noch offenen Editor erhalten bleibt.

## Meilenstein 5 – PWA-Feinschliff, Updates, README

### Icons und Splash-Screens
- **Eigenes Motiv:** verschachtelte Rahmen mit 2×2 Kacheln in Braun und Violett auf Kupfer-Verlauf. Es entsteht aus derselben Squircle-Funktion wie die App. Gerendert wird mit Playwright WebKit (`tools/make-assets.mts`); Bildausschnitte aus der Vorlage verwende ich nicht.
- **Icons:** `apple-touch-icon` (180), 192, 512, „maskable“ 512 (Motiv in der sicheren Zone), Favicons 32/64. iOS rundet das apple-touch-icon selbst ab, deshalb ist es randlos.
- **Splash-Screens:** `apple-touch-startup-image` für 13 gängige iPhone- und iPad-Grössen, jeweils hoch- und querformatig (26 JPEGs, zusammen 1,2 MB), mit passenden Media-Queries in `index.html`. Sie liegen im Service Worker in einer Gruppe, die erst bei Bedarf lädt, damit Geräte nicht alle 26 Bilder herunterladen.
- **Startansicht:** `index.html` enthält eine statische Ansicht (Verlauf, Icon, Schriftzug), bis Angular geladen ist. Sie ist nur CSS, ohne Inline-Skript, und passt damit zur CSP.
- **Manifest:** `display: standalone`. iOS kennt `fullscreen` nicht; das Vollbild entsteht durch `black-translucent` + `viewport-fit=cover`. `orientation: landscape` ignoriert iOS, deshalb unterstützt die App beide Ausrichtungen.
- **Bundle-Icon:** Das App-Bundle „Copper Deck Helper“ bekommt **kein** eigenes Icon. Ein Icon würde den Bundle-Inhalt und damit den Code-Hash ändern, und alle Berechtigungen müssten neu erteilt werden. Es erscheint daher mit dem Standard-Symbol in den Systemeinstellungen.

### Updates über den Service Worker
- **Prüfung** (`SwUpdate.checkForUpdate`) beim Start, bei `visibilitychange` und alle 30 Minuten.
- **Kein automatischer Reload:** Bei `VERSION_READY` erscheint ein Hinweis mit „Aktualisieren“, damit nie mitten in einer Bedienung neu geladen wird. Ausnahme: Ist der Cache beschädigt (`unrecoverable`), lädt die App sofort neu.
- **Versionsanzeige:** `tools/write-version.mjs` schreibt Version und Build-Zeit vor jedem Build in `web/src/version.ts`; About zeigt beides an.
- **Geprüft** (`tools/e2e-m5-update.mjs`, gegen launchd): Version A ist geöffnet, Version B wird installiert. Der Hinweis erscheint, A läuft bis zum Tippen unverändert weiter, danach läuft B, und die Kopplung bleibt erhalten.

### Testskripte
- `e2e-m2-offline.mjs` stoppt den LaunchAgent jetzt mit `launchctl bootout/bootstrap`. Vorher hat es den Helper von Hand beendet und gestartet, was mit KeepAlive kollidiert.
- `e2e-m2.mjs` erwartet keine „Kommt in M3“-Meldung mehr.

## Nach Meilenstein 5 – Emoji-Leiste und Dock bearbeiten (Version 0.6.0)

### Bedienung
- **Gleicher Bearbeitungsmodus wie die Kacheln:** langes Drücken auf eine Kachel, ein Emoji oder ein Dock-Icon startet ihn. Einträge wackeln, haben ein „–“ (zweimal tippen) und am Ende ein „+“.
- **Antippen:** Emoji öffnet einen kleinen Editor (Eingabefeld für die Emoji-Tastatur plus 16 Vorschläge). Dock-Icon öffnet direkt die App-Auswahl und **ersetzt** die App; die ID bleibt gleich.
- **Umsortieren fügt ein statt zu tauschen.** Emoji-Leiste und Dock sind geordnete Listen ohne feste Plätze; Einfügen mit Nachrücken ist dort das erwartete Verhalten. Während des Ziehens rückt die Liste live nach.
- **Kurz halten (200 ms), dann ziehen.** Dock und (bei 16 Emojis am iPhone) die Emoji-Leiste scrollen horizontal. Sofortiges Wischen bleibt deshalb Scrollen. Sobald das Ziehen scharf ist, verhindert ein nicht-passiver `touchmove`-Listener das native Scrollen von iOS. Am Dock-Rand scrollt es beim Ziehen automatisch.
- **Keine doppelten Apps im Dock:** Die App-Auswahl markiert Apps, die schon im Dock sind, und lehnt sie mit Hinweis ab.
- **Grenzen** wie im Schema des Helpers: 16 Emojis, 40 Dock-Einträge. Die Beschriftung im Dock ist der App-Name, auf 40 Zeichen gekürzt.
- **iPhone:** Hochkant ersetzt die Bearbeitungsleiste Uhr und Pille, deshalb gibt es dort den Knopf „Leiste & Dock“, der das Overlay öffnet.
- **iPad:** „+ Gruppe“ und „Fertig“ stehen übereinander, weil die Emoji-Leiste durch das „+“ breiter wird und sonst darunter verschwindet.
- Eine leere Emoji-Leiste wird ausserhalb des Bearbeitungsmodus ausgeblendet.

### Technik
- **Kein Helper-Änderung nötig:** `saveConfig` prüfte Emojis und Dock schon in Meilenstein 4 gegen das Schema (Revision, eindeutige IDs, Grenzen).
- `ReorderController` (`web/src/app/core/reorder.ts`) kapselt Tippen, langes Drücken und Umsortieren für beide Listen. Die App-Auswahl ist als `cd-app-picker` aus dem Kachel-Editor herausgelöst und wird im Dock-Editor wiederverwendet.
- Die Bestätigung beim Entfernen (zweites Tippen) liegt jetzt in `core/confirm.ts` und unterscheidet Einträge per ID statt per Beschriftung.

### Tests
- `tools/e2e-bar.mjs`: iPad und iPhone gleichzeitig gegen launchd, 22 Prüfungen. Der Test fängt alle `run`-Nachrichten ab, damit am Mac nichts eingefügt oder geöffnet wird, und prüft so zugleich, dass langes Drücken und Ziehen keine Aktion auslösen.
- **Nicht automatisch prüfbar:** Ziehen und Scrollen mit dem Finger auf echten Geräten (Playwright steuert per Maus).

### Einrichtung in isolierten Netzen
- Im Firmen-WLAN kam das iPhone nicht an den Mac (Zeitüberschreitung, auch mit IP-Adresse): Client Isolation. Gelöst mit dem iPhone-Hotspot per USB. Im README unter Fehlerbehebung ergänzt, dazu iCloud Drive bzw. Mail als Weg für das Zertifikat, wenn AirDrop nicht geht.
- Ich erlaube die IP-Adresse bewusst **nicht** als zusätzlichen Origin: Sie ändert sich je nach Netz, und die App auf dem Home-Bildschirm ist an ihre Adresse gebunden.

## Meilenstein 6 – Windows-Version (Version 0.7.0)

### Architektur
- **Ein Helper für beide Systeme.** Node-Teil, Web-App, Protokoll und Konfiguration sind gemeinsam. Nur die Systemzugriffe unterscheiden sich: `helper/src/platform.ts` erkennt Windows, `WindowsAppCatalog` und `WindowsActions` ersetzen dort die Mac-Teile.
- **Natives Programm in C# statt Swift** (`helper/native/windows/CopperDeckHelper.cs`). Es wird bei der Installation mit dem `csc.exe` des .NET Framework 4.x gebaut, das auf jedem Windows 10/11 vorhanden ist. So braucht es weder Visual Studio noch ein .NET-SDK, und ich liefere keine vorkompilierte .exe aus. Deshalb nur C#-5-Sprachmittel. Es hat dieselbe Schnittstelle wie das Mac-Programm (Unterbefehle, eine JSON-Zeile auf stdout).
- **Autostart:** Aufgabenplanung („bei Anmeldung“, interaktiv, ohne erhöhte Rechte). Nur in der interaktiven Sitzung erreichen Tastenkombinationen die Fenster des Benutzers. `CopperDeckHelper.exe run` ist der Launcher: startet node ohne Konsolenfenster und startet ihn nach einem Ende neu (wie KeepAlive bei launchd). Ein Mutex verhindert zwei Instanzen.
- **Admin-Kanal der CLI:** Named Pipe pro Benutzer statt Unix-Socket.
- **Daten:** `%LOCALAPPDATA%\CopperDeck` (rechnerbezogen, nicht im Roaming-Profil, weil Zertifikat und Icons zum Rechner gehören).
- **Plattform in der App:** `GET /api/platform` (ohne Anmeldung, damit schon Kopplungs- und Offline-Ansicht „PC“ sagen) und `platform` in der ready-Nachricht. Gibt nur „mac“ oder „windows“ preis.

### App-Auswahl („Apps selber wählen“)
- **Quelle:** `shell:AppsFolder` – dieselbe Liste wie das Startmenü bzw. `Get-StartApps`, inklusive Store-Apps. Die Kennung ist die **AppUserModelID**. Das Schemafeld heisst weiter `bundleId`, erlaubt aber jetzt auch AppUserModelIDs (`APP_ID_PATTERN`: keine Steuerzeichen, keine in Windows-Pfaden verbotenen Zeichen). Der Mac-Helper prüft weiterhin das strenge Bundle-ID-Muster.
- **Gestartet wird nur, was im Katalog steht.** Eine ID vom Gerät wird nie als Pfad ausgeführt.
- **Beliebiges Programm:** Ich habe bewusst **keine** Dateiauswahl vom iPhone aus gebaut. Sie würde es erlauben, vom Telefon aus beliebige Programme auf dem PC zu starten. Stattdessen legt `copper-deck add-app <exe>` lokal am PC eine Startmenü-Verknüpfung an; danach erscheint das Programm in der normalen Auswahl. Wer am PC sitzt, entscheidet also, was startbar ist.
- **Icons:** `IShellItemImageFactory` (256 px mit Transparenz), Cache-Dateinamen als Hash, weil AppUserModelIDs `\ ! { }` enthalten.

### Aktionen unter Windows
- **App öffnen:** Läuft die App schon (Fenster eines Prozesses mit derselben .exe), wird es nach vorne geholt; sonst Start über `shell:AppsFolder\<ID>`. Windows erlaubt Hintergrundprozessen das Aktivieren nur eingeschränkt; der übliche Weg (kurzes Alt-Signal vor `SetForegroundWindow`) wird verwendet. Klappt es trotzdem nicht, meldet die App das.
- **Tastenkombination:** `SendInput`. Modifier nach Lage auf der Tastatur: ⌘ = Win, ⌥ = Alt, ⌃ = Strg, ⇧ = Umschalt. So bleibt die Konfiguration im gleichen Format. Die App zeigt unter Windows „Strg, Alt, Umschalt, Win“ und belegt neue Kombinationen mit Strg vor. Buchstaben über `VkKeyScanW` (folgt dem Tastaturlayout).
- **Emoji:** `SendInput` mit `KEYEVENTF_UNICODE` statt Zwischenablage. Einfacher und lässt die Zwischenablage unberührt.
- **Fenster anordnen:** gleiche Aufteilung wie am Mac (1/2/3/4 Fenster), Arbeitsbereich des Bildschirms mit dem vordersten Fenster, unsichtbare Fensterränder von Windows 10/11 werden ausgeglichen.
- **Stage Manager:** gibt es nicht. Die Aktion wird im Editor ausgeblendet (ausser eine Kachel verwendet sie schon) und meldet „nur am Mac“. Die Windows-Startbelegung hat an ihrer Stelle „Aufgabenansicht“ (Win+Tab).
- **Administrator-Fenster:** Windows blockiert Eingaben in erhöhte Fenster (UIPI) ohne Fehlermeldung. Das native Programm prüft das vorher und die App nennt das Programm.
- **Mitteilung:** Infobereich-Benachrichtigung (`NotifyIcon`), unter Windows 10/11 als normale Benachrichtigung. Ohne eigene AppUserModelID, daher ohne Eintrag in den Benachrichtigungseinstellungen.
- **Bilder:** WIC über WPF (PNG, JPEG, WebP), statt sips.

### Netzwerk
- **mDNS:** Windows 10/11 meldet `<Computername>.local`. Ins Zertifikat kommen nur echte LAN-Adapter, keine virtuellen (Hyper-V, WSL, VPN).
- **Firewall:** Ohne Adminrechte fragt Windows beim ersten Start; mit Adminrechten legt `install.ps1` eine Regel nur für TCP 7443 und private Netzwerke an. Öffentlich eingestufte Netze erkennt das Skript und gibt einen Hinweis.

### Getestet und nicht getestet
- **Getestet (auf dem Mac):** 15 neue Unit-Tests mit nachgebildetem Windows (Katalog, Icon-Cache, Aktionen, Fehlertexte, Startbelegung, ID-Prüfung); alle 48 Tests grün. App im Windows-Modus per Playwright angesehen. Mac-Regressionstest (`e2e-bar.mjs`) grün.
- **Nicht getestet:** `CopperDeckHelper.cs` ist **nicht kompiliert**: Auf diesem Mac gibt es keinen C#-Compiler, und das Herunterladen eines .NET-SDK in den temporären Ordner wurde von der Rechteprüfung abgelehnt. `install.ps1` ist **nicht ausgeführt** (kein PowerShell hier). Beides ist der erste Schritt der Testcheckliste am PC.

## Meilenstein 7 – Lightroom-Classic-Tab (Version 0.8.0)

### Warum ein Plugin
- Nur **Lightroom Classic** hat eine Plugin-Schnittstelle (Lua-SDK), über die sich Regler wirklich auf Werte setzen lassen (`LrDevelopController`). Tastenkombinationen allein könnten das nicht.
- **Ein Plugin für Mac und Windows** (`lightroom/CopperDeck.lrplugin`, reines Lua, keine nativen Teile). Die Installationsskripte legen es in den **Modules**-Ordner, den Lightroom beim Start automatisch lädt. So muss man nichts im Zusatzmodul-Manager hinzufügen.

### Verbindung
- Das Plugin öffnet mit `LrSocket` zwei **lokale** Ports (47801 empfangen, 47802 senden; LrSocket kann pro Socket nur eine Richtung). Der Helper verbindet sich als Client und versucht es alle 2 s erneut. So ist es egal, ob Lightroom oder der Helper zuerst startet.
- **Format:** Helper → Plugin eine Tabulator-getrennte Zeile (`id, befehl, argumente`), Plugin → Helper eine JSON-Zeile. Lua in Lightroom hat keinen JSON-Leser; die einfache Zeile genügt für die festen Befehle. JSON schreibt das Plugin mit einem eigenen kleinen Encoder.
- **Zustand:** Das Plugin prüft alle 250 ms Foto, Modul und (im Entwickeln-Modul) die Reglerwerte und meldet nur Änderungen. Damit folgt die App auch Änderungen, die am Rechner gemacht werden.
- **Bereiche:** Temperatur und Tönung haben je nach Foto andere Bereiche (Raw: Kelvin, JPEG: −100…100). Das Plugin meldet den echten Bereich; die App rechnet damit.

### Bedienung
- **Eigener Tab** statt Kacheln: Der Bildschirm wechselt zwischen Kacheln und Lightroom (Segment „LR“ in der Pille, grüner Punkt = verbunden). Emoji-Leiste und Dock sind im Lightroom-Tab ausgeblendet, damit die Regler Platz haben.
- **Regler:** relatives Ziehen (kein Sprung beim Antippen), Feinmodus über senkrechten Abstand wie das Scrubbing in iOS, −/+ mit der Schrittweite von Lightroom (`increment`/`decrement`), Doppeltippen = Standardwert.
- **Drosselung:** Pro Regler ist höchstens ein Wert unterwegs; während er auf Antwort wartet, wird nur der neueste vorgemerkt. Das hält Lightroom flüssig, ohne Werte aufzustauen. Nach dem Loslassen gilt der eigene Wert noch 0,9 s, damit verspätete Meldungen den Regler nicht zurückspringen lassen.
- **Regler-Befehle wechseln automatisch ins Entwickeln-Modul**, weil `LrDevelopController` nur dort wirkt. In der Bibliothek zeigt die App die Regler gesperrt mit Knopf „Zu Entwickeln wechseln“ (die Werte sind dort nicht lesbar).
- **Exportieren:** Das SDK kann „Mit vorherigen Einstellungen exportieren“ nicht direkt auslösen. Der Helper holt Lightroom nach vorne und sendet die Standard-Tastenkombination (⌘⌥⇧E bzw. Strg+Alt+Umschalt+E). So gelten deine eigenen Exporteinstellungen.
- **Zurücksetzen** braucht wie das Löschen ein zweites Tippen.
- **Zahlenformat de-CH:** Dezimalpunkt (+0.35), wie Lightroom mit Schweizer Einstellungen.

### Sicherheit
- Feste Liste von 64 Reglern und 20 Befehlen; der Helper prüft mit zod, das Plugin prüft noch einmal. Ein Test vergleicht die Reglerliste in `Protocol.lua` mit der in `shared/src/lightroom.ts`.
- Vorgaben werden nur per UUID angewendet, die das Plugin selbst geliefert hat.

### Getestet und nicht getestet
- **Getestet:** Brücke im Helper gegen ein nachgebildetes Plugin über echte TCP-Verbindungen (7 Unit-Tests: Verbindung, Filter, Antworten, Abbruch, Wiederverbinden, Befehlsprüfung, Listenabgleich). Ende-zu-Ende mit iPad und iPhone gegen den Helper unter launchd und `tools/fake-lightroom.mjs` (23 Prüfungen, inkl. Live-Sync und Trennen).
- **Nicht getestet:** Das Lua-Plugin selbst. Lightroom Classic ist auf diesem Mac nicht installiert, und weder ein Lua-Interpreter noch fengari (Lua in JavaScript) durften installiert werden. Erster Punkt der Testcheckliste.

## Meilenstein 8 – Unterwegs mit Tailscale (Version 0.9.0)

### Warum Tailscale statt eigenem Server
- Deine Vorgabe: Das Handy soll sich **immer direkt** mit dem Laptop verbinden. Ein Server, der nur die Web-App ausliefert, hilft in isolierenden Netzen nicht (die Verbindung zum Laptop wäre dort genauso blockiert), und ein Relais über den Server wäre nicht direkt.
- Tailscale verbindet deine Geräte über WireGuard und durchdringt NAT/Firmennetze meist **direkt**; nur wenn das nicht geht, über einen Tailscale-Relay (weiterhin Ende-zu-Ende verschlüsselt). Du hast dem zugestimmt. Ein eigener Server ist damit nicht nötig.

### Umsetzung
- Der Helper erkennt Tailscale (macOS: App-Bundle bzw. Homebrew-CLI, Windows: `tailscale.exe`), liest `tailscale status --json` und nimmt `https://<name>.ts.net:7443` als **zusätzliche** erlaubte Adresse auf. Lokal bleibt alles wie bisher; Tailscale ist optional.
- **Zwei Zertifikate über SNI** auf demselben Port: `*.ts.net` bekommt das echte Let's-Encrypt-Zertifikat von `tailscale cert`, alles andere das mkcert-Zertifikat. Das Tailscale-Zertifikat kommt über stdout (`--cert-file - --key-file -`), weil die App-Store-Version von Tailscale nicht in beliebige Ordner schreiben darf.
- **Rückfall:** Bis das echte Zertifikat da ist, enthält das mkcert-Zertifikat auch den Tailscale-Namen. Geräte mit mkcert-Profil können die Tailscale-Adresse also sofort nutzen.
- **Erneuerung:** Prüfung jede Minute (Name und Zertifikat; anfangs alle 10 Minuten, was zu langsam war, wenn Tailscale erst nach dem Helper eingeschaltet wird), neues Zertifikat erst unter 30 Tagen Restlaufzeit. Tailscale-Namensänderungen übernimmt der Helper ohne Neustart (erlaubte Adressen werden bei jeder Anfrage neu gelesen).
- **macOS-Eigenheit:** Die Tailscale-App ist zugleich die CLI. Unter launchd (ohne Terminal) versucht sie, ihr Fenster zu starten („The Tailscale GUI failed to start“). `TAILSCALE_BE_CLI=1` erzwingt den CLI-Modus. Gefunden und behoben beim Test unter launchd.
- **Neutraler Name:** Let's-Encrypt-Zertifikate stehen öffentlich in den Certificate-Transparency-Logs. Auf deinen Wunsch habe ich den Mac in Tailscale in `copperdeck-mac` umbenannt (`tailscale set --hostname`); der Mac-Name selbst ist unverändert.
- **Anzeige:** About zeigt die Tailscale-Adresse („Unterwegs“); `copper-deck pair` und `copper-deck status` nennen sie ebenfalls; neu `copper-deck tailscale`.

### Getestet und offen
- **Getestet:** 7 Unit-Tests (Status lesen, Namensprüfung, stdout aufteilen, Zertifikat holen/speichern/nicht unnötig erneuern, Fehlererklärung, SNI mit zwei Zertifikaten). Unter launchd: Tailscale-Adresse erkannt, Rückfall-Zertifikat mit ts.net-Namen, `https://copperdeck-mac.tailf11a59.ts.net:7443` antwortet.
- **Offen:** Das echte Zertifikat konnte ich nicht holen. Im KTLU-Netz liest „Swisscom SecurePOP“ verschlüsselte Verbindungen mit, Let's Encrypt ist so nicht prüfbar. Auch der Tailscale-Relay ist von dort nicht erreichbar. Ob iPhone und Mac sich im KTLU-WLAN über Tailscale direkt finden, muss der Test am iPhone zeigen; über den Hotspot oder Mobilfunk sollte es gehen.

## Startseiten auf battle-isle.app

- **Was auf die Domains kommt:** Informationsseiten, nicht die App. Copper Deck muss auf jedem Rechner selbst laufen (nur der lokale Helper kann Apps öffnen und Tasten senden); eine zentral gehostete App könnte keinen Rechner steuern. Die Seiten erklären Installation, iPhone-Einrichtung, Tailscale, Lightroom und Hilfe; der Download kommt vom öffentlichen GitHub-Repo.
- **Eine Vorlage, zwei Seiten:** `site/src/page.html` mit Mac-/Windows-Blöcken, gebaut von `site/build.mjs`. So bleiben beide Seiten gleich aufgebaut, und Texte passen zum System (Terminal/PowerShell, Mac/PC, AirDrop/Mail).
- **Statisch und streng:** kein Inline-Skript (nur `app.js` für die Kopieren-Knöpfe), eigene Schriften, keine externen Ressourcen, keine Cookies oder Statistik. CSP in Caddy wie bei photoAI.
- **Deploy wie photoAI:** gleicher Server, gleicher Caddy, eigener read-only nginx-Container für beide Hostnamen.
- **DNS:** Beide Namen zeigen bei Cloudflare derzeit auf Cloudflare-Proxys (orange Wolke) und liefern Fehler 525, weil der Server für sie noch kein Zertifikat hat. Wie bei den anderen Seiten gehören sie auf „nur DNS“ (graue Wolke) mit `A → 78.47.125.152`; das kann ich ohne Cloudflare-Zugang nicht ändern.
- **Geprüft:** beide Seiten in Playwright WebKit bei 1280 px und 390 px; kein horizontales Scrollen, alle Ressourcen laden, Kopieren-Knöpfe da. Nicht geprüft: nginx-Konfiguration (kein Docker auf diesem Mac) und der eigentliche Deploy (SSH-Zugriff auf den Server wurde von der Rechteprüfung abgelehnt).

## Adobe Lightroom (Cloud-Version) im LR-Tab (Version 0.10.0)

### Was ich geprüft habe (an deinem installierten Lightroom 10.0, App-Store-Version)
- **Keine Plugin-Schnittstelle** (nur Classic hat das Lua-SDK).
- **Fensterinhalt nicht zugänglich:** Die Bedienungshilfen sehen im Lightroom-Fenster 0 Elemente, Regler lassen sich also auch nicht „anfassen“.
- **Internes Steuerungs-API für Hardware-Konsolen** (`LrAppController` u. a. in Lightrooms kompilierten Lua-Dateien): undokumentiert. Darauf aufzubauen hiesse, Adobes internen Code nachzubauen – fragil und vermutlich nicht erlaubt. Bewusst nicht verwendet.
- **Tastendrücke:** Buchstaben und Pfeile kommen an, **Ziffern (Sterne) nicht**, weder als Tastencode noch als Zeichen. Damit wären Bewertungen unzuverlässig.
- **Menüleiste zugänglich:** Menüeinträge auswählen funktionierte bei jedem Versuch, auch Sterne. Lightroom trägt jede Aktion ins Rückgängig-Menü ein („Als Bewertung 3 festlegen“).
- Die echte Kurzbefehlsliste stammt aus Lightroom selbst (`AgKeyboardShortcuts.lua`, Menüattribute). Standard-Satz: Markiert = Z (nicht P wie in Classic), Abgelehnt = X, Unmarkiert = U, Sterne 0–5, Farben 6–9, Bedienfelder ⌘1–⌘7.

### Umsetzung
- **Mac:** `helper/native/lightroom-menu.applescript` wählt den Eintrag über System Events (dieselbe Berechtigung wie die übrigen Aktionen). Gefunden wird er über **Kurzbefehl + Modifier**, damit es nicht von der Sprache abhängt. Nur Einträge ohne Kurzbefehl (vorheriges/nächstes Foto, Vorher/Nachher, Lila, Keine Farbe) gehen über den Namen (Deutsch und Englisch).
- **Tempo:** Der erste Entwurf brauchte bis zu 11 s, weil er jedes Menüelement einzeln abfragte. Alle Attribute einer Ebene in einem Abruf und erst die Ebene, dann die Untermenüs: 0,3 s (oberste Ebene) bzw. etwa 1 s (Untermenüs).
- **Fehlernummern** des Skripts 9001–9003, weil 1002 bei macOS „Bedienungshilfen fehlen“ heisst (ein Test hat die Verwechslung gefunden).
- **Läuft Lightroom nicht,** startet Copper Deck es und wiederholt den Befehl einmal.
- **Windows:** Kurzbefehle aus derselben Liste mit Strg statt ⌘, Lightroom wird vorher nach vorne geholt. Ungetestet.
- **App:** Ist Classic verbunden, gilt Classic (Regler). Sonst und wenn Adobe Lightroom installiert ist (`lightroomCloud` in der ready-Nachricht), zeigt der Tab Schaltflächen: Navigation, Sterne, Markierungen, Farben, Ansicht, Bedienfelder, Werkzeuge, Einstellungen und Export. Ohne Zustand, weil Lightroom nichts zurückmeldet. „Zurücksetzen“ braucht ein zweites Tippen.

### Getestet
- 5 Unit-Tests (Zuordnung aller 41 Befehle, Argumente, Starten und Wiederholen, Fehlertexte, ohne Lightroom).
- **An deinem Lightroom, vom iPad (Testbrowser) über den Helper:** Raster, Einzelbild, Nächstes, Vorheriges, 4 Sterne (gesetzt und über die App rückgängig gemacht), Licht-Bedienfeld – alles erfolgreich, mit Screenshots geprüft.
- **Zwischenfälle beim Testen:**
  - Zweimal gingen Testschritte daneben: zuerst Tasten, während du selbst am Mac warst, dann einmal 3 Sterne aus einem Zeitmesslauf.
  - Die Sterne habe ich sofort zurückgenommen, erst nachdem ich den Rückgängig-Eintrag geprüft hatte.
  - Ein Durchgang über alle 15 Fotos zeigte danach keine Sterne und keine Markierungen.
  - Vor jedem Tastendruck prüft der Test jetzt, dass Lightroom vorne ist.
