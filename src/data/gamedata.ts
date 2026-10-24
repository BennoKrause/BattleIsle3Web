// Loads and caches the static game data (unit classes, terrain, texts, campaign sets) from the
// original files. Mission files are loaded on demand.
import type { FileSource } from './source.ts';
import { parseUnitClasses, type UnitClass } from '../formats/unitdef.ts';
import { parseTerrainDefs, type TerrainDef } from '../formats/terraindef.ts';
import { textTable, parseTextFile } from '../formats/text.ts';
import { parseCampaignSet, type CampaignSet } from '../formats/campaign.ts';
import { parseMission, type Mission } from '../formats/mission.ts';
import { parseLib } from '../formats/lib.ts';

export type Language = 'GER' | 'ENG';

export interface UnitClassInfo extends UnitClass {
  name: string;
  description: string;
  weaponNames: string[];
  /** Weapon pictogram numbers of WC000.DAT (WB000 bitmap WB01_(10 + n); 100 = no weapon). */
  weaponIcons: number[];
}

export interface GameData {
  source: FileSource;
  language: Language;
  unitClasses: UnitClassInfo[];
  terrain: TerrainDef[];
  /** General UI/message texts (TEXT000.TXT) in file order; ids are not unique there. */
  uiTexts: string[];
  sets: CampaignSet[];
  palettes: Map<string, Uint8Array>;
  loadMission(fileId: number): Promise<LoadedMission>;
}

export interface LoadedMission {
  fileId: number;
  mission: Mission;
  /** #0 description, #1 short description, #2.. building names (index = nameIndex). */
  texts: Map<number, string>;
}

/** English texts exist only on CD1; files that are not translated fall back to German. */
async function readLang(src: FileSource, lang: Language, file: string): Promise<Uint8Array> {
  if (lang === 'ENG' && (await src.exists(`ENG/${file}`))) return src.read(`ENG/${file}`);
  return src.read(`GER/${file}`);
}

export async function loadGameData(source: FileSource, language: Language = 'GER'): Promise<GameData> {
  const [unitDat, unitTxt, wcTxt, partDat, text000, paltLib] = await Promise.all([
    source.read('LIB/UNIT000.DAT'),
    readLang(source, language, 'UNIT000.TXT'),
    readLang(source, language, 'WC000.DAT'),
    source.read('LIB/PART000.DAT'),
    readLang(source, language, 'TEXT000.TXT'),
    source.read('LIB/PALT000.LIB'),
  ]);
  const names = textTable(unitTxt, 'cp850');
  const weaponLines = textTable(wcTxt);
  const unitClasses: UnitClassInfo[] = parseUnitClasses(unitDat).map((c) => {
    // WC000.DAT: "icon:name:icon:name:..." for the 4 weapons; "-" = no weapon
    const parts = (weaponLines.get(c.index) ?? '').split(':');
    const weaponNames = [0, 1, 2, 3].map((w) => (parts[w * 2 + 1] ?? '-').trim());
    const weaponIcons = [0, 1, 2, 3].map((w) => { const n = Number((parts[w * 2] ?? '100').trim()); return Number.isFinite(n) ? n : 100; });
    return { ...c, name: names.get(c.nameText) ?? `#${c.index}`, description: names.get(c.descriptionText) ?? '', weaponNames, weaponIcons };
  });

  const sets: CampaignSet[] = [];
  for (const id of [0, 1, 2]) {
    const n = String(id).padStart(3, '0');
    sets.push(parseCampaignSet(id, await source.read(`MIS/MCP${n}.DAT`), await readLang(source, language, `MCP${n}.TXT`)));
  }

  const palettes = new Map(parseLib(paltLib).map((e) => [e.name, e.data.slice(0, 768)]));

  return {
    source, language, unitClasses,
    terrain: parseTerrainDefs(partDat),
    uiTexts: parseTextFile(text000).map((r) => r.body),
    sets, palettes,
    async loadMission(fileId: number) {
      const [dat, txt] = await Promise.all([source.read(`MIS/MISS${fileId}.DAT`), readLang(source, language, `MISS${fileId}.TXT`)]);
      return { fileId, mission: parseMission(dat), texts: textTable(txt) };
    },
  };
}
