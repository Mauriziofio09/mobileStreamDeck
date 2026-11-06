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
