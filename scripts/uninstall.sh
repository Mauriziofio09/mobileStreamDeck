#!/bin/bash
# Copper Deck – Deinstallation.
set -euo pipefail

LABEL="ch.copperdeck.helper"
APP_NAME="Copper Deck Helper"
DATA="$HOME/Library/Application Support/CopperDeck"
LOGS="$HOME/Library/Logs/CopperDeck"
APP_DST="$HOME/Applications/$APP_NAME.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "▶ Stoppe LaunchAgent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
pkill -f "copper-deck.mjs serve" 2>/dev/null || true

echo "▶ Entferne App-Bundle, Laufzeitdateien und CLI"
rm -rf "$APP_DST" "$DATA/runtime" "$HOME/Library/Application Support/Adobe/Lightroom/Modules/CopperDeck.lrplugin"
for d in /opt/homebrew/bin "$HOME/.local/bin"; do
  if [ -L "$d/copper-deck" ]; then rm -f "$d/copper-deck"; fi
done

read -r -p "Auch die macOS-Berechtigungen (Bedienungshilfen, Automation) zurücksetzen? [j/N] " a
if [[ "$a" =~ ^[jJyY]$ ]]; then
  tccutil reset Accessibility "$LABEL" || true
  tccutil reset AppleEvents "$LABEL" || true
  echo "  Berechtigungen zurückgesetzt (Mitteilungen ggf. unter Systemeinstellungen → Mitteilungen entfernen)."
fi

read -r -p "Auch Daten löschen (Konfiguration, gekoppelte Geräte, Zertifikat, Icons, Logs)? [j/N] " a
if [[ "$a" =~ ^[jJyY]$ ]]; then
  rm -rf "$DATA" "$LOGS"
  echo "  Daten gelöscht."
else
  echo "  Daten bleiben in: $DATA"
fi

cat <<TXT

Copper Deck ist deinstalliert.

mkcert-Root-CA wieder entfernen:
  • iPhone/iPad: Einstellungen → Allgemein → VPN und Geräteverwaltung → Profil „mkcert …“ → Profil entfernen.
    (Das Vertrauen unter Info → Zertifikatsvertrauenseinstellungen verschwindet damit automatisch.)
  • Mac: mkcert -uninstall
    Achtung: Die mkcert-CA kann auch von anderen Projekten genutzt werden. Nur entfernen, wenn du sie
    sonst nicht brauchst. Zum vollständigen Löschen danach auch den Ordner "\$(mkcert -CAROOT)" entfernen.
TXT
