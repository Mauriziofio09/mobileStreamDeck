# Copper Deck

iPhone und iPad als Touch-Panel für den Mac. Die vollständige Anleitung folgt in Meilenstein 5.

## Stand: Meilenstein 1 (UI mit Beispieldaten)

```bash
npm install
npm run icons                 # App-Icons lokal extrahieren (web/public/app-icons/, nicht im Repo)
cd web && ../node_modules/.bin/ng serve --host 0.0.0.0 --allowed-hosts
```

- Mac: http://localhost:4200
- iPhone/iPad (gleiches WLAN): http://MacBook-Pro-von-Maurizio.local:4200
- Screenshots: `node tools/screenshots.mjs` und `node tools/states.mjs`. Für den Vergleich mit der Vorlage `node tools/compare.mjs`, das braucht `design-ref/vorlage.png` (nur lokal).

Entscheidungen stehen in [DECISIONS.md](DECISIONS.md).
