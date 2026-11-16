#!/bin/sh
# Baut die Copper-Deck-Startseiten und lädt sie auf den Server (nach ~/mobilestreamdeck).
#   https://macmobilestreamdeck.battle-isle.app  und  https://windowsmobilestreamdeck.battle-isle.app
# Aufruf am Mac:  sh site/deploy/deploy.sh
# Erstes Mal:     sh site/deploy/deploy.sh --setup   (kopiert compose.yml, nginx.conf, Caddyfile-Block und startet
#                 den Container; den Caddy-Block danach einmalig an ~/game/deploy/Caddyfile anhängen, siehe README)
set -e
SERVER="${SERVER:-deploy@78.47.125.152}"
cd "$(dirname "$0")/../.."

node site/build.mjs

if [ "$1" = "--setup" ]; then
  ssh "$SERVER" 'mkdir -p ~/mobilestreamdeck/mac ~/mobilestreamdeck/windows'
  rsync -av site/deploy/compose.yml site/deploy/nginx.conf site/deploy/Caddyfile.mobilestreamdeck "$SERVER":mobilestreamdeck/
fi

# --delay-updates: alle Dateien einer Seite auf einmal austauschen
rsync -az --delete-after --delay-updates site/dist/mac/ "$SERVER":mobilestreamdeck/mac/
rsync -az --delete-after --delay-updates site/dist/windows/ "$SERVER":mobilestreamdeck/windows/

if [ "$1" = "--setup" ]; then
  ssh "$SERVER" 'cd ~/mobilestreamdeck && docker compose up -d && docker compose ps'
fi
echo "Deployt."
