// Mission control files ("MCP"): MIS/MCPnnn.DAT (videos, mission order, passwords) plus the
// language file GER|ENG/MCPnnn.TXT (set name, mission names, player names).
// Keys verified on the CD: UIA, MUSICID, WEAPONCONTROL, STARTMODI, COMPUTERPROGRESSION,
// BATTLESETNAME, VIDEOSEQUENCE, NUMMER, FILEID, KENNWORT, CHROMA, TOM, UNIT, PART,
// TERMINATIONSEQS, NAME, PLAYER.
import { parseControlFile } from './text.ts';

export interface VideoSequence {
  /** Sequence id used by mission messages and TERMINATIONSEQS. */
  id: number;
  /** 0 = small video inside the game frame, 2 = full-screen (640x480) video. Other values unverified. */
  kind: number;
  /** AVI file number: AVI/APInnn.AVI */
  file: number;
  extra: number[];
  comment: string;
}

export interface CampaignMission {
  /** 0-based position in this set (NUMMER). */
  number: number;
  /** Mission file number (FILEID): MIS/MISSnnn.DAT */
  fileId: number;
  /** Level password, -1 = none. */
  password: number;
  chroma: string;
  /** cutscene, briefing, victory, defeat, end-of-chapter (-1 = none). */
  terminationSeqs: number[];
  name?: string;
  playerNames?: string[];
}

export interface CampaignSet {
  id: number;
  name?: string;
  uia: number[];
  startModes: number[];
  videos: VideoSequence[];
  missions: CampaignMission[];
  rawKeys: Record<string, string[]>;
}

export function parseCampaignSet(id: number, dat: Uint8Array, txt?: Uint8Array): CampaignSet {
  const set: CampaignSet = { id, uia: [], startModes: [], videos: [], missions: [], rawKeys: {} };
  let current: CampaignMission | undefined;
  for (const r of parseControlFile(dat)) {
    (set.rawKeys[r.key] ??= []).push(r.value);
    switch (r.key) {
      case 'UIA': set.uia = r.value.split(/\s+/).filter(Boolean).map(Number); break;
      case 'STARTMODI': set.startModes = r.value.split(/\s+/).filter(Boolean).map(Number); break;
      case 'BATTLESETNAME': set.name = r.value; break;
      case 'VIDEOSEQUENCE': {
        const m = /^(\d+)\s*:\s*([-\d^]+)/.exec(r.value);
        if (!m) throw new Error(`MCP${id}: bad VIDEOSEQUENCE ${r.value}`);
        const parts = m[2].split('^').map(Number);
        set.videos.push({ id: Number(m[1]), kind: parts[0], file: parts[1], extra: parts.slice(2), comment: r.comment });
        break;
      }
      case 'NUMMER':
        current = { number: Number(r.value), fileId: -1, password: -1, chroma: '', terminationSeqs: [] };
        set.missions.push(current);
        break;
      case 'FILEID': if (current) current.fileId = Number(r.value); break;
      case 'KENNWORT': if (current) current.password = Number(r.value); break;
      case 'CHROMA': if (current) current.chroma = r.value; break;
      case 'TERMINATIONSEQS': if (current) current.terminationSeqs = r.value.split(/\s+/).filter(Boolean).map(Number); break;
    }
  }
  if (txt) {
    let num = -1;
    for (const r of parseControlFile(txt)) {
      if (r.key === 'BATTLESETNAME') set.name = r.value;
      else if (r.key === 'NUMMER') num = Number(r.value);
      else {
        const mission = set.missions.find((m) => m.number === num);
        if (!mission) continue;
        if (r.key === 'NAME') mission.name = r.value;
        if (r.key === 'PLAYER') mission.playerNames = r.value.split('|').map((s) => s.trim());
      }
    }
  }
  return set;
}
