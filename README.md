# Copper Deck

iPhone und iPad als Touch-Panel für den Mac. Die vollständige Anleitung mit Fehlerbehebung folgt in Meilenstein 5. Hier steht der Stand von Meilenstein 3.

## Installation (LaunchAgent)

```bash
npm install
scripts/install.sh
```

Das Skript läuft ohne sudo und erledigt Folgendes:
1. Es baut die Web-App und den Helper.
2. Es baut das kleine, ad-hoc-signierte App-Bundle **`~/Applications/Copper Deck Helper.app`**. Neu gebaut wird nur, wenn sich dessen nativer Code geändert hat. So bleiben deine Berechtigungen erhalten.
3. Es kopiert die Laufzeitdateien nach `~/Library/Application Support/CopperDeck/runtime/`.
4. Es legt den Befehl `copper-deck` an (in `/opt/homebrew/bin`).
5. Es richtet den LaunchAgent `~/Library/LaunchAgents/ch.copperdeck.helper.plist` ein und startet ihn: Aqua-Session, KeepAlive, absolute Pfade, UTF-8-Locale, gesetzter PATH.

Prozesskette: `launchd → Copper Deck Helper.app → node`. Der Helper startet automatisch bei der Anmeldung und nach einem Absturz.

```bash
copper-deck status                  # läuft er?
launchctl kickstart -k gui/$(id -u)/ch.copperdeck.helper   # neu starten
scripts/uninstall.sh                # deinstallieren (fragt, ob auch Daten gelöscht werden sollen)
```

## macOS-Berechtigungen

Alle Berechtigungen gelten für **„Copper Deck Helper“**, nicht für Terminal oder node. Rechte, die das Terminal hat, gelten für den LaunchAgent **nicht**. Ein Node-Update ändert nichts daran, weil das App-Bundle der verantwortliche Prozess ist.

| Berechtigung | Wofür | Wo aktivieren |
|---|---|---|
| Bedienungshilfen | Tastenkombinationen, Emoji, Fenster anordnen, App nach vorne holen | Systemeinstellungen → Datenschutz & Sicherheit → **Bedienungshilfen** → „Copper Deck Helper“ einschalten |
| Automation → System Events | Tastenkombinationen, Emoji | Dialog „… möchte System Events steuern“ mit **Erlauben** bestätigen; sonst: Datenschutz & Sicherheit → **Automation** → „Copper Deck Helper“ → „System Events“ |
| Mitteilungen | Timer-Ende | Systemeinstellungen → **Mitteilungen** → „Copper Deck Helper“ → Mitteilungen erlauben |

Die App zeigt den Stand unter **About → Berechtigungen am Mac**. Mit **Am Mac öffnen** öffnet sich die passende Einstellung direkt auf dem Mac. Erteilst du eine Berechtigung, erkennt die App das nach wenigen Sekunden von selbst. Im Terminal: `copper-deck permissions`, Mitteilungen testen mit `copper-deck notify-test`.

## Helper von Hand starten (nur Entwicklung)

```bash
npm run build && helper/bin/copper-deck serve
```

Vorher den LaunchAgent stoppen (`launchctl bootout gui/$(id -u)/ch.copperdeck.helper`). Achtung: Von Hand gestartet gelten die Berechtigungen des Terminals. Die App weist darauf hin.

## Erster Start

Der Helper erstellt beim ersten Start automatisch:
- das TLS-Zertifikat mit mkcert für `macbook-pro-von-maurizio.local`, die aktuelle LAN-IP und `localhost`
- die Startbelegung in `~/Library/Application Support/CopperDeck/config.json`

Danach ist die App erreichbar unter **https://macbook-pro-von-maurizio.local:7443**. Die App verwendet immer die `.local`-Adresse. Ändert sich die IP, funktioniert sie deshalb weiter.

Tests:
- `npm test`: Sicherheits-, Protokoll-, Aktions- und Timer-Tests.
- `node tools/e2e-m3.mjs basic`: Durchlauf gegen den Helper unter launchd.
- `node tools/e2e-m3-perms.mjs`: Durchlauf mit Berechtigungen. Öffnet TextEdit, tippt mit Schweizer Layout, prüft die Zwischenablage mit Bild und Datei, ordnet Fenster an. Deine Zwischenablage wird vorher gesichert und danach wiederhergestellt.

## 1. mkcert-Root-CA auf iPhone und iPad installieren

iOS vertraut dem Zertifikat des Helpers erst, wenn die Root-CA von mkcert installiert **und** ausdrücklich als vertrauenswürdig markiert ist. Das ist pro Gerät einmal nötig.

1. Am Mac `copper-deck ca` ausführen. Der Finder zeigt dann die Datei `rootCA.pem` im Ordner `~/Library/Application Support/mkcert/`.
   ⚠️ Nur **rootCA.pem** weitergeben, niemals **rootCA-key.pem**. Mit diesem Schlüssel könnte jeder Zertifikate ausstellen, denen deine Geräte vertrauen.
2. `rootCA.pem` per **AirDrop** an das iPhone bzw. iPad senden (Rechtsklick → Teilen → AirDrop).
   Auf dem Gerät erscheint „Profil geladen“. Fragt das iPad, auf welchem Gerät das Profil installiert werden soll, wähle das iPad.
3. Auf dem Gerät **Einstellungen** öffnen. Oben steht **„Profil geladen“**; falls nicht: **Allgemein → VPN und Geräteverwaltung**.
4. Das Profil „mkcert …“ antippen, dann **Installieren** wählen, den Gerätecode eingeben und nochmals **Installieren** bestätigen.
5. **Wichtig, sonst geht es nicht:** **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** öffnen (ganz unten auf der Info-Seite).
6. Unter „Volles Vertrauen für Root-Zertifikate aktivieren“ den Schalter bei **mkcert …** einschalten und mit **Fortfahren** bestätigen.
7. Zum Prüfen in Safari `https://macbook-pro-von-maurizio.local:7443` öffnen. Es darf keine Zertifikatswarnung erscheinen.

## 2. Auf dem Home-Bildschirm installieren

1. In **Safari** `https://macbook-pro-von-maurizio.local:7443` öffnen.
2. **Teilen** → **Zum Home-Bildschirm** → **Hinzufügen**.
3. **Copper Deck vom Home-Bildschirm aus öffnen.** Gekoppelt wird nur dort, denn iOS trennt den Speicher von Safari und den Home-Bildschirm-Apps. Ein in Safari gekoppeltes Gerät wäre in der App nicht gekoppelt. Safari zeigt deshalb nur die Installationsanleitung.

## 3. Koppeln

1. Am Mac: `copper-deck pair`. Der Befehl zeigt einen 6-stelligen Code. Er gilt 5 Minuten, nur einmal, und nach 5 Fehlversuchen ist er gesperrt.
2. In der installierten App den Code eingeben und **Koppeln** tippen.

Jedes Gerät erhält ein eigenes Token. Der Helper speichert davon nur den Hash, in `devices.json` mit den Rechten 600.

```bash
copper-deck devices          # gekoppelte Geräte auflisten
copper-deck revoke <id>      # Gerät widerrufen (trennt es sofort)
```

Geräte lassen sich auch in der App widerrufen: **About → Gekoppelte Geräte**.

## Zertifikat erneuern

mkcert-Zertifikate gelten etwa 2 Jahre und 3 Monate. Der Helper prüft bei jedem Start und erneuert das Zertifikat selbst, wenn
- es in weniger als 30 Tagen abläuft,
- der `.local`-Name fehlt (zum Beispiel nach einer Umbenennung des Macs) oder
- sich die LAN-IP geändert hat.

Von Hand:

```bash
copper-deck cert             # prüfen und nur bei Bedarf neu ausstellen
copper-deck cert --renew     # sofort neu ausstellen; der laufende Helper lädt es ohne Neustart
```

Solange die Root-CA dieselbe bleibt, musst du auf iPhone und iPad **nichts** neu installieren. Nur wenn die mkcert-CA neu erzeugt wird (etwa nach `mkcert -uninstall` und Löschen von `~/Library/Application Support/mkcert`), musst du Schritt 1 wiederholen.

## macOS-Firewall freigeben

Auf diesem Mac ist die Firewall zurzeit **aus**. Schaltest du sie ein, gilt Folgendes: Die Firewall regelt eingehende Verbindungen pro **lauschender Binary**. Das ist hier `node`, nicht das App-Bundle.

- Beim ersten Start fragt macOS „Eingehende Netzwerkverbindungen akzeptieren?“. Dort **Erlauben** wählen.
- Oder per Terminal:

```bash
NODE_BIN="$(readlink -f /opt/homebrew/bin/node)"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$NODE_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$NODE_BIN"
```

⚠️ Bekannte Einschränkung: Homebrew legt node unter einem versionierten Pfad ab (`/opt/homebrew/Cellar/node/26.3.1/…`). Nach `brew upgrade node` fragt die Firewall deshalb erneut. Die Datenschutz-Berechtigungen (Bedienungshilfen und so weiter) sind davon **nicht** betroffen. Alternativen stehen in DECISIONS.md.

## Daten und Logs

| Was | Wo |
|---|---|
| Konfiguration (+ Backup), Geräte, TLS, Icon-Cache | `~/Library/Application Support/CopperDeck/` |
| Log (ohne Tokens und Codes) | `~/Library/Logs/CopperDeck/helper.log` (+ `launchd.out.log`/`launchd.err.log`) |
| Laufender Timer (Endzeit) | `~/Library/Application Support/CopperDeck/timer.json` |
| App-Bundle | `~/Applications/Copper Deck Helper.app` |
| LaunchAgent | `~/Library/LaunchAgents/ch.copperdeck.helper.plist` |

Die getroffenen Entscheidungen stehen in [DECISIONS.md](DECISIONS.md).
