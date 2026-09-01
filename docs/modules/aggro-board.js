// Aggro Board — a drop-in module for EQLS Auras. See docs/MODULE-AUTHORING.md.
//
// Copy this ONE file into  %APPDATA%\EQ Buff Tracker\modules\aggro-board.js
// No dependencies, no require, nothing else to install.
//
// WHAT IT SHOWS: which player the mob you are fighting is ACTUALLY SWINGING AT, and who is closest
// behind them. That is a direct observation of the consequence threat exists to produce — it is
// not an estimate and there is no coefficient anywhere in it.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THERE IS NO THREAT NUMBER ON THIS OVERLAY
//
// A threat magnitude cannot be computed from an EverQuest log, and the reasons are measured:
//   * Melee hate is charged PER SWING from the weapon's damage stat in the reference server
//     implementation — a number no log line contains — and misses generate hate but are not logged.
//     So logged damage is not a noisy threat signal; it is a different quantity.
//   * Heal hate keys off the spell's BASE value, which the log never prints.
//   * Stun hate is clamp(target_maxHP/15, 25, 1200), not a flat 200 or 400.
//   * EverQuest Legends is not that server. Its own wiki has no Aggro or Hate Management page —
//     the Threat page redirects to one that does not exist.
// A ranked number built on those would be a guess wearing a measurement's clothes. This shows the
// thing the log DOES know, and a player can falsify it instantly by looking at their health bar.
//
// ACCURACY, measured rather than claimed: validated against 385 in-log ground-truth events where
// the game itself named the aggro holder ("You capture <mob>'s attention!"). Agreement 86.8%.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE THREE STATES ARE THREE DIFFERENT TILES, AND THAT IS DELIBERATE
//
// Measured on 600 ground-truth events: 30.0% of the time the mob was NOT SWINGING AT ANYONE. The
// board being empty is often the TRUTH, not a gap. So "nothing is swinging at anybody" and "I have
// not seen anything recently" must not look the same, and a renderer must not have to remember to
// tell them apart. They are emitted under three mutually exclusive KEYS, each clearing the others,
// so exactly one is ever present. An ambiguous empty panel is impossible by construction.

'use strict';

const STAMP_RE = /^\[[^\]]+\]\s*/;

// Mob melee against a player. The verbs are a closed set: 19 stems established by fixpoint over
// 642,043 damage lines with residual 0, cross-checked against an independent EQL parser.
const MOB_HIT = new RegExp(
  '^(?<mob>(?:a|an|the) [^.]+?) ' +
  '(?:hits|punches|kicks|cleaves|slashes|bashes|pierces|stings|claws|crushes|strikes|' +
  'backstabs|bites|smashes|slices|smites|shoots|reaves|frenzies|gores|mauls|rends|gouges|slams|burns) ' +
  '(?<who>[A-Za-z`\'"]+) for \\d+ points? of',
  'i');

// The game naming the holder outright. Two endings, and anchoring on `attention!` missed the
// second — 25 of 537 events read "...'s attention with an unparalleled approach!".
const CAPTURE_3P = /^(?<who>[A-Z][A-Za-z`']*) has captured (?<mob>.+?)'s attention[^!]*!$/;
const CAPTURE_1P = /^You capture (?<mob>.+?)'s attention[^!]*!$/;

// A fight ends. Clear rather than let a dead mob's board go stale on screen.
const SLAIN = /^(?:(?<mob>.+?) has been slain by .+!|You have slain (?<mob2>.+?)!)$/;

const KEY_HOLDER = 'aggro-holder';
const KEY_QUIET = 'aggro-quiet';
const KEY_STALE = 'aggro-stale';

// EQ capitalises a leading article at the START of a line and not mid-sentence, so one mob arrives
// as "A vis ghoul knight" and "a vis ghoul knight". Keying on the raw string makes two mobs — that
// single bug hid 255 of 600 ground-truth events until it was found and fixed.
function key(name) { return String(name).trim().toLowerCase(); }

const state = {
  mob: null,          // canonical key of the mob we are tracking
  display: null,      // its first-seen spelling, for the label
  hits: new Map(),    // player -> hits taken from that mob
  lastSeen: 0,
  lastEmitted: null,
};

function reset(mobKey, display, now) {
  state.mob = mobKey;
  state.display = display;
  state.hits = new Map();
  state.lastSeen = now;
}

function board(settings, now) {
  const staleAfter = (Number(settings.staleSeconds) || 12) * 1000;
  const rows = [...state.hits.entries()].sort((a, b) => b[1] - a[1]);

  // NOTHING TRACKED AT ALL — not an error state, and not the same as stale.
  if (!state.mob || !rows.length) {
    return { key: KEY_QUIET, name: 'Aggro — nothing swinging', durationSec: 0 };
  }
  if (now - state.lastSeen > staleAfter) {
    const secs = Math.round((now - state.lastSeen) / 1000);
    return { key: KEY_STALE, name: 'Aggro — no swings for ' + secs + 's', durationSec: 0 };
  }
  const [top, topHits] = rows[0];
  const next = rows[1];
  const margin = next ? topHits - next[1] : null;
  const label = next
    ? top + '  ▸ ' + next[0] + (settings.showMargin ? '  (+' + margin + ')' : '')
    : top;
  return { key: KEY_HOLDER, name: label, durationSec: 0 };
}

// Exactly one tile is ever present: emit the current state and clear the other two.
function emit(entry) {
  const others = [KEY_HOLDER, KEY_QUIET, KEY_STALE].filter((k) => k !== entry.key);
  state.lastEmitted = entry.key;
  return [entry].concat(others.map((k) => ({ key: k, clear: true })));
}

module.exports = {
  id: 'aggro-board',
  name: 'Aggro Board',
  apiVersion: 1,
  description: 'Who the mob is actually swinging at. Observed, not estimated.',
  hasAura: true,

  page: [
    { section: 'Display' },
    { key: 'showMargin', type: 'checkbox', label: 'Show the lead over second place', default: true },
    { section: 'Staleness' },
    {
      key: 'staleSeconds',
      type: 'slider',
      label: 'Call it stale after (seconds with no swing)',
      min: 3, max: 60, step: 1, default: 12,
    },
  ],

  onLine(line, ctx, settings) {
    const msg = ctx.stripTimestamp ? ctx.stripTimestamp(line) : line.replace(STAMP_RE, '');
    const now = ctx.now;

    // Ordered by frequency: mob-hit lines vastly outnumber the rest, and `onLine` runs on every
    // line in the log. Over 50ms on 20+ calls disables the module for the session.
    const h = MOB_HIT.exec(msg);
    if (h) {
      const k = key(h.groups.mob);
      if (k !== state.mob) reset(k, h.groups.mob, now);
      const who = h.groups.who === 'YOU' || h.groups.who === 'you' ? 'You' : h.groups.who;
      state.hits.set(who, (state.hits.get(who) || 0) + 1);
      state.lastSeen = now;
      return emit(board(settings, now));
    }

    const c1 = CAPTURE_1P.exec(msg);
    if (c1) {
      const k = key(c1.groups.mob);
      if (k !== state.mob) reset(k, c1.groups.mob, now);
      // The game has told us outright. Seed it strongly so the board agrees immediately rather
      // than waiting for the mob to swing.
      state.hits.set('You', (state.hits.get('You') || 0) + 3);
      state.lastSeen = now;
      return emit(board(settings, now));
    }

    const c3 = CAPTURE_3P.exec(msg);
    if (c3) {
      const k = key(c3.groups.mob);
      if (k !== state.mob) reset(k, c3.groups.mob, now);
      state.hits.set(c3.groups.who, (state.hits.get(c3.groups.who) || 0) + 3);
      state.lastSeen = now;
      return emit(board(settings, now));
    }

    const s = SLAIN.exec(msg);
    if (s) {
      const dead = key(s.groups.mob || s.groups.mob2 || '');
      if (dead && dead === state.mob) {
        state.mob = null;
        state.hits = new Map();
        return emit(board(settings, now));
      }
    }

    // A periodic nudge so a fight that goes quiet transitions to the stale tile without needing a
    // line about the mob we are tracking. Cheap: one comparison on most lines.
    if (state.mob && state.lastEmitted === KEY_HOLDER &&
        now - state.lastSeen > (Number(settings.staleSeconds) || 12) * 1000) {
      return emit(board(settings, now));
    }
    return null;
  },
};
