// Builds the machine-readable content catalog from the original CD data:
//   docs/campaign/MISSION_INVENTORY.json
//   docs/campaign/ASSET_DEPENDENCIES.json
// usage: node tools/inventory.ts   (expects original/cd1 and original/cd2, see tools/import-cd.ts)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseMission } from '../src/formats/mission.ts';
import { parseCampaignSet, type CampaignSet } from '../src/formats/campaign.ts';
import { textTable } from '../src/formats/text.ts';
import { parseUnitClasses } from '../src/formats/unitdef.ts';
import { ActionType, describeCondition, splitCategory, Weather } from '../src/formats/actions.ts';

const ROOT = join(import.meta.dirname, '..');
const CD = [join(ROOT, 'original', 'cd1'), join(ROOT, 'original', 'cd2')];
const read = (rel: string, cd = 0) => readFileSync(join(CD[cd], rel));

const SET_KIND: Record<number, 'campaign' | 'multiplayer' | 'tutorial'> = { 0: 'campaign', 1: 'multiplayer', 2: 'tutorial' };

// ---------------------------------------------------------------- video files
interface VideoFile { file: number; name: string; cds: number[]; codec?: string; size?: string; fps?: string; duration?: number; audio?: string }
const videoFiles = new Map<number, VideoFile>();
for (const [cdIndex, cd] of CD.entries()) {
  const dir = join(cd, 'AVI');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    const m = /^API(\d{3})(B?)\.AVI$/i.exec(f);
    if (!m || m[2]) continue;
    const n = Number(m[1]);
    const entry = videoFiles.get(n) ?? { file: n, name: `API${m[1]}.AVI`, cds: [] };
    entry.cds.push(cdIndex + 1);
    videoFiles.set(n, entry);
  }
}
const ffprobe = join(ROOT, 'tools', 'bin', 'ffprobe.exe');
if (existsSync(ffprobe)) {
  for (const v of videoFiles.values()) {
    const json = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json',
      join(CD[v.cds[0] - 1], 'AVI', v.name)]).toString());
    const vs = json.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    const as = json.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
    v.codec = vs?.codec_name;
    v.size = vs ? `${vs.width}x${vs.height}` : undefined;
    v.fps = vs?.r_frame_rate;
    v.duration = Math.round(Number(json.format.duration) * 100) / 100;
    v.audio = as ? `${as.codec_name} ${as.sample_rate}Hz ${as.channels}ch` : 'none';
  }
}

// ---------------------------------------------------------------- campaign sets
const sets: CampaignSet[] = [0, 1, 2].map((id) => {
  const n = String(id).padStart(3, '0');
  return parseCampaignSet(id, read(`MIS/MCP${n}.DAT`), read(`GER/MCP${n}.TXT`));
});
const setsEn: CampaignSet[] = [0, 1, 2].map((id) => {
  const n = String(id).padStart(3, '0');
  return parseCampaignSet(id, read(`MIS/MCP${n}.DAT`), read(`ENG/MCP${n}.TXT`));
});
// VIDEOSEQUENCE ids are local to each set (MCP002 defines its own 100/101 for tutorial victory/defeat).
const videoSeqBySet = sets.map((s) => new Map(s.videos.map((v) => [v.id, v])));

const unitClasses = parseUnitClasses(read('LIB/UNIT000.DAT'));
const unitNames = textTable(read('GER/UNIT000.TXT'), 'cp850');
const unitName = (t: number) => unitNames.get(unitClasses[t]?.nameText) ?? `#${t}`;

function resolveVideo(setId: number, seqId: number) {
  if (seqId < 0) return null;
  const seq = videoSeqBySet[setId].get(seqId);
  if (!seq) return { sequence: seqId, resolved: false, note: `sequence id not defined in MCP${String(setId).padStart(3, '0')}.DAT` };
  const vf = videoFiles.get(seq.file);
  return {
    sequence: seqId, resolved: !!vf, kind: seq.kind === 2 ? 'fullscreen' : seq.kind === 0 ? 'framed' : `kind ${seq.kind}`,
    file: vf?.name ?? `API${String(seq.file).padStart(3, '0')}.AVI`, cds: vf?.cds ?? [], comment: seq.comment || undefined,
  };
}

const unresolved: string[] = [];
const missions = [];
for (const set of sets) {
  for (const cm of set.missions) {
    const fid = cm.fileId;
    const missFile = `MIS/MISS${fid}.DAT`;
    const m = parseMission(read(missFile));
    const txtDe = textTable(read(`GER/MISS${fid}.TXT`));
    const txtEn = textTable(read(`ENG/MISS${fid}.TXT`));
    const en = setsEn[set.id].missions.find((x) => x.number === cm.number);

    const presentPlayers = new Set<number>();
    for (const u of m.units) if (u.owner < 6) presentPlayers.add(u.owner);
    for (const s of m.shops) if (s.kind === 1 && s.shopType > 0 && s.owner < 6) presentPlayers.add(s.owner);
    const players = [0, 1, 2, 3, 4, 5].filter((p) => presentPlayers.has(p)).map((p) => ({
      index: p,
      name: cm.playerNames?.[p] || null,
      nameEn: en?.playerNames?.[p] || null,
      control: (m.aiMask >> p) & 1 ? 'computer' : 'human',
      allies: [0, 1, 2, 3, 4, 5].filter((q) => q !== p && (m.allies[p] >> q) & 1),
      startUnits: m.units.filter((u) => u.owner === p).length,
      buildings: m.shops.filter((s) => s.kind === 1 && s.shopType > 0 && s.owner === p).length,
    }));

    const unitsByType: Record<string, number> = {};
    for (const u of m.units) unitsByType[unitName(u.type)] = (unitsByType[unitName(u.type)] ?? 0) + 1;

    const conditions = m.actions.filter((a) => splitCategory(a.category).kind !== 'normal').map((a) => {
      const c = splitCategory(a.category);
      return { kind: c.kind, level: c.level, category: a.category, type: a.type, param: a.param, shop: a.shop,
        playerMask: a.playerMask, text: describeCondition(a.type, a.param, a.shop),
        shopName: a.type === ActionType.VC_SHOP_OCCUPIED ? txtDe.get(m.shops[a.shop]?.nameIndex) ?? null : undefined };
    });
    const events = m.actions.filter((a) => splitCategory(a.category).kind === 'normal').map((a) => {
      const base = { turn: a.turn, movement: a.movement, playerMask: a.playerMask, type: a.type, level: splitCategory(a.category).level };
      switch (a.type) {
        case ActionType.MESSAGE: {
          const video = a.param >= 100 ? resolveVideo(set.id, a.param) : null;
          if (video && !video.resolved) unresolved.push(`MISS${fid}: message ${a.param} -> ${video.note ?? 'missing AVI ' + video.file}`);
          return { ...base, action: 'message', message: a.param, video };
        }
        case ActionType.WEATHER: return { ...base, action: 'weather', weather: Weather[a.param] ?? a.param };
        case ActionType.DF_LAYER: return { ...base, action: 'map-change', layer: a.param, changes: m.dfLayers[a.param]?.length ?? null };
        case ActionType.ALLIANCE: return { ...base, action: 'alliance', newAlly: a.newAlly };
        default:
          unresolved.push(`MISS${fid}: unknown action type ${a.type}`);
          return { ...base, action: 'unknown', param: a.param, shop: a.shop };
      }
    });

    const seqNames = ['cutscene', 'briefing', 'victory', 'defeat', 'chapterEnd'];
    const videos = Object.fromEntries(seqNames.map((k, i) => [k, resolveVideo(set.id, cm.terminationSeqs[i] ?? -1)]));
    for (const [k, v] of Object.entries(videos)) if (v && !v.resolved) unresolved.push(`MISS${fid}: ${k} video ${v.sequence} unresolved`);

    // Next mission: byte MISS+6 is 1-based within the set; byte MISS+7 == 39 marks the final mission (BI2020).
    const isFinal = m.nextMissionRaw2 === 39;
    let next: number | null = null;
    if (set.id === 0 && !isFinal) {
      next = set.missions.find((x) => x.number === m.nextMissionRaw - 1)?.fileId ?? null;
      if (next === null) unresolved.push(`MISS${fid}: next mission ${m.nextMissionRaw} not found in MCP000`);
    }

    missions.push({
      id: `MISS${fid}`, fileId: fid, set: SET_KIND[set.id], setName: set.name, number: cm.number,
      name: cm.name ?? null, nameEn: en?.name ?? null,
      files: { mission: missFile, textDe: `GER/MISS${fid}.TXT`, textEn: `ENG/MISS${fid}.TXT (CD1)` },
      password: cm.password >= 0 ? cm.password : null,
      descriptionDe: txtDe.get(0) ?? null, shortDescriptionDe: txtDe.get(1) ?? null,
      descriptionEn: txtEn.get(0) ?? null, shortDescriptionEn: txtEn.get(1) ?? null,
      map: { width: m.width, height: m.height, startWeather: Weather[m.weather] ?? m.weather, mapChangeLayers: m.dfLayers.length },
      players, startUnitCount: m.units.length, unitsByType,
      buildings: m.shops.filter((s) => s.kind === 1 && s.shopType > 0).map((s) => ({ index: s.index, x: s.x, y: s.y, type: s.shopType, owner: s.owner, name: txtDe.get(s.nameIndex) ?? null })),
      requiredVictoryConditions: m.requiredVictoryConditions,
      conditions, events, videos,
      next: set.id === 0 ? (isFinal ? 'END_OF_CAMPAIGN' : next) : null,
      nextRaw: [m.nextMissionRaw, m.nextMissionRaw2],
    });
  }
}

// ---------------------------------------------------------------- video usage
const usedFiles = new Map<number, string[]>();
for (const ms of missions) {
  for (const [k, v] of Object.entries(ms.videos)) if (v?.resolved && 'file' in v) {
    const n = Number(v.file!.slice(3, 6));
    usedFiles.set(n, [...(usedFiles.get(n) ?? []), `${ms.id}:${k}`]);
  }
  for (const e of ms.events) if ('video' in e && e.video?.resolved) {
    const n = Number(e.video.file!.slice(3, 6));
    usedFiles.set(n, [...(usedFiles.get(n) ?? []), `${ms.id}:t${e.turn}.${e.movement}`]);
  }
}
for (const v of videoSeqBySet[0].values()) if (v.id === 0) usedFiles.set(v.file, [...(usedFiles.get(v.file) ?? []), 'building-capture (VIDEOSEQUENCE 0)']);
const KNOWN_OTHER: Record<number, string> = {
  980: 'intro part 1 (identified by content; README: intro > 11 min, SPACE skips to next part)',
  981: 'intro part 2', 982: 'intro part 3',
  997: 'credits (content: team credits)', 900: 'test clip (7 frames, no audio; identical to BIN/TST.AVI)',
};
const videos = [...videoFiles.values()].sort((a, b) => a.file - b.file).map((v) => ({
  ...v, usedBy: usedFiles.get(v.file) ?? [], role: KNOWN_OTHER[v.file] ?? (usedFiles.has(v.file) ? 'mission sequence' : 'UNREFERENCED'),
}));
for (const v of videos) if (v.role === 'UNREFERENCED') unresolved.push(`${v.name}: not referenced by any mission or known role`);

const outDir = join(ROOT, 'docs', 'campaign');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'MISSION_INVENTORY.json'), JSON.stringify({
  generatedBy: 'tools/inventory.ts', source: 'original CD data (MIS/*.DAT, MIS/MCP*.DAT, GER|ENG/*.TXT)',
  sets: sets.map((s) => ({ id: s.id, file: `MCP${String(s.id).padStart(3, '0')}`, kind: SET_KIND[s.id], name: s.name, nameEn: setsEn[s.id].name, startModes: s.startModes, missions: s.missions.map((m) => `MISS${m.fileId}`) })),
  missions, unresolved,
}, null, 2));

const libDir = (cd: number, d: string) => existsSync(join(CD[cd], d)) ? readdirSync(join(CD[cd], d)) : [];
writeFileSync(join(outDir, 'ASSET_DEPENDENCIES.json'), JSON.stringify({
  generatedBy: 'tools/inventory.ts',
  global: {
    unitDefinitions: ['LIB/UNIT000.DAT', 'LIB/UNIT000.LIB', 'GER|ENG/UNIT000.TXT', 'GER|ENG/WC000.DAT'],
    terrain: ['LIB/PART000.DAT', 'LIB/PART000.LIB', 'LIB/LAYR000-006.LIB'],
    palettes: ['LIB/PALT000.LIB'],
    texts: ['GER|ENG/TEXT000.TXT', 'GER|ENG/MCP000-002.TXT'],
    missionControl: ['MIS/MCP000.DAT', 'MIS/MCP001.DAT', 'MIS/MCP002.DAT'],
    userInterface: libDir(0, 'LIB').filter((f) => f.endsWith('.LIB') && !/^(UNIT|PART|LAYR|PALT)/.test(f)).map((f) => `LIB/${f}`),
    unitAnimations: libDir(0, 'UIA').map((f) => `UIA/${f}`),
    fight3d: libDir(0, 'FGT').map((f) => `FGT/${f}`),
    music: [...new Set([...libDir(0, 'MUS'), ...libDir(1, 'MUS')])].sort().map((f) => `MUS/${f}`),
    intro: ['AVI/API980.AVI', 'AVI/API981.AVI', 'AVI/API982.AVI'],
    credits: ['AVI/API997.AVI'],
  },
  videos,
  missions: missions.map((m) => ({
    id: m.id, files: m.files,
    videos: [...new Set([...Object.values(m.videos).filter(Boolean).map((v) => v!.file), ...m.events.flatMap((e) => ('video' in e && e.video ? [e.video.file] : []))])],
    unitTypes: Object.keys(m.unitsByType),
  })),
}, null, 2));

console.log(`${missions.length} missions, ${videos.length} video files, ${unresolved.length} unresolved items`);
for (const u of unresolved) console.log('  UNRESOLVED', u);

// ---------------------------------------------------------------- CAMPAIGN_STRUCTURE.md
const fmtVid = (v: ReturnType<typeof resolveVideo>) => (v ? `${v.file}${v.resolved ? '' : ' ⚠'}` : '–');
const md: string[] = [];
md.push('# Kampagnenstruktur – Battle Isle 3', '',
  '> Automatisch erzeugt von `tools/inventory.ts` aus den Originaldateien (`MIS/MCP00x.DAT`, `GER|ENG/MCP00x.TXT`,',
  '> `MIS/MISSxxx.DAT`, `GER/MISSxxx.TXT`). Maschinenlesbar: `MISSION_INVENTORY.json`, `ASSET_DEPENDENCIES.json`.', '',
  '## Battle-Sets', '',
  'Die Original-CD enthält drei Battle-Sets (Handbuch S. 34: Missionsladefenster). Speicherstände nummerieren sie 1 = Schatten des Imperators, 2 = Mehrspieler, 3 = Tutorial (Handbuch S. 29).', '',
  '| Steuerdatei | Art | Name (DE / EN) | Missionen | STARTMODI |', '|---|---|---|---|---|');
for (const s of sets) md.push(`| MCP${String(s.id).padStart(3, '0')} | ${SET_KIND[s.id]} | ${s.name} / ${setsEn[s.id].name} | ${s.missions.map((m) => m.fileId).join(', ')} | ${s.startModes.join(' ')} |`);
md.push('', '## Kampagne „Der Schatten des Imperiums" (MCP000)', '',
  'Reihenfolge belegt durch das Folgemissionsfeld jeder Missionsdatei (Byte MISS+6, 1-basiert) und `NUMMER`/`FILEID` in MCP000.DAT; MISS119 trägt die Endmarkierung (Byte MISS+7 = 39). **Es gibt keine Verzweigungen.** Laut Handbuch (S. 30) wird bei Niederlage dieselbe Karte neu gestartet, bei Sieg die nächste geladen und deren Kennwort mitgeteilt.', '',
  'Videospalten: Zwischensequenz vor der Karte (`TERMINATIONSEQS[0]`), Missionsbriefing ([1]), Sieg ([2]), Niederlage ([3]), Kapitelende ([4]).', '',
  '| # | Datei | Name | Kennwort | Karte | Spieler (Mensch fett) | Sieg (benötigt) | Zwischensequenz | Briefing | Sieg | Niederlage | Kapitelende | Ereignisse | Folgemission |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of missions.filter((x) => x.set === 'campaign')) {
  const pl = m.players.map((p) => (p.control === 'human' ? `**${p.index}:${p.name}**` : `${p.index}:${p.name}`)).join(', ');
  const vc = m.conditions.filter((c) => c.kind === 'victory').length;
  md.push(`| ${m.number + 1} | ${m.id} | ${m.name} | ${m.password ?? '–'} | ${m.map.width}×${m.map.height} | ${pl} | ${m.requiredVictoryConditions} von ${vc} | ${fmtVid(m.videos.cutscene)} | ${fmtVid(m.videos.briefing)} | ${fmtVid(m.videos.victory)} | ${fmtVid(m.videos.defeat)} | ${fmtVid(m.videos.chapterEnd)} | ${m.events.length} | ${m.next === 'END_OF_CAMPAIGN' ? 'Ende → Epilog' : 'MISS' + m.next} |`);
}
md.push('', '### Sieg- und Niederlagebedingungen je Mission', '');
for (const m of missions) {
  md.push(`- **${m.id} ${m.name}** – benötigt ${m.requiredVictoryConditions}: ` +
    (m.conditions.map((c) => `${c.kind === 'victory' ? 'Sieg' : 'Niederlage'}${c.level ? ` (Stufe ${c.level}, Kategorie ${c.category})` : ''}: ${c.text}${c.shopName ? ` („${c.shopName}")` : ''}`).join('; ') || 'keine Bedingungen in der Datei (Mehrspielerkarte: Standard = alle Gegner besiegen, Annahme)'));
}
md.push('', '## Tutorial (MCP002) und Mehrspielerkarten (MCP001)', '',
  '| Datei | Set | Name (DE / EN) | Karte | Spieler | Sieg-/Niederlage-Videos |', '|---|---|---|---|---|---|');
for (const m of missions.filter((x) => x.set !== 'campaign')) {
  md.push(`| ${m.id} | ${m.set} | ${m.name} / ${m.nameEn ?? '–'} | ${m.map.width}×${m.map.height} | ${m.players.map((p) => `${p.index}:${p.name ?? '?'}`).join(', ')} | ${fmtVid(m.videos.victory)} / ${fmtVid(m.videos.defeat)} |`);
}
md.push('', 'Mehrspielerkarten: Laut Handbuch (S. 30/34) können Spieler beim Start frei als Mensch/Computer und Allianzen gewählt werden; im Mehrspieler-Modus werden keine Videosequenzen gezeigt. Echte Einzelkarten im Sinne eigenständiger Skirmish-Karten sind die Sets MCP001 und MCP002; die Kampagnenkarten sind zusätzlich mit Kennwort einzeln startbar.', '',
  '## Videos außerhalb der Missionen', '',
  '| Datei | Rolle | Beleg |', '|---|---|---|',
  '| API980–982.AVI | Vorspann (3 Teile, zusammen ≈ 11,6 min) | README.TXT: Vorspann > 11 min, LEER springt zum nächsten Abschnitt; Inhalt gesichtet |',
  '| API996.AVI | Gebäude-Einnahme-Sequenz | `VIDEOSEQUENCE 0` „Shop-Einnahmesequenz" in allen MCP-Dateien |',
  '| API997.AVI | Abspann/Credits | Inhalt gesichtet (Teamnamen) |',
  '| API998.AVI | Epilog nach der letzten Mission | MISS119 `TERMINATIONSEQS[4]` = 2005 → API998 |',
  '| SHOW/SHADOW.AVI | Trailer | nicht vom Spiel referenziert (Annahme, wird als Bonus angeboten) |', '',
  '## Offene Punkte', '');
for (const u of unresolved) md.push(`- ${u}`);
md.push('- Videos 101B (`API401B.AVI`, identisch groß mit API401) – Variante, Verwendung ungeklärt.',
  '- Kategorie 208 (MISS108, MISS113): Niederlagebedingung mit gesetztem Bit 7 – Bedeutung im Original ungeklärt (BI2020 deutet es als Aktionsstufe).',
  '- BI2020 fügt in MISS119 einen Allianzwechsel ein (`FixBI3FINAL`), der nicht in der Datei steht – muss am Original verifiziert werden.');
writeFileSync(join(outDir, 'CAMPAIGN_STRUCTURE.md'), md.join('\n') + '\n');
