# Copper Deck

Copper Deck macht iPhone und iPad zu einem Touch-Panel für deinen Mac oder Windows-PC, ähnlich einem Stream Deck. Du tippst eine Kachel an, und der Mac (bzw. PC) öffnet eine App oder einen Link, sendet eine Tastenkombination, fügt ein Emoji ein, ordnet Fenster an, schaltet Stage Manager um oder startet einen Timer.

```
iPhone / iPad (PWA, Vollbild)  ──WSS/HTTPS im WLAN──▶  Copper Deck Helper (Mac, launchd)
  Angular 22, Service Worker                           Node/Express + natives App-Bundle
```

**Inhalt**
1. [Voraussetzungen](#1-voraussetzungen)
2. [Installation auf dem Mac](#2-installation-auf-dem-mac)
3. [Zertifikat auf iPhone und iPad vertrauen](#3-zertifikat-auf-iphone-und-ipad-vertrauen)
4. [App auf den Home-Bildschirm legen](#4-app-auf-den-home-bildschirm-legen)
5. [Koppeln](#5-koppeln)
6. [macOS-Berechtigungen](#6-macos-berechtigungen)
7. [Bedienung](#7-bedienung)
8. [Kacheln bearbeiten](#8-kacheln-bearbeiten)
9. [Aktionen im Detail](#9-aktionen-im-detail)
10. [Updates](#10-updates)
11. [Zertifikat erneuern](#11-zertifikat-erneuern)
12. [macOS-Firewall](#12-macos-firewall)
13. [Befehle (CLI)](#13-befehle-cli)
14. [Daten, Logs und Sicherheit](#14-daten-logs-und-sicherheit)
15. [Deinstallation](#15-deinstallation)
16. [Fehlerbehebung](#16-fehlerbehebung)
17. [Entwicklung](#17-entwicklung)
18. [Windows](#18-windows)
19. [Lightroom Classic](#19-lightroom-classic)

---

## 1. Voraussetzungen

| Was | Hinweis |
|---|---|
| macOS 14 oder neuer | getestet unter macOS 27.0 auf Apple Silicon |
| Homebrew | https://brew.sh |
| Node.js | `brew install node` (getestet mit 26.3) |
| mkcert | `brew install mkcert`, danach **einmalig** `mkcert -install` (fragt nach dem Mac-Passwort) |
| Swift-Compiler | `xcode-select --install`, falls Xcode bzw. die Command Line Tools fehlen |
| iPhone/iPad | iOS/iPadOS 17 oder neuer, **im selben WLAN** wie der Mac |

## 2. Installation auf dem Mac

```bash
git clone <repo> copper-deck && cd copper-deck
npm install
scripts/install.sh
```

`install.sh` braucht kein sudo und erledigt Folgendes:

1. Es baut die Web-App und den Helper.
2. Es baut **`~/Applications/Copper Deck Helper.app`**, ein kleines, ad-hoc-signiertes App-Bundle. An diesem Bundle hängen die macOS-Berechtigungen (siehe [Abschnitt 6](#6-macos-berechtigungen)). Neu gebaut wird es nur, wenn sich sein nativer Code geändert hat. So bleiben die Berechtigungen bei Updates erhalten.
3. Es kopiert die Laufzeitdateien nach `~/Library/Application Support/CopperDeck/runtime/`.
4. Es legt den Befehl `copper-deck` an (`/opt/homebrew/bin/copper-deck`).
5. Es richtet den **LaunchAgent** `ch.copperdeck.helper` ein und startet ihn. Der Helper startet damit bei jeder Anmeldung und nach einem Absturz automatisch, ganz ohne Terminal.

Beim **ersten Start** erzeugt der Helper:
- das HTTPS-Zertifikat für **`<Name-deines-Macs>.local`** und die aktuelle LAN-IP (mit mkcert)
- die Startbelegung (Finder, Bücher, Nachrichten … und dein Dock)

Danach ist Copper Deck erreichbar unter **`https://<localhostname>.local:7443`**. Den genauen Namen zeigt dir `copper-deck status`. Auf diesem Mac lautet die Adresse:
**https://macbook-pro-von-maurizio.local:7443**

> Die App verwendet immer die `.local`-Adresse. Bekommt der Mac im WLAN eine neue IP-Adresse, funktioniert alles weiter.

## 3. Zertifikat auf iPhone und iPad vertrauen

iOS vertraut der Verbindung erst, wenn die **Root-CA von mkcert** installiert **und** ausdrücklich freigegeben ist. Das machst du einmal pro Gerät.

1. Am Mac: `copper-deck ca`. Der Finder zeigt die Datei **`rootCA.pem`**.
   > ⚠️ Gib nur `rootCA.pem` weiter, **niemals** `rootCA-key.pem`.
2. `rootCA.pem` per **AirDrop** ans iPhone bzw. iPad senden (Rechtsklick → Teilen → AirDrop). Auf dem Gerät erscheint „Profil geladen“. Fragt das iPad nach dem Gerät, wähle das iPad.
   > Geht AirDrop nicht: `rootCA.pem` in den iCloud Drive legen und auf dem Gerät in der App **Dateien** antippen, oder per Mail an dich selbst schicken und den Anhang in Mail antippen. Danach die Kopie im iCloud Drive wieder löschen.
3. Auf dem Gerät **Einstellungen** öffnen. Ganz oben steht **„Profil geladen“**; falls nicht: **Allgemein → VPN und Geräteverwaltung**.
4. Das Profil **„mkcert …“** antippen → **Installieren** → Gerätecode eingeben → **Installieren** bestätigen.
5. **Wichtig:** **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** öffnen (ganz unten auf der Info-Seite).
6. Unter „Volles Vertrauen für Root-Zertifikate aktivieren“ den Schalter bei **mkcert …** einschalten → **Fortfahren**.
7. Zum Prüfen in Safari `https://<localhostname>.local:7443` öffnen. Es darf **keine** Zertifikatswarnung erscheinen.

## 4. App auf den Home-Bildschirm legen

1. In **Safari** die Adresse aus Schritt 3.7 öffnen.
2. **Teilen** (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → **Hinzufügen**.
3. **Copper Deck vom Home-Bildschirm aus öffnen.** Die App startet im Vollbild, mit eigenem Icon und Startbild.

> **Warum nicht in Safari koppeln?** iOS trennt den Speicher von Safari und den Home-Bildschirm-Apps. Ein in Safari gekoppeltes Gerät wäre in der App nicht gekoppelt. Safari zeigt deshalb nur die Installationsanleitung.

## 5. Koppeln

1. Am Mac im Terminal: **`copper-deck pair`**. Der Befehl zeigt einen **6-stelligen Code**. Er ist 5 Minuten gültig, gilt nur einmal und ist nach 5 Fehlversuchen gesperrt.
2. In der installierten App den Code und einen Gerätenamen eingeben → **Koppeln**.

Jedes Gerät erhält ein eigenes Token. Gekoppelte Geräte verwaltest du so:

```bash
copper-deck devices          # auflisten (● = gerade verbunden)
copper-deck revoke <id>      # widerrufen – das Gerät wird sofort getrennt
```

In der App geht das unter **About → Gekoppelte Geräte → Widerrufen**.

## 6. macOS-Berechtigungen

Alle Berechtigungen gelten für **„Copper Deck Helper“**, nicht für Terminal oder node.

| Berechtigung | Wofür | Wo aktivieren |
|---|---|---|
| **Bedienungshilfen** | Tastenkombinationen, Emoji, Fenster anordnen, Apps nach vorne holen | Systemeinstellungen → Datenschutz & Sicherheit → **Bedienungshilfen** → „Copper Deck Helper“ einschalten |
| **Automation → System Events** | Tastenkombinationen, Emoji, Apps nach vorne holen | Den Dialog „Copper Deck Helper möchte System Events steuern“ mit **Erlauben** bestätigen. Später zu finden unter Datenschutz & Sicherheit → **Automation** → „Copper Deck Helper“ → „System Events“ |
| **Mitteilungen** | Hinweis, wenn ein Timer abgelaufen ist | Systemeinstellungen → **Mitteilungen** → „Copper Deck Helper“ → Mitteilungen erlauben |

- **In der App** siehst du unter **About → Berechtigungen am Mac** für jede Berechtigung ✓ oder ! samt Pfad. **„Am Mac öffnen“** öffnet die passende Einstellung direkt auf dem Mac.
- Sobald du eine Berechtigung erteilst, **erkennt die App das nach wenigen Sekunden von selbst**. Fehlt eine Berechtigung, zeigt das About-Segment einen roten Punkt.
- **Im Terminal:** `copper-deck permissions`. Mitteilungen testest du mit `copper-deck notify-test`.

**Warum ein eigenes App-Bundle?** macOS ordnet Berechtigungen dem „verantwortlichen“ Prozess zu. Startest du den Helper im Terminal, gelten die Rechte des Terminals; für den LaunchAgent gelten sie nicht. Hier startet launchd das Bundle, und das Bundle startet node. Damit hängen die Rechte am Bundle: Ein Node-Update ändert nichts daran, ein Update von Copper Deck ebenfalls nicht, solange sich der native Teil nicht ändert. Ändert er sich doch, sagt `install.sh` Bescheid.

## 7. Bedienung

| Element | Funktion |
|---|---|
| **Kachel antippen** | Aktion ausführen. Die Kachel drückt sich ein, leuchtet auf und zeigt ✓ bei Erfolg oder ✕ mit Grund bei einem Fehler. |
| **Wischen** | Seite wechseln. iPad: 2 Gruppen pro Seite, die nächste Seite schaut rechts herein. iPhone: 1 Gruppe pro Seite. |
| **Seitenpunkte** | direkt zu einer Seite springen |
| **Emoji-Leiste** | Emoji am Mac einfügen (an der Stelle, an der gerade getippt wird) |
| **Dock** | Apps öffnen. Das Dock scrollt seitlich, ohne die Seite zu wechseln. |
| **Uhr-Button** | Timer-Auswahl. Ein laufender Timer zeigt den Countdown auf dem Button und der Kachel. |
| **Pille → About** | Verbindungsstatus, Gerät, Versionen, gekoppelte Geräte, Berechtigungen |
| **Pille → Bar** | iPad: Emoji-Leiste und Dock ein- oder ausblenden. iPhone: als Overlay öffnen. Alternativ auf dem iPhone oben den Griff antippen. |

**Verbindung**
- Der Punkt am About-Segment zeigt den Status: grün = verbunden, orange = verbindet bzw. offline, rot = Berechtigung fehlt.
- Ohne Verbindung sind die Kacheln gedimmt, und oben erscheint ein Hinweis. Antippen meldet sofort „Keine Verbindung“; **Aktionen werden nicht gespeichert und nicht nachgeholt.**
- Kommst du aus dem Hintergrund zurück, verbindet sich die App sofort neu.
- Ist der Mac nicht erreichbar, startet die App trotzdem aus dem Cache und zeigt eine Offline-Ansicht.

**Ausrichtung:** Copper Deck ist fürs Querformat optimiert, funktioniert aber auch im Hochformat. iOS lässt sich bei Web-Apps nicht auf eine Ausrichtung festlegen.

## 8. Kacheln bearbeiten

- **Langes Drücken** (0,5 s) auf eine Kachel startet den Bearbeitungsmodus. Die Kacheln wackeln.
- **Ziehen:** auf eine andere Kachel = Plätze tauschen; auf einen leeren Platz = verschieben. Das geht auch in andere Gruppen. **Am linken oder rechten Rand halten** blättert zur nächsten Seite.
- **Antippen** öffnet den Editor:
  - **Typ:** App-Kachel (echtes App-Icon) oder Aktions-Kachel (Verlauf in Braun oder Violett, Beschriftung unten links)
  - **Aktion:** App öffnen · Link öffnen · Tastenkombination · Emoji einfügen · Timer · Letzte 4 Fenster anordnen · Stage Manager. Es gibt bewusst keine Aktion für Befehle oder Skripte.
  - **Beschriftung, Farbe** und **Symbol** (Emoji, eigenes Bild, App-Icon oder keines)
  - **App-Auswahl:** alle Apps aus /Applications, ~/Applications, /System/Applications und /System/Library/CoreServices, mit Suche
  - **Eigenes Bild:** PNG, JPEG oder WebP bis 2 MB (kein SVG)
- **Leerer Platz antippen:** neue Kachel. **„–“ zweimal antippen:** Kachel entfernen.
- **„+ Gruppe“** legt eine leere Gruppe an; eine leere Gruppe lässt sich mit **„Gruppe entfernen“** löschen. **„Fertig“** beendet den Modus.

### Emoji-Leiste und Dock

Im Bearbeitungsmodus lassen sich auch Emoji-Leiste und Dock bearbeiten. Den Modus startet auch langes Drücken auf ein Emoji oder ein Dock-Icon. Am iPhone öffnet **„Leiste & Dock“** in der Bearbeitungsleiste die beiden.

- **Antippen:** Emoji ändern (Emoji-Tastatur oder Vorschläge) bzw. die App im Dock ersetzen (App-Auswahl).
- **„+“** am Ende fügt ein Emoji (höchstens 16) bzw. eine App (höchstens 40) hinzu. Eine App, die schon im Dock ist, wird nicht doppelt aufgenommen.
- **„–“ zweimal antippen** entfernt den Eintrag.
- **Umsortieren:** kurz halten (0,2 s), dann ziehen. Der Eintrag wird an der neuen Stelle **eingefügt**, die anderen rücken nach. Am Rand des Docks scrollt es beim Ziehen mit. Sofortiges Wischen ohne Halten scrollt Leiste bzw. Dock.

**Speichern:** Jede Änderung speichert der Helper sofort und zeigt sie **live auf allen Geräten**. Haben zwei Geräte gleichzeitig etwas geändert, gewinnt die zuerst gespeicherte Änderung. Das andere Gerät meldet „Ein anderes Gerät hat inzwischen etwas geändert“ und lädt den aktuellen Stand.

## 9. Aktionen im Detail

| Aktion | Umsetzung am Mac |
|---|---|
| **App öffnen** | `open -b <Bundle-ID>`, denn App-Namen sind lokalisiert („Bücher“/„Books“). Danach holt System Events die App nach vorne; macOS tut das bei Hintergrundprozessen nicht selbst. |
| **Link öffnen** | im Standardbrowser, nur `http`/`https` |
| **Tastenkombination** | über System Events. Buchstaben folgen dem Tastaturlayout des Macs (getestet mit Schweizerdeutsch: Z/Y, ⇧1 = „+“, ⇧7 = „/“). |
| **Emoji einfügen** | Die Zwischenablage wird **vollständig** gesichert (Text, Bilder, kopierte Dateien …), dann wird das Emoji eingefügt und die Zwischenablage nach kurzer Zeit wiederhergestellt. Hast du inzwischen etwas Neues kopiert, wird nichts überschrieben. |
| **Letzte 4 Fenster anordnen** | Die vier vordersten sichtbaren, nicht minimierten Fenster kommen als 2×2-Raster auf den nutzbaren Bereich des Hauptbildschirms. Bei 3 Fenstern: links eines, rechts zwei; bei 2: nebeneinander; bei 1: ganzer Bereich. Fenster mit fester oder zu grosser Mindestgrösse werden in der Antwort genannt. |
| **Stage Manager** | wird umgeschaltet; danach prüft der Helper den tatsächlichen Zustand |
| **Timer** | Pomodoro (25 Min.) oder Pause (5 Min.). Es läuft immer nur ein Timer: nochmals tippen = stoppen, der andere Timer = ersetzen. Alle Geräte zeigen denselben Countdown; ein Neustart des Macs oder Helpers verliert ihn nicht. Am Ende erscheint eine Mitteilung am Mac. |

## 10. Updates

- **App (iPhone/iPad):** Nach `scripts/install.sh` erkennt die App die neue Version beim nächsten Öffnen, beim Zurückkehren aus dem Hintergrund oder spätestens nach 30 Minuten. Unten erscheint **„Neue Version von Copper Deck ist bereit. Aktualisieren“**. Die App lädt nie ungefragt neu. Von Hand prüfen: About → „Nach Update suchen“.
- **Mac:** Neuen Stand holen und `scripts/install.sh` erneut ausführen. Gekoppelte Geräte, Konfiguration und Berechtigungen bleiben erhalten.

## 11. Zertifikat erneuern

mkcert-Zertifikate gelten etwa 2 Jahre und 3 Monate. Der Helper prüft bei jedem Start und **erneuert das Zertifikat selbst**, wenn es in weniger als 30 Tagen abläuft, wenn der `.local`-Name fehlt (etwa nach einer Umbenennung des Macs) oder wenn sich die LAN-IP geändert hat.

```bash
copper-deck cert             # prüfen, nur bei Bedarf neu ausstellen
copper-deck cert --renew     # sofort neu ausstellen; der laufende Helper übernimmt es ohne Neustart
copper-deck cert-status      # Namen und Ablaufdatum anzeigen
```

Solange die mkcert-Root-CA dieselbe bleibt, musst du auf iPhone und iPad **nichts** tun. Nur wenn die CA neu erzeugt wurde (etwa nach `mkcert -uninstall` und Löschen von `$(mkcert -CAROOT)`), wiederholst du [Abschnitt 3](#3-zertifikat-auf-iphone-und-ipad-vertrauen).

## 12. macOS-Firewall

Ist die Firewall aus (Standard), musst du nichts tun. Ist sie eingeschaltet, hast du zwei Möglichkeiten:

- **Beim ersten Start** fragt macOS „Soll das Programm ‚node‘ eingehende Netzwerkverbindungen akzeptieren?“ → **Erlauben**.
- **Von Hand:** Systemeinstellungen → Netzwerk → Firewall → Optionen → node hinzufügen → „Eingehende Verbindungen erlauben“. Oder per Terminal:

```bash
NODE_BIN="$(readlink -f /opt/homebrew/bin/node)"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$NODE_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$NODE_BIN"
```

> Bekannte Einschränkung: Die Firewall regelt Verbindungen pro lauschender Binary, und das ist hier node unter einem versionierten Homebrew-Pfad. Nach `brew upgrade node` fragt die Firewall deshalb erneut; dann einfach nochmals erlauben. Die Datenschutz-Berechtigungen aus [Abschnitt 6](#6-macos-berechtigungen) sind davon nicht betroffen.

## 13. Befehle (CLI)

| Befehl | Zweck |
|---|---|
| `copper-deck pair` | Kopplungscode anzeigen |
| `copper-deck devices` | gekoppelte Geräte auflisten |
| `copper-deck revoke <id>` | Gerät widerrufen |
| `copper-deck status` | läuft der Helper? Version, Adresse, PID |
| `copper-deck permissions` | macOS-Berechtigungen prüfen |
| `copper-deck notify-test` | Testmitteilung senden |
| `copper-deck cert [--renew]` | TLS-Zertifikat prüfen bzw. erneuern |
| `copper-deck cert-status` | Zertifikatsdetails |
| `copper-deck ca` | mkcert-Root-CA im Finder zeigen (für AirDrop) |

**LaunchAgent**

```bash
launchctl kickstart -k gui/$(id -u)/ch.copperdeck.helper     # neu starten
launchctl print gui/$(id -u)/ch.copperdeck.helper | head -20 # Zustand
launchctl bootout gui/$(id -u)/ch.copperdeck.helper          # stoppen (bis zur nächsten Anmeldung)
```

## 14. Daten, Logs und Sicherheit

| Was | Wo |
|---|---|
| Konfiguration + Backup der letzten Version | `~/Library/Application Support/CopperDeck/config.json`, `config.backup.json` |
| Gekoppelte Geräte (nur Token-Hashes) | `…/CopperDeck/devices.json` (Rechte 600) |
| TLS-Zertifikat und Schlüssel | `…/CopperDeck/tls/` (Schlüssel 600) |
| App-Icon-Cache, eigene Bilder | `…/CopperDeck/icons/`, `…/CopperDeck/media/` |
| Laufender Timer | `…/CopperDeck/timer.json` |
| Laufzeitdateien | `…/CopperDeck/runtime/` |
| Logs (ohne Tokens und Codes) | `~/Library/Logs/CopperDeck/helper.log`, `launchd.out.log`, `launchd.err.log` |
| App-Bundle | `~/Applications/Copper Deck Helper.app` |
| LaunchAgent | `~/Library/LaunchAgents/ch.copperdeck.helper.plist` |

**Sicherheit im Überblick**
- **Verbindung:** nur HTTPS/WSS im lokalen Netz.
  - Bei jeder WebSocket-Verbindung wird der **Origin** geprüft (nur die `.local`-Adresse und localhost) und danach das **Token**, das als erste Nachricht kommt.
  - Alle HTTP-Endpunkte ausser der App-Shell und der Kopplung verlangen ein Token im `Authorization`-Header.
  - Tokens stehen **nie in der URL**.
- **Tokens:** pro Gerät eines, zufällig erzeugt (256 Bit). Der Helper speichert nur den SHA-256-Hash. Widerrufen trennt das Gerät sofort.
- **Aktionen:** Das Gerät sendet zum Ausführen nur **Aktions-IDs**. Der Helper kennt eine feste Liste streng typisierter Aktionen, **ohne** Befehle oder Skripte.
  - Jede Konfigurationsänderung wird gegen ein Schema geprüft.
  - Programme starten mit `execFile` und Argumentlisten.
  - AppleScript bekommt Werte nur als Argumente (`on run argv`).
- **Links und Bilder:** Links nur http/https. Bilder nur PNG, JPEG oder WebP mit Grössenlimit; der Helper rechnet sie um und vergibt die Dateinamen.

## 15. Deinstallation

```bash
scripts/uninstall.sh
```

Das Skript stoppt den LaunchAgent und entfernt App-Bundle, Laufzeitdateien und CLI. Danach **fragt** es, ob es auch die Berechtigungen zurücksetzen und die Daten löschen soll.

**Root-CA wieder entfernen**
- **iPhone/iPad:** Einstellungen → Allgemein → VPN und Geräteverwaltung → Profil „mkcert …“ → **Profil entfernen**. Damit ist auch der Eintrag unter Zertifikatsvertrauenseinstellungen weg.
- **Mac:** `mkcert -uninstall`. Die mkcert-CA kann auch von anderen Projekten genutzt werden, entferne sie also nur, wenn du sie sonst nicht brauchst. Für eine vollständige Entfernung danach auch den Ordner `$(mkcert -CAROOT)` löschen.

## 16. Fehlerbehebung

**Safari meldet „Diese Verbindung ist nicht privat“**
- Die Root-CA ist nicht installiert oder nicht freigegeben. Wiederhole [Abschnitt 3](#3-zertifikat-auf-iphone-und-ipad-vertrauen), besonders Schritt 5–6 (Zertifikatsvertrauenseinstellungen).
- Am Mac `copper-deck cert-status` ausführen: Der `.local`-Name muss in der Liste stehen.

**Safari findet `….local` nicht**
- Ist das Gerät im selben WLAN wie der Mac, nicht im Gäste-WLAN und nicht über Mobilfunk verbunden? Manche Netze blockieren mDNS (`.local`) oder isolieren Geräte voneinander (Client Isolation).
- Den Namen prüfen: Systemeinstellungen → Allgemein → Freigaben → „Lokaler Hostname“.
- **Seite lädt ewig bzw. „Server reagiert nicht mehr“** (auch mit der IP-Adresse des Macs): Das Netz isoliert die Geräte voneinander, typisch für Firmen-, Schul- und Gäste-WLANs. Dagegen hilft nur ein anderes Netz, am einfachsten der **persönliche Hotspot** des iPhones. Lässt sich der Hotspot nicht per WLAN aktivieren, das iPhone **per USB-Kabel** anschliessen, Hotspot einschalten und am Mac das WLAN ausschalten. Das Zertifikat gilt weiter, weil es auf den `.local`-Namen ausgestellt ist.
- Hast du den Mac umbenannt? Dann den Helper neu starten (`launchctl kickstart -k …`). Er stellt das Zertifikat für den neuen Namen aus. Danach die App auf dem Home-Bildschirm entfernen und mit der neuen Adresse neu hinzufügen.

**Die App zeigt „Mac nicht erreichbar“ oder bleibt offline**
1. `copper-deck status`. Antwortet der Befehl nicht, läuft der Helper nicht → `launchctl kickstart -k gui/$(id -u)/ch.copperdeck.helper` und `~/Library/Logs/CopperDeck/launchd.err.log` ansehen.
2. Ist der Mac im Ruhezustand? Ein schlafender Mac ist nicht erreichbar.
3. Ist die Firewall an? Siehe [Abschnitt 12](#12-macos-firewall).
4. Im Banner „Offline“ antippen, um sofort einen neuen Versuch zu starten.

**In Safari erscheint nur die Anleitung „Zum Home-Bildschirm“**
- So ist es gewollt: Gekoppelt wird in der installierten App, siehe [Abschnitt 4](#4-app-auf-den-home-bildschirm-legen).

**„Kein aktiver Code“ oder „Code abgelaufen“ beim Koppeln**
- Mit `copper-deck pair` einen neuen Code holen. Ein Code gilt 5 Minuten und nur einmal, nach 5 Fehlversuchen ist er gesperrt.

**Plötzlich wieder die Kopplungsansicht**
- Das Gerät wurde widerrufen, oder iOS hat die Website-Daten gelöscht (etwa unter Einstellungen → Apps → Safari → Erweitert → Website-Daten). Einfach neu koppeln.

**Tastenkombination, Emoji oder „App nach vorne“ funktioniert nicht**
- About → Berechtigungen am Mac: Steht dort ein „!“, die Berechtigung wie in [Abschnitt 6](#6-macos-berechtigungen) beschrieben erteilen.
- Wartet am Mac ein Dialog „… möchte System Events steuern“? Mit **Erlauben** bestätigen.
- Steht der Eintrag „Copper Deck Helper“ in Bedienungshilfen zwar eingeschaltet, wirkt aber nicht (etwa nach einer Änderung am nativen Teil): Eintrag mit „–“ entfernen, `launchctl kickstart -k gui/$(id -u)/ch.copperdeck.helper` ausführen und wieder einschalten.
- Ein Emoji landet dort, wo am Mac gerade der Cursor steht. Ist kein Textfeld aktiv, passiert nichts sichtbar.

**Keine Mitteilung am Ende des Timers**
- Systemeinstellungen → Mitteilungen → „Copper Deck Helper“ → erlauben. Danach mit `copper-deck notify-test` prüfen.
- Ein aktiver Fokus („Nicht stören“) kann Mitteilungen unterdrücken.

**„Fenster anordnen“ ordnet nicht alle Fenster an**
- Manche Apps haben eine feste oder zu grosse Mindestgrösse. Die Antwort nennt diese Fenster mit Grund, etwa „IntelliJ IDEA: Mindestgrösse zu gross“.

**Stage Manager meldet „Seitenstreifen nicht sichtbar“**
- Stage Manager ist an, aber es gibt keine weiteren Fenster, die im Streifen erscheinen könnten. Das ist kein Fehler.

**„Ein anderes Gerät hat inzwischen etwas geändert“**
- Zwei Geräte haben gleichzeitig bearbeitet. Der aktuelle Stand ist bereits geladen; wiederhole deine Änderung.

**Bild-Upload wird abgelehnt**
- Erlaubt sind PNG, JPEG und WebP bis 2 MB; SVG geht nicht. iOS wandelt HEIC-Fotos beim Auswählen normalerweise selbst in JPEG um. Ist ein Foto zu gross, einen Ausschnitt oder Screenshot davon verwenden.

**Die App zeigt eine alte Version**
- About → „Nach Update suchen“. Kommt kein Hinweis, die App vom App-Umschalter schliessen und neu öffnen.
- Notfalls die App vom Home-Bildschirm entfernen und neu hinzufügen. Danach musst du neu koppeln.

**Logs ansehen**

```bash
tail -f ~/Library/Logs/CopperDeck/helper.log
cat ~/Library/Logs/CopperDeck/launchd.err.log
```

## 17. Entwicklung

```
shared/   gemeinsame Typen, Protokoll, zod-Schemas, Startbelegung
web/      Angular-22-PWA (Strict-Modus), Service Worker
helper/   Node/Express-Helper (esbuild-Bundle), native/ = Swift + AppleScript
scripts/  install.sh, uninstall.sh
tools/    Screenshots, Vergleich mit der Vorlage, Assets, End-to-End-Tests
```

```bash
npm run build                          # Web + Helper bauen
npm test                               # Typprüfung + Unit-Tests des Helpers
node --import tsx tools/make-assets.mts  # Icons und Splash-Screens neu erzeugen
```

**End-to-End-Tests** (gegen den installierten Helper unter launchd):

| Skript | Prüft |
|---|---|
| `node tools/e2e-m2.mjs` | HTTPS, Kopplung, App/Link öffnen |
| `node tools/e2e-m2-offline.mjs` | Offline und Reconnect, ohne Nachholen (stoppt den LaunchAgent kurz) |
| `node tools/e2e-m3.mjs basic` | Stage Manager, Timer, Neustart, Berechtigungsfehler |
| `node tools/e2e-m3-perms.mjs` | Tastatur mit Schweizer Layout, Emoji und Zwischenablage, Fenster, Mitteilung. Öffnet TextEdit und ordnet deine Fenster neu an. |
| `node tools/e2e-m4.mjs` | zwei Geräte gleichzeitig: Bearbeiten, Ziehen, Editor, Bilder, Live-Sync, Konflikt |
| `node tools/e2e-lightroom.mjs` | Lightroom-Tab mit nachgebildetem Plugin: Regler, Bewertung, Vorgaben, Live-Sync, Trennen |
| `node tools/e2e-bar.mjs` | zwei Geräte: Emoji-Leiste und Dock bearbeiten, umsortieren, Live-Sync (fängt alle Aktionen ab) |
| `node tools/e2e-m5-update.mjs` | App-Update über den Service Worker (führt `install.sh` aus) |

Getroffene Entscheidungen und Abwägungen stehen in [DECISIONS.md](DECISIONS.md).

## 18. Windows

Copper Deck läuft auch unter **Windows 10 und 11**. iPhone und iPad, App, Kopplung und Bearbeiten funktionieren gleich wie am Mac; die Unterschiede stehen hier.

> **Stand:** Der Windows-Teil ist noch **nicht auf echtem Windows getestet**. Geprüft sind die Logik (Unit-Tests mit nachgebildetem Windows) und die Darstellung der App im Windows-Modus. Siehe Testcheckliste in DECISIONS.md.

### Voraussetzungen
In einer **PowerShell** (keine Administratorrechte nötig):

```powershell
winget install OpenJS.NodeJS.LTS
winget install FiloSottile.mkcert
winget install Git.Git
# PowerShell schliessen und neu öffnen, damit node, mkcert und git gefunden werden
mkcert -install                     # Root-CA anlegen (Windows fragt einmal nach)
```

### Installation
```powershell
git clone https://github.com/Mauriziofio09/mobileStreamDeck.git
cd mobileStreamDeck
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Das Skript baut Web-App und Helper, baut `CopperDeckHelper.exe` mit dem C#-Compiler, der in jedem Windows enthalten ist (.NET Framework 4.x), kopiert alles nach `%LOCALAPPDATA%\CopperDeck\runtime` und richtet die **Aufgabenplanung** ein: Der Helper startet bei jeder Anmeldung und nach einem Absturz neu. Danach weiter wie am Mac:

1. **Zertifikat aufs iPhone/iPad:** `copper-deck ca` zeigt `rootCA.pem` im Explorer. AirDrop gibt es unter Windows nicht: per Mail an dich selbst, über OneDrive bzw. iCloud für Windows. Auf dem Gerät antippen, installieren und in den Zertifikatsvertrauenseinstellungen freigeben ([Abschnitt 3](#3-zertifikat-auf-iphone-und-ipad-vertrauen), ab Schritt 3).
2. In Safari **`https://<computername>.local:7443`** öffnen (die genaue Adresse zeigt `install.ps1` am Ende) → Teilen → **Zum Home-Bildschirm**.
3. `copper-deck pair` → Code in der App eingeben.

### Firewall und Netzwerk
- Windows fragt beim ersten Start nach **Node.js**: für **private Netzwerke** zulassen. Wird `install.ps1` in einer Administrator-PowerShell ausgeführt, legt es die Regel „Copper Deck“ (TCP 7443, privat) selbst an.
- Ist das WLAN als **öffentlich** eingestuft, blockiert Windows eingehende Verbindungen. Zu Hause: Einstellungen → Netzwerk und Internet → WLAN → dein Netzwerk → Netzwerkprofil **Privat**.
- Firmen- und Gäste-WLANs isolieren Geräte oft voneinander, siehe [Fehlerbehebung](#16-fehlerbehebung).

### Unterschiede zum Mac
| | Mac | Windows |
|---|---|---|
| **App-Auswahl** | alle Apps aus /Applications u. a. | alle Programme aus dem **Startmenü**, inkl. Store-Apps, mit Icons |
| **Eigenes Programm** | – | `copper-deck add-app "C:\Pfad\Programm.exe" [Name]` legt eine Verknüpfung im Startmenü an; danach steht es in der App-Auswahl |
| **App öffnen** | öffnet bzw. holt nach vorne | läuft die App schon, holt Copper Deck ihr Fenster nach vorne, sonst startet sie |
| **Tastenkombination** | ⌘ ⌥ ⌃ ⇧ | **Strg, Alt, Umschalt, Win**. Buchstaben folgen dem Tastaturlayout (Schweizerdeutsch: Z/Y). |
| **Emoji einfügen** | über die Zwischenablage | direkt als Unicode-Eingabe; die Zwischenablage bleibt unberührt |
| **Fenster anordnen** | letzte 4 Fenster | ebenso, auf dem Bildschirm des vordersten Fensters |
| **Stage Manager** | ja | gibt es nicht; die Startbelegung hat stattdessen **Aufgabenansicht** (Win+Tab) |
| **Berechtigungen** | Bedienungshilfen, Automation, Mitteilungen | keine nötig |
| **Mitteilung am Timer-Ende** | Mitteilungszentrale | Windows-Benachrichtigung |

**Grenze unter Windows:** Läuft das Fenster im Vordergrund **als Administrator** (z. B. der Task-Manager oder eine Admin-PowerShell), lässt Windows keine Tastenkombinationen und Emojis von Copper Deck zu. Die App meldet das mit dem Namen des Programms.

### Daten und Befehle
- Daten, Zertifikat, Icons: `%LOCALAPPDATA%\CopperDeck\`, Logs: `%LOCALAPPDATA%\CopperDeck\Logs\` (`helper.log`, `launcher.log`)
- `copper-deck status | pair | devices | revoke <id> | cert | ca | add-app | notify-test`
- Neu starten: Aufgabenplanung → „Copper Deck Helper“ → Beenden/Ausführen, oder `CopperDeckHelper.exe stop` und `Start-ScheduledTask "Copper Deck Helper"`
- Update: `git pull`, dann erneut `install.ps1`
- Deinstallation: `powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1` (mit `-Purge` auch Daten, Kopplungen und Zertifikat)

### Fehlerbehebung Windows
- **„Ausführung von Skripts ist deaktiviert“:** das Skript wie oben mit `-ExecutionPolicy Bypass` starten.
- **Seite lädt nicht, obwohl der Helper läuft:** Netzwerkprofil „Privat“? Firewall-Frage zu Node.js zugelassen? `Get-NetFirewallRule -DisplayName "Copper Deck"` zeigt die Regel.
- **`<computername>.local` wird nicht gefunden:** Windows meldet den Namen per mDNS; manche Netze blockieren das. Computername prüfen mit `hostname`. Er darf nur Buchstaben, Ziffern und Bindestriche enthalten.
- **Helper startet nicht:** `%LOCALAPPDATA%\CopperDeck\Logs\launcher.log` ansehen.
- **csc.exe meldet Fehler:** Die Ausgabe von `install.ps1` aufbewahren; sie nennt Datei und Zeile im C#-Code.

## 19. Lightroom Classic

Der Tab **LR** (Pille rechts bzw. unten) macht iPhone und iPad zu einem Bedienpult für **Lightroom Classic** (ab Version 10) auf dem Mac oder PC.

> **Stand:** Das Lightroom-Plugin ist **noch nicht in echtem Lightroom getestet** (hier ist Lightroom Classic nicht installiert). Geprüft ist der ganze Weg App → Helper → Plugin-Schnittstelle mit einem nachgebildeten Plugin (`tools/fake-lightroom.mjs`).

### Einrichtung
1. Lightroom Classic installieren (Creative Cloud).
2. `scripts/install.sh` (Mac) bzw. `scripts\install.ps1` (Windows) erneut ausführen. Das Skript legt das Plugin in den **Modules**-Ordner von Lightroom:
   - Mac: `~/Library/Application Support/Adobe/Lightroom/Modules/CopperDeck.lrplugin`
   - Windows: `%APPDATA%\Adobe\Lightroom\Modules\CopperDeck.lrplugin`
3. Lightroom Classic **neu starten**. Unter Datei → Zusatzmodul-Manager steht dann „Copper Deck“ als aktiv.
4. In der App auf **LR** tippen. Der grüne Punkt zeigt: verbunden. Die Verbindung kommt nach wenigen Sekunden von selbst, auch wenn Lightroom später gestartet wird.

### Funktionen
- **Kopf:** vorheriges/nächstes Foto, Dateiname, **Sterne** (erneut tippen entfernt), **Auswahl / Abgelehnt**, **Farbmarkierung**, Modul **Bibliothek / Entwickeln**, Rückgängig/Wiederholen.
- **Regler** wie im Entwickeln-Modul: Grundeinstellungen (Weissabgleich, Ton, Präsenz), Gradationskurve, HSL (Farbton/Sättigung/Luminanz je 8 Farben), Color Grading, Details (Schärfen, Rauschreduzierung), Effekte (Vignettierung, Körnung).
  - **Ziehen** verändert relativ zum Startpunkt (kein Sprung beim Antippen). Finger beim Ziehen **nach oben oder unten wegbewegen = feiner** (halbe bzw. viertel Geschwindigkeit).
  - **−/+** verwenden die Schrittweite von Lightroom, **Doppeltippen** setzt den Regler zurück.
  - Die Werte in der App folgen Lightroom live, auch wenn du am Rechner änderst.
- **Vorgaben:** alle Entwicklungsvorgaben nach Ordnern; Tippen wendet sie auf die ausgewählten Fotos an.
- **Schnellaktionen:** Auto, Auto-Weissabgleich, Einstellungen kopieren/einfügen, Vorher/Nachher, Zuschneiden, Masken, alles zurücksetzen (zweimal tippen), **Exportieren** (= „Mit vorherigen Einstellungen exportieren“; der Helper holt Lightroom nach vorne und sendet ⌘⌥⇧E bzw. Strg+Alt+Umschalt+E).

### Sicherheit
- Das Plugin öffnet nur lokale Ports (127.0.0.1: 47801/47802); von aussen ist es nicht erreichbar. Geräte sprechen nur mit dem Helper.
- Befehle und Regler stammen aus einer festen Liste; Helper und Plugin prüfen sie beide. Es gibt keinen Weg, Lua-Code oder beliebige Einstellungen auszuführen.

### Fehlerbehebung Lightroom
- **„Lightroom Classic nicht verbunden“:** Läuft Lightroom Classic? Ist „Copper Deck“ im Zusatzmodul-Manager aktiv (sonst „Aktivieren“)? Nach dem ersten Installieren muss Lightroom neu gestartet werden.
- **Regler sind grau:** Lightroom ist in der Bibliothek, oder kein Foto ist ausgewählt. „Zu Entwickeln wechseln“ tippen.
- **Exportieren macht nichts:** Lightroom braucht dafür einmal einen normalen Export (die „vorherigen Einstellungen“). Auf dem Mac sind Bedienungshilfen für „Copper Deck Helper“ nötig.
- **Port belegt:** Ein anderes Programm nutzt 47801/47802 (sehr selten). Dann im Helper-Log nachsehen.
- Für Entwicklung ohne Lightroom: `node tools/fake-lightroom.mjs` simuliert das Plugin.

