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
//
// DO NOT edit this folder name to match a new product name. It is where every
// existing user's data already lives; changing it orphans all of it. A real
// rebrand needs a copy-the-folder-and-repoint migration, not a string edit.
// `test/pin.test.js` is the project's first test and fails CI if this line's
// folder name changes or a local require() ever creeps above it.
app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker'));

const fs = require('fs');

// Last-resort net for a stray async error - a filesystem watcher raising EPERM after the dir it
// watched moved (git branch switch, an AV lock), a socket error nothing listened for, that class
// of thing. Without this, Electron shows the user a raw "Uncaught Exception" dialog and the app
// exits: a genuinely bad first impression for something that is usually recoverable (the watcher
// is dead, nothing else is). So: write it somewhere findable regardless of the debug-log setting,
// mirror it into the debug log for when that IS on, and keep running. This is not a licence to
// leave real bugs unfixed - the moduleHost watcher that prompted it is fixed at its source too.
const CRASH_LOG_MAX_BYTES = 2 * 1024 * 1024;
function recordCrash(kind, err) {
  const line = `[${new Date().toISOString()}] ${kind}: ${(err && err.stack) || err}\n`;
  try {
    const p = path.join(app.getPath('userData'), 'crash.log');
    // Roll at 2 MB, keeping one previous file. Without this, a fault that repeats every log line
    // (a torn engine on a bad share code, before that was fixed) grew crash.log into gigabytes -
    // a real log day is 1.5M lines.
    try {
      if (fs.statSync(p).size > CRASH_LOG_MAX_BYTES) fs.renameSync(p, `${p}.1`);
    } catch { /* no file yet, or rename raced - append anyway */ }
    fs.appendFileSync(p, line);
  } catch { /* nothing more we can do */ }
  try { console.error(line); } catch { /* ignore */ }
  try { if (typeof debugLog === 'function') debugLog(`UNCAUGHT ${kind}: ${(err && err.message) || err}`); } catch { /* ignore */ }
}
process.on('uncaughtException', (err) => recordCrash('uncaughtException', err));
process.on('unhandledRejection', (reason) => recordCrash('unhandledRejection', reason));
const { ipcMain, protocol, BrowserWindow, Menu, Tray, globalShortcut, shell, screen } = require('electron');
const { buildTrayIcon } = require('./trayIcon');
const { createMainWindow, getMainWindow } = require('./mainWindow');
const { LogService } = require('./logService');
// Note 38. The zone matcher lives with the other log-line patterns; the seed list is data.
const { matchZoneChange, matchForgetSpell, matchMemorizeFinished } = require('./buffParser');
const KNOWN_ZONES = require('../shared/data/zones');
const { BuffStore } = require('./buffStore');
const { BuffEngine } = require('./buffEngine');
const { CustomTimerEngine } = require('./customTimerEngine');
const { DamageEngine } = require('./damageEngine');
const { GroupRoster, RESTORE_GRACE_MS: GROUP_ROSTER_GRACE_MS } = require('./groupRoster');
const { PetTracker } = require('./petTracker');
const { RaidNamedTracker } = require('./raidNamedTracker');
const { FirstAggroEngine } = require('./firstAggroEngine');
const { ModuleHost } = require('./moduleHost');
const { readLastZoneEntry } = require('./logZonePeek');
const { findRoute, describeLeg, allZoneNames, pickableZoneNames, searchPickableZones } = require('../shared/zoneRouting');
const { matchOfflineTell } = require('../shared/travelCommand');
const { lockoutBoardRows } = require('../shared/lockoutBoard');
const { matchShareCodeInChat, splitReason } = require('../shared/shareCodeChat');
const { TRAVEL_SPELLS } = require('../shared/data/zoneGraph');
const { IconService } = require('./iconService');
const { ICON_SETS } = require('./iconExtractor');
const { SpellbookService } = require('./spellbookService');
const { resolveInstallRoot } = require('./eqLocator');
const { tagBardSongs } = require('./bardSongTagger');
// rosterBackfill.js was deleted 1 Sep (teardown #14). It re-read the client spell file on every
// launch and re-added other-expansion bard songs, which was right when the roster was mined and
// wrong once it became the EQL-scoped set. A missing song goes in via tools/roster-overrides.json
// now - see applyInstallRoot. test/roster.test.js fails if the module or a call to it comes back.
const { SessionRestore } = require('./sessionRestore');
const gameSpellData = require('./gameSpellData');
const { makeStackingService } = require('./stackingService');
const spellEffects = require('./spellEffects');
const buffLines = require('../shared/buffLines');
const buffPlanner = require('./buffPlanner');
const { loadJson, saveJson } = require('./store');
const widgetManager = require('./widgetManager');
const actionBarManager = require('./actionBarManager');
const { AbilityGroupTracker, KNOWN_STANCES, KNOWN_INVOCATIONS } = require('./abilityGroups');
const ambiguousPopup = require('./ambiguousPopup');
const zonePromptPopup = require('./zonePromptPopup');
const moveHudWindow = require('./moveHudWindow');
const gridGuideWindow = require('./gridGuideWindow');
const nudgePadWindow = require('./nudgePadWindow');
const positionSnap = require('./positionSnap');
const { ProfileStore } = require('./profileStore');
const { ForegroundWatcher, focusGameWindow } = require('./foregroundWatcher');
const soundService = require('./soundService');
const configTransfer = require('./configTransfer');

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
const { LockoutService } = require('./lockoutService');
const lockoutService = new LockoutService();
const { LogRotationService } = require('./logRotation');
const logRotationService = new LogRotationService({ loadJson, saveJson });
const buffStore = new BuffStore({ loadJson, saveJson });
// The buff-stacking engine, bound to the roster's per-spell stacking data (build-roster.js writes
// it onto every buffs.json entry).
const stackingService = makeStackingService(buffStore);
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
actionBarManager.setActiveProfileIdFn(() => profileStore.getActiveId());
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
// The hide-auras hotkey that actually registered, or null. See registerHideHotkey below.
let hideHotkey = null;
// The user's own choice of key, persisted - NOT necessarily what's actually bound (registration
// can fail if another app owns the key, in which case hideHotkey falls back to Alt+Shift+H while
// this stays whatever was picked, so the Setup dropdown keeps showing their actual selection).
let hideHotkeyChoice = loadJson('hideHotkeyChoice', 'ScrollLock');

// It was 'Pause', which the owner picked because she never uses it in game - and Electron does
// not accept it. Not "returns false": globalShortcut.register THROWS on it, so the graceful
// "another application owns it" branch never ran and the hotkey never once worked. Confirmed by
// starting the actual app, since no unit test launches Electron. 'Pause' is deliberately not
// offered as a choice in the Setup dropdown for that reason - it can never succeed on this
// Electron build, and offering it anyway would just be a silent dead end.
//
// Reported directly: on some keyboards, the OS reports the physical Pause key as sending Scroll
// Lock's own virtual key code (or vice versa) - a driver/layout-level swap this app has no way to
// see through, since globalShortcut only knows the accelerator NAME it registered, not which
// physical key produced it. There's no way to register "the actual Pause key" that survives that
// swap; making the choice itself user-configurable (rather than hardcoding one corner-of-keyboard
// key and hoping) is the actual fix - whichever key the app is TOLD to grab is honestly the key
// that has to be pressed, on any keyboard.
function registerHideHotkey(choice, handler) {
  if (hideHotkey) {
    globalShortcut.unregister(hideHotkey);
    hideHotkey = null;
  }
  if (choice === 'none') return;
  const candidates = choice === 'Alt+Shift+H' ? [choice] : [choice, 'Alt+Shift+H'];
  for (const accelerator of candidates) {
    try {
      if (globalShortcut.register(accelerator, handler)) {
        hideHotkey = accelerator;
        return;
      }
      debugLog(`Hide-auras hotkey "${accelerator}" is owned by another application - trying the next one`);
    } catch (err) {
      // An accelerator this build of Electron will not parse. Caught rather than allowed to take
      // down startup, which is what the old code did.
      debugLog(`Hide-auras hotkey "${accelerator}" was refused by Electron: ${err.message}`);
    }
  }
  debugLog('No hide-auras hotkey could be registered - the button still works');
}

// Note 4's hotkey handler. Grabbed at the OS level, so EverQuest never sees the key at all while
// this app is running - the only thing that makes a global shortcut safe here. Module scope (not
// local to app.whenReady) so the Setup page's hotkey dropdown can call registerHideHotkey again
// with this same handler when the user changes their choice, without re-running startup.
function toggleMasterHidden() {
  const hidden = widgetManager.setMasterHidden(!widgetManager.isMasterHidden());
  actionBarManager.setMasterHidden(hidden);
  const settingsWin = getMainWindow();
  // Keep the button in the top bar honest - it is the only readout of a state that is otherwise
  // invisible by definition.
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('overlay:masterStateChanged', { masterHidden: hidden });
  }
}

const customTimerEngine = new CustomTimerEngine();
const damageEngine = new DamageEngine();
// Note 19. Who is / has been in the player's group, and which charmed pets are the player's - both
// feed the damage meter's "group" / "mine" scopes and its charmed-pet rows.
const groupRoster = new GroupRoster();
const petTracker = new PetTracker();
const raidNamedTracker = new RaidNamedTracker();
const firstAggroEngine = new FirstAggroEngine();

// One place for "put back what was live when the app last closed" - see sessionRestore.js. Every
// engine that holds live session state registers a capture/restore pair and its own staleness
// limit here; this owns the single snapshot file, the debounced save, and the startup pass.
const sessionRestore = new SessionRestore();
sessionRestore.setStore({ loadJson, saveJson });
sessionRestore.setDebugLogFn((m) => debugLog(m));
const MIN = 60 * 1000;

// Buffs / ally buffs / bard songs / custom timers - 5 minutes. A buff that "hasn't expired" may
// still be gone (death, camp, zone) and a wrong countdown reads as authoritative, but 5 min
// covers a crash or accidental close. Entries store an absolute expiresAt, so restore is just a
// filter: anything already past its expiry is dropped here.
sessionRestore.register('timers', {
  maxGapMs: 5 * MIN,
  capture() {
    const { selfBuffs, allyBuffs, bardSongs } = buffEngine.getSnapshotState();
    const customTimers = customTimerEngine.getSnapshotState();
    if (!selfBuffs.length && !allyBuffs.length && !bardSongs.length && !customTimers.length) return null;
    return { selfBuffs, allyBuffs, bardSongs, customTimers };
  },
  restore(d) {
    const now = Date.now();
    const alive = (xs) => (Array.isArray(xs) ? xs : []).filter((e) => e && e.expiresAt > now);
    const n = buffEngine.restoreSnapshot({
      selfBuffs: alive(d.selfBuffs),
      allyBuffs: alive(d.allyBuffs),
      bardSongs: alive(d.bardSongs),
    });
    return n + customTimerEngine.restoreSnapshot(alive(d.customTimers));
  },
});

// Damage meter - 2 minutes (the owner's call). A running total minutes out of date reads as
// current where an empty meter obviously doesn't; 2 min only covers a crash/restart mid-fight.
sessionRestore.register('damage', {
  maxGapMs: 2 * MIN,
  capture: () => damageEngine.captureState(),
  restore: (d) => damageEngine.restoreState(d),
});

// First-aggro line - 2 minutes, same reasoning ("X pulled" goes stale fast).
sessionRestore.register('firstAggro', {
  maxGapMs: 2 * MIN,
  capture: () => firstAggroEngine.captureState(),
  restore: (d) => firstAggroEngine.restoreState(d),
});

// Group roster - 20 minutes (its own RESTORE_GRACE_MS). A groupmate who joined before the restart
// would otherwise read as an outsider on the damage meter's group scope and Pets/Other bucketing.
sessionRestore.register('groupRoster', {
  maxGapMs: GROUP_ROSTER_GRACE_MS,
  capture: () => groupRoster.capture(),
  restore: (d) => {
    groupRoster.restore(d);
    return groupRoster.getAdmitted().length;
  },
});
// Timer definitions live on widgets themselves (see widgetStore.js), not a
// separate store - injected rather than required directly since
// widgetManager pulls in Electron's screen/BrowserWindow. Action bar gem cooldowns ride along as
// pseudo-widgets (see actionBarManager.getPseudoWidgets's own comment) rather than this engine
// needing a second, parallel trigger-matching implementation just for gems.
customTimerEngine.setGetWidgetsFn(() => [
  ...widgetManager.getAllWidgetConfigs(),
  ...actionBarManager.getPseudoWidgets(),
]);
// Stance/invocation "active" tracking (see abilityGroups.js) - genuinely separate from
// customTimerEngine above: a stance/invocation activation has to cross-trigger every OTHER gem in
// its group (mutual exclusion), which the pseudo-widget/customTimer trigger model has no concept
// of - each pseudo-widget's own trigger only ever affects itself there.
const abilityGroupTracker = new AbilityGroupTracker();
abilityGroupTracker.setGetGroupSlotsFn((group) => {
  const out = [];
  for (const bar of actionBarManager.getAllBars()) {
    (bar.slots || []).forEach((slot, index) => {
      if (slot.toggleGroup === group) {
        out.push({ barId: bar.id, index, toggleName: slot.toggleName, toggleDurationSec: slot.toggleDurationSec });
      }
    });
  }
  return out;
});
abilityGroupTracker.setOnChangeFn(() => broadcast('actionBar:abilityGroupChanged', abilityGroupTracker.getAllActiveStates()));
// QOL #16 - the active stance/invocation is a character state the player is still in after a
// restart (like the current zone), so persist it by name and restore it once the bars are known.
// Kept on its own store key rather than folded into sessionRestore: it has no staleness at all (a
// stance stays whatever you set until you change it) and its restore must run against the loaded
// bar layout, which is ready here at module load, before sessionRestore's startup pass.
abilityGroupTracker.setPersistFn((state) => saveJson('activeAbilityGroups', state));
abilityGroupTracker.restore(loadJson('activeAbilityGroups', { stance: null, invocation: null }));
// The group roster is one part of the sessionRestore snapshot now (registered above); a change
// just pings the shared debounced save, and restore happens in sessionRestore.restoreAll().
groupRoster.setPersistFn(() => sessionRestore.scheduleSave());
// See customTimerEngine._resolveCastName. getByName tries the exact name first and only then the
// rank-stripped one, which is what tells a mote rank ("Cannibalize V" -> Cannibalize) apart from a
// spell whose name merely ends in a numeral ("Yaulp III" -> itself).
customTimerEngine.setResolveSpellFn((name) => {
  const known = buffStore.getByName(name);
  return known ? known.name : null;
});
const iconService = new IconService();
const spellbookService = new SpellbookService();

// Drop-in custom-aura modules (feat/module-system). Additive and greenfield - the built-in aura
// types are untouched. The host rides the same 'line' bus below as a pure observer; its entries
// reach the overlay through one generic per-module channel. See moduleHost.js's header.
//
// Modules live in a `modules/` folder INSIDE the install (next to the .exe), shipped via
// package.json's extraFiles and seeded with the bundled ones - same resolution as soundService's
// bundledSoundsDir(). NOT userData: the owner's call, 1 Sep. Dev build reads the repo's own
// modules/ folder. The default per-user NSIS install is writable, so a user can still drop their
// own .js in there (it goes on an uninstall, like anything else in the install dir).
const MODULES_DIR = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'modules')
  : path.join(app.getAppPath(), 'modules');
const moduleHost = new ModuleHost(MODULES_DIR, { loadJson, saveJson });
moduleHost.setCurrentZoneFn(() => widgetManager.getCurrentZone());
moduleHost.setGroupMembersFn(() => [...buffEngine.groupMembers.values()]);
moduleHost.setIconUrlForSpellFn((name) => {
  const known = buffStore.getByName(name);
  return known && known.iconId != null ? iconService.buildIconUrl(known.iconId) : null;
});
// A module is invisible plumbing: no status UI, no error panel, no folder link. A load failure
// goes only to the debug log; the module simply doesn't appear.
moduleHost.on('modulesChanged', (list) => broadcast('modules:changed', list));
moduleHost.on('entriesChanged', (all) => broadcast('modules:entries', all));
moduleHost.on('settingsChanged', (payload) => broadcast('modules:settingsChanged', payload));
moduleHost.on('moduleError', ({ id, error }) => {
  debugLog(`MODULE "${id}" - ${error}`);
  broadcast('modules:error', { id, error });
});
moduleHost.loadModules();
moduleHost.watchFolder();

buffEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
buffEngine.setSpellbookCheckFn((name) => spellbookService.has(name));
// See buffEngine.setEnemyDebuffNamesFn - which spells any aura has asked to watch on enemies.
buffEngine.setEnemyDebuffNamesFn(() => widgetManager.getEnemyDebuffNames());
// Note 40 - the same, but for auras switched to "ally" mode (see buffEngine.setAllyEnemyDebuffNamesFn).
buffEngine.setAllyEnemyDebuffNamesFn(() => widgetManager.getAllyEnemyDebuffNames());
// Note 19. Anything you have mezzed, snared or slowed is a thing you are fighting, which seeds the
// damage meter's enemy set for a character who debuffs rather than attacks. Pull-based like the
// line above it, so a mob mezzed a second ago counts without anything having to push an update.
damageEngine.setKnownEnemiesFn(() =>
  buffEngine
    .getActiveAllyBuffs()
    .filter((b) => b.onEnemy && b.allyName)
    .map((b) => b.allyName)
);
// Note 19. The "group" damage scope filters on who has been in the player's group this session;
// the charmed-pet rows need to know which charmed mobs are the player's own. Both are pulled live.
damageEngine.setGroupFn(() => groupRoster.getAdmitted());
damageEngine.setPetsFn(() => petTracker.snapshot());
petTracker.setOwnNameFn(() => spellbookService.getCharacterName());
petTracker.setCharmSpellCheck((name) => {
  const entry = buffStore.getByName(name);
  return !!entry && entry.scaleCategory === 'charm';
});
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
// #29 - a debuff bard song landing on an enemy is only tracked when a Bard Songs aura wants it.
buffEngine.setBardSongDebuffsWantedFn(() =>
  widgetManager.getAllWidgetConfigs().some((w) => w.buffSource === 'bardSongs' && w.showDebuffSongs)
);
customTimerEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
buffEngine.setTrackOthersEnabled(loadJson('trackOthersEnabled', false));
buffEngine.setBlockedNames(loadJson('blockedBuffs', []));
// P0 rework, ON by default from the first public release - see buffEngine.js's constructor comment
// on useEvidenceModel for exactly what it changes. Measured against a real week-long log: +241 buff
// landings recovered (buffs the old path silently dropped), 0 lost, +6 prompts. It stays a toggle
// so it can be switched OFF again with one click if it ever misbehaves live - that IS the escape
// hatch, no rebuild needed. Only an explicit `false` written down (the user unticking the box)
// turns it off.
buffEngine.setUseEvidenceModel(loadJson('useEvidenceModel', true));
// P0c, off by default and independently switchable from useEvidenceModel above - see buffEngine.js's
// constructor comment on useCastTimeFilter for exactly what this changes.
buffEngine.setUseCastTimeFilter(loadJson('useCastTimeFilter', false));
// Note 26. The full ported stacking engine decides self-buff tile removal for pairs the curated
// line data doesn't cover. No toggle - it's a verified 1:1 port of the reference engine, and it
// only ever removes a stale tile on a clean one-way overwrite (stackingService.wouldOverwriteLive).
// The live engine has no character level, so it assumes 50 (see stackingService's header).
buffEngine.setStackConflictFn((activeSpellId, incomingSpellId) =>
  stackingService.wouldOverwriteLive(activeSpellId, incomingSpellId)
);
// ...and the same engine gets a veto over a curated 'overwrites': the curated line data proposes
// removing the stale tile, but if the ported engine says the two actually stack, the tile stays.
// Raw verdict (1 / 0 / -1 / null) - active buff is "worn", the incoming landing is "cast".
buffEngine.setStackVetoFn((activeSpellId, incomingSpellId) =>
  stackingService.verdict(activeSpellId, incomingSpellId, 50, 50)
);
// The heading model / measured blocked-pairs (docs/BUFF-STACKING.md) - the first authority, always
// on. The stacking engine above only answers what this returns 'unknown' for.
buffEngine.setLineStackFn((incomingName, activeName) => buffLines.stackDecision(incomingName, activeName));

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
    actionBarManager.setForegroundState({ autoHideEnabled: false, eqFocused: true, ownAppFocused: false });
    return;
  }
  const shouldShow = state.eqFocused || (showAurasWhenAppFocused && state.ownAppFocused);
  widgetManager.setForegroundHidden(!shouldShow);
  // Action bars each decide for themselves via their own showWhenAppFocused (not the shared
  // showAurasWhenAppFocused global widgets use) - see actionBarManager.isBarForegroundHidden.
  actionBarManager.setForegroundState({
    autoHideEnabled: true,
    eqFocused: state.eqFocused,
    ownAppFocused: state.ownAppFocused,
  });
}

foregroundWatcher.on('focusChanged', applyForegroundVisibility);
// QOL #9 - tell the main window when an exclusive-fullscreen app is in front, so the Buff Tracker
// page can explain why the auras vanished instead of leaving the user guessing. Broadcast on every
// change (focusChanged only fires when the state actually flips); the renderer also asks for the
// current value on load via the handler below.
foregroundWatcher.on('focusChanged', (state) => {
  broadcast('overlay:fullscreenWarning', !!(state && state.foregroundFullscreen));
});
// P3-2 circuit breaker - powershell.exe can't run here at all (broken PATH, an AV hook killing
// every child, an execution-policy lockdown). The watcher has stopped itself; say so once instead
// of the overlay silently never auto-hiding. The renderer also reads the current value on load.
foregroundWatcher.on('unavailable', () => {
  debugLog('[foreground] auto-hide unavailable - powershell probe failed repeatedly, watcher stopped');
  broadcast('overlay:autoHideUnavailable', true);
});
if (autoHideOverlayEnabled) foregroundWatcher.start();

// Permanent (not "remove before shipping" temp debug logging) - a running
// record of every detection decision (landed/queued/ignored/blocked and
// why), so a confusing moment in-game can be checked afterward instead of
// needing to manually trace the raw EQ log. Capped by truncating on
// startup rather than mid-session, so a single write is never slowed down
// by a size check.
// ITS OWN FOLDER, ONE FILE PER DAY. the owner, 23 August: "I cannot provide this currently as that log
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
// Off by default, manually enabled by the user under Diagnostics - reported live 25 Aug: "should
// there be a debug log of every aura that is fired/loaded/ended... i will enable it manually for
// myself." This used to write unconditionally on every launch, with no way to turn it off - fine
// while it only covered self/ally buff detection, but customTimerEngine now feeds the same
// function too (see its own setDebugLogFn below), and a running-forever log of every trigger
// firing on every aura is a cost worth making opt-in rather than assumed.
let debugLogEnabled = loadJson('debugLogEnabled', false);
function debugLog(message) {
  if (!debugLogEnabled) return;
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
customTimerEngine.setDebugLogFn(debugLog);
raidNamedTracker.setDebugLogFn(debugLog);
firstAggroEngine.setDebugLogFn(debugLog);

// AA "Spell Casting Reinforcement" (4 ranks) and Exaltation "Extended
// Enhancement" (3 ranks) both extend buff durations by a flat percentage,
// and stack additively with each other. buffEngine only needs the combined
// multiplier - it doesn't know or care where the percentages came from.
const AA_REINFORCEMENT_PERCENTS = [0, 5, 15, 30, 50];
const EXALTATION_PERCENTS = [0, 5, 10, 15];

// Spell Casting Deftness (AA, 3 ranks) reduces cast time on beneficial spells that have a duration
// and an initial cast time of at least 3 seconds - confirmed live 25 Aug straight from the AA
// window's own three rank tooltips (corrected from an earlier misread that called it "Subtlety").
// Same rank-dropdown shape as AA_REINFORCEMENT_PERCENTS/EXALTATION_PERCENTS above, not a free-typed
// percent, now that all three ranks have actually been seen rather than just one.
const DEFTNESS_PERCENTS = [0, 10, 25, 50];

function loadCharacterSettings() {
  return loadJson('characterSettings', { aaLevel: 0, exaltationLevel: 0, deftnessLevel: 0 });
}

function durationMultiplierFor(settings) {
  const aaPct = AA_REINFORCEMENT_PERCENTS[settings.aaLevel] || 0;
  const exaltPct = EXALTATION_PERCENTS[settings.exaltationLevel] || 0;
  return 1 + (aaPct + exaltPct) / 100;
}

buffEngine.setDurationMultiplierFn(() => durationMultiplierFor(loadCharacterSettings()));

// buffEngine.js's _scaledCastSec applies the eligibility gate (duration + >=3s base cast) itself,
// straight from the AA's own wording - this function only needs to return the raw multiplier.
function castTimeMultiplierFor(settings) {
  const deftnessPct = DEFTNESS_PERCENTS[settings.deftnessLevel] || 0;
  return 1 - deftnessPct / 100;
}

buffEngine.setCastTimeMultiplierFn(() => castTimeMultiplierFor(loadCharacterSettings()));

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

// One log-line consumer throwing must not stop the others. They are all listeners on Node's single
// 'line' EventEmitter, and emit() propagates a throw synchronously - a null customTimers element
// from a bad share code took out ten downstream engines this way (damage meter, raid board,
// lockouts, ...), silently, once per line. Each handler runs isolated now.
//
// GUARANTEE, and the edge it does NOT cover: this stops one fault reaching the OTHER handlers -
// they recover completely. It does NOT make the faulting engine whole: an engine that commits
// state before the work that throws (customTimerEngine advances currentZone before its trigger
// loop) is left with a torn line, and that transition is lost. The real fix for that is validating
// input at the door (widgetStore.normalizeWidget); this is containment.
//
// A distinct error signature is reported ONCE per session (not per line) via recordCrash, so it
// reaches crash.log + the debug log + a Diagnostics broadcast - a built-in engine can't be
// disabled like a slow module, so a silent forever-fault would be worse than a loud one-time one.
const _lineHandlerFaults = new Set();
const _LINE_HANDLER_FAULT_CAP = 50;
// A stable signature for "the same fault", so a distinct one is reported once per session and the
// set stays bounded. Deliberately NOT the error message: a message that interpolates data (a
// position, a zone/mob/spell name, a JSON offset) is different on every throw, which would both
// grow this set without bound AND re-report - re-churning crash.log, the exact thing its 2MB roll
// exists to stop. label + error type + the first stack frame identifies the throw site instead.
function _faultSig(label, err) {
  const type = (err && err.constructor && err.constructor.name) || 'Error';
  const frame = ((err && err.stack) || '').split('\n')[1]?.trim() || 'no-frame';
  return `${label}:${type}:${frame}`;
}
function onLogLine(label, fn) {
  logService.watcher.on('line', (line) => {
    try {
      fn(line);
    } catch (err) {
      const sig = _faultSig(label, err);
      if (!_lineHandlerFaults.has(sig) && _lineHandlerFaults.size < _LINE_HANDLER_FAULT_CAP) {
        _lineHandlerFaults.add(sig);
        recordCrash(`lineHandler[${label}]`, err);
        broadcast('diagnostics:lineHandlerFault', { label, message: (err && err.message) || String(err) });
      }
    }
  });
}

onLogLine('buffEngine', (line) => buffEngine.handleLine(line));
onLogLine('customTimerEngine', (line) => customTimerEngine.handleLine(line));
// Note 19. A fourth listener for the same reason as the third: damage is not a buff, and giving
// buffEngine a second job would mean every future change to either having to think about both.
onLogLine('damageEngine', (line) => damageEngine.handleLine(line));
// Note 19. Group membership and charmed-pet ownership - two small trackers the damage meter reads.
onLogLine('groupRoster', (line) => groupRoster.handleLine(line));
onLogLine('petTracker', (line) => petTracker.handleLine(line));
onLogLine('raidNamedTracker', (line) => raidNamedTracker.handleLine(line));
onLogLine('firstAggro', (line) => firstAggroEngine.handleLine(line));
onLogLine('abilityGroupTracker', (line) => abilityGroupTracker.handleLine(line));
// Custom modules ride the same bus as pure observers. Its handleLine already catches per-module
// throws internally (like lockoutService); the wrapper is a second layer for the host itself.
onLogLine('moduleHost', (line) => moduleHost.handleLine(line));
// Raid lockouts. Its handleLine swallows and counts its own errors rather than throwing, because
// this bus is shared with buff detection and everything else on it - see the note at the top of
// lockoutService.js. A lockout parser that stops working is a disappointment; one that takes the
// buff overlay down with it is not acceptable.
onLogLine('lockoutService', (line) => lockoutService.handleLine(line));

// Both pulled from the watcher rather than pushed, so neither can go stale when the tailer rolls
// to a new file. The current FILE is how a live line is attributed to a character - the 'line'
// event carries only the string.
lockoutService.setLogsFolderFn(() => logService.watcher.getStatus().logsFolder);
lockoutService.setCurrentFileFn(() => logService.watcher.getStatus().currentFilePath);

/**
 * Weekly log rotation at the lockout reset. See logRotation.js for the measurement behind the
 * boundary and for why it truncates rather than deletes.
 *
 * Checked once a minute. That covers both the owner's own description - "the first time they log
 * in after the reset" - and the app being left open across a Tuesday morning, which a check only at
 * startup would miss entirely.
 *
 * Wrapped, because a rotation problem must never stop the app starting or keep it from tracking
 * buffs. Nothing here is on the critical path for anything else.
 */
// THE SPLITTER SAYING IT CANNOT READ THE LOG ANY MORE. Wired here rather than inside logService
// because this is where debugLog lives - it writes the detection-YYYY-MM-DD.log file the owner can
// actually find and send, where the first version of this only reached a console she never opens.
//
// An unstamped line is filed under the day of the line before it, which is right for the wrapped
// server broadcasts it exists for - ten lines in 1,761,090 of her real log. A batch that is mostly
// unstamped means something else entirely: the stamp pattern has stopped matching what the game
// writes, and every one of those lines has just gone into the wrong day, silently.
logService.splitter.setOnFormatAlarm((alarm) => {
  const pct = (alarm.ratio * 100).toFixed(1);
  debugLog(
    `LOG SPLITTER: ${pct}% of the last ${alarm.total} lines had no readable timestamp ` +
    `(normal is under 0.01%). They were filed under ${alarm.lastDateKeySeen}. The stamp format ` +
    `may have changed. First one: ${JSON.stringify(alarm.sample)}`
  );
  broadcast('log:state', logService.getState());
});

logRotationService.setLogsFolderFn(() => logService.watcher.getStatus().logsFolder);
// Ten seconds of silence. Her own Archive-log warning says the safe moment is when EQ is not
// writing, so the rotation waits for one rather than picking a moment at random.
//
// SEEDED TO NOW, not to zero, and that distinction is the whole guard. The watcher opens the log AT
// THE END and emits nothing for what is already in it, so at launch no line has ever been seen and
// "time since the last line" is vacuously enormous - every log looks quiet, including one the game
// is writing to at that instant. Starting the clock at launch means the first rotation has to
// observe a real lull. Assume it is busy until it demonstrably is not.
let lastLogLineAt = Date.now();
// lastLogLineAt is seeded to launch time (see above), so "how long since the last line" is
// meaningless until at least one real line has arrived - this flag is the guard for the QOL #5
// "is it working right now?" readout.
let sawFirstLogLine = false;
onLogLine('logActivity', () => { lastLogLineAt = Date.now(); sawFirstLogLine = true; });
logRotationService.setIsQuietFn(() => Date.now() - lastLogLineAt > 10000);

// IS EVERQUEST LOGGING? The tracker is dead in the water without `/log on`, and EQ Legends writes
// no "logging is now ON/OFF" line we could watch for (checked the owner's whole corpus). So this
// is activity-based: if eqgame.exe is running but nothing has reached the tailer AND the log file
// itself has not been written since the app launched, logging is almost certainly off - prompt.
const APP_LAUNCH_MS = Date.now();
let loggingSeemsOff = false;      // last verdict, so the prompt fires on the transition only
let loggingPromptOpen = false;    // a modal is up; do not stack another
let eqFirstSeenRunningMs = null;  // when we first confirmed eqgame.exe was up
const LOGGING_GRACE_MS = 150000;  // 2.5 min of "EQ up, still nothing" before the first prompt

function eqIsRunning() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('tasklist', ['/FI', 'IMAGENAME eq eqgame.exe', '/NH'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      resolve(!err && /eqgame\.exe/i.test(stdout || ''));
    });
  });
}

async function checkLoggingActive() {
  // A line reached the tailer recently, or the log file grew since launch -> logging is working.
  const status = logService.watcher.getStatus();
  let logWorking = Date.now() - lastLogLineAt < LOGGING_GRACE_MS;
  if (!logWorking && status.currentFilePath) {
    try { logWorking = fs.statSync(status.currentFilePath).mtimeMs > APP_LAUNCH_MS + 3000; } catch (e) { /* ignore */ }
  }

  if (logWorking) {
    if (loggingSeemsOff) { loggingSeemsOff = false; loggingPromptOpen = false; broadcast('logging:ok'); }
    return;
  }
  if (loggingSeemsOff || loggingPromptOpen) return; // already flagged / asked

  const running = await eqIsRunning();
  if (!running) { eqFirstSeenRunningMs = null; return; } // EQ not up - nothing to log
  if (eqFirstSeenRunningMs === null) eqFirstSeenRunningMs = Date.now();
  // EQ must have been up, with still-zero activity, for the whole grace window - so a player who
  // just launched EQ, or is briefly idle in an empty zone, is not nagged.
  if (Date.now() - eqFirstSeenRunningMs < LOGGING_GRACE_MS) return;

  loggingSeemsOff = true;
  loggingPromptOpen = true;
  debugLog('LOGGING: eqgame up >2.5min with no log activity - prompting for /log on');
  broadcast('logging:off');
}
ipcMain.handle('logging:acknowledge', () => { loggingPromptOpen = false; return true; });
ipcMain.handle('logging:recheck', async () => {
  loggingPromptOpen = false;
  loggingSeemsOff = false;
  // A recheck is the user saying "I just did /log on" - give the client a moment to write.
  await new Promise((r) => setTimeout(r, 4000));
  const working = Date.now() - lastLogLineAt < LOGGING_GRACE_MS
    || (() => { try { return fs.statSync(logService.watcher.getStatus().currentFilePath).mtimeMs > Date.now() - 8000; } catch (e) { return false; } })();
  return { seemsOff: !working };
});
// First check after 90s, then every 60s. The grace window above is what actually gates the prompt.
setTimeout(() => { checkLoggingActive(); setInterval(checkLoggingActive, 60000); }, 90000);
// So the tailed log is rotated LAST and keeps the newest mtime. Without this, emptying a
// logged-out character's log after the played one drags the watcher onto the mule at its next
// directory scan, and every line written in between is lost to buffs, lockouts and the rest.
logRotationService.setCurrentFileFn(() => logService.watcher.getStatus().currentFilePath);
logRotationService.loadSettings();

// ONE reset setting, two consumers. The Lockouts grid measures its week from it; the weekly
// rotation cuts the log at it. The Lockouts page and the Setup page both edit the same store key,
// so they can never disagree. Default is the Alt+Z measurement - Tuesday 11:00 local.
const savedReset = loadJson('lockoutReset', { weekday: 2, hour: 11 });
function applyResetRule(rule) {
  const clean = lockoutService.setResetRule(rule); // clamps; returns the stored shape
  logRotationService.setResetRule(clean);
  saveJson('lockoutReset', clean);
  return clean;
}
lockoutService.setResetRule(savedReset);
logRotationService.setResetRule(savedReset);

const savedLogTarget = loadJson('lockoutLogTarget', { path: null });
if (savedLogTarget && savedLogTarget.path) lockoutService.setLogTarget(savedLogTarget.path);

// QOL #14 - a manually entered character/server for the spellbook, for when auto detection off
// the log picks the wrong one or none. `<name>_<server>` is the base the EQ client names its
// per-character files with (eqlog_<base>.txt, <base>-<CLASS>-Spellbook.txt).
let spellbookChar = loadJson('spellbookCharacter', { name: '', server: '' });
function spellbookCharBase(c) {
  const name = String((c && c.name) || '').trim();
  const server = String((c && c.server) || '').trim();
  if (!name) return '';
  return server ? `${name}_${server}` : name;
}
if (spellbookCharBase(spellbookChar)) spellbookService.setCharacterOverride(spellbookCharBase(spellbookChar));

// An explicit spellbook file the user picked from "Change spellbook file..." - beats both name
// paths. Its own key so clearing the typed name/server doesn't disturb it and vice versa.
let spellbookFileOverride = loadJson('spellbookFileOverride', '');
if (spellbookFileOverride) spellbookService.setFileOverride(spellbookFileOverride);

function runLogRotation(why) {
  try {
    // NOT WHILE A BACKFILL IS IN FLIGHT. The backfill holds a per-file state object for the length
    // of its stream and sets its own 'done' at the end, so clearing the map underneath it loses
    // whichever characters it had not reached - and it then reports ok, done, with one character
    // silently missing from the grid until someone hits rescan. Waiting a minute costs nothing.
    if (lockoutService.backfillState === 'running') {
      logRotationService.noteHostSkip('the lockout scan is running; will try again shortly');
      return;
    }
    // NOR WHILE THE SPLITTER STILL HAS A BACKLOG. Emptying the live log resets the splitter to the
    // start of a now-empty file, so anything it had not yet read never reaches Logs/Split/. The
    // archive still has every line, but the per-day folder - which is the one she opens - would
    // have a hole in it. A megabyte of slack: during play the splitter is a poll behind at most,
    // and it reads 140 MB in about a second, so this only ever bites a first launch against a very
    // large log.
    if (logService.splitter.bytesBehind() > 1024 * 1024) {
      logRotationService.noteHostSkip('still splitting the log into per-day files; will try again shortly');
      return;
    }
    const report = logRotationService.rotateIfDue();
    if (report.rotated.length) {
      debugLog(`LOG ROTATION (${why}): archived ${report.rotated.length} file(s) for week ${report.boundary}`);
      // The lockout grid is built from those files, so it has to be rebuilt from what is now there.
      lockoutService.states.clear();
      lockoutService.backfillState = 'idle';
      broadcast('lockouts:changed', lockoutService.getStatus());
    }
    if (report.failed.length) {
      debugLog(`LOG ROTATION (${why}): ${report.failed.length} file(s) FAILED - ${JSON.stringify(report.failed)}`);
    }
    if (report.skippedUnreadable.length) {
      // Not a failure and not a success. The log's head carried no readable timestamp, so whether
      // it predates the week could not be established and it was left alone.
      debugLog(`LOG ROTATION (${why}): could not read a timestamp in ${report.skippedUnreadable.join(', ')}`);
    }
  } catch (err) {
    debugLog(`LOG ROTATION (${why}): threw - ${err && err.message}`);
  }
}
// Once a minute, and that is cheaper than it sounds: when the log is busy the check costs one
// comparison and returns, and when the week is already closed off it costs a readdir. A minute is
// short enough that someone opening =Auras before the game gets their rotation promptly, and short
// enough to catch a lull during a session left running across a Tuesday morning.
setInterval(() => runLogRotation('interval'), 60 * 1000);

// Debounced, because a backfill applies well over a million lines and the renderer does not need
// to hear about each one. Live play emits at human speed and coalesces to nothing.
let lockoutPushTimer = null;
lockoutService.on('changed', () => {
  if (lockoutPushTimer) return;
  lockoutPushTimer = setTimeout(() => {
    lockoutPushTimer = null;
    broadcast('lockouts:changed', lockoutService.getStatus());
    // If a raid-lockout aura is on screen right now, a kill that just landed should drop off it
    // live rather than waiting for the 20s to lapse. Cheap no-op when nothing is shown.
    pushLockoutBoard();
  }, 400);
});
lockoutService.on('backfillChanged', (status) => broadcast('lockouts:backfill', status));
// A separate Diagnostics feed showing ONLY memorize/forget lines - raised 25 Aug straight out of
// investigating why currentlyMemorized went stale after a loadout swap: the swap itself turned out
// to print NOTHING at all (confirmed by searching a real log across the whole swap window - zero
// forget/memorize/loadout/class/spellbook lines of any kind), which the general live log feed and
// the detection log both make tedious to verify since they're dominated by unrelated buff/combat
// noise. This makes "did anything actually fire when I swapped" a one-glance answer instead of a
// log search, for this and any future swap-adjacent question.
onLogLine('memorizedFeed', (line) => {
  if (matchForgetSpell(line) || matchMemorizeFinished(line)) broadcast('memorized:line', line);
});

/**
 * Note 30. Somebody pasted a share code into chat.
 *
 * This OFFERS and never applies. The code is text another player typed, so importing it without
 * being asked would let anyone reconfigure the app by talking in guild chat. The most that happens
 * on its own is that the main window is told, and the person decides.
 *
 * Codes already seen are remembered for the session, so a code sitting in a busy guild channel
 * that somebody quotes three times produces one offer rather than three.
 */
const offeredShareCodes = new Set();

// The offer strip is easy to miss and trivial to dismiss - it appears while she is playing, and
// the one place it must not do is steal focus mid-fight. So a dismissed offer used to be gone for
// good, with no way back to a code somebody had genuinely sent. These are kept for the session and
// listed under "+ Add aura", which is where somebody goes when they want the aura, rather than
// where they happened to be when it arrived.
//
// This is a READ-ONLY record. Nothing here imports: picking one still opens the ordinary import
// screen with every confirmation it already has. See gotcha #24.
const recentShareCodes = [];
const RECENT_SHARE_CODE_CAP = 20;

ipcMain.handle('shareCode:recent', () => recentShareCodes.slice().reverse());

onLogLine('shareCodeChat', (line) => {
  const found = matchShareCodeInChat(line);
  if (!found) return;
  if (offeredShareCodes.has(found.code)) return;
  offeredShareCodes.add(found.code);
  const peek = widgetManager.peekShareCode(found.code);
  recentShareCodes.push({
    sender: found.sender,
    channel: found.channel,
    code: found.code,
    auraName: peek ? peek.name : null,
    at: Date.now(),
  });
  if (recentShareCodes.length > RECENT_SHARE_CODE_CAP) recentShareCodes.shift();
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('shareCode:offered', {
    sender: found.sender,
    channel: found.channel,
    code: found.code,
    // null when it will not decode. The renderer says so rather than showing an empty name, and
    // splitReason offers the likeliest cause when the code looks truncated.
    aura: peek,
    problem: peek ? null : splitReason(found.code) || 'That code could not be read.',
  });
});
// Shared by the real log-driven zone change below and the zone-prompt popup's "where are you
// now" answer - both are "the app now knows/believes the current zone", and both need the exact
// same fan-out (widget visibility, the main window's own currentZone, a travel-route redraw).
function applyZoneChangeAndNotify(zone) {
  const changed = widgetManager.applyZoneChange(zone);
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('zone:changed', changed);
  return changed;
}

// Note 38. A third listener rather than a hook inside one of the engines - neither of them is
// about where you are, and a zone is not a buff.
onLogLine('zoneChange', (line) => {
  const zone = matchZoneChange(line);
  if (!zone) return;
  const changed = applyZoneChangeAndNotify(zone);
  debugLog(`ZONE now "${changed}"`);
  // The damage meter's "since zone-in" tally starts over here - see damageEngine.enterZone.
  damageEngine.enterZone();
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
// Persist live engine state so a restart doesn't wipe everything currently running - see
// sessionRestore.js for why this exists and why each part is time-limited. The save is debounced
// (2s) because these events fire on every tick of every active thing and it writes to disk.
buffEngine.on('buffsChanged', (buffs) => {
  broadcast('buffs:active', buffs);
  sessionRestore.scheduleSave();
});
buffEngine.on('allyBuffsChanged', (buffs) => {
  broadcast('buffs:activeAllies', buffs);
  sessionRestore.scheduleSave();
});
buffEngine.on('bardSongsChanged', (songs) => {
  broadcast('buffs:activeBardSongs', songs);
  sessionRestore.scheduleSave();
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
  spellEffects.resetCache(); // its per-category stat map is built from the roster, which is about to change
  stackingService.invalidate(); // its spellView cache is built from roster entries
  // Tagging is cheap and idempotent - it only writes when it actually changes something - so
  // running it every launch costs nothing after the first, and it self-heals after a re-seed.
  //
  // BARD-SONG BACKFILL IS DELIBERATELY NO LONGER RUN. Its module is left intact for reference.
  //
  // It existed to undo a mining mistake: the old roster was built by filtering the client's spell
  // file on "duration > 0", which threw away 386 real bard songs that carry 0 there, so backfill
  // re-read spells_us.txt on every launch and put them back.
  //
  // The roster is no longer mined, so there is nothing to undo. It is the ~1,000 spells EQ Legends
  // actually has, and songs sit in it on the same footing as everything else. Running backfill
  // against that re-reads the client's file, which carries the spells of EVERY EverQuest version,
  // and pushes back in everything this server does not have. Measured on this install: +1,499
  // entries, taking the roster from 1,052 to about 2,551.
  //
  // Size is not the real cost. "Is this landing line unique?" is judged by counting roster
  // entries, so every re-added spell votes on ambiguity it has no business voting on - which is
  // precisely what the rebuild set out to remove. See the note at the top of tools/build-roster.js.
  //
  // If a bard song really is missing, add it via an `add` block in tools/roster-overrides.json:
  // one rebuild then fixes it for everyone, instead of each install quietly healing itself into a
  // different roster.
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
  sessionRestore.scheduleSave();
});
// Note 19. One engine, but a damage aura can be scoped to the whole fight, just the player's
// group, or just the player (+ their charmed pets), and 'group'/'mine' recompute the % denominator
// - so the three views are computed here and the overlay picks its aura's. `all` stays a plain
// array for any older consumer; `damage:active` carries the object.
function damageViews() {
  return {
    all: damageEngine.getActive(Date.now(), 'all'),
    group: damageEngine.getActive(Date.now(), 'group'),
    mine: damageEngine.getActive(Date.now(), 'mine'),
  };
}
damageEngine.on('activeChanged', () => {
  broadcast('damage:active', damageViews());
  sessionRestore.scheduleSave();
});
// Backlog #33 - the named-kill board. Each row becomes an infinite buff-shaped tile (killed ones
// flagged so overlay.js can dim them); a row with a live respawn countdown carries remainingSec.
raidNamedTracker.on('changed', (rows) => broadcast('raidNamed:active', rows.map(raidNamedTile)));
firstAggroEngine.on('changed', (rows) => {
  broadcast('firstAggro:active', rows.map(firstAggroTile));
  sessionRestore.scheduleSave();
});
// One line - who took the first hit of the fight. An infinite, buff-shaped tile styled
// like a travel-guide leg (no category border, no countdown). `side` lets overlay.js
// colour a body-pull ('mob') differently from a clean pull.
function firstAggroTile(row) {
  return {
    name: row.text,
    id: 'first-aggro',
    valueText: '',
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
    firstAggroSide: row.side,
  };
}
function raidNamedTile(row) {
  return {
    name: row.name,
    tier: row.tier,
    killed: row.killed,
    infinite: row.respawnRemainingSec == null,
    remainingSec: row.respawnRemainingSec,
    durationSec: null,
    iconUrl: null,
    showOnOverlay: true,
    spellCategory: 'buff',
  };
}

/**
 * Note 20's destination command, redesigned 26 Aug. The original version (the owner's own design, 23
 * August) read the exact word typed as a possible zone name - "/tell qeynos" - which needed
 * knowing the game's own short name for the place and, worse, meant an ORDINARY /tell to an
 * offline GUILDMATE could look like a travel command. Confirmed directly: "Freeport" is also a
 * real zone name AND a real person could be named it - there is no way to tell those apart from
 * the log line alone. So the app no longer reads /tell's target as a zone name at all. The only
 * thing it reacts to is one word, user-configurable (added 26 Aug so anyone can trade the default
 * short word for a longer, collision-proof one, or the reverse, without needing a code change) -
 * defaults to "eqtm", short at the owner's own explicit call after weighing it against a longer
 * word past EverQuest's 15-letter name cap (immune to collision but slower to type). Persisted the
 * same way debugLogEnabled is - loaded once into a plain variable, updated in place by its own IPC
 * handler. Everything but this one word is left alone, full stop, so a normal social /tell that
 * happens to fail never touches this aura.
 */
let travelPickerCommand = loadJson('travelPickerCommand', 'eqtm');

/**
 * The current zone/destination picker popup - see zonePromptPopup.js and src/renderer/zone-prompt.
 * A standalone always-on-top window the player answers by clicking a zone from a searchable list,
 * same shape as ambiguousPopup, just for zones instead of ambiguous casts.
 */
let pendingZonePrompt = null; // { mode: 'destination' | 'currentZone' } | null

function hasTravelWidget() {
  return widgetManager.getAllWidgetConfigs().some((w) => w.buffSource === 'travel');
}

function openZonePrompt(mode) {
  if (!hasTravelWidget()) return;
  pendingZonePrompt = { mode };
  broadcast('travel:zonePrompt', pendingZonePrompt);
  zonePromptPopup.updateVisibility(pendingZonePrompt);
}

function closeZonePrompt() {
  pendingZonePrompt = null;
  broadcast('travel:zonePrompt', null);
  zonePromptPopup.updateVisibility(null);
}

// P3-4, travel-guide half. The ambiguous-cast popup is `focusable: false` so it never takes focus
// at all - the zone-prompt popup CAN'T be, because the user types a zone name into its search box,
// which needs keyboard focus. So this is the equivalent: once the interaction is over and there's
// nothing left to ask, hand focus back to EQ. Guarded on `pendingZonePrompt` so a chained
// follow-up (destination picked -> "and where are you now?") doesn't flick focus out and back.
// Best-effort and not awaited, same as the ambiguous popup's call.
function returnFocusAfterZonePrompt() {
  if (!pendingZonePrompt) focusGameWindow();
}

// Chained after a destination is set: the other half of a route is where you're coming from, and
// nothing ever replays zone history at startup (same limitation as currentlyMemorized), so this is
// the one moment - right after the player has shown they're actively using the travel aura - worth
// asking rather than leaving the aura stuck on "Waiting for a zone line" until they happen to walk
// through one.
function maybePromptCurrentZone() {
  if (hasTravelWidget() && !widgetManager.getCurrentZone()) openZonePrompt('currentZone');
}

// The reverse chain: answering "where are you now" always moves straight into picking a
// destination next - UNCONDITIONALLY, not just when none is set yet. Reported live: typing the
// command with an old destination already active, answering the current-zone question, and having
// it just close - leaving the STALE destination silently active - is exactly the "quietly wrong"
// failure this project avoids everywhere else. Typing the command at all is a clear signal the
// player wants to interact with travel right now, so the natural next step is always offered
// rather than assumed unnecessary.
function promptDestinationNext() {
  openZonePrompt('destination');
}

onLogLine('travelCommand', (line) => {
  const typed = matchOfflineTell(line);
  if (!typed) return;
  // Anything but the exact fixed word is an ORDINARY /tell - to a real person, who is really
  // offline - and this aura has nothing to do with it. No fallback zone-name matching any more;
  // see the comment above for why that used to fire on a coincidence.
  if (typed.toLowerCase() !== travelPickerCommand) return;
  // The same command closes the popup if it's already open - a second one is read as "never
  // mind", not "ask again", so there is one command to remember either way.
  if (pendingZonePrompt) {
    debugLog(`TRAVEL picker closed by /tell ${typed}`);
    closeZonePrompt();
    returnFocusAfterZonePrompt();
    return;
  }
  // Reported live: after a restart (currentZone always resets - nothing replays log history) an
  // aura sitting in one place the whole session (a dungeon, camped) never gets a fresh zone line,
  // so it was stuck on "Waiting for a zone line" with no way back in - the command only ever
  // opened the DESTINATION popup, which does nothing for a zone that's already set. Now the
  // command asks whichever question is actually blocking the aura: if the zone is unknown, that's
  // it regardless of whether a destination exists yet; only once the zone is known does it fall
  // back to asking for a destination.
  if (hasTravelWidget() && !widgetManager.getCurrentZone()) {
    debugLog(`TRAVEL current-zone picker opened by /tell ${typed}`);
    openZonePrompt('currentZone');
    return;
  }
  debugLog(`TRAVEL destination picker opened by /tell ${typed}`);
  openZonePrompt('destination');
});

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

  // Reported live, in the strongest possible terms: idle means GONE - no text, no tile, nothing on
  // screen, not even an explanatory placeholder. This overrides every other rule in this function,
  // including a currently-open picker - setting up a destination is not the same as having one,
  // and the popup window (not this aura) is what represents that in-progress state. The only way
  // back onto the screen is an actual destination, set through the popup.
  if (!widget.travelDestination) return [];

  // Where you are, at the top of every state below now that there IS something being tracked.
  // Empty when zone is unknown rather than printing "unknown" - the row underneath already says
  // that in its own words ("Waiting for a zone line").
  const zoneHeader = zone ? [row(`Current zone: ${zone}`, '')] : [];

  // A live popup question comes next - it's the most urgent of these, since the app is actively
  // waiting on an answer rather than just waiting on the player to do something. Only reachable
  // here for the currentZone case in practice (a destination-mode prompt with a destination
  // already set means the player is CHANGING it, which still counts as tracking).
  // No valueText on either row, on purpose - reported live that "/tell eqtm opened it" crowded
  // out the name column and truncated "Pick your destination" mid-word. Nothing useful was lost:
  // the popup itself is what the player is looking at right now.
  if (pendingZonePrompt) {
    return [
      ...zoneHeader,
      pendingZonePrompt.mode === 'destination'
        ? row('Pick your destination in the popup', '')
        : row('Pick your current zone in the popup', ''),
    ];
  }
  if (!zone) return [row('Waiting for a zone line', 'walk through one')];

  const result = findRoute(zone, widget.travelDestination, { scribedSpells: scribed });
  if (result.reason === 'already-there') {
    // Auto-close: the destination has been reached, so it's cleared right away rather than
    // sitting on "You are in X" forever - the aura falls straight back to its idle "Pick a
    // destination" state the very next time this runs (the 1s tick, or the next zone line).
    const destination = widget.travelDestination;
    widgetManager.setTravelDestination(widget.id, '');
    return [...zoneHeader, row(`You are in ${destination}`, '')];
  }
  if (!result.ok) {
    return [...zoneHeader, row(`No route to ${widget.travelDestination}`, result.reason === 'unknown-zone' ? 'unknown zone' : '')];
  }
  return [...zoneHeader, ...result.legs.map((leg, i) => row(describeLeg(leg), `${i + 1}/${result.legs.length}`))];
}

// One place that both recomputes and sends, so no caller can do one without the other.
function pushTravelRoutes() {
  broadcast('travel:routes', travelRoutes());
}

// -------------------------------------------------------------------------------------------------
// The raid-lockout aura (owner request, 2 Sep 2026). Transient: the player's macro sends
// `/tell <word>`, the board pops for `lockoutAutoHideSec`, then it clears itself. Same broadcast
// shape as travel routes - one { widgetId: rows } map, each overlay picks its own id out - and the
// same reasoning for living in the main process: the overlay can't require lockoutBoard.js
// (lockoutBoardRows is required at the top of this file).
const lockoutShownUntil = new Map(); // widget id -> ms timestamp to hide at
let lockoutHideTimer = null;

function hasLockoutWidget() {
  return widgetManager.getAllWidgetConfigs().some((w) => w.buffSource === 'lockout');
}

// One board row -> a buff-shaped tile the overlay can draw. Same field shape as a travel-guide
// leg (travelRowsFor's row()): no spell category (so no coloured border), a blank valueText (so
// no infinity glyph on the right), no bar. Zone/character headers are flagged so overlay.js can
// style them bold; a tier row's `name` is "d3 · Adaptive".
function lockoutTile(row, i) {
  return {
    name: row.label,
    // "d1 · Normal" repeats across zones, so a name-only identity would collide (gotcha #13). The
    // list is a fixed zone-then-tier order rebuilt wholesale each push, so a positional id is
    // stable enough and unique.
    id: `lockout-${i}`,
    valueText: '',
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
    lockoutHeader: row.kind === 'zone' || row.kind === 'character',
    lockoutKind: row.kind,
  };
}

function lockoutBoardRoutes() {
  const now = Date.now();
  // getProjection() just reads the parsed states. It's only called when a board is actually shown
  // (an unshown aura short-circuits to [] first), so the 1s heartbeat below costs nothing at idle.
  let projection = null;
  const out = {};
  for (const w of widgetManager.getAllWidgetConfigs()) {
    if (w.buffSource !== 'lockout') continue;
    if ((lockoutShownUntil.get(w.id) || 0) <= now) { out[w.id] = []; continue; }
    if (!projection) {
      try { projection = lockoutService.getProjection(); } catch { projection = { characters: [] }; }
    }
    out[w.id] = lockoutBoardRows(projection).map((row, i) => lockoutTile(row, i));
  }
  return out;
}

// The board only ever reaches the overlay through here, and only when it has actually changed -
// the 1s heartbeat and the lockoutService 'changed' event both call this, and without the dedupe
// the overlay would rebuild its tile list every second (a visible flash). Reported live.
let lastLockoutBoardJSON = null;
function pushLockoutBoard() {
  const board = lockoutBoardRoutes();
  const json = JSON.stringify(board);
  if (json !== lastLockoutBoardJSON) {
    lastLockoutBoardJSON = json;
    broadcast('lockout:board', board);
    const summary = Object.entries(board).map(([id, rows]) => `${id.slice(0, 8)}:${rows.length}`).join(' ');
    debugLog(`LOCKOUT board broadcast -> ${summary || '(no lockout auras)'}`);
  }
  // Re-arm a single timer for the soonest hide, so a board clears itself even with no further
  // log activity. One timer for all lockout auras - they rarely overlap and the recompute is tiny.
  if (lockoutHideTimer) { clearTimeout(lockoutHideTimer); lockoutHideTimer = null; }
  const now = Date.now();
  const next = [...lockoutShownUntil.values()].filter((t) => t > now).sort((a, b) => a - b)[0];
  if (next) lockoutHideTimer = setTimeout(pushLockoutBoard, Math.max(250, next - now));
}

function popLockoutBoard(word) {
  const now = Date.now();
  const mine = widgetManager.getAllWidgetConfigs()
    .filter((w) => w.buffSource === 'lockout' && (w.lockoutTriggerWord || 'eqrlm') === word);
  if (!mine.length) return false;

  // A second `/tell <word>` while it's up is "never mind" - one command both ways, like the
  // travel picker.
  if (mine.some((w) => (lockoutShownUntil.get(w.id) || 0) > now)) {
    for (const w of mine) lockoutShownUntil.delete(w.id);
    debugLog(`LOCKOUT board dismissed by /tell ${word}`);
    pushLockoutBoard();
    return true;
  }

  // Reveal only once the grid scan has FINISHED. Showing it mid-scan renders a half-parsed board
  // (every tier looks owed) that then visibly shrinks as backfill marks tiers completed - reported
  // live as "it flashes with every single lockout before truncating the list". One push, final
  // content.
  const reveal = () => {
    const t = Date.now();
    for (const w of mine) lockoutShownUntil.set(w.id, t + (w.lockoutAutoHideSec || 20) * 1000);
    debugLog(`LOCKOUT board opened by /tell ${word}`);
    pushLockoutBoard();
  };
  if (lockoutService.backfillState === 'done') {
    reveal();
  } else if (lockoutService.backfillState === 'running') {
    const waitDone = () => {
      if (lockoutService.backfillState === 'running') lockoutService.once('backfillChanged', waitDone);
      else reveal();
    };
    lockoutService.once('backfillChanged', waitDone);
  } else {
    lockoutService.backfill().then(reveal, reveal);
  }
  return true;
}

onLogLine('lockoutCommand', (line) => {
  if (!hasLockoutWidget()) return;
  const typed = matchOfflineTell(line);
  if (!typed) return;
  const word = typed.toLowerCase();
  const wanted = new Set(
    widgetManager.getAllWidgetConfigs()
      .filter((w) => w.buffSource === 'lockout')
      .map((w) => (w.lockoutTriggerWord || 'eqrlm'))
  );
  if (wanted.has(word)) {
    popLockoutBoard(word);
  } else {
    debugLog(`LOCKOUT /tell "${word}" seen but no lockout aura uses it (words in use: ${[...wanted].join(', ') || 'none'})`);
  }
});
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
  petTracker.tick();
  abilityGroupTracker.sweep();
  // Note 20. Catches the two inputs that change without a zone line - editing the destination and
  // scribing a travel spell. Cheap: a breadth-first search over 104 nodes, only for auras that are
  // actually travel guides, and almost always zero of them.
  pushTravelRoutes();
  // The raid-lockout aura is transient (a shown board clears itself when its timer lapses), so it
  // needs a heartbeat to notice that lapse and to give a freshly-created aura window its first
  // (empty) push. Same cost profile as the travel push - a handful of small maps.
  pushLockoutBoard();
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

// Module-level, not a local inside whenReady - Electron destroys a Tray the moment its JS object
// is garbage collected, and a function-local const would be eligible for GC as soon as
// app.whenReady().then(...) returns.
let appTray = null;

app.whenReady().then(() => {
  iconService.registerProtocol();
  soundService.registerProtocol();
  // #39 - copy the shipped starter tones into userData/sounds/ so they survive uninstall and sit
  // next to your auras. Idempotent; leaves your own files and any starter you deleted alone.
  soundService.seedStarterSounds();
  createMainWindow();

  // Requested directly, alongside making the window's own close button hide-to-tray instead of
  // quitting (see mainWindow.js's own comment on that history) - a real Quit item is what makes
  // hiding safe instead of just recreating the old "invisible orphan process" problem under a new
  // name. Left-clicking the tray icon itself (not just the menu) also reopens the window, since
  // that click reads as the more natural affordance than requiring right-click every time.
  appTray = new Tray(buildTrayIcon());
  appTray.setToolTip('EQLS Auras');
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show EQLS Auras', click: () => createMainWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  appTray.on('click', () => createMainWindow());
  widgetManager.initWidgets();
  actionBarManager.initActionBars();
  logService.init();
  // NO ROTATION CALL HERE, deliberately. It used to run one line below this, and at that moment the
  // watcher has just opened the log at the end and seen nothing, so the ten-second quiet check
  // cannot mean anything yet and passes for any log at all - including one the game is actively
  // writing to. The minute timer above covers the same case a moment later, by which time silence
  // is evidence instead of ignorance.
  // Part of the shutdown instrumentation above. Closing the main window no longer always means
  // quitting (see mainWindow.js - it hides to the tray unless app.quit() is already underway), so
  // this now logs on every hide-to-tray too, not just a real shutdown - still useful context for a
  // report, just not proof of a quit on its own the way it used to be.
  const win = getMainWindow();
  if (win) {
    win.on('close', () => debugLog('SHUTDOWN: main window close event (hide-to-tray unless a quit is already underway)'));
    win.webContents.on('unresponsive', () => debugLog('SHUTDOWN WARNING: main window renderer unresponsive'));
  }

  registerHideHotkey(hideHotkeyChoice, toggleMasterHidden);

  applyInstallRoot(logService.getState().eqFolder);

  // Put back whatever was still running when the app last closed - see sessionRestore.js. Every
  // registered part (timers, damage meter, first-aggro, group roster) restores here, each within
  // its own staleness limit. Deliberately after applyInstallRoot so the roster is fully
  // backfilled/tagged first: a restored buff is looked up by name for its icon, and doing this
  // earlier would restore entries the roster doesn't know about yet.
  sessionRestore.restoreAll();

  // Recover the current zone from the log tail. logWatcher started at EOF and will never see the
  // "You have entered X." line if the player zoned while the app was down, which otherwise leaves
  // the raid-named board, zone-gated aura visibility and the travel guide's current zone all blind
  // until the next zone change. A zone line is unambiguous, so unlike a buff it is safe to read
  // back. Deferred off the ready handler so a large log's tail scan never delays startup.
  setImmediate(() => {
    const logPath = logService.watcher.getStatus().currentFilePath;
    if (!logPath) return;
    const found = readLastZoneEntry(logPath);
    if (!found) return;
    applyZoneChangeAndNotify(found.zone);
    raidNamedTracker.setZone(found.zone, found.viaVoidling);
    customTimerEngine.seedZone(found.zone);
    pushTravelRoutes();
    debugLog(
      `ZONE recovered on startup: "${found.zone}" (from the log tail` +
      (found.viaVoidling ? ', raid entry confirmed)' : ')')
    );
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Raid lockouts. The scan is LAZY - it runs the first time the page is opened and not before, so
// a user who never opens it pays nothing at startup. It is idempotent by the module's own
// contract, so overlapping the live tailer is safe and re-running it costs only time.
ipcMain.handle('logRotation:getStatus', () => logRotationService.getStatus());
ipcMain.handle('logRotation:setEnabled', (_event, enabled) => {
  logRotationService.setEnabled(enabled);
  return logRotationService.getStatus();
});

ipcMain.handle('lockoutReset:get', () => lockoutService.resetRule);
ipcMain.handle('lockoutReset:set', (_event, rule) => {
  const applied = applyResetRule(rule);
  // Push to every open window so the Lockouts page and the Setup page stay in step, and rebuild
  // the grid under the new boundary.
  broadcast('lockoutReset:changed', applied);
  broadcast('lockouts:changed', lockoutService.getStatus());
  return applied;
});
// If a stored "Change log file" target has gone missing, backfill drops it - persist that.
function persistTargetIfCleared(r) {
  if (r && r.targetCleared) saveJson('lockoutLogTarget', { path: null });
  return r;
}

ipcMain.handle('lockouts:get', async () => {
  if (lockoutService.backfillState === 'idle') persistTargetIfCleared(await lockoutService.backfill());
  return lockoutService.getProjection();
});
ipcMain.handle('lockouts:rescan', async () => {
  persistTargetIfCleared(await lockoutService.rebuild());
  return lockoutService.getProjection();
});

// --- Lockouts-page log tools. NO OS dialogs - the renderer drives in-app modals; these handlers
//     just list files and act on paths the renderer sends back. ---

function lockoutLogsFolder() {
  const p = logService.watcher.getStatus().currentFilePath;
  return p ? path.dirname(p) : (logService.watcher.getStatus().logsFolder || null);
}

function listLogFilesIn(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((n) => /\.txt$/i.test(n) && /eqlog/i.test(n))
      .map((n) => {
        const full = path.join(dir, n);
        let st;
        try { st = fs.statSync(full); } catch (e) { st = null; }
        return { name: n, path: full, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    return [];
  }
}

// What the in-app picker shows: the live folder, the per-day Split folder, the weekly Archive.
ipcMain.handle('lockouts:listLogFiles', () => {
  const folder = lockoutLogsFolder();
  if (!folder) return { live: [], split: [], archive: [] };
  return {
    live: listLogFilesIn(folder),
    split: listLogFilesIn(path.join(folder, 'Split')),
    archive: listLogFilesIn(path.join(folder, 'Archive')),
  };
});

ipcMain.handle('lockouts:setLogTargetByPath', async (_event, filePath) => {
  lockoutService.setLogTarget(filePath || null);
  saveJson('lockoutLogTarget', { path: filePath || null });
  persistTargetIfCleared(await lockoutService.rebuild());
  return lockoutService.getProjection();
});

// Feed extra files (the Split/ files covering a gap) into the current grid. Does NOT touch the
// live log - it only adds to what the parser has seen this session.
ipcMain.handle('lockouts:addLogsByPaths', async (_event, paths) => {
  const added = await lockoutService.addLogs(Array.isArray(paths) ? paths : []);
  return { projection: lockoutService.getProjection(), added };
});

// Split the watched log at this week's reset. The renderer has already confirmed in an in-app
// modal; this just does it and rebuilds the grid.
ipcMain.handle('lockouts:trim', async () => {
  // Only the LIVE tailed log - never a file loaded via "Change log file" (that would rewrite an
  // archive or a mule's log). The renderer hides the button in that case; this is the backstop.
  const watched = logService.watcher.getStatus().currentFilePath;
  if (lockoutService.logTarget && lockoutService.logTarget !== watched) {
    return { report: { ok: false, reason: 'trim only works on your live log - switch back to it first' }, projection: lockoutService.getProjection() };
  }
  // The splitter must be caught up first, or the still-unsplit tail is lost when the file is
  // rewritten. It polls every second, so "try again" clears in a moment.
  if (logService.splitter.bytesBehind() > 0) {
    return { report: { ok: false, reason: 'the day-file split is catching up - try again in a moment' }, projection: lockoutService.getProjection() };
  }

  const report = logRotationService.trimAtBoundary(watched);
  if (report.ok) {
    // The file was rewritten in place, not emptied - point the tailer and the splitter at the new
    // end so they do not re-read (and re-emit / re-split) the kept week. See bug #1.
    logService.watcher.resyncOffset(watched, report.keptBytes);
    logService.splitter.resyncOffset(watched, report.keptBytes);
    await lockoutService.rebuild();
    // The log just shrank - a later regrowth past the threshold is a fresh event worth nudging on.
    saveJson('logArchivePromptDismissedAt', 0);
  }
  return { report, projection: lockoutService.getProjection() };
});

ipcMain.handle('log:getState', () => logService.getState());
// QOL #9 - current exclusive-fullscreen state, for the Buff Tracker page's warning line on load
// (the push channel overlay:fullscreenWarning keeps it current after that). null when the
// foreground watcher is off (auto-hide disabled) - nothing is polling, so we genuinely don't know.
ipcMain.handle('overlay:fullscreenState', () =>
  foregroundWatcher.lastState ? !!foregroundWatcher.lastState.foregroundFullscreen : null
);
// P3-2 - false once the foreground probe has failed repeatedly and the watcher stopped itself.
// true otherwise (including while auto-hide is simply turned off - nothing is broken then).
ipcMain.handle('overlay:autoHideAvailable', () => !foregroundWatcher.unavailable);
// QOL #5 - the "is it working right now?" readout on the Buff Tracker page. Which file is being
// tailed and how long since a line last arrived from it.
ipcMain.handle('log:activity', () => {
  const s = logService.watcher.getStatus();
  return {
    file: s.currentFilePath ? path.basename(s.currentFilePath) : null,
    folderSet: !!(s.logsFolder || s.currentFilePath),
    sawLine: sawFirstLogLine,
    lastLineAgoMs: sawFirstLogLine ? Date.now() - lastLogLineAt : null,
  };
});
ipcMain.handle('log:chooseFolder', async () => {
  const state = await logService.chooseFolder();
  applyInstallRoot(state.eqFolder);
  return state;
});
ipcMain.handle('log:setSplitEnabled', (_event, enabled) => logService.setSplitEnabled(enabled));
ipcMain.handle('log:setSplitDayStartHour', (_event, hour) => logService.setSplitDayStartHour(hour));
ipcMain.handle('log:chooseSplitFolder', () => logService.chooseSplitFolder());
ipcMain.handle('log:resetSplitFolder', () => logService.resetSplitFolder());
ipcMain.handle('log:openFolder', () => logService.openLogFolder());
// Whether archiving the whole log right now would take this lockout week's kills with it - the
// renderer uses this to word its in-app confirm.
ipcMain.handle('log:archiveHoldsCurrentWeek', () =>
  logRotationService.logHoldsCurrentWeek(logService.watcher.getStatus().currentFilePath));

// QOL #24 - a once-on-launch nudge when the live log has grown past the archive threshold (50 MB,
// logService.ARCHIVE_PROMPT_THRESHOLD_BYTES). It must fire even for someone who has never archived,
// so it keys purely off current size, not on any calendar or rotation timing. The renderer's modal
// steers toward "Trim to this week" (lockout-safe) rather than a whole-log archive. Re-nudged at
// most once a week so it is not every-launch nagging.
const LAUNCH_ARCHIVE_RENUDGE_MS = 7 * 24 * 60 * 60 * 1000;
ipcMain.handle('log:launchArchiveCheck', () => {
  const state = logService.getState();
  if (!state.shouldPromptArchive) return { prompt: false };
  const dismissedAt = Number(loadJson('logArchivePromptDismissedAt', 0)) || 0;
  if (dismissedAt && Date.now() - dismissedAt < LAUNCH_ARCHIVE_RENUDGE_MS) return { prompt: false };
  return {
    prompt: true,
    sizeBytes: state.fileSizeBytes,
    holdsCurrentWeek: logRotationService.logHoldsCurrentWeek(state.currentFilePath),
  };
});
ipcMain.handle('log:dismissArchivePrompt', () => {
  saveJson('logArchivePromptDismissedAt', Date.now());
  return { ok: true };
});

ipcMain.handle('log:archiveNow', async () => {
  // The renderer has already confirmed in an in-app modal (and warned if this holds the lockout
  // week). The archive empties the same log the lockout grid is built from, so the grid is rebuilt
  // from what is now there - exactly as the weekly rotation does.
  const result = logService.archiveNow();
  await lockoutService.rebuild();
  broadcast('lockouts:changed', lockoutService.getStatus());
  if (result && result.ok) saveJson('logArchivePromptDismissedAt', 0); // see QOL #24
  return result;
});
ipcMain.handle('log:openArchiveFolder', () => logService.openArchiveFolder());

ipcMain.handle('buffs:getActive', () => buffEngine.getActiveBuffs());
ipcMain.handle('buffs:getActiveAllies', () => buffEngine.getActiveAllyBuffs());
ipcMain.handle('buffs:getActiveBardSongs', () => buffEngine.getActiveBardSongs());
ipcMain.handle('buffs:removeActiveBardSong', (_event, { castBy, name }) => buffEngine.removeActiveBardSong(castBy, name));

ipcMain.handle('damage:getActive', () => damageViews());
ipcMain.handle('raidNamed:getActive', () => raidNamedTracker.getActive().map(raidNamedTile));
ipcMain.handle('firstAggro:getActive', () => firstAggroEngine.getActive().map(firstAggroTile));
ipcMain.handle('travel:getRoutes', () => travelRoutes());
ipcMain.handle('lockout:getBoard', () => lockoutBoardRoutes());
ipcMain.handle('travel:getZones', () => allZoneNames());
// Used only by the zone-prompt popup's pick list - no instance-tier variants (" (Awakened)",
// " (Fused)"), at the owner's request. `travel:getZones` above is untouched for anything that
// still wants every zone including tiers.
ipcMain.handle('travel:getPickableZones', () => pickableZoneNames());
// The eqtm picker's search - display-name substring + community nicknames + boss names + client
// short names, unioned (QOL #30). Zone-prompt renderer calls this per keystroke.
ipcMain.handle('travel:searchZones', (_event, query) => searchPickableZones(query));
ipcMain.handle('travel:getPickerCommand', () => travelPickerCommand);
ipcMain.handle('travel:setPickerCommand', (_event, word) => {
  // Letters only, matching what a /tell name can even contain (matchOfflineTell's own pattern) -
  // an empty result (nothing typed, or nothing but stripped characters) falls back to the
  // default rather than leaving the command permanently unreachable.
  const cleaned = (typeof word === 'string' ? word : '').trim().toLowerCase().replace(/[^a-z]/g, '');
  travelPickerCommand = cleaned || 'eqtm';
  saveJson('travelPickerCommand', travelPickerCommand);
  return travelPickerCommand;
});
ipcMain.handle('travel:getZonePrompt', () => pendingZonePrompt);
ipcMain.handle('travel:resolveZonePrompt', (_event, { mode, zone }) => {
  if (!zone) return;
  if (mode === 'destination') {
    for (const w of widgetManager.getAllWidgetConfigs()) {
      if (w.buffSource === 'travel') widgetManager.setTravelDestination(w.id, zone);
    }
    debugLog(`TRAVEL destination set to "${zone}" via picker`);
    closeZonePrompt();
    maybePromptCurrentZone();
  } else if (mode === 'currentZone') {
    applyZoneChangeAndNotify(zone);
    debugLog(`ZONE set to "${zone}" via picker (self-reported, no log line seen yet)`);
    closeZonePrompt();
    promptDestinationNext();
  }
  pushTravelRoutes();
  returnFocusAfterZonePrompt();
});
ipcMain.handle('travel:dismissZonePrompt', () => {
  closeZonePrompt();
  returnFocusAfterZonePrompt();
});
// Reported live: closing the destination popup without picking a new zone left the OLD
// destination active, and there was no way to actually stop tracking one at all - "Stop tracking"
// in the popup is that missing action, distinct from the dismiss button (cancel vs. clear).
ipcMain.handle('travel:stopTracking', () => {
  for (const w of widgetManager.getAllWidgetConfigs()) {
    if (w.buffSource === 'travel') widgetManager.setTravelDestination(w.id, '');
  }
  debugLog('TRAVEL destination cleared via "Stop tracking"');
  closeZonePrompt();
  pushTravelRoutes();
  returnFocusAfterZonePrompt();
});
// Reported live: an accidentally-wrong current zone had no way back in short of walking to a real
// zone line, because the /tell command only ever opens the currentZone picker when the zone is
// UNKNOWN - once it's set (even wrongly), the command falls back to the destination picker
// instead. This is the escape hatch: force the currentZone picker open regardless of
// whether the app already believes it knows one.
ipcMain.handle('travel:correctCurrentZone', () => {
  debugLog('TRAVEL current-zone picker force-opened to correct it');
  openZonePrompt('currentZone');
});
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

// Defaults ON, at the owner's request. Only the DEFAULT changed - anyone who has deliberately
// switched it off has `false` stored and keeps it, because the stored value is read first and
// this fallback is reached only when the setting has never been touched.
// QOL #50 - the Buff Tracker "finish setting up" checklist, dismissed for good once the user
// clicks it away (a per-machine nag, not something to carry between installs).
// First-run setup wizard - shown once, then re-openable from the Setup page.
ipcMain.handle('ui:getSetupWizardDone', () => loadJson('setupWizardDone', false) === true);
ipcMain.handle('ui:setSetupWizardDone', (_event, done) => {
  saveJson('setupWizardDone', done !== false);
  return true;
});
ipcMain.handle('ui:getSetupNudgeDismissed', () => loadJson('setupNudgeDismissed', false) === true);
ipcMain.handle('ui:dismissSetupNudge', () => {
  saveJson('setupNudgeDismissed', true);
  return true;
});

ipcMain.handle('ui:getTradePing', () => loadJson('tradePingEnabled', true) === true);
ipcMain.handle('ui:setTradePing', (_event, enabled) => {
  const on = enabled === true;
  saveJson('tradePingEnabled', on);
  return on;
});

ipcMain.handle('ui:getTellPing', () => loadJson('tellPingEnabled', false) === true);
ipcMain.handle('ui:setTellPing', (_event, enabled) => {
  const on = enabled === true;
  saveJson('tellPingEnabled', on);
  return on;
});

// Reported as missing the day tell pings shipped: a burst of tells (a busy conversation, or
// someone spamming) machine-gunned the sound with no rate limit at all. 3s default - long enough
// to silence a rapid burst, short enough that two genuinely separate tells a few seconds apart
// both still ping. 0 means off - every tell pings, however close together, same as before this
// existed. The actual rate-limiting happens in the renderer's own onLogLine handler (see
// tellShouldPing in the main-window renderer), which is the only place that already tracks tell
// lines; this is just the stored setting.
ipcMain.handle('ui:getTellPingCooldownSec', () => {
  const v = loadJson('tellPingCooldownSec', 3);
  return typeof v === 'number' && v >= 0 ? v : 3;
});
ipcMain.handle('ui:setTellPingCooldownSec', (_event, seconds) => {
  const v = Math.max(0, Math.min(30, Number(seconds) || 0));
  saveJson('tellPingCooldownSec', v);
  return v;
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

ipcMain.handle('settings:getUseEvidenceModel', () => loadJson('useEvidenceModel', true));
ipcMain.handle('settings:setUseEvidenceModel', (_event, enabled) => {
  saveJson('useEvidenceModel', enabled);
  buffEngine.setUseEvidenceModel(enabled);
  return enabled;
});

ipcMain.handle('settings:getUseCastTimeFilter', () => loadJson('useCastTimeFilter', false));
ipcMain.handle('settings:setUseCastTimeFilter', (_event, enabled) => {
  saveJson('useCastTimeFilter', enabled);
  buffEngine.setUseCastTimeFilter(enabled);
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
    actionBarManager.setForegroundState({ autoHideEnabled: false, eqFocused: true, ownAppFocused: false });
  }
  return autoHideOverlayEnabled;
});
ipcMain.handle('overlay:getMasterState', () => ({
  allUnlocked: widgetManager.areAllUnlocked(),
  masterHidden: widgetManager.isMasterHidden(),
  soundsMuted: widgetManager.isSoundsMuted(),
  previewAll: widgetManager.isPreviewAll(),
  previewAny: widgetManager.isPreviewAny(), // the button toggles on this - "any on" -> one press clears all
  suspendedMove: suspendedMove ? suspendedMove.kind : null,
}));
ipcMain.handle('overlay:setPreviewAll', (_event, enabled) => {
  widgetManager.setPreviewAll(!!enabled);
  return widgetManager.isPreviewAny();
});
// "Back to moving auras" - the pad's centre button opened a settings page and stashed the move
// session; put it back exactly as it was.
ipcMain.handle('move:resume', () => {
  const s = suspendedMove;
  suspendedMove = null;
  if (!s) { notifyMasterState(); return { resumed: false }; }
  if (s.kind === 'all') {
    widgetManager.setAllUnlocked(true);
    enterUnlockAllMode({ keepSuspended: true });
    notifyMasterState();
  } else {
    enterMoveMode(s.moveKind, s.id, { keepSuspended: true });
  }
  return { resumed: true };
});
ipcMain.handle('overlay:setMasterHidden', (_event, hidden) => {
  actionBarManager.setMasterHidden(hidden);
  return widgetManager.setMasterHidden(hidden);
});
// QOL #10 - global mute for every aura's alert sounds.
ipcMain.handle('overlay:setSoundsMuted', (_event, muted) => widgetManager.setSoundsMuted(muted));
ipcMain.handle('overlay:setAllUnlocked', (_event, unlocked) => {
  // The shared step/snap HUD rides with "Unlock all" - opened here, and every box gets its own
  // nudge pad. A single-aura "Move…" that was left open (e.g. its centre button opened settings
  // without a Done) is torn down first, so the two move modes never overlap.
  if (unlocked) {
    if (hudMode === 'single') exitMoveMode();
    const res = widgetManager.setAllUnlocked(true);
    enterUnlockAllMode(); // clears any suspended move - this is a fresh session
    return res;
  }
  const res = widgetManager.setAllUnlocked(false);
  if (hudMode === 'all') exitUnlockAllMode();
  if (suspendedMove) { suspendedMove = null; notifyMasterState(); }
  return res;
});
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

function spellbookState() {
  return {
    filePath: spellbookService.getFilePath(),
    spellCount: spellbookService.getCount(),
    ...spellbookService.getExpectation(),
  };
}
ipcMain.handle('spellbook:getState', spellbookState);
// QOL #14 - the manually entered character/server for the spellbook.
ipcMain.handle('spellbook:getCharacter', () => ({ ...spellbookChar }));
ipcMain.handle('spellbook:setCharacter', (_event, { name, server }) => {
  spellbookChar = { name: String(name || '').trim(), server: String(server || '').trim() };
  saveJson('spellbookCharacter', spellbookChar);
  spellbookService.setCharacterOverride(spellbookCharBase(spellbookChar) || null);
  return spellbookState();
});
// The "Change spellbook file..." safety valve: list every *-Spellbook.txt in the install root,
// and pin one (or clear the pin with a falsy path). Own persisted key.
ipcMain.handle('spellbook:listCandidates', () => spellbookService.listCandidates());
ipcMain.handle('spellbook:setFileOverride', (_event, filePath) => {
  spellbookFileOverride = String(filePath || '');
  saveJson('spellbookFileOverride', spellbookFileOverride);
  spellbookService.setFileOverride(spellbookFileOverride || null);
  return spellbookState();
});
ipcMain.handle('spellbook:getMemorized', () => memorizedWithIcons());
ipcMain.handle('spellbook:forgetMemorized', (_event, name) => buffEngine.removeMemorized(name));
ipcMain.handle('spellbook:clearMemorized', () => buffEngine.clearMemorized());

ipcMain.handle('widget:list', () => widgetManager.getAllWidgetConfigs());
ipcMain.handle('widget:getConfig', (_event, id) => widgetManager.getWidgetConfig(id));
ipcMain.handle('widget:preview', (_event, id) => widgetManager.previewWidget(id));
ipcMain.handle('widget:isPreviewing', (_event, id) => widgetManager.isPreviewShown(id));
ipcMain.handle('widget:getPreviewMode', (_event, id) => widgetManager.isPreviewShown(id)); // overlay re-sync on load
// An overlay asks for this as it boots, the same way it asks for its lock state - a window
// created on demand would otherwise start out assuming it may make noise.
ipcMain.handle('widget:isAudible', (_event, id) => {
  const config = widgetManager.getWidgetConfig(id);
  return config ? widgetManager.shouldBeAudible(config) : true;
});
ipcMain.handle('widget:create', (_event, { name, buffSource }) => widgetManager.createCustomWidget(name, { buffSource }));
ipcMain.handle('widget:createAlly', (_event, { name }) => widgetManager.createAllyBuffsWidget(name));
ipcMain.handle('widget:createBardSongs', (_event, { name }) => widgetManager.createBardSongsWidget(name));
ipcMain.handle('widget:createRaidNamed', (_event, { name }) => widgetManager.createRaidNamedWidget(name));
ipcMain.handle('widget:createModuleAura', (_event, { name, moduleId }) => widgetManager.createModuleAuraWidget(name, moduleId));
ipcMain.handle('widget:createDebuff', (_event, { name }) => widgetManager.createDebuffWidget(name));
ipcMain.handle('widget:createDamageMeter', (_event, { name, mineOnly }) =>
  widgetManager.createDamageMeterWidget(name, mineOnly)
);
ipcMain.handle('widget:createLockoutBoard', (_event, { name }) =>
  widgetManager.createLockoutBoardWidget(name)
);
ipcMain.handle('widget:createFirstAggro', (_event, { name }) =>
  widgetManager.createFirstAggroWidget(name)
);
ipcMain.handle('widget:createTravelGuide', (_event, { name, destination }) =>
  widgetManager.createTravelGuideWidget(name, destination)
);
ipcMain.handle('widget:setTravelDestination', (_event, { id, destination }) => {
  const config = widgetManager.setTravelDestination(id, destination);
  pushTravelRoutes();
  return config;
});
ipcMain.handle('widget:createTextAura', (_event, { name, preset }) =>
  widgetManager.createTextAuraWidget(name, preset)
);
ipcMain.handle('widget:createBuffTimer', (_event, { name, spellName, source }) =>
  widgetManager.createBuffTimerWidget(name, spellName, source)
);
ipcMain.handle('widget:createCooldownTimer', (_event, { name, spellName, cooldownSec, iconId, buffDurationSec }) =>
  widgetManager.createCooldownTimerWidget(name, spellName, cooldownSec, iconId, buffDurationSec)
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

// Every spell name in the roster, for the "Skill cast" custom-timer trigger's search picker. A
// castOf trigger fires on "You begin casting X" / "You begin singing X" - it needs no landing
// text and no recast time, so it must NOT be filtered like buffs:castable (recast > 1.5s) or
// buffs:trackable (has a duration). That filtering was why bard songs and instants were missing
// from the picker. Reported live 30 Aug.
ipcMain.handle('buffs:allNames', () =>
  buffStore
    .getAll()
    .map((e) => ({ name: e.name, iconId: e.iconId ?? null, isBardSong: !!e.isBardSong }))
    .sort((a, b) => a.name.localeCompare(b.name))
);

// Only the spells that can actually be tracked, and which of the two ways each one supports.
// The picker needs this to avoid offering "on an ally" for a spell whose roster entry has no
// third-person landing text - that would build an aura which silently never lights up.
//
// Also requires a real duration (a fixed number of seconds, or infiniteDuration - "lasts until
// dispelled" is still a duration, just an unbounded one). Reported live 25 Aug: Anarchy, an
// Enchanter nuke with no duration at all, showing up in the Buff timer picker labelled "no
// duration" - "nukes are not buffs, remove them from the buff selection list. remove anything that
// does not have a duration for clarity." A no-duration entry only ever had landing text because
// the detection engine needs it for instant-event tracking (a sound/text flash, never a countdown)
// - genuinely useful for auras like Resist flash, but not what "pick one spell and get a duration
// timer for it" means here. Debuffs keep their entries here unaffected: a mez/charm/snare/slow
// genuinely has a duration in the roster (that's how "wears off" gets timed at all), so this only
// ever drops instants (nukes, heals, and the like), never a real trackable debuff.
ipcMain.handle('buffs:trackable', () =>
  buffStore
    .getAll()
    .filter((e) => e.landingText && String(e.landingText).trim())
    .filter((e) => (typeof e.durationSec === 'number' && e.durationSec > 0) || e.infiniteDuration)
    .map((e) => {
      const hasThirdPersonText = !!(e.othersLandingSuffix && String(e.othersLandingSuffix).trim());
      // A debuff, charm, dot or nuke landing on "not you" is something cast AT a target, never
      // something cast ON a groupmate - the log's "not you" line looks identical either way, but
      // the two are opposite in meaning. Reported directly: "allure is marked as a buff to cast
      // on an ally, it is not" - Allure is a charm (roster: kind 'det', scaleCategory 'charm') and
      // does carry third-person text ("<Name> has been charmed."), so before this fix `ally` was
      // true purely because the text existed, with nothing checking what KIND of landing it was.
      const isDetrimental = ['debuff', 'charm', 'dot', 'nuke'].includes(e.scaleCategory);
      return {
        name: e.name,
        ally: hasThirdPersonText && !isDetrimental,
        // Whether "on something you cast it at" can be offered. Needs the same third-person
        // landing text ally tracking needs, plus a category that means the spell is cast at
        // something rather than on someone. Offering it for a heal would build an aura that never
        // lights up; ally and enemy are the two halves of one split, never both true for one spell.
        enemy: hasThirdPersonText && isDetrimental,
        durationSec: typeof e.durationSec === 'number' ? e.durationSec : null,
        infinite: !!e.infiniteDuration,
      };
    })
);
ipcMain.handle('widget:setTextAuraMessage', (_event, { id, value }) =>
  widgetManager.setTextAuraMessage(id, value)
);
ipcMain.handle('widget:setTextAuraSize', (_event, { id, value }) => widgetManager.setTextAuraSize(id, value));
ipcMain.handle('widget:setTextAuraInstantSec', (_event, { id, value }) =>
  widgetManager.setTextAuraInstantSec(id, value)
);
ipcMain.handle('widget:setStackTextLines', (_event, { id, value }) =>
  widgetManager.setStackTextLines(id, value)
);
ipcMain.handle('widget:setMaxStackTextLines', (_event, { id, value }) =>
  widgetManager.setMaxStackTextLines(id, value)
);
ipcMain.handle('widget:setMergeSameDuration', (_event, { id, value }) =>
  widgetManager.setMergeSameDuration(id, value)
);
ipcMain.handle('widget:setCategoryBorders', (_event, { id, value }) =>
  widgetManager.setCategoryBorders(id, value)
);
ipcMain.handle('widget:setCategoryBorderWidth', (_event, { id, px }) =>
  widgetManager.setCategoryBorderWidth(id, px)
);
ipcMain.handle('widget:setTrackOnEnemies', (_event, { id, value }) =>
  widgetManager.setTrackOnEnemies(id, value)
);
ipcMain.handle('widget:setDebuffCastBy', (_event, { id, value }) =>
  widgetManager.setDebuffCastBy(id, value)
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
// The user's own choice (not necessarily what's bound - see registerHideHotkey's own comment on
// why those can differ), for the Setup page dropdown to show the right selection.
ipcMain.handle('settings:getHideHotkeyChoice', () => hideHotkeyChoice);
ipcMain.handle('settings:setHideHotkeyChoice', (_event, choice) => {
  hideHotkeyChoice = choice;
  saveJson('hideHotkeyChoice', choice);
  registerHideHotkey(choice, toggleMasterHidden);
  return hideHotkey;
});
// The button that makes the whole thing reachable. Opening the folder rather than the file: the
// question is nearly always "what happened on that day", which means picking one.
ipcMain.handle('debug:openLogFolder', () => shell.openPath(DEBUG_LOG_DIR));
ipcMain.handle('debug:logFolder', () => DEBUG_LOG_DIR);

// For the About page's "Copy bug report" button. Today's file only, tail rather than the whole
// thing - a report is about what just happened, and this project's own logs run to megabytes in
// a single session, which would make "paste this in Discord" impossible.
// Returns '' rather than throwing when Diagnostics has never been turned on (no file exists yet)
// or the file can't be read - the button still has the version info worth sending either way.
ipcMain.handle('debug:getRecentLogTail', (_event, maxChars = 4000) => {
  try {
    const p = path.join(DEBUG_LOG_DIR, `detection-${debugLogDateStamp(new Date())}.log`);
    const raw = fs.readFileSync(p, 'utf8');
    return raw.length > maxChars ? raw.slice(-maxChars) : raw;
  } catch {
    return '';
  }
});
// Custom modules (feat/module-system). No folder link, no reload button - dropping a file in
// hot-reloads via moduleHost.watchFolder(); these reads feed the sidebar and the per-module pages.
ipcMain.handle('modules:list', () => moduleHost.getRegistered());
ipcMain.handle('modules:entries', () => moduleHost.getAllEntries());
ipcMain.handle('modules:getSettings', (_event, id) => moduleHost.getSettings(id));
ipcMain.handle('modules:setSetting', (_event, { id, key, value }) => moduleHost.setSetting(id, key, value));
// A discovered module is inert until the user enables it here (Setup page). The renderer shows a
// consent dialog before the first enable - see moduleHost.js's header.
ipcMain.handle('modules:setEnabled', (_event, { id, enabled }) => moduleHost.setModuleEnabled(id, enabled));

ipcMain.handle('debug:getEnabled', () => debugLogEnabled);
ipcMain.handle('debug:setEnabled', (_event, enabled) => {
  debugLogEnabled = !!enabled;
  saveJson('debugLogEnabled', debugLogEnabled);
  return debugLogEnabled;
});
// The one place a renderer (an overlay window - see preload-overlay.js's debugLog bridge) can
// write into the same debug log every detection line already goes through. .on, not .handle - the
// overlay has nothing to wait for a reply about, same as widget:reportContentSize.
ipcMain.on('debug:logLine', (_event, message) => debugLog(message));
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
ipcMain.handle('widget:reorder', (_event, { orderedIds }) => widgetManager.reorderWidgets(orderedIds));
// Sidebar folders (Overlay Auras list organisation - see the renderer). None of these touch an
// overlay window; the renderer just re-fetches the list + folders after each.
ipcMain.handle('auraFolders:list', () => widgetManager.getFolders());
ipcMain.handle('auraFolders:create', (_event, name) => widgetManager.createFolder(name));
ipcMain.handle('auraFolders:rename', (_event, { id, name }) => widgetManager.renameFolder(id, name));
ipcMain.handle('auraFolders:delete', (_event, id) => widgetManager.deleteFolder(id));
ipcMain.handle('auraFolders:setCollapsed', (_event, { id, collapsed }) => widgetManager.setFolderCollapsed(id, collapsed));
ipcMain.handle('auraFolders:reorder', (_event, { orderedIds }) => widgetManager.reorderFolders(orderedIds));
ipcMain.handle('widget:setFolder', (_event, { id, folderId }) => widgetManager.setWidgetFolder(id, folderId));
ipcMain.handle('widget:resetToDefault', (_event, { id }) => widgetManager.resetWidgetToDefault(id));
ipcMain.handle('widget:setName', (_event, { id, value }) => widgetManager.setName(id, value));
ipcMain.handle('widget:toggleLock', (_event, id) => widgetManager.toggleLock(id));
ipcMain.handle('widget:resetPosition', (_event, id) => widgetManager.resetPosition(id));
ipcMain.handle('widget:isLocked', (_event, id) => widgetManager.isLocked(id));

// The move HUD (moveHudWindow.js) - precise positioning for one aura OR one action bar. Entering
// move mode unlocks the target, hides the main config window (it just covers where you want the
// target), and opens the detached HUD panel. Done reverses all three. One panel, one code path -
// `moveTarget.kind` picks which manager the nudge / reset / bounds calls go to.
let moveTarget = null; // { kind: 'widget' | 'actionBar', id } | null
let moveStepPx = 1;

positionSnap.set(loadJson('overlaySnapGrid', { enabled: false, sizePx: 8 }));

const targetManager = (kind) => (kind === 'actionBar' ? actionBarManager : widgetManager);

function targetName(kind, id) {
  const cfg = kind === 'actionBar' ? actionBarManager.getConfig(id) : widgetManager.getWidgetConfig(id);
  return cfg ? cfg.name : '';
}
function targetBounds(kind, id) {
  return kind === 'actionBar' ? actionBarManager.getBounds(id) : widgetManager.getWidgetBounds(id);
}
function targetLocked(kind, id) {
  return kind === 'actionBar' ? actionBarManager.isLocked(id) : widgetManager.isLocked(id);
}
function targetSetLocked(kind, id, locked) {
  return kind === 'actionBar' ? actionBarManager.setLocked(id, locked) : widgetManager.setLocked(id, locked);
}

// 'single' - one aura/bar being positioned via its "Move…" button (main window hidden).
// 'all' - "Unlock all auras" is on; the HUD is just the shared step/snap controls, every aura
// carries its own nudge arrows, and the main window stays open.
let hudMode = null;

// When the pad's centre button opens an aura's settings, the move session that was open is torn
// down but REMEMBERED here, so the "Back to moving" button (main window top bar) can put it back:
// tweak one aura's settings, then resume moving all of them. null | { kind:'all' } |
// { kind:'single', moveKind, id }.
let suspendedMove = null;
function notifyMasterState() {
  getMainWindow()?.webContents.send('overlay:masterStateChanged');
}

function hudMeta() {
  const grid = positionSnap.get();
  return {
    mode: hudMode || 'single',
    name: moveTarget ? targetName(moveTarget.kind, moveTarget.id) : '',
    stepPx: moveStepPx,
    snapEnabled: grid.enabled,
    snapSizePx: grid.sizePx,
  };
}

function onMoveTargetMoved(id, bounds) {
  if (moveTarget && id === moveTarget.id && bounds) moveHudWindow.update(bounds, hudMeta());
  // Keep this aura's nudge pad glued above its box (no-op if it has no pad open).
  if (bounds) nudgePadWindow.updateFor(id, bounds);
}
widgetManager.setOnWidgetMovedFn(onMoveTargetMoved);
actionBarManager.setOnMovedFn(onMoveTargetMoved);

function enterMoveMode(kind, id, { keepSuspended = false } = {}) {
  if (!targetName(kind, id) && !targetBounds(kind, id)) return { ok: false };
  if (!keepSuspended && suspendedMove) { suspendedMove = null; notifyMasterState(); }
  moveTarget = { kind, id };
  hudMode = 'single';
  positionSnap.setActive(id);
  if (targetLocked(kind, id)) targetSetLocked(kind, id, false);
  const b = targetBounds(kind, id); // exists now that it is unlocked
  getMainWindow()?.hide();
  moveHudWindow.open(b || { x: 200, y: 200, width: 160, height: 80 }, hudMeta());
  nudgePadWindow.showFor(id, b, kind); // a pad over the box - aura or action bar
  if (positionSnap.get().enabled) gridGuideWindow.show(positionSnap.get().sizePx);
  return { ok: true };
}

function exitMoveMode() {
  const t = moveTarget;
  moveTarget = null;
  hudMode = null;
  positionSnap.setActive(null);
  moveHudWindow.close();
  nudgePadWindow.hideAll();
  gridGuideWindow.hide();
  if (t) targetSetLocked(t.kind, t.id, true);
  const win = getMainWindow();
  if (win) { win.show(); win.focus(); }
  else createMainWindow();
}

// "Unlock all auras" - the shared HUD holds only the step/snap controls; every aura gets its own
// nudge-pad window above its box. The main window stays open (unlike single move mode).
function enterUnlockAllMode({ keepSuspended = false } = {}) {
  if (!keepSuspended && suspendedMove) { suspendedMove = null; notifyMasterState(); }
  hudMode = 'all';
  positionSnap.setActiveAll(true);
  moveHudWindow.open(null, hudMeta());
  for (const { id, bounds } of widgetManager.getVisibleUnlockedBounds()) nudgePadWindow.showFor(id, bounds);
  if (positionSnap.get().enabled) gridGuideWindow.show(positionSnap.get().sizePx);
}
function exitUnlockAllMode() {
  hudMode = null;
  positionSnap.setActiveAll(false);
  moveHudWindow.close();
  nudgePadWindow.hideAll();
  gridGuideWindow.hide();
}

// End whatever positioning session is open - a single "Move…" or "Unlock all auras" - re-locking
// and closing the HUD + every pad. Shared by the HUD's Done button and the pad's centre button.
// `suspend: true` (from the pad centre button) remembers the mode so "Back to moving" can resume.
function endMoveSession({ suspend = false } = {}) {
  suspendedMove = suspend && hudMode === 'all'
    ? { kind: 'all' }
    : suspend && hudMode === 'single' && moveTarget
      ? { kind: 'single', moveKind: moveTarget.kind, id: moveTarget.id }
      : null;
  if (hudMode === 'all') {
    widgetManager.setAllUnlocked(false);
    exitUnlockAllMode();
    getMainWindow()?.webContents.send('overlay:masterStateChanged');
  } else if (hudMode === 'single') {
    exitMoveMode();
  }
  notifyMasterState();
}

ipcMain.handle('widget:enterMoveMode', (_event, id) => enterMoveMode('widget', id));
ipcMain.handle('actionBar:enterMoveMode', (_event, id) => enterMoveMode('actionBar', id));
// An arrow on a per-box nudge pad (nudgePadWindow.js). Only an unlocked thing shows a pad, so the
// lock check is belt-and-braces. Routed by kind, same split targetManager uses.
ipcMain.on('nudgePad:nudge', (_event, { id, kind, dx, dy } = {}) => {
  if (!id) return;
  if (kind === 'actionBar') {
    if (!actionBarManager.isLocked(id)) actionBarManager.nudgePosition(id, dx, dy);
  } else if (!widgetManager.isLocked(id)) {
    widgetManager.nudgeWidget(id, dx, dy);
  }
});
// The pad's centre button - end the move and jump to this aura's settings. Ending the move first
// (exitMoveMode / exitUnlockAllMode) closes the HUD and every pad and re-locks - otherwise the
// move UI is left half-open behind the settings page and a later "Unlock all" collides with it.
// Same freeze-safe shape as the old right-click path: nav message FIRST, show()/focus() deferred,
// and it comes from the pad's own focusable:false window so the 24 Aug foreground-lock never bit.
ipcMain.on('nudgePad:openSettings', (_event, id) => {
  endMoveSession({ suspend: true }); // remembered, so "Back to moving" can resume it
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('widget:openSettings', id);
  setImmediate(() => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
});
ipcMain.handle('widget:getNudgeStep', () => moveStepPx);
ipcMain.handle('moveHud:setStep', (_event, px) => {
  moveStepPx = px === 10 ? 10 : 1;
  broadcast('widget:nudgeStep', moveStepPx); // the per-box arrows read this
  return moveStepPx;
});
ipcMain.handle('moveHud:setSnap', (_event, { enabled, sizePx }) => {
  const grid = positionSnap.set({ enabled, sizePx });
  saveJson('overlaySnapGrid', grid);
  if (moveTarget || hudMode === 'all') {
    if (grid.enabled) gridGuideWindow.show(grid.sizePx);
    else gridGuideWindow.hide();
  }
  return grid;
});
ipcMain.handle('moveHud:resetPosition', () => {
  if (moveTarget) targetManager(moveTarget.kind).resetPosition(moveTarget.id);
});
// Centre the single-move target on its own display's work area. `axis` is 'h' | 'v' - one axis at
// a time, the other kept where it is (owner's ask). Exact, so it ignores snap-to-grid.
ipcMain.handle('moveHud:centre', (_event, axis) => {
  if (!moveTarget || hudMode !== 'single') return null;
  const b = targetBounds(moveTarget.kind, moveTarget.id);
  if (!b) return null;
  const wa = (screen.getDisplayMatching(b) || screen.getPrimaryDisplay()).workArea;
  const pos = {};
  if (axis === 'h') pos.x = Math.round(wa.x + (wa.width - b.width) / 2);
  if (axis === 'v') pos.y = Math.round(wa.y + (wa.height - b.height) / 2);
  return moveTarget.kind === 'actionBar'
    ? actionBarManager.placeBar(moveTarget.id, pos)
    : widgetManager.placeWidget(moveTarget.id, pos);
});
ipcMain.handle('moveHud:done', () => endMoveSession());

// The Action Bar overlay - see actionBarManager.js's own header comment. Multiple bars, same
// {id, ...} shape every widget:* handler already uses.
ipcMain.handle('actionBar:list', () => actionBarManager.getAllBars());
ipcMain.handle('actionBar:getConfig', (_event, id) => actionBarManager.getConfig(id));
ipcMain.handle('actionBar:create', (_event, { name }) => actionBarManager.createBar(name));
ipcMain.handle('actionBar:delete', (_event, id) => actionBarManager.deleteBar(id));
ipcMain.handle('actionBar:setName', (_event, { id, name }) => actionBarManager.setBarName(id, name));
ipcMain.handle('actionBar:setIconsPerRow', (_event, { id, count }) => actionBarManager.setIconsPerRow(id, count));
ipcMain.handle('actionBar:setIconSize', (_event, { id, px }) => actionBarManager.setIconSize(id, px));
ipcMain.handle('actionBar:setMarginPx', (_event, { id, px }) => actionBarManager.setMarginPx(id, px));
ipcMain.handle('actionBar:setVisible', (_event, { id, visible }) => actionBarManager.setVisible(id, visible));
ipcMain.handle('actionBar:setShowWhenAppFocused', (_event, { id, enabled }) => actionBarManager.setShowWhenAppFocused(id, enabled));
ipcMain.handle('actionBar:toggleLock', (_event, id) => actionBarManager.toggleLock(id));
ipcMain.handle('actionBar:isLocked', (_event, id) => actionBarManager.isLocked(id));
ipcMain.handle('actionBar:resetPosition', (_event, id) => actionBarManager.resetPosition(id));
ipcMain.handle('actionBar:swapSlots', (_event, { id, a, b }) => actionBarManager.swapSlots(id, a, b));
ipcMain.handle('actionBar:setSlotIcon', (_event, { id, index, iconId }) => actionBarManager.setSlotIcon(id, index, iconId));
ipcMain.handle('actionBar:setOpacity', (_event, { id, opacity }) => actionBarManager.setOpacity(id, opacity));
ipcMain.handle('actionBar:setSlotName', (_event, { id, index, name }) => actionBarManager.setSlotName(id, index, name));
ipcMain.handle('actionBar:setSlotDisabled', (_event, { id, index, disabled }) => actionBarManager.setSlotDisabled(id, index, disabled));
ipcMain.handle('actionBar:setSlotCooldown', (_event, { id, index, cooldown }) => actionBarManager.setSlotCooldown(id, index, cooldown));
ipcMain.handle('actionBar:setSlotCount', (_event, { id, count }) => actionBarManager.setSlotCount(id, count));
ipcMain.handle('actionBar:setCooldownStyle', (_event, { id, style }) => actionBarManager.setCooldownStyle(id, style));
ipcMain.handle('actionBar:setCooldownShowNumber', (_event, { id, enabled }) => actionBarManager.setCooldownShowNumber(id, enabled));
ipcMain.handle('actionBar:setNameLabelSize', (_event, { id, size }) => actionBarManager.setNameLabelSize(id, size));
ipcMain.handle('actionBar:setNameLabelAnchor', (_event, { id, anchor }) => actionBarManager.setNameLabelAnchor(id, anchor));
ipcMain.handle('actionBar:setNameLabelColor', (_event, { id, color }) => actionBarManager.setNameLabelColor(id, color));
ipcMain.handle('actionBar:setNameLabelWrap', (_event, { id, wrap }) => actionBarManager.setNameLabelWrap(id, wrap));
ipcMain.handle('actionBar:setCooldownTextSize', (_event, { id, size }) => actionBarManager.setCooldownTextSize(id, size));
ipcMain.handle('actionBar:setCooldownTextAnchor', (_event, { id, anchor }) => actionBarManager.setCooldownTextAnchor(id, anchor));
ipcMain.handle('actionBar:setCooldownTextColor', (_event, { id, color }) => actionBarManager.setCooldownTextColor(id, color));
ipcMain.handle('actionBar:setCooldownTextWrap', (_event, { id, wrap }) => actionBarManager.setCooldownTextWrap(id, wrap));
ipcMain.handle('actionBar:setCooldownReplacesLabel', (_event, { id, replaces }) => actionBarManager.setCooldownReplacesLabel(id, replaces));
ipcMain.handle('actionBar:setBorderWidth', (_event, { id, px }) => actionBarManager.setBorderWidth(id, px));
ipcMain.handle('actionBar:setBorderOffset', (_event, { id, px }) => actionBarManager.setBorderOffset(id, px));
ipcMain.handle('actionBar:setBorderColor', (_event, { id, color }) => actionBarManager.setBorderColor(id, color));
ipcMain.handle('actionBar:setSlotBgColor', (_event, { id, index, color }) => actionBarManager.setSlotBgColor(id, index, color));
ipcMain.handle('actionBar:setSlotNameSizeOverride', (_event, { id, index, size }) => actionBarManager.setSlotNameSizeOverride(id, index, size));
ipcMain.handle('actionBar:setSlotInsetPx', (_event, { id, index, px }) => actionBarManager.setSlotInsetPx(id, index, px));
ipcMain.handle('actionBar:setSlotToggleGroup', (_event, { id, index, group }) => actionBarManager.setSlotToggleGroup(id, index, group));
ipcMain.handle('actionBar:setSlotToggleName', (_event, { id, index, name }) => actionBarManager.setSlotToggleName(id, index, name));
ipcMain.handle('actionBar:setSlotToggleDurationSec', (_event, { id, index, sec }) => actionBarManager.setSlotToggleDurationSec(id, index, sec));
ipcMain.handle('actionBar:getKnownAbilityGroups', () => {
  // The roster is the source of truth now (#20/#21 added every stance/invocation the owner named
  // as a category:'Stance'/'Invocation' entry). Union with the hand-seeded KNOWN_ lists so a name
  // that was only ever observed live - and never made it into the roster - still stays pickable.
  const roster = buffStore.getAll();
  const named = (category) => roster.filter((b) => b.category === category).map((b) => b.name);
  const union = (fromRoster, seed) => [...new Set([...fromRoster, ...seed])].sort();
  return {
    stances: union(named('Stance'), KNOWN_STANCES),
    invocations: union(named('Invocation'), KNOWN_INVOCATIONS),
  };
});
ipcMain.handle('actionBar:getAbilityGroupState', () => abilityGroupTracker.getAllActiveStates());
ipcMain.handle('actionBar:setSlotMultiIcon', (_event, { id, index, enabled }) => actionBarManager.setSlotMultiIcon(id, index, enabled));
ipcMain.handle('actionBar:setSlotSecondIcon', (_event, { id, index, iconId }) => actionBarManager.setSlotSecondIcon(id, index, iconId));
ipcMain.handle('actionBar:setSlotBorderEnabled', (_event, { id, index, enabled }) => actionBarManager.setSlotBorderEnabled(id, index, enabled));
ipcMain.handle('actionBar:setSlotBorderWidth', (_event, { id, index, px }) => actionBarManager.setSlotBorderWidth(id, index, px));
ipcMain.handle('actionBar:setSlotBorderOffset', (_event, { id, index, px }) => actionBarManager.setSlotBorderOffset(id, index, px));
ipcMain.handle('actionBar:setSlotBorderColor', (_event, { id, index, color }) => actionBarManager.setSlotBorderColor(id, index, color));
ipcMain.handle('actionBar:setActiveProfileIds', (_event, { id, profileIds }) => actionBarManager.setActiveProfileIds(id, profileIds));
ipcMain.handle('actionBar:copySettings', (_event, { id, fromId }) => actionBarManager.copySettingsFrom(id, fromId));
ipcMain.handle('actionBar:duplicate', (_event, id) => actionBarManager.duplicateBar(id));
ipcMain.handle('actionBar:clearAllTextOverrides', (_event, id) => actionBarManager.clearAllTextOverrides(id));
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
ipcMain.handle('widget:setIconDepletionShade', (_event, { id, value }) => widgetManager.setIconDepletionShade(id, value));
ipcMain.handle('widget:setTimerColorRamp', (_event, { id, enabled }) => widgetManager.setTimerColorRamp(id, enabled));
ipcMain.handle('widget:setExpiredLingerSec', (_event, { id, seconds }) => widgetManager.setExpiredLingerSec(id, seconds));
ipcMain.handle('widget:setIconLabelSize', (_event, { id, value }) => widgetManager.setIconLabelSize(id, value));
ipcMain.handle('widget:setTimerTextColor', (_event, { id, value }) => widgetManager.setTimerTextColor(id, value));
ipcMain.handle('widget:setGroupAllyBuffs', (_event, { id, value }) => widgetManager.setGroupAllyBuffs(id, value));
ipcMain.handle('widget:setShowDebuffSongs', (_event, { id, value }) => widgetManager.setShowDebuffSongs(id, value));
ipcMain.handle('widget:setSplitSongsByType', (_event, { id, value }) => widgetManager.setSplitSongsByType(id, value));
ipcMain.handle('widget:setGroupAllyDirection', (_event, { id, value }) => widgetManager.setGroupAllyDirection(id, value));
ipcMain.handle('widget:setHideAllyNameOnTile', (_event, { id, value }) => widgetManager.setHideAllyNameOnTile(id, value));
ipcMain.handle('widget:setLabelTextColor', (_event, { id, value }) => widgetManager.setLabelTextColor(id, value));
ipcMain.handle('widget:setIconMargin', (_event, { id, value }) => widgetManager.setIconMargin(id, value));
ipcMain.handle('widget:setIconLabelAnchor', (_event, { id, value }) => widgetManager.setIconLabelAnchor(id, value));
ipcMain.handle('widget:setWrapText', (_event, { id, enabled }) => widgetManager.setWrapText(id, enabled));
ipcMain.handle('widget:setIconJustify', (_event, { id, value }) => widgetManager.setIconJustify(id, value));
ipcMain.handle('widget:setTextJustify', (_event, { id, value }) => widgetManager.setTextJustify(id, value));
ipcMain.handle('widget:setMaxDurationFilter', (_event, { id, value }) => widgetManager.setMaxDurationFilter(id, value));
ipcMain.handle('widget:setSoundOnLand', (_event, { id, enabled }) => widgetManager.setSoundOnLand(id, enabled));
ipcMain.handle('widget:setSoundOnExpire', (_event, { id, enabled }) => widgetManager.setSoundOnExpire(id, enabled));
ipcMain.handle('widget:setSoundWarningSec', (_event, { id, value }) => widgetManager.setSoundWarningSec(id, value));
ipcMain.handle('widget:setSoundWarningLoopSec', (_event, { id, value }) => widgetManager.setSoundWarningLoopSec(id, value));
ipcMain.handle('widget:setSoundCooldownSec', (_event, { id, value }) => widgetManager.setSoundCooldownSec(id, value));
ipcMain.handle('widget:setLandSoundId', (_event, { id, soundId }) => widgetManager.setLandSoundId(id, soundId));
ipcMain.handle('widget:setExpireSoundId', (_event, { id, soundId }) => widgetManager.setExpireSoundId(id, soundId));
ipcMain.handle('widget:setWarningSoundId', (_event, { id, soundId }) => widgetManager.setWarningSoundId(id, soundId));
ipcMain.handle('widget:setAlertVolume', (_event, { id, value }) => widgetManager.setAlertVolume(id, value));

ipcMain.handle('sounds:pick', () => soundService.pickAndImportSound(getMainWindow()));
ipcMain.handle('sounds:getInfo', (_event, id) => soundService.getSoundInfo(id));
ipcMain.handle('sounds:openFolder', () => soundService.openPickerFolder());
// QOL #3a - the userData folder, where every aura / profile / setting JSON lives. For a manual
// backup before an update.
ipcMain.handle('app:openConfigFolder', () => shell.openPath(app.getPath('userData')));

// Opens a link in the user's real browser - never navigates a renderer window. Locked to
// https:// so a compromised renderer can't use it to launch a local file or a custom-scheme
// handler. The only caller today is the About page's site link.
ipcMain.handle('app:openExternal', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) return shell.openExternal(url);
  return false;
});

// QOL #3c - export / import the whole config as a portable bundle folder. See configTransfer.js.
ipcMain.handle('config:export', () => configTransfer.exportConfig(app.getPath('userData')));
ipcMain.handle('config:listImportable', () => configTransfer.listImportable(app.getPath('userData')));
ipcMain.handle('config:import', (_event, sourcePath) => configTransfer.importConfig(app.getPath('userData'), sourcePath));
ipcMain.handle('config:openExportsFolder', () => {
  const dir = path.join(app.getPath('userData'), 'exports');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  return shell.openPath(dir);
});

// QOL #3b - "Back up now". Copies userData into a dated folder inside itself, skipping the
// Electron/Chromium cache dirs, the detection logs (large, ephemeral, not config) and the backups
// folder itself. Walks the top-level children rather than fs.cpSync on the whole tree, so the
// destination being a subfolder of the source is never a problem.
ipcMain.handle('app:backupConfig', () => {
  try {
    const src = app.getPath('userData');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(src, 'backups', `backup-${stamp}`);
    fs.mkdirSync(dest, { recursive: true });
    const SKIP = new Set([
      'backups', 'detection-logs', 'Cache', 'GPUCache', 'Code Cache', 'DawnCache', 'DawnGraphiteCache',
      'blob_storage', 'Local Storage', 'Session Storage', 'Shared Dictionary', 'Network', 'logs',
    ]);
    let items = 0;
    for (const name of fs.readdirSync(src)) {
      if (SKIP.has(name)) continue;
      const from = path.join(src, name);
      const to = path.join(dest, name);
      try {
        if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
        else fs.copyFileSync(from, to);
        items += 1;
      } catch (e) { /* skip a locked/odd entry, keep going */ }
    }
    return { ok: true, path: dest, items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
ipcMain.handle('widget:setListWidth', (_event, { id, value }) => widgetManager.setListWidth(id, value));
ipcMain.handle('widget:setLockoutOptions', (_event, { id, ...opts }) => {
  const config = widgetManager.setLockoutOptions(id, opts);
  pushLockoutBoard(); // a shown board picks up the new word / hide time right away
  return config;
});
ipcMain.on('widget:reportContentSize', (_event, { id, width, height, originX }) => widgetManager.fitToContent(id, width, height, originX));
ipcMain.handle('widget:setOpacity', (_event, { id, value }) => widgetManager.setOpacity(id, value));
ipcMain.handle('widget:setBuffFilter', (_event, { id, mode, names }) => widgetManager.setBuffFilter(id, mode, names));
ipcMain.handle('widget:setBuffSource', (_event, { id, source }) => widgetManager.setBuffSource(id, source));
// Named fields rather than a spread, so nothing arrives from the renderer that the store has not
// been told to expect. The cost is that a new field has to be added HERE too - cooldownSec was
// added to the form, the store and the engine and still did nothing until this line changed.
ipcMain.handle(
  'widget:addCustomTimer',
  // This handler destructures a fixed set of names, so a field missing from the list is silently
  // dropped rather than erroring - which is exactly how castOf timers came to be impossible to
  // create through the UI while looking like they worked. Keep this list in sync with
  // readTimerFormData in main-window.js.
  (_event, { id, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec }) =>
    widgetManager.addCustomTimer(id, {
      name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec,
    })
);
ipcMain.handle('widget:setTriggerDurationSec', (_event, { id, seconds }) => widgetManager.setTriggerDurationSec(id, seconds));
ipcMain.handle('widget:setTriggerCombineMode', (_event, { id, mode }) => widgetManager.setTriggerCombineMode(id, mode));
ipcMain.handle('widget:setAndWindowSec', (_event, { id, seconds }) => widgetManager.setAndWindowSec(id, seconds));
ipcMain.handle('widget:setReverseDetection', (_event, { id, enabled }) => widgetManager.setReverseDetection(id, enabled));
ipcMain.handle(
  'widget:updateCustomTimer',
  (_event, { id, timerId, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec }) =>
    widgetManager.updateCustomTimer(id, timerId, {
      name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec,
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
    actionBarManager.applyProfileVisibility();
    broadcast('profiles:activeChanged', result);
  }
  return result;
});
// The buff optimiser (buffPlanner.js). Its input - the three classes+levels and the dragged
// priority order - lives on the active loadout profile (profileStore). The plan itself is always
// recomputed here from the live roster and the real stacking model, never stored: the roster is
// rebuilt every launch (see buffStore's header) so a cached plan could silently drift.
ipcMain.handle('planner:getInput', (_event, profileId) => {
  const profile = profileStore.getProfile(profileId || profileStore.getActiveId());
  return {
    classes: (profile && profile.plannerClasses) || [],
    level: (profile && profile.plannerLevel) || buffPlanner.DEFAULT_LEVEL,
    buffPlanOrder: (profile && profile.buffPlanOrder) || [],
    playstyle: (profile && profile.plannerPlaystyle) || 'balanced',
    excludedStats: (profile && profile.plannerExcludedStats) || [],
    allStats: spellEffects.STAT_NAMES, // for the "ignore this stat" toggles
  };
});
ipcMain.handle('planner:setPlaystyle', (_event, { profileId, playstyle }) => {
  profileStore.setPlannerPlaystyle(profileId || profileStore.getActiveId(), playstyle);
  return true;
});
ipcMain.handle('planner:setExcludedStats', (_event, { profileId, stats }) => {
  profileStore.setPlannerExcludedStats(profileId || profileStore.getActiveId(), stats);
  return true;
});
ipcMain.handle('planner:setClasses', (_event, { profileId, classes }) => {
  profileStore.setPlannerClasses(profileId || profileStore.getActiveId(), buffPlanner.normalizeClassCodes(classes));
  return true;
});
ipcMain.handle('planner:setLevel', (_event, { profileId, level }) => {
  profileStore.setPlannerLevel(profileId || profileStore.getActiveId(), level);
  return true;
});
ipcMain.handle('planner:setOrder', (_event, { profileId, order }) => {
  profileStore.setBuffPlanOrder(profileId || profileStore.getActiveId(), order);
  return true;
});
ipcMain.handle('planner:compute', (_event, profileId) => {
  const profile = profileStore.getProfile(profileId || profileStore.getActiveId());
  const classes = (profile && profile.plannerClasses) || [];
  const level = (profile && profile.plannerLevel) || buffPlanner.DEFAULT_LEVEL;
  const priorityOrder = (profile && profile.buffPlanOrder) || [];
  const playstyle = (profile && profile.plannerPlaystyle) || 'balanced';
  const excludedStats = (profile && profile.plannerExcludedStats) || [];
  // The planner uses the full stacking engine (roster stacking data - always present now, not
  // gated on the EQ folder) for pairs the curated line model returns 'unknown' for. It passes the
  // real character level, so a not-yet-capped low-level spell resolves correctly here (unlike the
  // live engine, which has to assume 50).
  const checkStack = (activeId, incomingId) => stackingService.planConflict(activeId, incomingId, level);
  // The real +STR / +AC / haste numbers - read straight off the roster now (each entry carries its
  // `stackEffects`), so the planner has them whether or not the EQ folder is set.
  const roster = buffStore.getAll();
  const byId = new Map(roster.filter((e) => e.spellId != null).map((e) => [Number(e.spellId), e]));
  const entryFor = (spellId) => byId.get(Number(spellId)) || null;
  const spellData = {
    stats: (spellId) => spellEffects.spellStats(entryFor(spellId), level),
    headline: (spellId, category) => spellEffects.categoryHeadline(roster, entryFor(spellId), category),
    score: (spellId, name, weightScale) => spellEffects.statScore(entryFor(spellId), name, weightScale),
    weightScale: (style, excluded) => spellEffects.combinedWeightScale(style, excluded),
    multiplierStats: spellEffects.MULTIPLIER_STATS,
  };
  const plan = buffPlanner.computePlan({ roster, classes, level, priorityOrder, checkStack, spellData, lines: buffLines, playstyle, excludedStats });
  // Attach a served icon url to everything the page will draw, same shape buffs:known uses.
  const withIcons = (list) =>
    list.map((c) => ({ ...c, iconUrl: c.iconId != null ? iconService.buildIconUrl(c.iconId) : null }));
  return {
    classes: plan.classes.map((c) => c.code),
    level: plan.classes.length ? plan.classes[0].level : level,
    hasBard: plan.hasBard,
    statsKnown: plan.statsKnown,
    totals: plan.totals,
    slots: withIcons(plan.slots),
    overflow: withIcons(plan.overflow),
    candidates: withIcons(plan.candidates),
    songSlots: withIcons(plan.songSlots),
    songOverflow: withIcons(plan.songOverflow),
    songCandidates: withIcons(plan.songCandidates),
    permanentSlots: withIcons(plan.permanentSlots),
    permanentOverflow: withIcons(plan.permanentOverflow),
    combatSlots: withIcons(plan.combatSlots || []),
    combatOverflow: withIcons(plan.combatOverflow || []),
    stackingKnown: plan.stackingKnown,
    stackingCoverage: plan.stackingCoverage,
    playstyle: plan.playstyle,
    excludedStats: plan.excludedStats,
  };
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
  actionBarManager.removeProfileFromAllBars(id);
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
//
// One recurrence now diagnosed, 25 Aug: before-quit fired, then the main window's own close
// event (twice), then will-quit - render-process-gone never fired, ruling out a renderer crash.
// So this WAS the main-window-close path (mainWindow.js's `close` handler, which deliberately
// quits the whole app - see its own comment on why). The open question this time is what fired
// the window's close event in the first place: confirmed NOT the user pressing Alt+F4 (the owner
// was actively playing, unfocused from this app entirely - Alt+F4 needs focus to reach a window
// at all) and NOT anything in this app's own code (checked every path that can close a window or
// call quit(): the global hotkey only toggles widget visibility, setForegroundHidden only
// touches overlay widgets, deleteWidget only closes an individual widget's own window, the
// single-instance guard only runs at startup). Nothing here can close the main window while
// unfocused - Windows' own Application/Hang event log had nothing for this app either. Points
// outward, to something OS-level neither the app nor this log can see (sleep, a forced restart,
// memory pressure favoring the focused game process, etc.) rather than to a bug in this codebase.
// If it recurs, what to check next: whatever else was happening on the system at that exact
// second, not another pass over these same four ruled-out in-app paths.
app.on('before-quit', () => {
  debugLog('SHUTDOWN: before-quit fired');
  // Flush immediately - the debounced save may still be pending, and this is exactly the moment
  // the snapshot matters most.
  sessionRestore.saveNow();
});
app.on('will-quit', () => {
  debugLog('SHUTDOWN: will-quit fired');
  // A global shortcut outlives the window that registered it, so leaving it registered means the
  // key stays captured from EverQuest after the app has gone.
  globalShortcut.unregisterAll();
  // foregroundWatcher now keeps one persistent powershell.exe alive (see its own header comment
  // on why) rather than spawning a fresh one per poll - without this it would linger as an
  // orphaned process after the app closes instead of exiting with it.
  foregroundWatcher.stop();
  raidNamedTracker.stop();
  firstAggroEngine.stop();
});
// A renderer dying takes its window with it, which can cascade into
// window-all-closed and look like a clean quit - `reason` distinguishes a
// real crash ('crashed'/'oom') from an ordinary teardown ('clean-exit').
// Navigation lockdown for EVERY window in the app, present and future - one registration covers
// the main window, the overlay, every aura, and the little popup windows. These pages render
// spell / zone / chat-derived strings and pasted share codes; nothing they contain should be able
// to navigate the window somewhere else or open a new one. All content is loaded from local files,
// so a navigation attempt is always either a bug or an injection - deny it and log it.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (e, url) => {
    // about:blank / the page's own file reload are fine; anything else is denied.
    if (url !== contents.getURL()) {
      e.preventDefault();
      debugLog(`BLOCKED navigation to ${url}`);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    debugLog(`BLOCKED window.open / target=_blank to ${url}`);
    return { action: 'deny' };
  });
});

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
// Backlog #18 - the in-app changelog shown on the About page.
ipcMain.handle('app:getChangelog', () => require('../shared/data/changelog').CHANGELOG);
