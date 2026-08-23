const { app } = require('electron');
const path = require('path');

// Electron's default userData path is derived from the app's display name
// (productName/name in package.json), which normally makes a rebrand
// silently orphan every existing user's saved data - widgets, loadout
// profiles, the buff roster, spellbook cache, all of it would appear to
// vanish on next launch since the app would start reading/writing a brand
// new folder. Pinned here to the ORIGINAL "EQ Buff Tracker" folder
// (reconstructed from the OS-level roaming appdata root, not from the
// current product name) so the "EQLS Auras" rename - and any future one,
// e.g. toward "EQLsource" branding - never touches real user data.
//
// MUST run before requiring ANY local module, not just before this file's
// own app.getPath('userData') calls further down - widgetManager.js builds
// its WidgetStore at require() time (module-level code, not inside a
// function), so a require('./widgetManager') above this line would already
// read/create widgets.json under the WRONG folder before this line ever
// got a chance to run. Confirmed the hard way: an earlier version of this
// pin sat after the requires and silently seeded a second, empty
// widgets.json under the new "EQLS Auras" folder on first restart after
// the rename, while everything else (buffs, profiles, spellbook) correctly
// stayed in the old folder - a real split-brain, not a hypothetical.
app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker'));

const fs = require('fs');
const { ipcMain, protocol, BrowserWindow, Menu, globalShortcut, shell } = require('electron');
const { createMainWindow, getMainWindow } = require('./mainWindow');
const { LogService } = require('./logService');
// Note 38. The zone matcher lives with the other log-line patterns; the seed list is data.
const { matchZoneChange } = require('./buffParser');
const KNOWN_ZONES = require('../shared/data/zones');
const { BuffStore } = require('./buffStore');
const { BuffEngine } = require('./buffEngine');
const { CustomTimerEngine } = require('./customTimerEngine');
const { DamageEngine } = require('./damageEngine');
const { findRoute, describeLeg, allZoneNames } = require('../shared/zoneRouting');
const { TRAVEL_SPELLS } = require('../shared/data/zoneGraph');
const { IconService } = require('./iconService');
const { ICON_SETS } = require('./iconExtractor');
const { SpellbookService } = require('./spellbookService');
const { resolveInstallRoot } = require('./eqLocator');
const { tagBardSongs } = require('./bardSongTagger');
// rosterBackfill is intentionally NOT wired up any more - see applyInstallRoot for why.
// Kept as a require so the module stays discoverable rather than looking like dead code.
const { backfillBardSongs: _unusedBackfillBardSongs } = require('./rosterBackfill');
const { saveSnapshot, loadSnapshot } = require('./sessionSnapshot');
const gameSpellData = require('./gameSpellData');
const { loadJson, saveJson } = require('./store');
const widgetManager = require('./widgetManager');
const ambiguousPopup = require('./ambiguousPopup');
const { ProfileStore } = require('./profileStore');
const { ForegroundWatcher, focusGameWindow } = require('./foregroundWatcher');
const soundService = require('./soundService');

protocol.registerSchemesAsPrivileged([
  { scheme: 'eqicon', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'eqsound', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Running two copies at once is a real trap here: each would independently
// tail the same log file, maintain its own separate buff state, and open
// its own overlay window - so whichever window you're actually looking at
// might not be the one that's processing anything. Refuse a second launch
// and just focus the existing one instead.
// `return` (legal at CommonJS module scope) matters as much as the quit:
// app.quit() only *schedules* a shutdown, it doesn't stop execution, so
// without this a rejected second instance would carry on running every
// module-level side effect below - building stores, touching userData - while
// on its way out. Given this project's history with a userData write from the
// wrong place wiping real data, a second instance must do nothing at all.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const logService = new LogService();
const buffStore = new BuffStore({ loadJson, saveJson });
const buffEngine = new BuffEngine(buffStore, { loadJson, saveJson });
const profileStore = new ProfileStore({ loadJson, saveJson });
// Makes sure the engine starts out pointed at whichever profile was last
// active, instead of always defaulting to DEFAULT_PROFILE_ID regardless of
// what the user last had selected.
buffEngine.setActiveProfileId(profileStore.getActiveId());
// So a newly created/duplicated/imported widget defaults to belonging to
// whichever profile is currently active, not always just the default one
// - see widgetManager.js's getActiveProfileIdFn doc.
widgetManager.setActiveProfileIdFn(() => profileStore.getActiveId());
// Note 21. Restored before any window is built, so the label is either there from the first
// frame or not at all - appearing a moment later would read as a glitch.
widgetManager.setSaveLoadoutLabelEnabledFn((enabled) => saveJson('loadoutLabelEnabled', enabled));
widgetManager.setLoadoutLabelEnabledState(loadJson('loadoutLabelEnabled', false));
// Note 21's label reads this. Looked up fresh on every push rather than cached, so renaming a
// profile shows immediately and a deleted one cannot leave a stale name on screen.
widgetManager.setActiveProfileNameFn(() => {
  const active = profileStore.getAll().find((pr) => pr.id === profileStore.getActiveId());
  return active ? active.name : '';
});
// The hide-auras hotkey that actually registered at startup, or null. See HIDE_HOTKEYS below.
let hideHotkey = null;

const customTimerEngine = new CustomTimerEngine();
const damageEngine = new DamageEngine();
// Timer definitions live on widgets themselves (see widgetStore.js), not a
// separate store - injected rather than required directly since
// widgetManager pulls in Electron's screen/BrowserWindow.
customTimerEngine.setGetWidgetsFn(() => widgetManager.getAllWidgetConfigs());
// See customTimerEngine._resolveCastName. getByName tries the exact name first and only then the
// rank-stripped one, which is what tells a mote rank ("Cannibalize V" -> Cannibalize) apart from a
// spell whose name merely ends in a numeral ("Yaulp III" -> itself).
customTimerEngine.setResolveSpellFn((name) => {
  const known = buffStore.getByName(name);
  return known ? known.name : null;
});
const iconService = new IconService();
const spellbookService = new SpellbookService();
buffEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
buffEngine.setSpellbookCheckFn((name) => spellbookService.has(name));
// See buffEngine.setEnemyDebuffNamesFn - which spells any aura has asked to watch on enemies.
buffEngine.setEnemyDebuffNamesFn(() => widgetManager.getEnemyDebuffNames());
// Note 19. Anything you have mezzed, snared or slowed is a thing you are fighting, which seeds the
// damage meter's enemy set for a character who debuffs rather than attacks. Pull-based like the
// line above it, so a mob mezzed a second ago counts without anything having to push an update.
damageEngine.setKnownEnemiesFn(() =>
  buffEngine
    .getActiveAllyBuffs()
    .filter((b) => b.onEnemy && b.allyName)
    .map((b) => b.allyName)
);
// See buffEngine.setAllyDebuffAlertNamesFn - spells a text aura wants a warning about when
// somebody else casts them.
buffEngine.setAllyDebuffAlertNamesFn(() => widgetManager.getAllyDebuffAlertNames());
// Suppresses "which bard song was that?" prompts when no aura would show the
// answer anyway - songs are opt-in and off by default, so without this the
// prompts kept arriving for something deliberately hidden. Checks live widget
// state rather than a cached flag so enabling "Show bard songs" on any aura
// starts the prompts again immediately.
buffEngine.setBardSongsVisibleFn(() =>
  widgetManager.getAllWidgetConfigs().some((w) => w.hideBardSongs === false)
);
customTimerEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
// Note 9. A zone part in an all-of condition asks where you are. Pull-based, so it reads the same
// zone the rest of the app is using rather than keeping a copy that could fall behind.
customTimerEngine.setCurrentZoneFn(() => widgetManager.getCurrentZone());
buffEngine.setTrackOthersEnabled(loadJson('trackOthersEnabled', false));
buffEngine.setBlockedNames(loadJson('blockedBuffs', []));

// Auto-hide overlay widgets while EQ isn't the focused window (backlog #6)
// - on by default per explicit user request. The watcher itself only ever
// runs while this is on, so there's no background polling overhead if the
// user turns it off.
const foregroundWatcher = new ForegroundWatcher();
let autoHideOverlayEnabled = loadJson('autoHideOverlay', true);
// Separate, OFF by default: whether this app's own windows also count as
// "keep the auras visible". Used to be baked into auto-hide with no way to
// turn it off, which meant tabbing to the app always dragged every aura back
// on screen over whatever else was there. Kept as its own setting because the
// two wants are genuinely different - "hide when I'm not playing" vs "show
// while I'm configuring". Unlocked auras stay visible regardless of both
// settings (see widgetManager.setLocked), so this being off never blocks
// repositioning.
let showAurasWhenAppFocused = loadJson('showAurasWhenAppFocused', false);

function applyForegroundVisibility() {
  const state = foregroundWatcher.lastState;
  if (!autoHideOverlayEnabled || !state) {
    widgetManager.setForegroundHidden(false);
    return;
  }
  const shouldShow = state.eqFocused || (showAurasWhenAppFocused && state.ownAppFocused);
  widgetManager.setForegroundHidden(!shouldShow);
}

foregroundWatcher.on('focusChanged', applyForegroundVisibility);
if (autoHideOverlayEnabled) foregroundWatcher.start();

// Permanent (not "remove before shipping" temp debug logging) - a running
// record of every detection decision (landed/queued/ignored/blocked and
// why), so a confusing moment in-game can be checked afterward instead of
// needing to manually trace the raw EQ log. Capped by truncating on
// startup rather than mid-session, so a single write is never slowed down
// by a size check.
// ITS OWN FOLDER, ONE FILE PER DAY. Shara, 23 August: "I cannot provide this currently as that log
// file doesn't exist. it should probably be created as an actual file in it's own folder, that
// updates and is split per day."
//
// It did exist, and that is the more useful finding: it sat as a single loose file in
// %APPDATA%/EQ Buff Tracker, in among Cache, Code Cache, DawnGraphiteCache, GPUCache, Local
// Storage and Network. Nobody should be expected to find anything in there, and note 28 stayed
// blocked for days on a file that had been written the whole time. A log nobody can reach is a log
// that does not exist.
//
// Per day rather than one growing file, because the question asked of it is always "what happened
// at that moment" - a date in the filename answers it before the file is even opened.
const DEBUG_LOG_DIR = path.join(app.getPath('userData'), 'detection-logs');
// Old files are deleted rather than kept forever. Two weeks is well past the point where anyone
// would be investigating something, and it bounds the folder without a size check on every write.
const DEBUG_LOG_KEEP_DAYS = 14;

function debugLogDateStamp(d) {
  // Local date, not ISO/UTC. The player's "yesterday evening" has to land in yesterday's file.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pruneOldDebugLogs() {
  try {
    const cutoff = Date.now() - DEBUG_LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(DEBUG_LOG_DIR)) {
      if (!/^detection-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const full = path.join(DEBUG_LOG_DIR, name);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full);
    }
  } catch {
    // Best-effort tidying. A folder that cannot be read is not a reason to fail to start.
  }
}

try {
  fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
  pruneOldDebugLogs();
  // The old single file, if this install has one. Moved into the folder under the date it was last
  // written rather than deleted - it may be the very thing someone is looking for.
  const legacy = path.join(app.getPath('userData'), 'detection-debug.log');
  if (fs.existsSync(legacy)) {
    const stamp = debugLogDateStamp(fs.statSync(legacy).mtime);
    const dest = path.join(DEBUG_LOG_DIR, `detection-${stamp}.log`);
    if (fs.existsSync(dest)) fs.appendFileSync(dest, fs.readFileSync(legacy));
    else fs.renameSync(legacy, dest);
    if (fs.existsSync(legacy)) fs.rmSync(legacy);
  }
} catch {
  // If the folder cannot be made, debugLog below fails quietly per write.
}

// Cached so the common path is a string compare rather than a date format on every line, and so
// the rollover happens the first time a line is written after midnight rather than on a timer.
let debugLogStamp = null;
let debugLogPath = null;
function debugLog(message) {
  const now = new Date();
  const line = `[${now.toLocaleTimeString()}] ${message}`;
  try {
    const stamp = debugLogDateStamp(now);
    if (stamp !== debugLogStamp) {
      debugLogStamp = stamp;
      debugLogPath = path.join(DEBUG_LOG_DIR, `detection-${stamp}.log`);
    }
    fs.appendFileSync(debugLogPath, line + '\n');
  } catch {
    // Best-effort only - never let a logging failure break detection.
  }
  broadcast('debug:line', line);
}
buffEngine.setDebugLogFn(debugLog);

// AA "Spell Casting Reinforcement" (4 ranks) and Exaltation "Extended
// Enhancement" (3 ranks) both extend buff durations by a flat percentage,
// and stack additively with each other. buffEngine only needs the combined
// multiplier - it doesn't know or care where the percentages came from.
const AA_REINFORCEMENT_PERCENTS = [0, 5, 15, 30, 50];
const EXALTATION_PERCENTS = [0, 5, 10, 15];

function loadCharacterSettings() {
  return loadJson('characterSettings', { aaLevel: 0, exaltationLevel: 0 });
}

function durationMultiplierFor(settings) {
  const aaPct = AA_REINFORCEMENT_PERCENTS[settings.aaLevel] || 0;
  const exaltPct = EXALTATION_PERCENTS[settings.exaltationLevel] || 0;
  return 1 + (aaPct + exaltPct) / 100;
}

buffEngine.setDurationMultiplierFn(() => durationMultiplierFor(loadCharacterSettings()));

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

logService.watcher.on('line', (line) => buffEngine.handleLine(line));
logService.watcher.on('line', (line) => customTimerEngine.handleLine(line));
// Note 19. A fourth listener for the same reason as the third: damage is not a buff, and giving
// buffEngine a second job would mean every future change to either having to think about both.
logService.watcher.on('line', (line) => damageEngine.handleLine(line));
// Note 38. A third listener rather than a hook inside one of the engines - neither of them is
// about where you are, and a zone is not a buff.
logService.watcher.on('line', (line) => {
  const zone = matchZoneChange(line);
  if (!zone) return;
  const changed = widgetManager.applyZoneChange(zone);
  debugLog(`ZONE now "${changed}"`);
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('zone:changed', changed);
  // Note 20. Where you are is half of every route, so a zone line is the main thing that makes a
  // travel aura redraw.
  pushTravelRoutes();
});
logService.watcher.on('status', (status) => {
  if (status.currentFilePath) {
    const baseName = path.basename(status.currentFilePath, path.extname(status.currentFilePath)).replace(/^eqlog_/i, '');
    spellbookService.setCharacterBaseName(baseName);
  }
});
// Persist live timers so a restart doesn't wipe everything currently running
// - see sessionSnapshot.js for why this exists and why it's time-limited.
// Debounced because these events fire on every tick of every buff (once a
// second) and this writes to disk; 2s is far below the 5 minute grace window,
// so nothing meaningful is lost even if the app dies between writes.
let snapshotTimer = null;
function saveSessionSnapshotSoon() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const { selfBuffs, allyBuffs } = buffEngine.getSnapshotState();
    saveSnapshot({ loadJson, saveJson }, { selfBuffs, allyBuffs, customTimers: customTimerEngine.getSnapshotState() });
  }, 2000);
}

buffEngine.on('buffsChanged', (buffs) => {
  broadcast('buffs:active', buffs);
  saveSessionSnapshotSoon();
});
buffEngine.on('allyBuffsChanged', (buffs) => {
  broadcast('buffs:activeAllies', buffs);
  saveSessionSnapshotSoon();
});
// Where the EQ install actually lives, once known - kept module-level so
// lookups against the game's own spell data (gameSpellData.js) can happen
// from anywhere without re-deriving it from the log folder each time. Set by
// applyInstallRoot below, null until the log folder is configured.
let currentInstallRoot = null;

function applyInstallRoot(eqFolder) {
  if (!eqFolder) return;
  currentInstallRoot = resolveInstallRoot(eqFolder);
  iconService.setEqFolder(currentInstallRoot);
  spellbookService.setInstallRoot(currentInstallRoot);
  // Tagging is cheap and idempotent - it only writes when it actually changes something - so
  // running it every launch costs nothing after the first, and it self-heals after a re-seed.
  //
  // BARD-SONG BACKFILL IS DELIBERATELY NO LONGER RUN. Its module is left intact for reference.
  //
  // It existed to undo a mining mistake: the old roster was built by filtering the client's spell
  // file on "duration > 0", which threw away 386 real bard songs that carry 0 there, so backfill
  // re-read spells_us.txt on every launch and put them back.
  //
  // The roster is no longer mined, so there is nothing to undo. It is built from the curated
  // EQ Legends spreadsheet - the definitive list of what this server actually has - and songs sit
  // in it on the same footing as everything else. Running backfill against that re-reads the
  // client's file, which carries the spells of EVERY EverQuest version, and pushes back in
  // everything this server does not have. Measured on this install: +1,499 entries, taking the
  // roster from 1,052 to about 2,551.
  //
  // Size is not the real cost. "Is this landing line unique?" is judged by counting roster
  // entries, so every re-added spell votes on ambiguity it has no business voting on - which is
  // precisely what the rebuild set out to remove. See the note at the top of tools/build-roster.js.
  //
  // If a bard song really is missing, it belongs in the spreadsheet: one rebuild then fixes it
  // for everyone, instead of each install quietly healing itself into a different roster.
  const tagged = tagBardSongs(currentInstallRoot, buffStore);
  if (tagged) debugLog(`Tagged ${tagged} existing roster entries as bard songs`);
}

// Enriched with icon art here rather than in the renderer: the gem-bar
// display on the landing page needs an icon per spell, and resolving that
// renderer-side would mean shipping the whole ~11k-entry roster over IPC just
// to look up a handful of names. iconUrl is null for anything memorized that
// isn't a tracked buff (a nuke, a heal) - the gem slot still renders, just
// without art.
function memorizedWithIcons() {
  return buffEngine.getCurrentlyMemorized().map((name) => {
    const known = buffStore.getByName(name);
    // A memorized spell that isn't a tracked buff (a nuke, a heal, anything
    // the roster's mining filter dropped) still has real icon art in the
    // game data - falling back to that means every occupied gem shows its
    // actual artwork, and the renderer greys out the non-buff ones rather
    // than showing a placeholder.
    const iconId = known?.iconId != null ? known.iconId : gameSpellData.getIconId(currentInstallRoot, name);
    return {
      name,
      iconUrl: iconId != null ? iconService.buildIconUrl(iconId) : null,
      isKnownBuff: !!known,
      // Drives which end of the gem bar this lands on (see renderMemorized) -
      // songs fill from the right, mirroring how bards actually lay their bar
      // out. Comes from the roster's own flag where the spell is a tracked
      // buff (bardSongTagger.js fills it in from the game's spell data, see
      // gotcha #14); a non-buff spell is never treated as a song.
      isBardSong: !!known?.isBardSong,
    };
  });
}
buffEngine.on('memorizedChanged', () => broadcast('spellbook:memorized', memorizedWithIcons()));
customTimerEngine.on('activeChanged', (timers) => {
  broadcast('customTimers:active', timers);
  saveSessionSnapshotSoon();
});
damageEngine.on('activeChanged', (rows) => broadcast('damage:active', rows));

/**
 * Note 20. The route each travel aura is currently showing, keyed by aura id.
 *
 * Worked out HERE and not in the overlay, because the overlay runs with nodeIntegration off and
 * cannot require the routing module. Broadcast as one map rather than per-window, so this needs no
 * new per-window plumbing: each overlay picks its own id out of it and ignores the rest. The
 * payload is a handful of legs per travel aura, which is nothing.
 *
 * Recomputed rather than cached because all three of its inputs move: the zone changes as she
 * walks, the destination changes when she edits the aura, and the spellbook changes when she
 * scribes something. A stale route is worse than no route - it points the wrong way.
 */
function scribedTravelSpellNames() {
  return TRAVEL_SPELLS.map((s) => s.spell).filter((name) => spellbookService.has(name));
}

function travelRoutes() {
  const zone = widgetManager.getCurrentZone();
  const scribed = scribedTravelSpellNames();
  const routes = {};
  for (const w of widgetManager.getAllWidgetConfigs()) {
    if (w.buffSource !== 'travel') continue;
    routes[w.id] = travelRowsFor(w, zone, scribed);
  }
  return routes;
}

function travelRowsFor(widget, zone, scribed) {
  const row = (name, valueText) => ({
    name,
    valueText: valueText || '',
    barPercent: 0,
    remainingSec: null,
    durationSec: 0,
    infinite: true,
    instant: false,
    landedAt: null,
    showOnOverlay: true,
    iconUrl: null,
    isBardSong: false,
    spellCategory: null,
  });

  // Each of these says WHY there is nothing to show. An aura that simply goes blank is the "empty
  // aura and no way to tell why" this project keeps trying to avoid.
  if (!widget.travelDestination) return [row('Pick a destination', '')];
  if (!zone) return [row('Waiting for a zone line', 'walk through one')];

  const result = findRoute(zone, widget.travelDestination, { scribedSpells: scribed });
  if (result.reason === 'already-there') return [row(`You are in ${widget.travelDestination}`, '')];
  if (!result.ok) {
    return [row(`No route to ${widget.travelDestination}`, result.reason === 'unknown-zone' ? 'unknown zone' : '')];
  }
  return result.legs.map((leg, i) => row(describeLeg(leg), `${i + 1}/${result.legs.length}`));
}

// One place that both recomputes and sends, so no caller can do one without the other.
function pushTravelRoutes() {
  broadcast('travel:routes', travelRoutes());
}
// The longest timeout any damage aura asks for - see setOptions for why the longest and not the
// shortest. Recomputed on any widget change rather than read per line, because it changes when
// someone edits a setting and at no other time.
function refreshDamageOptions() {
  const timeouts = widgetManager
    .getAllWidgetConfigs()
    .filter((w) => w.buffSource === 'damage')
    .map((w) => w.fightTimeoutSec)
    .filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (timeouts.length) damageEngine.setOptions({ fightTimeoutSec: Math.max(...timeouts) });
}
// A fight that ends in silence produces no log line to notice it with, so the meter needs a clock
// of its own to clear itself. One second, which is as often as the number could change anyway -
// timestamps in the log have one-second resolution. Deliberately NOT saved into the session
// snapshot: a damage total from before a restart is not the current fight, and restoring one
// would be showing a number that means nothing.
setInterval(() => {
  // Re-read alongside the tick rather than on a widget-changed hook. It is a filter over a handful
  // of configs once a second, and doing it here means the setting can never be left stale by a
  // path that edits a widget without remembering to call this.
  refreshDamageOptions();
  damageEngine.tick();
  // Note 20. Catches the two inputs that change without a zone line - editing the destination and
  // scribing a travel spell. Cheap: a breadth-first search over 104 nodes, only for auras that are
  // actually travel guides, and almost always zero of them.
  pushTravelRoutes();
}, 1000);
buffEngine.on('unknownBuffsChanged', (buffs) => broadcast('buffs:unknown', buffs));
buffEngine.on('ambiguousCastsChanged', (casts) => {
  broadcast('buffs:ambiguous', casts);
  ambiguousPopup.updateVisibility(casts);
});
buffEngine.on('blockedBuffsChanged', (blocked) => broadcast('buffs:blocked', blocked));

app.on('second-instance', () => {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

// The default File/Edit/View/Window/Help menu never actually needs removing
// by itself - a frameless window (see mainWindow.js) has no native frame to
// hang a visible menu bar off, so it disappears on its own. What setting it
// to null would also throw away is every accelerator that hung off it,
// including Ctrl+R (reload) and Ctrl+Shift+I (DevTools) - both load-bearing
// for this project's own testing practice (see CLAUDE.md). This keeps just
// those, invisibly, instead of the full default menu or nothing at all.
Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
    ],
  },
]));

app.whenReady().then(() => {
  iconService.registerProtocol();
  soundService.registerProtocol();
  createMainWindow();
  widgetManager.initWidgets();
  logService.init();
  // Part of the shutdown instrumentation above - this is the third quit path,
  // and the only one that normally means "the user closed the app".
  const win = getMainWindow();
  if (win) {
    win.on('close', () => debugLog('SHUTDOWN: main window close event'));
    win.webContents.on('unresponsive', () => debugLog('SHUTDOWN WARNING: main window renderer unresponsive'));
  }

  // Note 4's hotkey. Pause/Break, chosen by the owner because she never uses it in game - which
  // is the only thing that makes a global shortcut safe here: it is grabbed at the OS level and
  // EverQuest never sees the key at all while this app is running.
  //
  // Registration can genuinely fail (another app already owns the key), and it fails by
  // returning false rather than throwing - so it is logged and the button in the top bar carries
  // on working either way. The shortcut is never the only way to reach this.
  const toggleMasterHidden = () => {
    const hidden = widgetManager.setMasterHidden(!widgetManager.isMasterHidden());
    const settingsWin = getMainWindow();
    // Keep the button in the top bar honest - it is the only readout of a state that is
    // otherwise invisible by definition.
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('overlay:masterStateChanged', { masterHidden: hidden });
    }
  };

  // Tried in order, first one that takes wins.
  //
  // It was 'Pause', which the owner picked because she never uses it in game - and Electron does
  // not accept it. Not "returns false": globalShortcut.register THROWS on it, so the graceful
  // "another application owns it" branch below never ran and the hotkey has never once worked.
  // Nothing caught it because no unit test launches Electron; it took starting the actual app.
  //
  // Scroll Lock is the honest substitute - the same corner of the keyboard, equally unused in
  // game. The chord is there in case something else already owns Scroll Lock, so the feature
  // degrades to a worse key rather than to nothing.
  const HIDE_HOTKEYS = ['ScrollLock', 'Alt+Shift+H'];
  for (const accelerator of HIDE_HOTKEYS) {
    try {
      if (globalShortcut.register(accelerator, toggleMasterHidden)) {
        hideHotkey = accelerator;
        break;
      }
      debugLog(`Hide-auras hotkey "${accelerator}" is owned by another application - trying the next one`);
    } catch (err) {
      // An accelerator this build of Electron will not parse. Caught rather than allowed to take
      // down startup, which is what the old code did.
      debugLog(`Hide-auras hotkey "${accelerator}" was refused by Electron: ${err.message}`);
    }
  }
  if (!hideHotkey) debugLog('No hide-auras hotkey could be registered - the button still works');

  applyInstallRoot(logService.getState().eqFolder);

  // Put back whatever was still running when the app last closed - see
  // sessionSnapshot.js. Deliberately after applyInstallRoot so the roster is
  // fully backfilled/tagged first: a restored buff is looked up by name for
  // its icon, and doing this earlier would restore entries the roster doesn't
  // know about yet.
  const { restored, gapMs, reason } = loadSnapshot({ loadJson, saveJson });
  if (restored) {
    const count =
      buffEngine.restoreSnapshot(restored) + customTimerEngine.restoreSnapshot(restored.customTimers);
    if (count) debugLog(`Restored ${count} running timers after a ${Math.round(gapMs / 1000)}s restart`);
  } else if (reason && reason !== 'no snapshot') {
    debugLog(`Did not restore timers: ${reason}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

ipcMain.handle('log:getState', () => logService.getState());
ipcMain.handle('log:chooseFolder', async () => {
  const state = await logService.chooseFolder();
  applyInstallRoot(state.eqFolder);
  return state;
});
ipcMain.handle('log:setSplitEnabled', (_event, enabled) => logService.setSplitEnabled(enabled));
ipcMain.handle('log:setSplitOnGap', (_event, splitOnGap) => logService.setSplitOnGap(splitOnGap));
ipcMain.handle('log:chooseSplitFolder', () => logService.chooseSplitFolder());
ipcMain.handle('log:resetSplitFolder', () => logService.resetSplitFolder());
ipcMain.handle('log:openFolder', () => logService.openLogFolder());
ipcMain.handle('log:archiveNow', () => logService.archiveNow());

ipcMain.handle('buffs:getActive', () => buffEngine.getActiveBuffs());
ipcMain.handle('buffs:getActiveAllies', () => buffEngine.getActiveAllyBuffs());

ipcMain.handle('damage:getActive', () => damageEngine.getActive());
ipcMain.handle('travel:getRoutes', () => travelRoutes());
ipcMain.handle('travel:getZones', () => allZoneNames());
ipcMain.handle('customTimers:getActive', () => customTimerEngine.getActive());
ipcMain.handle('customTimers:removeActive', (_event, id) => customTimerEngine.removeActive(id));
ipcMain.handle('buffs:getUnknown', () => buffEngine.getUnknownBuffs());
ipcMain.handle('buffs:getKnown', () =>
  buffStore.getAll().map((b) => ({ ...b, iconUrl: b.iconId != null ? iconService.buildIconUrl(b.iconId) : null }))
);
ipcMain.handle('buffs:resolveUnknown', (_event, { name, durationSec, landingText, endedText }) =>
  buffEngine.resolveUnknown(name, durationSec, { landingText, endedText })
);
ipcMain.handle('buffs:dismissUnknown', (_event, name) => buffEngine.dismissUnknown(name));
ipcMain.handle('buffs:removeActive', (_event, name) => buffEngine.removeActiveBuff(name));
ipcMain.handle('buffs:removeActiveAlly', (_event, { allyName, name }) => buffEngine.removeActiveAllyBuff(allyName, name));
ipcMain.handle('buffs:getBlocked', () => buffEngine.getBlockedBuffs());
ipcMain.handle('buffs:blockBuff', (_event, name) => {
  buffEngine.blockBuff(name);
  saveJson('blockedBuffs', buffEngine.getBlockedBuffs());
  return buffEngine.getBlockedBuffs();
});
ipcMain.handle('buffs:unblockBuff', (_event, name) => {
  buffEngine.unblockBuff(name);
  saveJson('blockedBuffs', buffEngine.getBlockedBuffs());
  return buffEngine.getBlockedBuffs();
});
ipcMain.handle('buffs:upsertKnown', (_event, { name, durationSec, landingText, endedText, iconId }) => {
  const result = buffStore.upsert(name, durationSec, { landingText, endedText, iconId });
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:removeKnown', (_event, name) => buffStore.remove(name));
ipcMain.handle('buffs:renameKnown', (_event, { oldName, newName }) => {
  const result = buffStore.rename(oldName, newName);
  if (result) broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:setShowOnOverlay', (_event, { name, showOnOverlay }) => {
  const result = buffStore.setShowOnOverlay(name, showOnOverlay);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:setNoDurationScaling', (_event, { name, value }) => {
  const result = buffStore.setNoDurationScaling(name, value);
  broadcast('buffs:known', buffStore.getAll());
  return result;
});
ipcMain.handle('buffs:setBardSong', (_event, { name, isBardSong }) => {
  const result = buffStore.setBardSong(name, isBardSong);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});

// Settings-window UI scale.
//
// Done with Electron's zoom factor rather than by converting the stylesheet to relative units.
// main-window.css carries 316 hardcoded px values across 39 distinct sizes; rewriting all of them
// to rem would be a large change to a window with no automated layout coverage, and it would get
// some of them wrong in ways only visible by eye. Zoom scales text, spacing and controls together
// and cannot drift out of step with itself.
//
// Intended to apply to THIS window only. Auras must not scale with it - each already has its own
// icon, text and label sizes, and scaling those from here would fight the per-aura settings.
//
// Stated as intent rather than as fact, deliberately. Chromium keys zoom by origin within a
// session; every window here (main, each aura, the ambiguous popup) loads a file:// page with no
// separate `partition`, and file:// URLs have an empty host. So "a zoom factor cannot leak between
// them" is an assumption about Chromium's internals, not something this code enforces. It is on
// the live checklist in TESTING.md to confirm by eye. If it ever does leak, the fix is to give the
// aura windows their own session partition rather than to stop scaling.
const UI_SCALE_MIN = 80;
const UI_SCALE_MAX = 160;

function clampUiScale(pct) {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Number(pct) || 100));
}

function applyUiScale(pct) {
  const clamped = clampUiScale(pct);
  const win = getMainWindow();
  // setZoomFactor throws on a destroyed webContents - reachable if this lands during shutdown.
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(clamped / 100);
  return clamped;
}

// Clamped on the way OUT as well as in. Returning the raw file contents means a hand-edited or
// truncated uiScale.json - say `5` - reaches the slider, whose own min silently pulls it to 80,
// so the number on screen and the zoom actually applied disagree with nothing reporting it.
ipcMain.handle('ui:getScale', () => clampUiScale(loadJson('uiScale', 100)));

// Sidebar width. TWO clamps, deliberately, and the distinction is the whole point:
//
//   clampStoredSidebarWidth - the preference range. Applied when SAVING and when reading back.
//   fitSidebarWidth         - additionally caps against the current window width.
//
// Collapsing them into one is the obvious simplification and it quietly destroys the setting:
// launch once in a narrow window, the stored 320 gets clamped down to fit, and the next save
// writes the shrunken number over the user's choice. Widen the window again and their width is
// gone for good. Keeping the stored preference untouched means a narrow window renders narrow
// and a wide one restores exactly what they picked.
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 190;

function clampStoredSidebarWidth(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

// Note 8's second half. WHICH buffs count as "the same duration" is app-wide rather than
// per-aura, at the owner's request - both readings are defensible and she wanted to be able to
// try each rather than have one picked for her.
//
//   'duration'  - any buffs with the same total duration merge. Simple and predictable, but a
//                 large slice of the roster is 1440s, so unrelated buffs merge too.
//   'burst'     - same duration AND landed at about the same time, so a Quick Buff set merges
//                 while two unrelated 24-minute buffs stay apart.
//
// Anything unrecognised falls back to 'duration', which is the simpler behaviour and the one a
// user is likeliest to be able to make sense of if it ever shows up unexpectedly.
const MERGE_RULES = ['duration', 'burst'];
const normalizeMergeRule = (rule) => (MERGE_RULES.includes(rule) ? rule : 'duration');

ipcMain.handle('ui:getMergeRule', () => normalizeMergeRule(loadJson('mergeRule', 'duration')));
ipcMain.handle('ui:setMergeRule', (_event, rule) => {
  const value = normalizeMergeRule(rule);
  saveJson('mergeRule', value);
  // Every overlay needs it, not just the focused one - it is app-wide, and an aura that kept the
  // old rule until the next restart would look like the setting had not worked.
  broadcast('ui:mergeRuleChanged', value);
  return value;
});

ipcMain.handle('ui:getTradePing', () => loadJson('tradePingEnabled', false) === true);
ipcMain.handle('ui:setTradePing', (_event, enabled) => {
  const on = enabled === true;
  saveJson('tradePingEnabled', on);
  return on;
});

ipcMain.handle('ui:getSidebarWidth', () => clampStoredSidebarWidth(loadJson('sidebarWidth', SIDEBAR_DEFAULT)));
ipcMain.handle('ui:setSidebarWidth', (_event, px) => {
  const width = clampStoredSidebarWidth(px);
  saveJson('sidebarWidth', width);
  return width;
});
ipcMain.handle('ui:setScale', (_event, pct) => {
  const applied = applyUiScale(pct);
  saveJson('uiScale', applied);
  return applied;
});

ipcMain.handle('buffs:getAmbiguous', () => buffEngine.getAmbiguousCasts());
ipcMain.handle('buffs:resolveAmbiguous', (_event, { text, buffName }) => {
  const result = buffEngine.resolveAmbiguousCast(text, buffName);
  // Put EverQuest back in front once the last question is answered.
  //
  // The popup only ever appears mid-fight, and answering it means clicking out of the game -
  // which the game does not undo by itself, so you are left hunting for the window at the worst
  // possible moment. Only when the queue is EMPTY: with several queued, focusing the game after
  // the first answer would throw you out of the popup before you had finished with it.
  //
  // Deliberately not awaited. It is a nicety, and the answer is already recorded either way -
  // making the renderer wait on a PowerShell round-trip to learn that would be the wrong trade.
  if (buffEngine.getAmbiguousCasts().length === 0) focusGameWindow();
  return result;
});
ipcMain.handle('buffs:dismissAmbiguous', (_event, text) => buffEngine.dismissAmbiguousCast(text));
ipcMain.handle('buffs:resetAmbiguousResolutions', () => buffEngine.resetAmbiguousResolutions());
ipcMain.handle('buffs:getAmbiguousResolutions', () => buffEngine.getAmbiguousResolutions());
ipcMain.handle('buffs:removeAmbiguousResolution', (_event, { text, isSelf }) => buffEngine.removeAmbiguousResolution(text, isSelf));

ipcMain.handle('settings:getTrackOthers', () => loadJson('trackOthersEnabled', false));
ipcMain.handle('settings:setTrackOthers', (_event, enabled) => {
  saveJson('trackOthersEnabled', enabled);
  buffEngine.setTrackOthersEnabled(enabled);
  return enabled;
});

ipcMain.handle('settings:getAutoHideOverlay', () => autoHideOverlayEnabled);
ipcMain.handle('settings:setAutoHideOverlay', (_event, enabled) => {
  autoHideOverlayEnabled = enabled;
  saveJson('autoHideOverlay', enabled);
  if (enabled) {
    foregroundWatcher.start();
  } else {
    foregroundWatcher.stop();
    widgetManager.setForegroundHidden(false); // always show when the feature's off
  }
  return autoHideOverlayEnabled;
});
ipcMain.handle('overlay:getMasterState', () => ({
  allUnlocked: widgetManager.areAllUnlocked(),
  masterHidden: widgetManager.isMasterHidden(),
}));
ipcMain.handle('overlay:setMasterHidden', (_event, hidden) => widgetManager.setMasterHidden(hidden));
ipcMain.handle('overlay:setAllUnlocked', (_event, unlocked) => widgetManager.setAllUnlocked(unlocked));
ipcMain.handle('settings:getShowAurasWhenAppFocused', () => showAurasWhenAppFocused);
ipcMain.handle('settings:setShowAurasWhenAppFocused', (_event, enabled) => {
  showAurasWhenAppFocused = enabled;
  saveJson('showAurasWhenAppFocused', enabled);
  // Re-evaluate straight away rather than waiting for the next focus change -
  // the app itself is focused right now (the user just clicked the checkbox),
  // so this setting's effect should be visible immediately.
  applyForegroundVisibility();
  return showAurasWhenAppFocused;
});

ipcMain.handle('settings:getCharacter', () => loadCharacterSettings());
ipcMain.handle('settings:setCharacter', (_event, settings) => {
  saveJson('characterSettings', settings);
  return settings;
});

ipcMain.handle('spellbook:getState', () => ({
  filePath: spellbookService.getFilePath(),
  spellCount: spellbookService.getCount(),
  ...spellbookService.getExpectation(),
}));
ipcMain.handle('spellbook:getMemorized', () => memorizedWithIcons());
ipcMain.handle('spellbook:forgetMemorized', (_event, name) => buffEngine.removeMemorized(name));
ipcMain.handle('spellbook:clearMemorized', () => buffEngine.clearMemorized());

ipcMain.handle('widget:list', () => widgetManager.getAllWidgetConfigs());
ipcMain.handle('widget:getConfig', (_event, id) => widgetManager.getWidgetConfig(id));
// Note 6 - clicking an aura's name in its move box. Raises the settings window and tells it
// which aura to open. Worth knowing: this pulls EverQuest out of focus, so with auto-hide on it
// is also the moment your other auras vanish. The unlocked ones stay put, which is the only
// reason that is tolerable.
ipcMain.on('widget:openSettings', (_event, id) => {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('widget:openSettings', id);
});
// An overlay asks for this as it boots, the same way it asks for its lock state - a window
// created on demand would otherwise start out assuming it may make noise.
ipcMain.handle('widget:isAudible', (_event, id) => {
  const config = widgetManager.getWidgetConfig(id);
  return config ? widgetManager.shouldBeAudible(config) : true;
});
ipcMain.handle('widget:create', (_event, { name, buffSource }) => widgetManager.createCustomWidget(name, { buffSource }));
ipcMain.handle('widget:createAlly', (_event, { name }) => widgetManager.createAllyBuffsWidget(name));
ipcMain.handle('widget:createDebuff', (_event, { name }) => widgetManager.createDebuffWidget(name));
ipcMain.handle('widget:createDamageMeter', (_event, { name, mineOnly }) =>
  widgetManager.createDamageMeterWidget(name, mineOnly)
);
ipcMain.handle('widget:createTravelGuide', (_event, { name, destination }) =>
  widgetManager.createTravelGuideWidget(name, destination)
);
ipcMain.handle('widget:setTravelDestination', (_event, { id, destination }) =>
  widgetManager.setTravelDestination(id, destination)
);
ipcMain.handle('widget:createSoundOnly', (_event, { name }) => widgetManager.createSoundOnlyWidget(name));
ipcMain.handle('widget:createTextAura', (_event, { name, preset }) =>
  widgetManager.createTextAuraWidget(name, preset)
);
ipcMain.handle('widget:createBuffTimer', (_event, { name, spellName, source }) =>
  widgetManager.createBuffTimerWidget(name, spellName, source)
);
ipcMain.handle('widget:createCooldownTimer', (_event, { name, spellName, cooldownSec, iconId }) =>
  widgetManager.createCooldownTimerWidget(name, spellName, cooldownSec, iconId)
);
// Spells worth a cooldown countdown - note 15.
//
// A DIFFERENT list from the trackable one below, deliberately. A cooldown is started by the cast
// line, so it needs no landing text at all: filtering this the same way would drop 158 of the 478
// candidates, a third of them, for a reason that does not apply.
//
// Anything at 1.5s or under is excluded. That is the global cooldown every spell shares, not a
// per-spell recast, and it is 511 of the 989 entries that carry the field - half the list would
// be a countdown that finishes before it can be read.
ipcMain.handle('buffs:castable', () =>
  buffStore
    .getAll()
    .filter((e) => typeof e.reuseSec === 'number' && e.reuseSec > 1.5)
    .map((e) => ({
      name: e.name,
      reuseSec: e.reuseSec,
      castSec: typeof e.castSec === 'number' ? e.castSec : 0,
      // What the timer actually counts. See widgetStore.createCooldownTimer for why the cast time
      // is part of it: the recast clock starts when the cast finishes, and the timer starts when
      // it begins.
      cooldownSec: e.reuseSec + (typeof e.castSec === 'number' ? e.castSec : 0),
      iconId: e.iconId ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
);

// Only the spells that can actually be tracked, and which of the two ways each one supports.
// The picker needs this to avoid offering "on an ally" for a spell whose roster entry has no
// third-person landing text - that would build an aura which silently never lights up.
ipcMain.handle('buffs:trackable', () =>
  buffStore
    .getAll()
    .filter((e) => e.landingText && String(e.landingText).trim())
    .map((e) => ({
      name: e.name,
      ally: !!(e.othersLandingSuffix && String(e.othersLandingSuffix).trim()),
      // Whether "on something you cast it at" can be offered. Needs the same third-person landing
      // text ally tracking needs - an enemy landing IS an ally landing as far as the log is
      // concerned, since "not you" is all the line says - plus a category that means the spell is
      // cast at something rather than on someone. Offering it for a heal would build an aura that
      // never lights up.
      enemy: !!(
        e.othersLandingSuffix &&
        String(e.othersLandingSuffix).trim() &&
        ['debuff', 'charm', 'dot', 'nuke'].includes(e.scaleCategory)
      ),
      durationSec: typeof e.durationSec === 'number' ? e.durationSec : null,
      infinite: !!e.infiniteDuration,
    }))
);
ipcMain.handle('widget:setTextAuraMessage', (_event, { id, value }) =>
  widgetManager.setTextAuraMessage(id, value)
);
ipcMain.handle('widget:setTextAuraSize', (_event, { id, value }) => widgetManager.setTextAuraSize(id, value));
ipcMain.handle('widget:setTextAuraInstantSec', (_event, { id, value }) =>
  widgetManager.setTextAuraInstantSec(id, value)
);
ipcMain.handle('widget:setMergeSameDuration', (_event, { id, value }) =>
  widgetManager.setMergeSameDuration(id, value)
);
ipcMain.handle('widget:setCategoryBorders', (_event, { id, value }) =>
  widgetManager.setCategoryBorders(id, value)
);
ipcMain.handle('widget:setTrackOnEnemies', (_event, { id, value }) =>
  widgetManager.setTrackOnEnemies(id, value)
);
ipcMain.handle('widget:setAllyDebuffAlert', (_event, { id, value }) =>
  widgetManager.setAllyDebuffAlert(id, value)
);
ipcMain.handle('widget:setDamageOptions', (_event, { id, options }) =>
  widgetManager.setDamageOptions(id, options)
);
ipcMain.handle('widget:setAlwaysOn', (_event, { id, value }) => widgetManager.setAlwaysOn(id, value));
// Note 21's global switch. On the Overlay Auras page beside the other app-wide aura settings,
// not in Add Aura - it is a permanent option rather than something you build.
// Which key actually took, so the hint in the top bar names the one that works rather than the
// one that was asked for. Null when none of them registered.
ipcMain.handle('settings:getHideHotkey', () => hideHotkey);
// The button that makes the whole thing reachable. Opening the folder rather than the file: the
// question is nearly always "what happened on that day", which means picking one.
ipcMain.handle('debug:openLogFolder', () => shell.openPath(DEBUG_LOG_DIR));
ipcMain.handle('debug:logFolder', () => DEBUG_LOG_DIR);
ipcMain.handle('zone:current', () => widgetManager.getCurrentZone());
ipcMain.handle('zone:known', () => KNOWN_ZONES);
ipcMain.handle('widget:setVisibleInZones', (_event, { id, zones }) =>
  widgetManager.setVisibleInZones(id, zones)
);
ipcMain.handle('settings:getLoadoutLabel', () => widgetManager.isLoadoutLabelEnabled());
ipcMain.handle('settings:setLoadoutLabel', (_event, enabled) =>
  widgetManager.setLoadoutLabelEnabled(enabled).enabled
);
ipcMain.handle('widget:setShowOnAllProfiles', (_event, { id, value }) =>
  widgetManager.setShowOnAllProfiles(id, value)
);
ipcMain.handle('widget:export', (_event, id) => widgetManager.exportWidget(id));
ipcMain.handle('widget:peekCode', (_event, code) => widgetManager.peekWidgetCode(code));
ipcMain.handle('widget:import', (_event, code) => widgetManager.importWidget(code));
ipcMain.handle('widget:duplicate', (_event, id) => widgetManager.duplicateWidget(id));
ipcMain.handle('widget:applyCodeToSelfBuffs', (_event, code) => widgetManager.applyCodeToSelfBuffs(code));
ipcMain.handle('widget:delete', (_event, id) => widgetManager.deleteWidget(id));
ipcMain.handle('widget:move', (_event, { id, direction }) => widgetManager.moveWidget(id, direction));
ipcMain.handle('widget:setName', (_event, { id, value }) => widgetManager.setName(id, value));
ipcMain.handle('widget:toggleLock', (_event, id) => widgetManager.toggleLock(id));
ipcMain.handle('widget:resetPosition', (_event, id) => widgetManager.resetPosition(id));
ipcMain.handle('widget:isLocked', (_event, id) => widgetManager.isLocked(id));
ipcMain.handle('widget:setDisplayMode', (_event, { id, mode }) => widgetManager.setDisplayMode(id, mode));
ipcMain.handle('widget:setTimerFormat', (_event, { id, value }) => widgetManager.setTimerFormat(id, value));
ipcMain.handle('widget:setTextSize', (_event, { id, value }) => widgetManager.setTextSize(id, value));
ipcMain.handle('widget:setIconSize', (_event, { id, value }) => widgetManager.setIconSize(id, value));
ipcMain.handle('widget:setContentAnchor', (_event, { id, value }) => widgetManager.setContentAnchor(id, value));
ipcMain.handle('widget:setIconsPerRow', (_event, { id, value }) => widgetManager.setIconsPerRow(id, value));
ipcMain.handle('widget:setRowSize', (_event, { id, value }) => widgetManager.setRowSize(id, value));
ipcMain.handle('widget:setSortOrder', (_event, { id, value }) => widgetManager.setSortOrder(id, value));
ipcMain.handle('widget:setLowTimeThreshold', (_event, { id, value }) => widgetManager.setLowTimeThreshold(id, value));
ipcMain.handle('widget:setLandingGlowEnabled', (_event, { id, enabled }) => widgetManager.setLandingGlowEnabled(id, enabled));
ipcMain.handle('widget:setHideBardSongs', (_event, { id, hide }) => widgetManager.setHideBardSongs(id, hide));
ipcMain.handle('widget:setShowRowIcon', (_event, { id, enabled }) => widgetManager.setShowRowIcon(id, enabled));
ipcMain.handle('widget:setMirrorRowDirection', (_event, { id, enabled }) => widgetManager.setMirrorRowDirection(id, enabled));
ipcMain.handle('widget:setShowIconLabel', (_event, { id, enabled }) => widgetManager.setShowIconLabel(id, enabled));
ipcMain.handle('widget:setIconLabelSize', (_event, { id, value }) => widgetManager.setIconLabelSize(id, value));
ipcMain.handle('widget:setTimerTextColor', (_event, { id, value }) => widgetManager.setTimerTextColor(id, value));
ipcMain.handle('widget:setGroupAllyBuffs', (_event, { id, value }) => widgetManager.setGroupAllyBuffs(id, value));
ipcMain.handle('widget:setGroupAllyDirection', (_event, { id, value }) => widgetManager.setGroupAllyDirection(id, value));
ipcMain.handle('widget:setHideAllyNameOnTile', (_event, { id, value }) => widgetManager.setHideAllyNameOnTile(id, value));
ipcMain.handle('widget:setLabelTextColor', (_event, { id, value }) => widgetManager.setLabelTextColor(id, value));
ipcMain.handle('widget:setIconMargin', (_event, { id, value }) => widgetManager.setIconMargin(id, value));
ipcMain.handle('widget:setIconLabelAnchor', (_event, { id, value }) => widgetManager.setIconLabelAnchor(id, value));
ipcMain.handle('widget:setWrapText', (_event, { id, enabled }) => widgetManager.setWrapText(id, enabled));
ipcMain.handle('widget:setIconJustify', (_event, { id, value }) => widgetManager.setIconJustify(id, value));
ipcMain.handle('widget:setMaxDurationFilter', (_event, { id, value }) => widgetManager.setMaxDurationFilter(id, value));
ipcMain.handle('widget:setSoundOnLand', (_event, { id, enabled }) => widgetManager.setSoundOnLand(id, enabled));
ipcMain.handle('widget:setSoundOnExpire', (_event, { id, enabled }) => widgetManager.setSoundOnExpire(id, enabled));
ipcMain.handle('widget:setSoundWarningSec', (_event, { id, value }) => widgetManager.setSoundWarningSec(id, value));
ipcMain.handle('widget:setSoundWarningLoopSec', (_event, { id, value }) => widgetManager.setSoundWarningLoopSec(id, value));
ipcMain.handle('widget:setLandSoundId', (_event, { id, soundId }) => widgetManager.setLandSoundId(id, soundId));
ipcMain.handle('widget:setExpireSoundId', (_event, { id, soundId }) => widgetManager.setExpireSoundId(id, soundId));
ipcMain.handle('widget:setWarningSoundId', (_event, { id, soundId }) => widgetManager.setWarningSoundId(id, soundId));
ipcMain.handle('widget:setAlertVolume', (_event, { id, value }) => widgetManager.setAlertVolume(id, value));

ipcMain.handle('sounds:pick', () => soundService.pickAndImportSound(getMainWindow()));
ipcMain.handle('sounds:getInfo', (_event, id) => soundService.getSoundInfo(id));
ipcMain.handle('sounds:openFolder', () => soundService.openPickerFolder());
ipcMain.handle('widget:setListWidth', (_event, { id, value }) => widgetManager.setListWidth(id, value));
ipcMain.on('widget:reportContentSize', (_event, { id, width, height, originX }) => widgetManager.fitToContent(id, width, height, originX));
ipcMain.handle('widget:setOpacity', (_event, { id, value }) => widgetManager.setOpacity(id, value));
ipcMain.handle('widget:setBuffFilter', (_event, { id, mode, names }) => widgetManager.setBuffFilter(id, mode, names));
ipcMain.handle('widget:setBuffSource', (_event, { id, source }) => widgetManager.setBuffSource(id, source));
// Named fields rather than a spread, so nothing arrives from the renderer that the store has not
// been told to expect. The cost is that a new field has to be added HERE too - cooldownSec was
// added to the form, the store and the engine and still did nothing until this line changed.
ipcMain.handle(
  'widget:addCustomTimer',
  // Note 9's allOf is listed here as well as everywhere else it passes through. This handler
  // destructures a fixed set of names, so a field missing from the list is silently dropped rather
  // than erroring - which is exactly how castOf timers came to be impossible to create through the
  // UI while looking like they worked.
  (_event, { id, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec, allOf }) =>
    widgetManager.addCustomTimer(id, {
      name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec, allOf,
    })
);
ipcMain.handle(
  'widget:updateCustomTimer',
  (_event, { id, timerId, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, cooldownSec, allOf }) =>
    widgetManager.updateCustomTimer(id, timerId, {
      name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, cooldownSec, allOf,
    })
);
ipcMain.handle('widget:removeCustomTimer', (_event, { id, timerId }) => widgetManager.removeCustomTimer(id, timerId));
ipcMain.handle('widget:excludeBuff', (_event, { id, name }) => widgetManager.excludeBuff(id, name));
ipcMain.handle('widget:unexcludeBuff', (_event, { id, name }) => widgetManager.unexcludeBuff(id, name));
ipcMain.handle('widget:setActiveProfileIds', (_event, { id, profileIds }) => widgetManager.setActiveProfileIds(id, profileIds));

ipcMain.handle('profiles:list', () => profileStore.getAll());
ipcMain.handle('profiles:getActiveId', () => profileStore.getActiveId());
ipcMain.handle('profiles:create', (_event, { name, widgetIdsToMigrate }) => {
  const profile = profileStore.create(name);
  // "Migrate" here just means: check this widget's box in the create-profile
  // modal, and it's added to the new profile's membership list too - see
  // widgetStore.js's activeProfileIds field doc. Additive, not a replace -
  // a widget already active on other profiles keeps that membership.
  for (const id of widgetIdsToMigrate || []) {
    const widget = widgetManager.getWidgetConfig(id);
    if (widget && !widget.activeProfileIds.includes(profile.id)) {
      widgetManager.setActiveProfileIds(id, [...widget.activeProfileIds, profile.id]);
    }
  }
  // Note 21. The loadout label turns itself on the first time a SECOND loadout exists - with only
  // one there is nothing for it to tell you, and by the time there are two it is the moment it
  // starts being useful.
  //
  // ONCE, EVER. Gated on a flag of its own rather than on the profile count, because otherwise
  // switching it off and later adding a third loadout turns it back on, and she has to keep
  // switching it off forever. The note warned about exactly that shape.
  if (!loadJson('loadoutLabelAutoOffered', false) && profileStore.getAll().length >= 2) {
    saveJson('loadoutLabelAutoOffered', true);
    if (!widgetManager.isLoadoutLabelEnabled()) {
      widgetManager.setLoadoutLabelEnabled(true);
      debugLog('Loadout label switched on automatically - a second loadout now exists');
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('settings:loadoutLabelChanged', true);
    }
  }
  broadcast('profiles:changed', profileStore.getAll());
  return profile;
});
ipcMain.handle('profiles:rename', (_event, { id, name }) => {
  const profile = profileStore.rename(id, name);
  if (profile) broadcast('profiles:changed', profileStore.getAll());
  return profile;
});
ipcMain.handle('profiles:setActive', (_event, id) => {
  const result = profileStore.setActiveId(id);
  if (result) {
    buffEngine.setActiveProfileId(result);
    // Profile membership is what decides which widgets are on screen (see
    // widgetManager's isVisibleForActiveProfile) - switching profiles has to
    // re-evaluate every widget's visibility, not just swap the engine's
    // ambiguous-resolution bucket.
    widgetManager.applyProfileVisibility();
    broadcast('profiles:activeChanged', result);
  }
  return result;
});
ipcMain.handle('profiles:delete', (_event, id) => {
  const removed = profileStore.remove(id);
  if (!removed) return false;
  // Order matters: drop the profile's own resolution memory and its
  // membership on every widget first, THEN point the engine at whatever
  // profileStore now considers active (unconditionally - a no-op if the
  // deleted profile wasn't the active one, since setActiveProfileId
  // already short-circuits on an unchanged id).
  widgetManager.removeProfileFromAllWidgets(id);
  buffEngine.removeProfile(id);
  buffEngine.setActiveProfileId(profileStore.getActiveId());
  broadcast('profiles:changed', profileStore.getAll());
  broadcast('profiles:activeChanged', profileStore.getActiveId());
  return true;
});

ipcMain.handle('icons:getSets', () => ICON_SETS);
ipcMain.handle('icons:getSet', () => iconService.getIconSet());
ipcMain.handle('icons:setSet', (_event, iconSet) => {
  iconService.setIconSet(iconSet);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return iconService.getIconSet();
});
ipcMain.handle('icons:getCount', () => iconService.getIconCount());

// Shutdown instrumentation. The app was observed exiting on its own with
// code 0 and no crash dump, meaning something called app.quit() - but there
// are three paths that can (the single-instance guard, window-all-closed, and
// the main window's own close handler) and nothing recorded which. These log
// to the same persisted debug file as detection decisions, so a recurrence is
// diagnosable after the fact instead of needing to catch it live.
app.on('before-quit', () => {
  debugLog('SHUTDOWN: before-quit fired');
  // Flush immediately - the debounced save above may still be pending, and
  // this is exactly the moment the snapshot matters most.
  if (snapshotTimer) clearTimeout(snapshotTimer);
  const { selfBuffs, allyBuffs } = buffEngine.getSnapshotState();
  saveSnapshot({ loadJson, saveJson }, { selfBuffs, allyBuffs, customTimers: customTimerEngine.getSnapshotState() });
});
app.on('will-quit', () => {
  debugLog('SHUTDOWN: will-quit fired');
  // A global shortcut outlives the window that registered it, so leaving it registered means the
  // key stays captured from EverQuest after the app has gone.
  globalShortcut.unregisterAll();
});
// A renderer dying takes its window with it, which can cascade into
// window-all-closed and look like a clean quit - `reason` distinguishes a
// real crash ('crashed'/'oom') from an ordinary teardown ('clean-exit').
app.on('render-process-gone', (_event, _contents, details) => {
  debugLog(`SHUTDOWN: render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
});
app.on('child-process-gone', (_event, details) => {
  debugLog(`SHUTDOWN: child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});

app.on('window-all-closed', () => {
  debugLog('SHUTDOWN: window-all-closed - every BrowserWindow is gone');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// The main window is frameless (see mainWindow.js) so it draws its own
// title bar in the renderer - these are the only way left to
// minimize/maximize/close it, since Windows' native controls no longer
// exist for that window.
ipcMain.handle('window:minimize', () => {
  getMainWindow()?.minimize();
});
ipcMain.handle('window:maximizeToggle', () => {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle('window:close', () => {
  getMainWindow()?.close();
});
ipcMain.handle('window:isMaximized', () => {
  return getMainWindow()?.isMaximized() ?? false;
});

// Basic round-trip test so we can confirm main <-> preload <-> renderer
// IPC is wired up correctly before building real features on top of it.
ipcMain.handle('app:getVersionInfo', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  };
});
