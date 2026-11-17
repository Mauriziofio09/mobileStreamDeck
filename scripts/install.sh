#!/bin/bash
# Copper Deck – Installation als LaunchAgent (Aqua-Session, KeepAlive).
# Aufruf: scripts/install.sh   (ohne sudo)
set -euo pipefail

LABEL="ch.copperdeck.helper"
APP_NAME="Copper Deck Helper"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/Library/Application Support/CopperDeck"
LOGS="$HOME/Library/Logs/CopperDeck"
RUNTIME="$DATA/runtime"
APP_DST="$HOME/Applications/$APP_NAME.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

say()  { printf '\033[1;33m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Voraussetzungen -------------------------------------------------------
NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "node fehlt (brew install node)"
# Stabiler Pfad (Homebrew-Symlink), damit ein Node-Update den LaunchAgent nicht bricht.
case "$NODE" in /opt/homebrew/bin/node|/usr/local/bin/node) ;; *) say "Hinweis: node liegt unter $NODE";; esac
[ -x /opt/homebrew/bin/mkcert ] || [ -x /usr/local/bin/mkcert ] || die "mkcert fehlt (brew install mkcert && mkcert -install)"
xcrun --find swiftc >/dev/null 2>&1 || die "Swift-Compiler fehlt (xcode-select --install)"

# --- Bauen -----------------------------------------------------------------
say "Baue Web-App und Helper"
(cd "$REPO" && npm run build --silent >/dev/null)
ok "Build fertig"

# --- App-Bundle (nur ersetzen, wenn sich der native Code geändert hat) -----
# Die Berechtigungen hängen am Code-Hash des Bundles. Ein unverändertes Bundle behält sie.
SRC_HASH="$(shasum -a 256 "$REPO/helper/native/CopperDeckHelper.swift" | cut -c1-16)"
INSTALLED_HASH=""
if [ -f "$APP_DST/Contents/Info.plist" ]; then
  INSTALLED_HASH="$(/usr/libexec/PlistBuddy -c 'Print :CopperDeckSourceHash' "$APP_DST/Contents/Info.plist" 2>/dev/null || true)"
fi
if [ "$SRC_HASH" != "$INSTALLED_HASH" ]; then
  say "Baue $APP_NAME.app (nativer Code geändert oder neu)"
  (cd "$REPO/helper" && node native/build-app.mjs >/dev/null)
  mkdir -p "$HOME/Applications"
  rm -rf "$APP_DST"
  cp -R "$REPO/helper/dist/$APP_NAME.app" "$APP_DST"
  if [ -n "$INSTALLED_HASH" ]; then say "Nativer Code wurde geändert: Berechtigungen müssen ggf. neu erteilt werden."; fi
  ok "App-Bundle installiert: $APP_DST"
else
  ok "App-Bundle unverändert – Berechtigungen bleiben erhalten"
fi
codesign --verify "$APP_DST" || die "Signatur des App-Bundles ungültig"

# --- Laufzeitdateien ausserhalb des Bundles --------------------------------
say "Kopiere Laufzeitdateien nach $RUNTIME"
mkdir -p "$DATA" "$LOGS"
chmod 700 "$DATA" "$LOGS"
rm -rf "$RUNTIME.new"
mkdir -p "$RUNTIME.new/helper" "$RUNTIME.new/bin"
cp "$REPO/helper/dist/copper-deck.mjs" "$REPO/helper/dist/copper-deck.mjs.map" "$RUNTIME.new/helper/"
cp "$REPO/helper/native/keystroke.applescript" "$REPO/helper/native/activate.applescript" "$REPO/helper/native/lightroom-menu.applescript" "$RUNTIME.new/helper/"
cp -R "$REPO/web/dist/web/browser" "$RUNTIME.new/web"
/usr/bin/python3 -c 'import json,sys; print(json.dumps({"node": sys.argv[1], "script": sys.argv[2]}))' \
  "$NODE" "$RUNTIME/helper/copper-deck.mjs" > "$RUNTIME.new/launch.json"
cat > "$RUNTIME.new/bin/copper-deck" <<SHIM
#!/bin/sh
exec "$NODE" "$RUNTIME/helper/copper-deck.mjs" "\$@"
SHIM
chmod 755 "$RUNTIME.new/bin/copper-deck"
rm -rf "$RUNTIME.old"; [ -d "$RUNTIME" ] && mv "$RUNTIME" "$RUNTIME.old"
mv "$RUNTIME.new" "$RUNTIME"; rm -rf "$RUNTIME.old"
ok "Laufzeitdateien bereit"

# --- Lightroom-Classic-Plugin ----------------------------------------------
# Plugins im Modules-Ordner lädt Lightroom Classic beim Start automatisch (kein Zusatzmodul-Manager nötig).
LR_MODULES="$HOME/Library/Application Support/Adobe/Lightroom/Modules"
mkdir -p "$LR_MODULES"
rm -rf "$LR_MODULES/CopperDeck.lrplugin"
cp -R "$REPO/lightroom/CopperDeck.lrplugin" "$LR_MODULES/"
ok "Lightroom-Plugin: $LR_MODULES/CopperDeck.lrplugin (wirkt nach einem Neustart von Lightroom Classic)"

# --- CLI -------------------------------------------------------------------
if [ -w /opt/homebrew/bin ]; then CLI_DIR=/opt/homebrew/bin; else CLI_DIR="$HOME/.local/bin"; mkdir -p "$CLI_DIR"; fi
ln -sf "$RUNTIME/bin/copper-deck" "$CLI_DIR/copper-deck"
ok "CLI: $CLI_DIR/copper-deck"
case ":$PATH:" in *":$CLI_DIR:"*) ;; *) say "$CLI_DIR ist nicht im PATH – ggf. ergänzen";; esac

# --- LaunchAgent -----------------------------------------------------------
say "Richte LaunchAgent $LABEL ein"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP_DST/Contents/MacOS/CopperDeckHelper</string>
    <string>serve</string>
  </array>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>WorkingDirectory</key><string>$DATA</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>de_CH.UTF-8</string>
    <key>LC_ALL</key><string>de_CH.UTF-8</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LOGS/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/launchd.err.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null || die "plist ungültig"

# Laufenden Terminal-Helper beenden, damit Port und Socket frei sind.
pkill -f "copper-deck.mjs serve" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"

for _ in $(seq 1 30); do
  if "$RUNTIME/bin/copper-deck" status >/dev/null 2>&1; then break; fi
  sleep 1
done
"$RUNTIME/bin/copper-deck" status >/dev/null 2>&1 || die "Helper antwortet nicht – siehe $LOGS/helper.log und launchd.err.log"
ok "Helper läuft unter launchd"

cat <<TXT

Fertig. Copper Deck: https://$(scutil --get LocalHostName | tr 'A-Z' 'a-z').local:7443

Beim ersten Start fragt macOS nach Berechtigungen für „${APP_NAME}“:
  • Bedienungshilfen: Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen → „${APP_NAME}“ einschalten
  • Automation:       erscheint bei der ersten Tastenkombination – „Erlauben“ wählen
  • Mitteilungen:     „Erlauben“ wählen (für das Timer-Ende)
Den aktuellen Stand zeigt:  copper-deck permissions   (oder in der App unter About)
TXT
