# Build und Auslieferung

Voraussetzung: Node 24, `npm install`, importierte Spieldaten (`npm run import-cd -- --cd1 <CD1.iso> --cd2 <CD2.iso>` → `public/gamedata`).

```
.uild.ps1 [-Target All|Docker|Portable] [-Zip] [-NoData] [-Install]   # PowerShell-Start (prüft Node, installiert bei Bedarf)
npm run dist            # beide Pakete   -> dist/docker und dist/windows-portable
npm run dist:docker     # nur Docker
npm run dist:portable   # nur Windows portable, zusätzlich als dist/BattleIsle3-windows-portable.zip
node tools/build-dist.ts --no-data          # ohne Spieldaten (Ordner "gamedata" später ergänzen)
node tools/build-dist.ts --node-exe <Pfad>  # portable unter Linux/macOS bauen: Windows-node.exe angeben
```

Das Skript (`tools/build-dist.ts`) prüft die Typen, baut die Web-App mit Vite (ohne die urheberrechtlich geschützten Spieldaten, `BI3_NO_PUBLIC`)
und packt beide Pakete. Die Spieldaten werden getrennt kopiert.

## 1. Docker (`dist/docker`)

`docker compose up -d --build` → http://localhost:8080 (anderer Port: `BI3_PORT=9000`). nginx liefert die App aus; der Ordner `gamedata` wird
nur als Read-only-Volume eingebunden und ist nicht Teil des Images. Auf dem Handy `http://<Rechner-IP>:8080` öffnen.
Hinweis: Das Image `nginx:1.27-alpine` wird beim ersten Build aus dem Internet geladen.

## 2. Windows portable (`dist/windows-portable`)

`BattleIsle3.bat` starten (öffnet den Browser, Port 8765, sonst der nächste freie). `BattleIsle3-Netzwerk.bat` macht das Spiel im WLAN für das Handy
erreichbar. Enthalten sind `node.exe` (Laufzeit, aus dem Build-Rechner kopiert), `server.mjs` (statischer Server ohne Abhängigkeiten, mit Range-Requests
für Videos) und `app/` mit den Spieldaten. Keine Installation, keine Admin-Rechte, kein Internet.

## Geprüft

- Portable: Server mit der mitgelieferten `node.exe` gestartet, im strengen Groß-/Kleinschreibungsmodus (`--strict-case`, wie unter Linux/Docker),
  E2E-Tests dagegen (`BI3_BASE_URL=http://localhost:8799 npx playwright test …`): Missionen, Videos, Musik, Kampf, Speichern – bestanden.
- Docker: `docker compose up -d --build` gebaut und gestartet (nginx 1.27 alpine), E2E-Tests gegen http://localhost:8080: Missionen, Videos, Musik, Kampf, Speichern,
  Kampagnenübergang, Handy-Oberfläche – bestanden; Content-Types (MIDI, LIB) und Range-Requests für Videos (206) stimmen.
- ZIP (`npm run dist:portable`): in einen neuen Ordner entpackt, mit der enthaltenen `node.exe` gestartet, Seite und Video werden ausgeliefert.
- Nicht geprüft: Start auf einem Windows ohne vorinstallierte Visual-C++-Laufzeit (die offizielle node.exe braucht sie normalerweise nicht, auf einer
  frischen Installation nicht getestet).
