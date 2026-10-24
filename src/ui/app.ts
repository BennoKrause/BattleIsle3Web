// Application flow: boot, intro, disk menu, campaign and single-map games, save/load, setup,
// video recorder. Mirrors the original menus (manual p. 28ff).
import { FetchSource } from '../data/source.ts';
import { loadGameData, type GameData } from '../data/gamedata.ts';
import type { CampaignMission, CampaignSet } from '../formats/campaign.ts';
import { textTable } from '../formats/text.ts';
import { createGame } from '../engine/setup.ts';
import { Difficulty, RF } from '../engine/rules.ts';
import { Game } from '../engine/game.ts';
import type { GameState } from '../engine/state.ts';
import { adaptComputerUnits, earnTrainingPoints, newCampaign, transferUnitsIntoPool, transferUnitsOntoMap, type CampaignProgress } from '../engine/campaign.ts';
import { Assets } from './assets.ts';
import { BitmapFont } from './font.ts';
import { Desktop, el, label, DESKTOP_W } from './desktop.ts';
import { choose } from './menu.ts';
import { VideoPlayer, videoUrl } from './video.ts';
import { GameScreen } from './gamescreen.ts';
import { MapRenderer } from '../render/mapview.ts';
import { loadRawSprites } from '../render/sprites.ts';
import { MidiPlayer } from '../audio/synth.ts';
import { FxPlayer } from '../audio/fx.ts';
import { FightAssets } from '../render/fight3d.ts';
import { detectMobile } from './mobile/detect.ts';
import { initPixelText, setParagraph, setText, COLORS } from './mobile/pixel.ts';
import { applyMobileTheme } from './mobile/theme.ts';
import { parseMidi, type MidiSong } from '../audio/midi.ts';
import { DEFAULT_CHROMA, parseChroma } from '../render/chroma.ts';
import { autosave, listSaves, loadSettings, rememberSequence, saveSettings, seenSequences, writeSave, type SaveGame, type Settings } from './storage.ts';

const UI_LIBS = ['BKGD000', 'MNGR000', 'FRMS000', 'CMSK000', 'CMFRM000', 'SETUP000', 'SI000', 'SP000', 'ST000', 'WW000', 'UW000', 'CA000', 'MA000', 'CURS000', 'FF000', 'UI000', 'UI001', 'WB000'];
const INTRO = [980, 981, 982];
const CREDITS = 997;

interface Running {
  game: Game;
  screen: GameScreen;
  set: CampaignSet;
  mission: CampaignMission;
  campaign?: CampaignProgress;
  computerPlayers?: boolean[];
}

export class App {
  private host: HTMLElement;
  settings: Settings = loadSettings();
  data!: GameData;
  assets!: Assets;
  fonts!: { small: BitmapFont; medium: BitmapFont; large: BitmapFont };
  desktop!: Desktop;
  video!: VideoPlayer;
  renderer!: MapRenderer;
  running: Running | null = null;
  /** Log of started videos (exposed for automated tests). */
  readonly videoLog: string[] = [];
  readonly music = new MidiPlayer();
  readonly fx = new FxPlayer();
  /** Phone interface (src/ui/mobile) instead of the original-like desktop. */
  mobile = false;
  private fightAssets: Promise<FightAssets> | null = null;
  private songs = new Map<string, MidiSong>();
  /** Track currently wanted by the running game (restarted after videos). */
  private musicTrack = -1;
  /** Incremented by every start/stop so a slow music load cannot start after a later stop. */
  private musicGen = 0;
  /** Name of the MIDI file that was started last (exposed for automated tests). */
  musicFile = '';

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async boot() {
    const src = new FetchSource('/gamedata');
    const manifest = await fetch('/gamedata/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!manifest) {
      this.host.innerHTML = `<div class="nodata"><h1>Battle Isle 3 – Originaldaten fehlen</h1>
        <p>Die Spieldaten werden aus den Original-CDs importiert. Bitte einmalig ausführen:</p>
        <pre>npm run import-cd -- --cd1 "pfad/zu/Battle Isle 3 - CD1.iso" --cd2 "pfad/zu/Battle Isle 3 - CD2.iso"</pre></div>`;
      return;
    }
    this.data = await loadGameData(src, this.settings.language);
    const pal = this.data.palettes.get('STD')!;
    this.assets = new Assets(src, pal);
    await this.assets.load(...UI_LIBS);
    this.fonts = {
      small: await BitmapFont.load(src, 'CHAR009'),
      medium: await BitmapFont.load(src, 'CHAR012'),
      large: await BitmapFont.load(src, 'CHAR016'),
    };
    this.mobile = detectMobile();
    document.body.classList.toggle('mobile-ui', this.mobile);
    if (this.mobile) { initPixelText(this.fonts); applyMobileTheme(this.assets); }
    this.desktop = new Desktop(this.host, this.assets, this.mobile);
    this.video = new VideoPlayer(this.desktop.root, this.assets);
    this.video.volume = this.settings.videoVolume;
    this.video.onStart = (f) => this.videoLog.push(f);
    let videosActive = 0;
    this.video.onBegin = () => { videosActive++; this.musicGen++; this.music.stop(); };
    this.video.onEnd = () => { if (--videosActive === 0) void this.startMusic(this.musicTrack); };
    this.music.volume = this.settings.musicVolume;
    this.fx.volume = this.settings.fightVolume;
    const unlock = () => { this.music.unlock(); this.fx.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.renderer = new MapRenderer(this.data, pal, await loadRawSprites(src, 'LIB/PART000.LIB'), await loadRawSprites(src, 'LIB/UNIT000.LIB'));
    this.renderer.setRoadSprites(await Promise.all([0, 1, 2, 3, 4, 5, 6].map((n) => loadRawSprites(src, `LIB/LAYR00${n}.LIB`))));
    this.renderer.zoom = this.settings.zoom;
    (window as unknown as { bi3app: App }).bi3app = this;
    const params = new URLSearchParams(location.search);
    if (params.get('mission')) {
      await this.startSingle(Number(params.get('mission')), Number(params.get('difficulty') ?? Difficulty.NORMAL));
      return;
    }
    if (!this.settings.introSeen && !params.has('nointro')) {
      await this.playIntro();
      this.settings.introSeen = true;
      saveSettings(this.settings);
    }
    await this.diskMenu();
  }

  // ------------------------------------------------------------------ videos
  async playIntro() {
    await this.pressToStart();
    await this.video.play({ files: INTRO.map((n) => videoUrl(n)), fullscreen: true, parts: true });
  }

  /** Browsers allow sound only after a user gesture: the original intro starts after a click. */
  private pressToStart(): Promise<void> {
    if (navigator.userActivation?.hasBeenActive) return Promise.resolve();
    return new Promise((resolve) => {
      const b = el('div', 'start-overlay', this.desktop.root);
      if (this.mobile) {
        setText(el('h1', 'm-start-title', b), 'BATTLE ISLE 3', { font: 'large', color: COLORS.accent, scale: 2.2 });
        setText(el('p', 'm-start-sub', b), 'Schatten des Imperators', { font: 'medium', color: COLORS.text, scale: 1.6 });
        setText(el('p', 'm-start-tap', b), 'Zum Starten tippen', { font: 'small', color: COLORS.muted, scale: 1.6 });
      } else {
        label(b, this.fonts.large.render('Battle Isle 3 – Schatten des Imperators', '#f0e060'), 0, 0).style.position = 'static';
        label(b, this.fonts.medium.render('Klicken oder Taste drücken zum Starten', '#c0d0c0'), 0, 0).style.position = 'static';
      }
      const go = () => { window.removeEventListener('keydown', go); b.remove(); resolve(); };
      b.addEventListener('click', go);
      window.addEventListener('keydown', go);
    });
  }

  /** Plays a VIDEOSEQUENCE of a set (kind 2 = full screen). */
  async playSequence(set: CampaignSet, seq: number) {
    if (seq < 0) return;
    const v = set.videos.find((x) => x.id === seq) ?? this.data.sets[0].videos.find((x) => x.id === seq);
    if (!v) { console.warn(`video sequence ${seq} not defined in MCP${set.id}`); return; }
    rememberSequence(set.id, seq);
    await this.video.play({ files: [videoUrl(v.file)], fullscreen: this.mobile || v.kind === 2 });
  }

  // ------------------------------------------------------------------ menus
  async diskMenu() {
    this.closeGame();
    this.desktop.clear();
    const saves = listSaves();
    const entries = [
      'Neue Kampagne starten',
      'Einzelne Karte starten',
      { text: 'Spiel laden', enabled: saves.some(Boolean) },
      'Videoarchiv',
      'Vorspann ansehen',
      'Setup',
    ];
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'DISK - MENU', entries, false);
    if (c === 0) await this.newCampaignDialog();
    else if (c === 1) await this.singleMapDialog();
    else if (c === 2) await this.loadDialog();
    else if (c === 3) await this.videoArchive();
    else if (c === 4) { await this.playIntro(); await this.diskMenu(); }
    else if (c === 5) { await this.setupMenu(); await this.diskMenu(); }
  }

  private async chooseDifficulty(): Promise<number> {
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Schwierigkeit', ['Spielstärke:  Training', 'Spielstärke:  Normal', 'Spielstärke:  Experte']);
    return c < 0 ? -1 : [Difficulty.TRAINING, Difficulty.NORMAL, Difficulty.EXPERT][c];
  }

  async newCampaignDialog() {
    const d = await this.chooseDifficulty();
    if (d < 0) return this.diskMenu();
    await this.runCampaign(newCampaign(0, d));
  }

  async singleMapDialog(): Promise<void> {
    const setIdx = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Battle-Set wählen', this.data.sets.map((s) => s.name ?? `Set ${s.id}`));
    if (setIdx < 0) return this.diskMenu();
    const set = this.data.sets[setIdx];
    const m = await choose(this.desktop.layer, this.assets, this.fonts.small, set.name ?? '', set.missions.map((x) => x.name ?? `MISS${x.fileId}`));
    if (m < 0) return this.singleMapDialog();
    const mission = set.missions[m];
    if (mission.password > 0) {
      const pw = await this.prompt('Levelcode eingeben:');
      if (pw === null) return this.singleMapDialog();
      if (Number(pw) !== mission.password) { await this.message('Kennwort', 'Falsches Kennwort.'); return this.singleMapDialog(); }
    }
    const d = await this.chooseDifficulty();
    if (d < 0) return this.singleMapDialog();
    // player setup: human or computer for every player present (manual p. 30)
    const lm = await this.data.loadMission(mission.fileId);
    const tmp = createGame(this.data, lm, { setId: set.id, difficulty: d });
    const computer = tmp.players.map((p) => p.computer);
    if (set.id !== 0) {
      for (;;) {
        const present = tmp.players.filter((p) => p.alive);
        const names = mission.playerNames ?? [];
        const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Spieler einstellen', [
          ...present.map((p) => `${names[p.index] || `Spieler ${p.index + 1}`}:  ${computer[p.index] ? 'COMPUTER' : 'MENSCH'}`),
          'Spiel starten',
        ]);
        if (c < 0) return this.singleMapDialog();
        if (c === present.length) break;
        computer[present[c].index] = !computer[present[c].index];
      }
      if (computer.every((x, i) => x || !tmp.players[i].alive)) computer[tmp.players.findIndex((p) => p.alive)] = false;
    }
    await this.startSingle(mission.fileId, d, computer);
  }

  private async startSingle(fileId: number, difficulty: number, computerPlayers?: boolean[]) {
    const set = this.data.sets.find((s) => s.missions.some((m) => m.fileId === fileId))!;
    const mission = set.missions.find((m) => m.fileId === fileId)!;
    const lm = await this.data.loadMission(fileId);
    const state = createGame(this.data, lm, { setId: set.id, difficulty, computerPlayers });
    const game = new Game(this.data, state);
    this.applySettingsToGame(game);
    game.start();
    await this.openGame({ game, set, mission, computerPlayers }, true);
  }

  // ------------------------------------------------------------------ campaign
  async runCampaign(c: CampaignProgress, resume?: GameState) {
    const set = this.data.sets[c.setId];
    const mission = set.missions[c.missionIndex];
    let game: Game;
    if (resume) {
      game = new Game(this.data, resume);
      this.applySettingsToGame(game);
    } else {
      // intro sequence of the mission (e.g. "Kapitel I.")
      await this.playSequence(set, mission.terminationSeqs[0] ?? -1);
      const lm = await this.data.loadMission(mission.fileId);
      const state = createGame(this.data, lm, { setId: set.id, difficulty: c.difficulty });
      transferUnitsOntoMap(state, c.pool);
      state.players[0].trainingPoints = [...(c.trainingPoints ?? [0, 0, 0])];
      if (set.rawKeys.COMPUTERPROGRESSION) adaptComputerUnits(state, c.missionIndex);
      game = new Game(this.data, state);
      this.applySettingsToGame(game);
      game.start();
    }
    await this.openGame({ game, set, mission, campaign: c }, !resume);
  }

  private applySettingsToGame(game: Game) {
    game.options.attackAllies = this.settings.attackAllies;
    if (this.settings.autoRefuel) game.state.ruleFlags |= RF.AUTO_REFUEL | RF.AUTO_REPAIR;
    else game.state.ruleFlags &= ~(RF.AUTO_REFUEL | RF.AUTO_REPAIR);
  }

  private async openGame(r: Omit<Running, 'screen'>, fresh: boolean) {
    this.closeGame();
    const { game, set, mission } = r;
    const shopNames = (await this.data.loadMission(mission.fileId)).texts;
    const chroma = mission.chroma ? parseChroma(mission.chroma) : DEFAULT_CHROMA;
    const playerNames = [...(mission.playerNames ?? [])];
    const screen = new GameScreen(game, {
      assets: this.assets, fonts: this.fonts, desktop: this.desktop, renderer: this.renderer, chroma,
      playerNames, shopNames, missionName: mission.name ?? `MISS${mission.fileId}`,
      src: this.data.source,
      fight: { enabled: () => this.settings.fightMode === '3d', load: () => (this.fightAssets ??= FightAssets.load(this.data.source)), fx: this.fx },
    }, {
      playSequence: (seq) => this.playSequence(set, seq),
      showText: (t, x) => this.message(t, x),
      openDiskMenu: () => void this.inGameDiskMenu(),
      openSetup: () => void this.setupMenu(),
      openVideoRecorder: () => void this.videoRecorder(set),
      showBriefing: () => this.briefing(),
      onOutcome: () => void this.onOutcome(),
      onAutosave: () => this.autosaveNow(),
      quit: () => void this.confirmQuit(),
    });
    screen.aiDelay = Math.round(120 / Math.max(0.25, this.settings.aiSpeed));
    this.running = { ...r, screen };
    void this.startMusic(Math.max(0, set.missions.indexOf(mission)));
    if (fresh) {
      // password of the map (manual p. 56) and the mission briefing
      if (r.campaign && mission.password > 0) await this.message(mission.name ?? '', `Kennwort dieser Karte: ${mission.password}`);
      await this.playSequence(set, mission.terminationSeqs[1] ?? -1);
      // events triggered at the start (game.start) are presented now
      await screen.playEvents(game.state.events);
    }
    await screen.runComputerTurns();
  }

  /** Plays the music of a mission (original w_music.c: file A_/M_ + mission number in the set, max. 19, loops). */
  async startMusic(track: number) {
    this.musicTrack = track;
    const gen = ++this.musicGen;
    this.music.stop();
    if (track < 0 || !this.settings.music) return;
    const name = `${this.settings.music === 1 ? 'A' : 'M'}_${String(Math.min(track, 19)).padStart(3, '0')}.MID`;
    try {
      let song = this.songs.get(name);
      if (!song) {
        const r = await fetch(`/gamedata/MUS/${name}`);
        if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
        song = parseMidi(new Uint8Array(await r.arrayBuffer()));
        this.songs.set(name, song);
      }
      if (gen !== this.musicGen) return; // stopped or superseded while loading
      this.musicFile = name;
      this.music.play(song);
    } catch (e) {
      console.warn('music not available', e);
    }
  }

  private closeGame() {
    this.musicTrack = -1;
    this.musicGen++;
    this.music.stop();
    this.running?.screen.destroy();
    this.running = null;
  }

  private async briefing() {
    const r = this.running;
    if (!r) return;
    const seq = r.mission.terminationSeqs[1] ?? -1;
    if (seq >= 0) await this.playSequence(r.set, seq);
    else {
      const t = textTable(await this.data.source.read(`GER/MISS${r.mission.fileId}.TXT`));
      await this.message(r.mission.name ?? '', t.get(0) ?? '');
    }
  }

  private async onOutcome() {
    const r = this.running;
    if (!r || !r.game.state.outcome) return;
    const { game, set, mission, campaign } = r;
    const won = game.state.outcome!.result === 'victory';
    this.musicTrack = -1;
    this.musicGen++;
    this.music.stop();
    r.screen.destroy();
    await this.playSequence(set, mission.terminationSeqs[won ? 2 : 3] ?? -1);
    if (!campaign) {
      await this.message(mission.name ?? '', won ? 'Mission erfolgreich beendet.' : 'Mission verloren.');
      return this.diskMenu();
    }
    if (!won) {
      // a lost map is restarted automatically (manual p. 30)
      await this.message(mission.name ?? '', 'Die Mission ist gescheitert. Die Karte wird neu gestartet.');
      return this.runCampaign(campaign);
    }
    if (campaign.difficulty === Difficulty.TRAINING) {
      // training units cannot reach the next map (manual p. 36)
      await this.message(mission.name ?? '', 'Im Trainingsmodus kann die nächste Karte nicht erreicht werden.');
      return this.diskMenu();
    }
    await this.playSequence(set, mission.terminationSeqs[4] ?? -1);
    const next: CampaignProgress = {
      ...campaign,
      pool: transferUnitsIntoPool(this.data, game.state, campaign.pool),
      // points left over in this mission plus the points earned by the survivors
      trainingPoints: earnTrainingPoints(this.data, game.state, game.state.players[0].trainingPoints),
      completed: [...campaign.completed, mission.fileId],
      missionIndex: campaign.missionIndex + 1,
    };
    if (next.missionIndex >= set.missions.length) {
      next.finished = true;
      this.autosaveCampaignEnd(next);
      await this.video.play({ files: [videoUrl(CREDITS)], fullscreen: true });
      await this.message('Battle Isle 3', 'Die Kampagne „Der Schatten des Imperiums" ist abgeschlossen.');
      return this.diskMenu();
    }
    const nm = set.missions[next.missionIndex];
    await this.message(nm.name ?? '', `Nächste Karte: ${nm.name}\nKennwort: ${nm.password}`);
    await this.runCampaign(next);
  }

  private autosaveCampaignEnd(c: CampaignProgress) {
    try { localStorage.setItem('bi3.campaign.finished', JSON.stringify(c)); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ save / load
  private snapshot(label: string): SaveGame | null {
    const r = this.running;
    if (!r) return null;
    return {
      version: 1, label, savedAt: new Date().toISOString(),
      mode: r.campaign ? 'campaign' : 'single', setId: r.set.id, fileId: r.mission.fileId,
      campaign: r.campaign, computerPlayers: r.computerPlayers, state: structuredClone(r.game.state),
    };
  }

  private autosaveNow() {
    const s = this.snapshot(`${this.running?.mission.name ?? ''} R${(this.running?.game.state.turn ?? 0) + 1}`);
    if (s) autosave(s);
  }

  private async inGameDiskMenu() {
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'DISK - MENU', ['Spiel speichern', 'Spiel laden', 'Neue Kampagne starten', 'Einzelne Karte starten']);
    if (c === 0) await this.saveDialog();
    else if (c === 1) await this.loadDialog(true);
    else if (c === 2) await this.newCampaignDialog();
    else if (c === 3) await this.singleMapDialog();
  }

  private slotLabel(s: SaveGame | null, i: number) {
    if (!s) return `${i + 1}. – leer –`;
    // the name is shortened, the date stays readable: the list field of the menu is only 324 px wide
    const date = new Date(s.savedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let name = s.label;
    const text = () => `${i + 1}. ${name} (${date})`;
    while (name.length > 4 && this.fonts.small.measure(text()) > 324) name = name.slice(0, -2).trimEnd();
    return text();
  }

  private async saveDialog() {
    const saves = listSaves();
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Spielstand speichern', saves.slice(0, 8).map((s, i) => this.slotLabel(s, i)));
    if (c < 0) return;
    const r = this.running!;
    const snap = this.snapshot(`${r.mission.name ?? ''} – Runde ${r.game.state.turn + 1}`)!;
    if (!writeSave(c, snap)) await this.message('Speichern', 'Speichern fehlgeschlagen (Browser-Speicher nicht verfügbar).');
  }

  async loadDialog(inGame = false) {
    const saves = listSaves();
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Spielstand laden', saves.map((s, i) => ({ text: this.slotLabel(s, i), enabled: !!s })));
    if (c < 0 || !saves[c]) { if (!inGame) await this.diskMenu(); return; }
    await this.loadSave(saves[c]!);
  }

  async loadSave(s: SaveGame) {
    const set = this.data.sets[s.setId];
    const mission = set.missions.find((m) => m.fileId === s.fileId)!;
    if (s.mode === 'campaign' && s.campaign) return this.runCampaign(s.campaign, s.state);
    const game = new Game(this.data, s.state);
    this.applySettingsToGame(game);
    await this.openGame({ game, set, mission, computerPlayers: s.computerPlayers }, false);
  }

  // ------------------------------------------------------------------ setup, videos, dialogs
  async setupMenu() {
    for (;;) {
      const st = this.settings;
      const zoomName = st.zoom === 1 ? 'Kleine Hexfelder' : st.zoom === 1.5 ? 'Mittelgroße Hexfelder' : 'Große Hexfelder';
      const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'SETUP', [
        zoomName,
        st.fightMode === '3d' ? 'Kampf: 3D' : 'Kampf: schnell',
        `Videolautstärke: ${Math.round(st.videoVolume * 7)}`,
        st.attackAllies ? 'Alliierte angreifen' : 'Alliierte nicht angreifen',
        st.autoRefuel ? 'Units autom. betanken' : 'Units manuell betanken',
        `Computerzüge: ${st.aiSpeed >= 2 ? 'schnell' : st.aiSpeed <= 0.5 ? 'langsam' : 'normal'}`,
        `Sprache: ${st.language === 'GER' ? 'Deutsch' : 'English'}`,
        `Midi Music: ${['aus', 'Standard-Midi', 'General-Midi'][st.music]}`,
        `Musiklautstärke: ${Math.round(st.musicVolume * 7)}`,
        `Kampflautstärke: ${Math.round(st.fightVolume * 7)}`,
        `Oberfläche: ${{ auto: 'Automatisch', mobile: 'Handy', desktop: 'Desktop' }[st.uiMode]}`,
      ]);
      if (c < 0) break;
      if (c === 1) st.fightMode = st.fightMode === '3d' ? 'fast' : '3d';
      if (c === 0) st.zoom = st.zoom === 2 ? 1 : st.zoom + 0.5;
      if (c === 2) st.videoVolume = st.videoVolume >= 1 ? 0 : Math.min(1, st.videoVolume + 1 / 7);
      if (c === 3) st.attackAllies = !st.attackAllies;
      if (c === 4) st.autoRefuel = !st.autoRefuel;
      if (c === 5) st.aiSpeed = st.aiSpeed >= 2 ? 0.5 : st.aiSpeed * 2;
      if (c === 6) st.language = st.language === 'GER' ? 'ENG' : 'GER';
      if (c === 7) st.music = (st.music + 1) % 3;
      if (c === 8) st.musicVolume = st.musicVolume >= 1 ? 1 / 7 : Math.min(1, st.musicVolume + 1 / 7);
      if (c === 9) st.fightVolume = st.fightVolume >= 1 ? 0 : Math.min(1, st.fightVolume + 1 / 7);
      if (c === 10) {
        st.uiMode = ({ auto: 'mobile', mobile: 'desktop', desktop: 'auto' } as const)[st.uiMode];
        saveSettings(st);
        // the interface is built at start-up: keep a running game in an autosave and reload the page
        if (this.running) this.autosaveNow();
        await this.message('Oberfläche', 'Die Oberfläche wird neu geladen.' + (this.running ? ' Das laufende Spiel wurde automatisch gespeichert (Spiel laden).' : ''));
        // an explicit ?ui=... in the address would override the setting
        const url = new URL(location.href);
        url.searchParams.delete('ui');
        location.replace(url.toString());
        return;
      }
      saveSettings(st);
      this.renderer.zoom = st.zoom;
      this.video.volume = st.videoVolume;
      this.music.volume = st.musicVolume;
      this.fx.volume = st.fightVolume;
      if (c === 7 && this.running) void this.startMusic(this.musicTrack);
      if (this.running) {
        this.applySettingsToGame(this.running.game);
        this.running.screen.aiDelay = Math.round(120 / Math.max(0.25, st.aiSpeed));
        this.running.screen.refresh();
      }
    }
  }

  /** Videorecorder (manual p. 57): replays the sequences seen in this campaign. */
  private async videoRecorder(set: CampaignSet) {
    const seen = seenSequences(set.id).sort((a, b) => a - b);
    if (!seen.length) { await this.message('Videorecorder', 'Noch keine Videos gesehen.'); return; }
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Videorecorder', seen.slice(0, 30).map((s) => `Sequenz ${s} – ${set.videos.find((v) => v.id === s)?.comment || `API${String(set.videos.find((v) => v.id === s)?.file ?? 0).padStart(3, '0')}`}`));
    if (c >= 0) await this.playSequence(set, seen[c]);
  }

  /** Comfort function: all videos already unlocked, plus intro, credits and trailer. */
  private async videoArchive(): Promise<void> {
    const set = this.data.sets[0];
    const seen = new Set(seenSequences(0));
    const entries: { text: string; play: () => Promise<unknown> }[] = [
      { text: 'Vorspann', play: () => this.video.play({ files: INTRO.map((n) => videoUrl(n)), fullscreen: true, parts: true }) },
    ];
    for (const m of set.missions) {
      for (const seq of m.terminationSeqs.filter((x) => x >= 0)) {
        if (!seen.has(seq)) continue;
        entries.push({ text: `${m.name}: Sequenz ${seq}`, play: () => this.playSequence(set, seq) });
      }
    }
    if (localStorage.getItem('bi3.campaign.finished')) entries.push({ text: 'Abspann', play: () => this.video.play({ files: [videoUrl(CREDITS)], fullscreen: true }) });
    entries.push({ text: 'Trailer (SHOW/SHADOW.AVI)', play: () => this.video.play({ files: [videoUrl('SHADOW')], fullscreen: true }) });
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Videoarchiv', entries.slice(0, 30).map((e) => e.text));
    if (c >= 0) { await entries[c].play(); return this.videoArchive(); }
    await this.diskMenu();
  }

  private async confirmQuit() {
    const c = await choose(this.desktop.layer, this.assets, this.fonts.small, 'Sind Sie sicher, daß Sie das Spiel verlassen wollen?', ['Ja', 'Nein'], false);
    if (c === 0) await this.diskMenu();
  }

  message(title: string, text: string): Promise<void> {
    if (this.mobile) {
      return new Promise((resolve) => {
        const back = el('div', 'm-modal', this.desktop.layer);
        const box = el('div', 'm-dialog msgbox', back);
        setText(el('h3', 'm-dialog-title m-field', box), title, { font: 'small', color: COLORS.accent, scale: 1.7 });
        setParagraph(el('p', 'm-dialog-text', box), text, 300, { color: COLORS.text, scale: 1.5 });
        const ok = el('button', 'm-cmd m-primary', box);
        setText(el('span', 'm-cmd-label', ok), 'OK', { color: COLORS.accent, scale: 1.8 });
        ok.addEventListener('click', () => { back.remove(); resolve(); });
      });
    }
    return new Promise((resolve) => {
      const f = this.fonts.small;
      const lines = text.split('\n').flatMap((l) => f.wrap(l, 360));
      const h = 60 + lines.length * 11;
      const box = el('div', 'gwin msgbox', this.desktop.layer, { left: `${(DESKTOP_W - 400) / 2}px`, top: `${Math.max(10, 280 - h / 2)}px`, width: '400px', height: `${h}px` });
      box.style.zIndex = '6000';
      label(box, this.fonts.medium.render(title, '#f0e060'), 16, 10);
      lines.forEach((l, i) => label(box, f.render(l, '#e0e8d0'), 20, 34 + i * 11));
      const close = () => { window.removeEventListener('keydown', onKey); box.remove(); resolve(); };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') close(); };
      window.addEventListener('keydown', onKey);
      box.addEventListener('click', close);
    });
  }

  prompt(title: string): Promise<string | null> {
    if (this.mobile) {
      return new Promise((resolve) => {
        const back = el('div', 'm-modal', this.desktop.layer);
        const box = el('div', 'm-dialog msgbox', back);
        setText(el('h3', 'm-dialog-title m-field', box), title, { font: 'small', color: COLORS.accent, scale: 1.7 });
        const input = el('input', 'prompt-input m-input', box);
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        const row = el('div', 'm-row', box);
        const cancel = el('button', 'm-cmd', row);
        setText(el('span', 'm-cmd-label', cancel), 'Abbrechen', { color: COLORS.text, scale: 1.6 });
        const ok = el('button', 'm-cmd m-primary', row);
        setText(el('span', 'm-cmd-label', ok), 'OK', { color: COLORS.accent, scale: 1.8 });
        const done = (v: string | null) => { back.remove(); resolve(v); };
        cancel.addEventListener('click', () => done(null));
        ok.addEventListener('click', () => done(input.value.trim()));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); });
        setTimeout(() => input.focus(), 0);
      });
    }
    return new Promise((resolve) => {
      const box = el('div', 'gwin msgbox', this.desktop.layer, { left: `${(DESKTOP_W - 328) / 2}px`, top: '230px', width: '328px', height: '135px', backgroundImage: `url(${this.assets.url('CA000', 'CA00_00')})` });
      box.style.zIndex = '6000';
      label(box, this.fonts.small.render(title, '#f0e060'), 24, 20);
      const input = el('input', 'prompt-input', box, { left: '24px', top: '50px', width: '280px' });
      input.autofocus = true;
      setTimeout(() => input.focus(), 0);
      const done = (v: string | null) => { box.remove(); resolve(v); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); if (e.key === 'Escape') done(null); });
    });
  }
}
