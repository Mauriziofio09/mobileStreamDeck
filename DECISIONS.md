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
