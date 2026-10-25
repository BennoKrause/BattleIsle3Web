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
Spielstände, die im Spiel unter „Server“ gespeichert werden, liegen in `./saves` (portable: Ordner `saves`; Vite-Dev-Server: `saves/`
im Projekt, API in `tools/portable/saves.mjs`). Die App-Dateien (`app`, `import`, `server.mjs`, `saves.mjs`) bindet `docker-compose.yml`
aus dem Paketordner ein: Für ein Update die neue ZIP-Datei darüber entpacken, dann reicht `docker compose restart`
(`docker compose up -d --build` geht ebenso). Die laufende Version steht im Setup-Menü ganz unten.

## Stand der Prüfung

- Der neue Einrichtungsablauf (Importer, Server) ist mit den echten Images getestet. Der Playwright-Test der Einrichtungsseite
  (`e2e/setup.spec.ts`) schlägt aber noch fehl, die Ursache ist nicht geklärt.
- Das Docker-Paket mit dem neuen Node-Server und der Einrichtung wurde noch nicht gebaut und getestet (das frühere nginx-Paket mit
  mitgelieferten Daten war getestet).
- Nicht geprüft: Start auf einem frischen Windows ohne Visual-C++-Laufzeit.

## Release auf GitHub (`release.ps1`)

```
.\release.ps1 -Version 0.3.0 -DryRun        # Probelauf: Tests, Pakete bauen und prüfen, Notizen anzeigen – nichts wird veröffentlicht
.\release.ps1 -Version 0.3.0                # Vorabversion (Pre-Release) mit Notizen aus den Commits seit dem letzten Tag
.\release.ps1 -Version 0.3.0 -Notes n.md    # eigene Release-Notizen
.\release.ps1 -Version 0.3.0 -Final         # normales Release
.\release.ps1 -Version 0.3.0 -SkipTests     # ohne Unit- und Browser-Tests
```

Ablauf:
1. Prüft, dass der Arbeitsstand sauber ist, man auf `master` ist, `master` nicht hinter `origin/master` liegt und der Tag
   noch nicht existiert.
2. Führt die Unit- und Browser-Tests aus.
3. Setzt die Version in `package.json`.
4. Baut beide Pakete und prüft die ZIP-Dateien auf Spieldaten. Werden welche gefunden, bricht das Skript ab.
5. Committet, setzt den Tag und pusht `master`; `develop` wird per Fast-Forward nachgezogen.
6. Legt das GitHub-Release an und lädt beide ZIP-Dateien hoch.

Für GitHub nutzt das Skript die GitHub-CLI (`gh`), falls sie installiert ist. Sonst nimmt es die gespeicherten
Git-Anmeldedaten, mit denen auch gepusht wird.
