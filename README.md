# Battle Isle 3 im Browser

Hallo! Das hier ist mein Versuch, **Battle Isle 3 – Schatten des Imperators** (Blue Byte, 1995) wieder spielbar zu machen,
und zwar ohne DOSBox, ohne Windows-95-Kompatibilitätsmodus und ohne Bastelei. Einfach im Browser, auf dem PC und auf dem
Handy.

Die Idee war nicht, ein „inspiriert von“-Spiel zu bauen, sondern das Original möglichst genau nachzubilden. Gleiche Regeln,
gleiche Grafik, gleiche Musik, gleiche Videos. Dafür liest das Spiel die Daten direkt von den **eigenen Original-CDs**.
In diesem Repository steckt deshalb kein einziges Byte der Originaldaten. Wer spielen will, braucht die beiden CDs als
ISO-Images.

| So sieht das Menü aus | Karte mit Straßen, Schienen und Gebäuden |
|---|---|
| ![Menü](docs/screenshots/menu.png) | ![Karte](docs/screenshots/map.png) |

| Der 3D-Kampf | Der „Schnelle Kampf“ mit der Statistik des Originals |
|---|---|
| ![3D-Kampf](docs/screenshots/fight-3d.png) | ![2D-Kampf](docs/screenshots/fight-2d.png) |

Und weil ich auch unterwegs spielen wollte, gibt es eine eigene Handy-Oberfläche im Look des Originals:

<img src="docs/screenshots/mobile.png" alt="Handy-Oberfläche" width="280">

## Wie das entstanden ist

Den Großteil der Arbeit habe ich zusammen mit Claude Code gemacht, einer KI, die programmiert und Programme analysiert.
Die Spielregeln sind nicht geraten. Sie stammen aus der Original-EXE und den DLLs, die wir mit Ghidra dekompiliert und
Funktion für Funktion gelesen haben: Kampfformel, Erfahrung, Sicht und Nebel, Hinterhalte, Klemmen, Produktion,
Versorgung, Straßenbau, Tauchen und Steigen, Trainingspunkte. Wo das Handbuch etwas anderes sagt als das Programm, gilt
das Programm. Diese Stellen sind dokumentiert.

Einiges davon war richtige Detektivarbeit:

- Die Kampfstatistik („Schneller Kampf“) ist pixelgenau aus `MS_FIGTR.DLL` nachgebaut.
- Der 3D-Kampf rendert die Original-3D-Modelle (Format 3DO2) mit einem eigenen Software-Renderer.
- Straßen, Wege und Schienen setzt das Spiel je nach Nachbarfeldern aus 24 Grundstücken plus Spiegelungen zusammen.
- Die Musik sind die originalen MIDI-Dateien, gespielt über einen eigenen Synthesizer.

Wie gut das Ergebnis ist, prüfen über 100 Unit-Tests und über 60 Browser-Tests. Alle 40 Missionen der Kampagne werden
automatisch gestartet und angespielt. Was ich gegen die EXE abgeglichen habe und was noch offen ist, steht in
[docs/research/FEATURE_AUDIT.md](docs/research/FEATURE_AUDIT.md).

## Was (noch) nicht original ist

Damit niemand enttäuscht wird:

- **Der Computergegner** ist eine eigene KI. Die Original-KI ist nicht nachgebaut. Sie spielt ordentlich, aber anders.
- **Netzwerkspiel** gibt es nicht. Mehrere Spieler an einem Gerät (Hot-Seat) gehen.
- Das **Wetter** und ein paar Kleinigkeiten sind noch vorläufig, siehe Audit.

## Selbst spielen

Gebraucht werden die beiden Original-CDs als `.iso`-Dateien.

**Windows, ohne Installation:** Das portable Paket bauen (`.\build.ps1 -Target Portable`), entpacken und die beiden
ISO-Images auf `BattleIsle3.bat` ziehen. Beim ersten Start werden die Daten übernommen und die Videos umgewandelt. Das
dauert ein paar Minuten. Danach öffnet sich das Spiel im Browser.

**Docker:** `.\build.ps1 -Target Docker`, die ISOs in `dist/docker/iso` legen, `docker compose up -d --build` ausführen
und http://localhost:8080 öffnen.

**Aus dem Quelltext** (Node 24):

```
npm install
npm run import-cd -- --cd1 <CD1.iso> --cd2 <CD2.iso>   # übernimmt die Daten nach public/gamedata (FFmpeg nötig für die Videos)
npm run dev                                              # http://localhost:5173
```

Mehr zum Bauen steht in [docs/BUILD.md](docs/BUILD.md).

## Für Neugierige

- `src/formats`: Parser für die Originalformate (LIB/TPWM, Missionen, 3DO2-Modelle, MIDI …)
- `src/engine`: Spielregeln, ohne Browser-Abhängigkeit
- `src/render`, `src/ui`: Karte, 3D-Kampf, Fenster, Handy-Oberfläche
- `tools`: Importer, Build-Skripte, Analysewerkzeuge
- [docs/research](docs/research): ermittelte Regeln und Formate ([Spielregeln](docs/research/GAME_RULES.md),
  [Funktionsabgleich](docs/research/FEATURE_AUDIT.md), [3DO2-Modelle](docs/research/FORMAT_3DO2.md),
  [Fenster](docs/research/UI_WINDOWS.md), [Quellen](docs/research/EXTERNAL_SOURCES.md))

Tests: `npm test` (Unit-Tests) und `npm run test:e2e` (Browser). Tests, die Spieldaten brauchen, werden ohne importierte
Daten übersprungen.

## Rechtliches

Battle Isle ist eine Marke der jeweiligen Rechteinhaber. Das hier ist ein privates, nicht-kommerzielles Hobbyprojekt ohne
Verbindung zu ihnen. Die Screenshots zeigen Grafiken des Originalspiels und dienen nur der Dokumentation. Spieldaten (die
Inhalte der CDs und alles, was daraus erzeugt wird) gehören nicht in dieses Repository und dürfen nicht weitergegeben
werden. Als Referenz für die Regeln diente unter anderem das Open-Source-Projekt BattleIsle2020 (GPLv3), siehe
[Quellen](docs/research/EXTERNAL_SOURCES.md).

Viel Spaß, und falls jemand Fehler findet oder weiß, wie sich etwas im Original genau verhalten hat: Issues sind
willkommen.
