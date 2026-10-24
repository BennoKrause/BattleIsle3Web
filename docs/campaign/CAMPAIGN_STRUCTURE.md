# Kampagnenstruktur – Battle Isle 3

> Automatisch erzeugt von `tools/inventory.ts` aus den Originaldateien (`MIS/MCP00x.DAT`, `GER|ENG/MCP00x.TXT`,
> `MIS/MISSxxx.DAT`, `GER/MISSxxx.TXT`). Maschinenlesbar: `MISSION_INVENTORY.json`, `ASSET_DEPENDENCIES.json`.

## Battle-Sets

Die Original-CD enthält drei Battle-Sets (Handbuch S. 34: Missionsladefenster). Speicherstände nummerieren sie 1 = Schatten des Imperators, 2 = Mehrspieler, 3 = Tutorial (Handbuch S. 29).

| Steuerdatei | Art | Name (DE / EN) | Missionen | STARTMODI |
|---|---|---|---|---|
| MCP000 | campaign | Der Schatten des Imperiums / Shadow of the Empire | 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119 | 1 1 1 |
| MCP001 | multiplayer | Mehrspielerkarten / Mulitplayergames | 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311 | 0 1 1 |
| MCP002 | tutorial | Tutorial / Tutorial | 200, 201, 202, 203, 204, 205, 206, 207 | 1 1 0 |

## Kampagne „Der Schatten des Imperiums" (MCP000)

Reihenfolge belegt durch das Folgemissionsfeld jeder Missionsdatei (Byte MISS+6, 1-basiert) und `NUMMER`/`FILEID` in MCP000.DAT; MISS119 trägt die Endmarkierung (Byte MISS+7 = 39). **Es gibt keine Verzweigungen.** Laut Handbuch (S. 30) wird bei Niederlage dieselbe Karte neu gestartet, bei Sieg die nächste geladen und deren Kennwort mitgeteilt.

Videospalten: Zwischensequenz vor der Karte (`TERMINATIONSEQS[0]`), Missionsbriefing ([1]), Sieg ([2]), Niederlage ([3]), Kapitelende ([4]).

| # | Datei | Name | Kennwort | Karte | Spieler (Mensch fett) | Sieg (benötigt) | Zwischensequenz | Briefing | Sieg | Niederlage | Kapitelende | Ereignisse | Folgemission |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MISS100 | Die Prätorianer | – | 24×16 | **0:Imperium**, 2:Maliteri, 5:Zoleri | 1 von 1 | API000.AVI | API400.AVI | API421.AVI | API426.AVI | – | 5 | MISS101 |
| 2 | MISS101 | Der Vormarsch | 6487674 | 24×24 | **0:Imperium**, 2:Maliteri, 5:Zoleri | 4 von 6 | – | API401.AVI | API422.AVI | API427.AVI | – | 3 | MISS102 |
| 3 | MISS102 | Die Schiffe | 1564386 | 24×24 | **0:Imperium**, 2:Maliteri, 5:Zoleri | 4 von 6 | – | API402.AVI | API423.AVI | API425.AVI | – | 6 | MISS103 |
| 4 | MISS103 | Die Landung auf Kaar | 9745642 | 24×32 | **0:Imperium**, 4:Drullische Kais | 1 von 1 | – | API403.AVI | API420.AVI | API424.AVI | – | 3 | MISS104 |
| 5 | MISS104 | Kampf um die Fabriken | 3756838 | 24×24 | **0:Imperium**, 1:Drulls, 4:Drullische Kais, 5:Imperiale Kais | 2 von 4 | API012.AVI | API404.AVI | API421.AVI | API425.AVI | API016.AVI | 5 | MISS105 |
| 6 | MISS105 | Das Flugzeugkombinat | 2957843 | 32×40 | **0:Imperium**, 1:Drulls, 4:Drullische Kais, 5:Imperiale Kais | 1 von 1 | – | API405.AVI | API422.AVI | API427.AVI | – | 15 | MISS106 |
| 7 | MISS106 | Die Spaltung der Kais | 8844366 | 32×32 | **0:Imperium**, 1:Drulls, 4:Drullische Kais, 5:Imperiale Kais | 2 von 4 | – | API406.AVI | API421.AVI | API425.AVI | API025.AVI | 13 | MISS107 |
| 8 | MISS107 | Das HQ der Drulls | 2375411 | 48×32 | **0:Imperium**, 1:Drulls, 3:Ieti, 4:Drullische Kais, 5:Imperiale Kais | 1 von 1 | – | API407.AVI | API420.AVI | API424.AVI | – | 10 | MISS108 |
| 9 | MISS108 | Das Expeditionsheer | 3854653 | 32×40 | **0:Imperium**, 1:Drulls, 2:Cyborgs, 4:Imperiale Kais | 1 von 1 | API034.AVI | API408.AVI | API423.AVI | API426.AVI | – | 22 | MISS109 |
| 10 | MISS109 | Urelis | 5647332 | 32×32 | **0:Imperium**, 1:Drulls, 2:Cyborgs, 4:Imperiale Kais | 1 von 1 | – | API409.AVI | API422.AVI | API425.AVI | – | 20 | MISS110 |
| 11 | MISS110 | Kol-Lorz in Gefahr | 4092664 | 48×32 | **0:Imperium**, 1:Drulls, 2:Cyborgs, 4:Imperiale Kais | 1 von 1 | – | API410.AVI | API420.AVI | API426.AVI | – | 5 | MISS111 |
| 12 | MISS111 | Die Nachschublinien | 7564366 | 32×32 | **0:Imperium**, 1:Drulls, 2:Cyborgs, 4:Imperiale Kais | 1 von 1 | – | API411.AVI | API421.AVI | API424.AVI | – | 11 | MISS112 |
| 13 | MISS112 | Skom | 8264241 | 56×64 | **0:Imperium**, 1:Drulls, 2:Cyborgs | 3 von 3 | API056.AVI | API412.AVI | API422.AVI | API426.AVI | – | 16 | MISS113 |
| 14 | MISS113 | Der Panzerkeil | 3243554 | 56×40 | **0:Imperium**, 1:Drulls, 2:Cyborgs | 1 von 1 | – | API413.AVI | API421.AVI | API427.AVI | – | 11 | MISS114 |
| 15 | MISS114 | Terdon | 5487436 | 40×40 | **0:Imperium**, 1:Drulls | 1 von 1 | – | API414.AVI | API420.AVI | API426.AVI | – | 16 | MISS115 |
| 16 | MISS115 | Entscheidung über Skom | 1353411 | 32×48 | **0:Imperium**, 1:Drulls | 1 von 1 | – | API415.AVI | API421.AVI | API425.AVI | – | 9 | MISS116 |
| 17 | MISS116 | Der Hafen von Magalo | 4524338 | 40×40 | **0:Imperium**, 1:Drulls, 4:Imperiale Kais, 5:Gegenunion | 3 von 4 | API078.AVI | API416.AVI | API422.AVI | API426.AVI | – | 15 | MISS117 |
| 18 | MISS117 | Vor Hallwa | 6731244 | 56×32 | **0:Imperium**, 1:Drulls, 4:Imperiale Kais, 5:Gegenunion | 2 von 4 | – | API417.AVI | API420.AVI | API427.AVI | – | 19 | MISS118 |
| 19 | MISS118 | In der Hauptstadt | 1243371 | 32×24 | **0:Imperium**, 1:Drulls, 3:Partisanen, 4:Imperiale Kais, 5:Gegenunion | 4 von 4 | – | API418.AVI | API421.AVI | API425.AVI | – | 6 | MISS119 |
| 20 | MISS119 | Die Entscheidung | 6245425 | 32×24 | **0:Imperium**, 1:Drulls, 3:Partisanen, 4:Imperiale Kais, 5:Gegenunion | 1 von 1 | – | API419.AVI | API422.AVI | API426.AVI | API998.AVI | 5 | Ende → Epilog |

### Sieg- und Niederlagebedingungen je Mission

- **MISS100 Die Prätorianer** – benötigt 1: Sieg: player 2 has no units left; Niederlage: player 0 has no units left; Niederlage: turn 29 reached
- **MISS101 Der Vormarsch** – benötigt 4: Sieg: player 2 has no units left; Sieg: building 1 owned by player 0 („MALA KANDA"); Sieg: building 1 owned by player 5 („MALA KANDA"); Sieg: building 2 owned by player 0 („IRETI"); Sieg: building 2 owned by player 5 („IRETI"); Sieg: building 4 owned by player 0 („FLUGZEUGWRACK"); Niederlage: player 0 has no units left; Niederlage: turn 90 reached
- **MISS102 Die Schiffe** – benötigt 4: Sieg: player 2 has no units left; Sieg: building 2 owned by player 0 („UMO"); Sieg: building 2 owned by player 5 („UMO"); Sieg: building 3 owned by player 0 („ENTALA"); Sieg: building 3 owned by player 5 („ENTALA"); Sieg: building 4 owned by player 0 („HEILIGTUM"); Niederlage: turn 90 reached; Niederlage: player 0 has no units left
- **MISS103 Die Landung auf Kaar** – benötigt 1: Sieg: building 3 owned by player 0 („KAI-HAUPTQUATIER"); Niederlage: turn 90 reached; Niederlage: player 0 has no units left
- **MISS104 Kampf um die Fabriken** – benötigt 2: Sieg: building 6 owned by player 0 („PANZERFABRIK P2"); Sieg: building 6 owned by player 5 („PANZERFABRIK P2"); Sieg: building 1 owned by player 0 („F.FABRIK GATNO"); Sieg: building 1 owned by player 5 („F.FABRIK GATNO"); Niederlage: player 0 has no units left; Niederlage: building 0 owned by player 4 („HAUPTQUARTIER"); Niederlage: turn 90 reached
- **MISS105 Das Flugzeugkombinat** – benötigt 1: Sieg: building 7 owned by player 0 („FLUGZEUGKOMBINAT"); Niederlage: player 0 has no units left; Niederlage: turn 90 reached
- **MISS106 Die Spaltung der Kais** – benötigt 2: Sieg: building 8 owned by player 0 („F. FABRIK FELGO"); Sieg: building 8 owned by player 5 („F. FABRIK FELGO"); Sieg: building 7 owned by player 0 („F. FABRIK ESTO"); Sieg: building 7 owned by player 5 („F. FABRIK ESTO"); Niederlage: player 0 has no units left; Niederlage: turn 90 reached
- **MISS107 Das HQ der Drulls** – benötigt 1: Sieg: building 9 owned by player 0 („HAUPTQUATIER"); Niederlage: building 12 owned by player 1 („HAUPTQUATIER"); Niederlage: building 12 owned by player 4 („HAUPTQUATIER"); Niederlage: building 12 owned by player 3 („HAUPTQUATIER"); Niederlage: player 0 has no units left; Niederlage: turn 99 reached
- **MISS108 Das Expeditionsheer** – benötigt 1: Sieg: building 9 owned by player 0 („GEHEIMES DEPOT"); Niederlage: building 8 owned by player 1 („FLUGZEUGKOMBINAT"); Niederlage: building 8 owned by player 2 („FLUGZEUGKOMBINAT"); Niederlage (Stufe 128, Kategorie 208): player 0 has no units left; Niederlage: turn 100 reached
- **MISS109 Urelis** – benötigt 1: Sieg: building 12 owned by player 0 („HAUPTQUATIER"); Niederlage: building 10 owned by player 1 („HAUPTQUATIER"); Niederlage: player 0 has no units left; Niederlage: turn 100 reached
- **MISS110 Kol-Lorz in Gefahr** – benötigt 1: Sieg: building 9 owned by player 0 („FLUGHAFEN LURS"); Niederlage: building 16 owned by player 1 („LORZ-WERKE"); Niederlage: building 16 owned by player 2 („LORZ-WERKE"); Niederlage: player 0 has no units left; Niederlage: turn 160 reached
- **MISS111 Die Nachschublinien** – benötigt 1: Sieg: building 11 owned by player 0 („URELIS' BUNKER"); Niederlage: building 7 owned by player 1 („HAUPTQUATIER"); Niederlage: turn 100 reached; Niederlage: player 0 has no units left
- **MISS112 Skom** – benötigt 3: Sieg: building 9 owned by player 0 („HOL-LONK ZENTRUM"); Sieg: building 25 owned by player 0 („HQ F™DERATION"); Sieg: building 7 owned by player 0 („TEXOL"); Niederlage: player 0 has no units left; Niederlage: building 15 owned by player 1 („PEM CONT"); Niederlage: building 15 owned by player 2 („PEM CONT"); Niederlage: turn 160 reached
- **MISS113 Der Panzerkeil** – benötigt 1: Sieg: building 17 owned by player 0 („HQ F™DERATION"); Niederlage: building 12 owned by player 1 („HAUPTQUATIER"); Niederlage: building 12 owned by player 2 („HAUPTQUATIER"); Niederlage (Stufe 128, Kategorie 208): player 0 has no units left; Niederlage: turn 160 reached
- **MISS114 Terdon** – benötigt 1: Sieg: building 13 owned by player 0 („HAUPTQUATIER"); Niederlage: building 4 owned by player 1 („STADTZENTRUM"); Niederlage: player 0 has no units left; Niederlage: turn 100 reached
- **MISS115 Entscheidung über Skom** – benötigt 1: Sieg: building 10 owned by player 0 („HQ F™DERATION"); Niederlage: building 2 owned by player 1 („IMPERIALES HQ"); Niederlage: player 0 has no units left; Niederlage: turn 100 reached
- **MISS116 Der Hafen von Magalo** – benötigt 3: Sieg: building 12 owned by player 0 („MAGALO HAFEN"); Sieg: building 12 owned by player 4 („MAGALO HAFEN"); Sieg: building 10 owned by player 0 („FLUGHAFEN EKOPAN"); Sieg: building 16 owned by player 0 („FLUGHAFEN BUNKA"); Niederlage: player 0 has no units left; Niederlage: turn 120 reached
- **MISS117 Vor Hallwa** – benötigt 2: Sieg: building 6 owned by player 0 („MALATI"); Sieg: building 5 owned by player 0 („ANDAU"); Sieg: building 6 owned by player 4 („MALATI"); Sieg: building 5 owned by player 4 („ANDAU"); Niederlage: player 0 has no units left; Niederlage: turn 95 reached
- **MISS118 In der Hauptstadt** – benötigt 4: Sieg: building 9 owned by player 0 („VILLA VAL HARRIS"); Sieg: building 1 owned by player 0 („B™RSE"); Sieg: building 6 owned by player 0 („KASERNE"); Sieg: building 8 owned by player 0 („KRAFTWERK"); Niederlage: building 11 owned by player 1 („PARLAMENT"); Niederlage: building 11 owned by player 3 („PARLAMENT"); Niederlage: player 0 has no units left; Niederlage: turn 100 reached
- **MISS119 Die Entscheidung** – benötigt 1: Sieg: building 2 owned by player 0 („FORSCHUNGSLABOR"); Niederlage: building 6 owned by player 1 („HAUPTQUATIER"); Niederlage: building 6 owned by player 3 („HAUPTQUATIER"); Niederlage: building 6 owned by player 5 („HAUPTQUATIER"); Niederlage: player 0 has no units left; Niederlage: turn 100 reached
- **MISS300 Die drei Könige (3)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS301 Der Belagerungsring (2)** – benötigt 1: Sieg: building 7 owned by player 0 („HQ-NOTRU-KLAN"); Niederlage: building 0 owned by player 1 („HQ-GIMON-KLAN"); Niederlage: turn 199 reached
- **MISS302 Das Kraftwerk (2)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS303 Unternehmen Nautilus (3)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS304 Die verfluchte Insel (6)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS305 Die geheime Fabrik (4)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS306 Die Kristalle (2)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS307 Ohne Ausweg (2)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS308 Der Wettlauf (6)** – benötigt 1: Niederlage: player 0 has no units left; Niederlage: player 1 has no units left; Niederlage: player 2 has no units left; Niederlage: player 3 has no units left
- **MISS309 Grenzkonflikte(2)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS310 Die Wüstenfabrik (5)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS311 Erinnerungen (6)** – benötigt 1: keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)
- **MISS200 Tutorial 1** – benötigt 1: Sieg: player 1 has no units left; Niederlage: player 0 has no units left
- **MISS201 Tutorial 2** – benötigt 1: Sieg: player 1 has no units left; Niederlage: player 0 has no units left
- **MISS202 Tutorial 3** – benötigt 1: Sieg: building 7 owned by player 0; Sieg: player 1 has no units left; Niederlage: building 0 owned by player 1 („Hauptquatier"); Niederlage: player 0 has no units left
- **MISS203 Tutorial 4** – benötigt 1: Sieg: building 0 owned by player 0 („Hauptquatier"); Sieg: player 1 has no units left; Niederlage: player 0 has no units left
- **MISS204 Tutorial 5** – benötigt 1: Sieg: building 7 owned by player 0 („Hauptquatier"); Niederlage: player 0 has no units left
- **MISS205 Tutorial 6** – benötigt 1: Sieg: building 1 owned by player 0 („Flughafen"); Sieg: player 1 has no units left; Niederlage: player 0 has no units left
- **MISS206 Tutorial 7** – benötigt 1: Sieg: building 5 owned by player 0 („Hauptquatier"); Niederlage: player 0 has no units left
- **MISS207 Tutorial 8** – benötigt 1: Sieg: building 5 owned by player 0 („Hauptquatier"); Niederlage: building 0 owned by player 1 („Hauptquatier"); Niederlage: player 0 has no units left

## Tutorial (MCP002) und Mehrspielerkarten (MCP001)

| Datei | Set | Name (DE / EN) | Karte | Spieler | Sieg-/Niederlage-Videos |
|---|---|---|---|---|---|
| MISS300 | multiplayer | Die drei Könige (3) / The three kings (3) | 56×48 | 0:Belgor, 1:Mertania, 3:Ux | – / – |
| MISS301 | multiplayer | Der Belagerungsring (2) / The siege (2) | 48×48 | 0:Gimon Klan, 1:Notru Klan | – / – |
| MISS302 | multiplayer | Das Kraftwerk (2) / The power plant (2) | 24×24 | 0:Nordalpol, 1:Südalpol | – / – |
| MISS303 | multiplayer | Unternehmen Nautilus (3) / The Nautilus Project (3) | 48×48 | 0:Westakton, 1:Ostakton, 3:Piraten | – / – |
| MISS304 | multiplayer | Die verfluchte Insel (6) / The cursed island (6) | 40×32 | 0:Artu, 1:Geen, 2:Maron, 3:Fexit, 4:Olzo, 5:Ers | – / – |
| MISS305 | multiplayer | Die geheime Fabrik (4) / The hidden factory (4) | 56×40 | 0:Kul, 1:Gaman, 2:Heltik, 3:Polfon | – / – |
| MISS306 | multiplayer | Die Kristalle (2) / The Crystalls (2) | 48×24 | 0:Südmogun, 1:Nordmogun | – / – |
| MISS307 | multiplayer | Ohne Ausweg (2) / No escape (2) | 24×24 | 0:General Migon, 1:General Tarus | – / – |
| MISS308 | multiplayer | Der Wettlauf (6) / – | 32×24 | 0:Karon, 1:Seipo, 2:Srewe, 3:Dlawe, 4:Reuab | – / – |
| MISS309 | multiplayer | Grenzkonflikte(2) / – | 32×16 | 0:Invita, 1:Invidae | – / – |
| MISS310 | multiplayer | Die Wüstenfabrik (5) / – | 40×40 | 0:Opal, 1:Smaragd, 2:Saphir, 3:Rubin | – / – |
| MISS311 | multiplayer | Erinnerungen (6) / – | 48×48 | 0:Patric, 1:Friedel, 2:Haiko, 3:Angelika, 4:Markus | – / – |
| MISS200 | tutorial | Tutorial 1 / Tutorial 1 | 24×16 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS201 | tutorial | Tutorial 2 / Tutorial 2 | 24×16 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS202 | tutorial | Tutorial 3 / Tutorial 3 | 24×32 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS203 | tutorial | Tutorial 4 / Tutorial 4 | 24×32 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS204 | tutorial | Tutorial 5 / Tutorial 5 | 32×32 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS205 | tutorial | Tutorial 6 / Tutorial 6 | 24×32 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS206 | tutorial | Tutorial 7 / Tutorial 7 | 32×32 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |
| MISS207 | tutorial | Tutorial 8 / Tutorial 8 | 32×40 | 0:Spieler, 1:Computer | API421.AVI / API426.AVI |

Mehrspielerkarten: Laut Handbuch (S. 30/34) können Spieler beim Start frei als Mensch/Computer und Allianzen gewählt werden; im Mehrspieler-Modus werden keine Videosequenzen gezeigt. Echte Einzelkarten im Sinne eigenständiger Skirmish-Karten sind die Sets MCP001 und MCP002; die Kampagnenkarten sind zusätzlich mit Kennwort einzeln startbar.

## Videos außerhalb der Missionen

| Datei | Rolle | Beleg |
|---|---|---|
| API980–982.AVI | Vorspann (3 Teile, zusammen ≈ 11,6 min) | README.TXT: Vorspann > 11 min, LEER springt zum nächsten Abschnitt; Inhalt gesichtet |
| API996.AVI | Gebäude-Einnahme-Sequenz | `VIDEOSEQUENCE 0` „Shop-Einnahmesequenz" in allen MCP-Dateien |
| API997.AVI | Abspann/Credits | Inhalt gesichtet (Teamnamen) |
| API998.AVI | Epilog nach der letzten Mission | MISS119 `TERMINATIONSEQS[4]` = 2005 → API998 |
| SHOW/SHADOW.AVI | Trailer | nicht vom Spiel referenziert (Annahme, wird als Bonus angeboten) |

## Offene Punkte

- API008.AVI: not referenced by any mission or known role
- API508.AVI: not referenced by any mission or known role
- API509.AVI: not referenced by any mission or known role
- Videos 101B (`API401B.AVI`, identisch groß mit API401) – Variante, Verwendung ungeklärt.
- Kategorie 208 (MISS108, MISS113): Niederlagebedingung mit gesetztem Bit 7 – Bedeutung im Original ungeklärt (BI2020 deutet es als Aktionsstufe).
- BI2020 fügt in MISS119 einen Allianzwechsel ein (`FixBI3FINAL`), der nicht in der Datei steht – muss am Original verifiziert werden.
