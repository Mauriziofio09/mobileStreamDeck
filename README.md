# Copper Deck

iPhone und iPad als Touch-Panel für den Mac. Die vollständige Anleitung mit Fehlerbehebung folgt in Meilenstein 5. Hier steht der Stand von Meilenstein 2.

## Bauen und starten

```bash
npm install
npm run build                       # Web-App und Helper bauen
helper/bin/copper-deck serve        # Helper starten (ab Meilenstein 3 übernimmt das launchd)
```

Der Helper erstellt beim ersten Start automatisch:
- das TLS-Zertifikat mit mkcert für `macbook-pro-von-maurizio.local`, die aktuelle LAN-IP und `localhost`
- die Startbelegung in `~/Library/Application Support/CopperDeck/config.json`

Danach ist die App erreichbar unter **https://macbook-pro-von-maurizio.local:7443**. Die App verwendet immer die `.local`-Adresse. Ändert sich die IP, funktioniert sie deshalb weiter.

Tests: `npm test` (Sicherheits- und Protokolltests). Echte Durchläufe in WebKit gegen den laufenden Helper: `node tools/e2e-m2.mjs` und `node tools/e2e-m2-offline.mjs <logdatei>`.

## 1. mkcert-Root-CA auf iPhone und iPad installieren

iOS vertraut dem Zertifikat des Helpers erst, wenn die Root-CA von mkcert installiert **und** ausdrücklich als vertrauenswürdig markiert ist. Das ist pro Gerät einmal nötig.

1. Am Mac `helper/bin/copper-deck ca` ausführen. Der Finder zeigt dann die Datei `rootCA.pem` im Ordner `~/Library/Application Support/mkcert/`.
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

1. Am Mac: `helper/bin/copper-deck pair`. Der Befehl zeigt einen 6-stelligen Code. Er gilt 5 Minuten, nur einmal, und nach 5 Fehlversuchen ist er gesperrt.
2. In der installierten App den Code eingeben und **Koppeln** tippen.

Jedes Gerät erhält ein eigenes Token. Der Helper speichert davon nur den Hash, in `devices.json` mit den Rechten 600.

```bash
helper/bin/copper-deck devices          # gekoppelte Geräte auflisten
helper/bin/copper-deck revoke <id>      # Gerät widerrufen (trennt es sofort)
```

Geräte lassen sich auch in der App widerrufen: **About → Gekoppelte Geräte**.

## Zertifikat erneuern

mkcert-Zertifikate gelten etwa 2 Jahre und 3 Monate. Der Helper prüft bei jedem Start und erneuert das Zertifikat selbst, wenn
- es in weniger als 30 Tagen abläuft,
- der `.local`-Name fehlt (zum Beispiel nach einer Umbenennung des Macs) oder
- sich die LAN-IP geändert hat.

Von Hand:

```bash
helper/bin/copper-deck cert             # prüfen und nur bei Bedarf neu ausstellen
helper/bin/copper-deck cert --renew     # sofort neu ausstellen; ein laufender Helper lädt es ohne Neustart
```

Solange die Root-CA dieselbe bleibt, musst du auf iPhone und iPad **nichts** neu installieren. Nur wenn die mkcert-CA neu erzeugt wird (etwa nach `mkcert -uninstall` und Löschen von `~/Library/Application Support/mkcert`), musst du Schritt 1 wiederholen.

## macOS-Firewall freigeben

Auf diesem Mac ist die Firewall zurzeit **aus** (`socketfilterfw --getglobalstate`). Schaltest du sie ein, gibt es zwei Möglichkeiten:

- Beim ersten Start fragt macOS „Eingehende Netzwerkverbindungen akzeptieren?“. Dort **Erlauben** wählen.
- Oder von Hand unter **Systemeinstellungen → Netzwerk → Firewall → Optionen**: das Programm hinzufügen und auf „Eingehende Verbindungen erlauben“ stellen.

Per Terminal geht das so:

```bash
NODE_BIN="$(readlink -f "$(which node)")"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$NODE_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$NODE_BIN"
```

Hinweis: Die Freigabe hängt am Pfad der Binary. Bei Homebrew ist das ein versionierter Pfad wie `/opt/homebrew/Cellar/node/26.3.1/bin/node`, und nach einem Node-Update ist die Freigabe weg. Meilenstein 3 löst das mit einem eigenen, signierten App-Bundle für den Helper, und diese Anleitung wird dann angepasst.

## Daten und Logs

| Was | Wo |
|---|---|
| Konfiguration (+ Backup), Geräte, TLS, Icon-Cache | `~/Library/Application Support/CopperDeck/` |
| Log (ohne Tokens und Codes) | `~/Library/Logs/CopperDeck/helper.log` |

Die getroffenen Entscheidungen stehen in [DECISIONS.md](DECISIONS.md).
