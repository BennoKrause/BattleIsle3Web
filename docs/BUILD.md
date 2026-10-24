# Build und Auslieferung

Voraussetzung zum Bauen: Node 24 und `npm install`. Die fertigen Pakete brauchen keine Installation.

```
.\build.ps1 [-Target All|Docker|Portable] [-Zip] [-Ffmpeg <ffmpeg.exe>] [-Install]   # PowerShell-Start (prüft Node, installiert bei Bedarf)
npm run dist            # beide Pakete   -> dist/docker und dist/windows-portable
npm run dist:docker     # nur Docker
npm run dist:portable   # nur Windows portable, zusätzlich als dist/BattleIsle3-windows-portable.zip
node tools/build-dist.ts --node-exe <Pfad>   # portable unter Linux/macOS bauen: Windows-node.exe angeben
node tools/build-dist.ts --with-data         # nur für eigene Tests: schon importierte Spieldaten mitpacken (nicht weitergeben!)
```

Die Pakete enthalten **keine Spieldaten**. Das Skript (`tools/build-dist.ts`) prüft die Typen, baut die Web-App mit Vite und packt Server,
Importer und App. Beim ersten Start übergibt man nur die beiden Original-ISO-Images; die Einrichtung (`tools/lib/importer.ts`) liest sie
selbst (ISO9660), übernimmt die Daten und wandelt alle Videos mit FFmpeg nach MP4 um (Fortschrittsanzeige im Browser). Die Grafiken
werden vom Browser direkt im Originalformat gelesen, sie müssen nicht umgewandelt werden. Erst nach erfolgreichem Import wird `manifest.json`
geschrieben; ein abgebrochener Import beginnt beim nächsten Start neu.

## 1. Windows portable (`dist/windows-portable`)

Die beiden `.iso`-Dateien auf `BattleIsle3.bat` ziehen (oder in den Ordner `iso` legen, oder die Pfade auf der Einrichtungsseite eintragen).
Später genügt ein Doppelklick. Port 8765 (sonst der nächste freie); `BattleIsle3-Netzwerk.bat` macht das Spiel im WLAN für das Handy erreichbar.
Enthalten sind `node.exe`, `ffmpeg\ffmpeg.exe`, `server.mjs` (Server ohne Abhängigkeiten, mit Range-Requests für Videos) und `app/`.
Die importierten Daten liegen in `app\gamedata`.

## 2. Docker (`dist/docker`)

Die beiden ISO-Images in den Ordner `iso` legen (oder `BI3_ISO_DIR=/pfad` setzen), dann `docker compose up -d --build` und
http://localhost:8080 öffnen (anderer Port: `BI3_PORT=9000`). Das Image (`node:24-alpine` mit FFmpeg) führt beim ersten Aufruf die Einrichtung aus;
die Daten landen im Volume `./gamedata` und bleiben bei Updates erhalten. Die Images werden danach nicht mehr gebraucht.

## Stand der Prüfung

- Der neue Einrichtungsablauf (Importer, Server) ist mit den echten Images getestet. Der Playwright-Test der Einrichtungsseite
  (`e2e/setup.spec.ts`) schlägt aber noch fehl, die Ursache ist nicht geklärt.
- Das Docker-Paket mit dem neuen Node-Server und der Einrichtung wurde noch nicht gebaut und getestet (das frühere nginx-Paket mit
  mitgelieferten Daten war getestet).
- Nicht geprüft: Start auf einem frischen Windows ohne Visual-C++-Laufzeit.
