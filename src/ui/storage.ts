// Persistent settings and save games in the browser (localStorage; every access guarded because
// storage can be unavailable, e.g. in private windows).
import type { GameState } from '../engine/state.ts';
import type { CampaignProgress } from '../engine/campaign.ts';
import type { Language } from '../data/gamedata.ts';

export interface Settings {
  language: Language;
  introSeen: boolean;
  attackAllies: boolean;
  autoRefuel: boolean;
  zoom: number;
  videoVolume: number;
  /** MIDI music: 0 off, 1 Standard-MIDI (A_nnn.MID), 2 General-MIDI (M_nnn.MID); original setup menu. */
  music: number;
  musicVolume: number;
  /** Fight presentation (manual p. 39): '3d' = 3D fight window, 'fast' = statistics only. */
  fightMode: '3d' | 'fast';
  /** Fight volume 0..1 (setup "Kampflautstärke" 0..7). */
  fightVolume: number;
  /** User interface: 'auto' (phone interface on phones), 'mobile' or 'desktop' (the original-like windows). */
  uiMode: 'auto' | 'mobile' | 'desktop';
  aiSpeed: number;
}

const DEFAULTS: Settings = { language: 'GER', introSeen: false, attackAllies: false, autoRefuel: true, zoom: 2, videoVolume: 1, music: 2, musicVolume: 0.5, fightMode: '3d', fightVolume: 1, uiMode: 'auto', aiSpeed: 1 };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bi3.settings') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem('bi3.settings', JSON.stringify(s)); } catch { /* ignore */ }
}

export interface SaveGame {
  version: 1;
  label: string;
  savedAt: string;
  mode: 'campaign' | 'single';
  setId: number;
  fileId: number;
  campaign?: CampaignProgress;
  /** Player configuration for single maps. */
  computerPlayers?: boolean[];
  state: GameState;
}

export const SAVE_SLOTS = 10; // slots 9 and 10 are the automatic saves (README.TXT "AUTOSAVE")

export function listSaves(): (SaveGame | null)[] {
  return Array.from({ length: SAVE_SLOTS }, (_, i) => {
    try {
      const raw = localStorage.getItem(`bi3.save.${i}`);
      return raw ? (JSON.parse(raw) as SaveGame) : null;
    } catch {
      return null;
    }
  });
}

export function writeSave(slot: number, save: SaveGame): boolean {
  try {
    localStorage.setItem(`bi3.save.${slot}`, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Autosave alternates between slots 8 and 9 (= "Position 9 oder 10"). */
export function autosave(save: SaveGame) {
  let next = 8;
  try {
    next = localStorage.getItem('bi3.autosave.last') === '8' ? 9 : 8;
    localStorage.setItem('bi3.autosave.last', String(next));
  } catch { /* ignore */ }
  writeSave(next, { ...save, label: `Autosave ${save.label}` });
}

/** Seen video sequences for the video recorder of the campaign. */
export function rememberSequence(setId: number, seq: number) {
  try {
    const key = `bi3.seen.${setId}`;
    const seen: number[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!seen.includes(seq)) { seen.push(seq); localStorage.setItem(key, JSON.stringify(seen)); }
  } catch { /* ignore */ }
}

export function seenSequences(setId: number): number[] {
  try { return JSON.parse(localStorage.getItem(`bi3.seen.${setId}`) ?? '[]'); } catch { return []; }
}
