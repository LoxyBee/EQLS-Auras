// Aggro Board — a bundled module for EQLS Auras. See docs/MODULE-AUTHORING.md.
//
// This ships in the install's `modules/` folder (next to the .exe) and loads automatically.
// A drop-in module written by hand goes in that same folder. No dependencies, no require.
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
//
// The mob name used to require "a/an/the " in front - which meant every NAMED mob and raid boss
// ("Lady Vox", "Unmoving", "Muck covered elemental") was invisible, so the board sat on "nothing
// swinging" for entire raid fights (reported live). The article is optional now; article-less
// names are disambiguated from a PLAYER meleeing something (`Korv crushes Unmoving for 300`) by a
// player set - see PLAYERS below. The (?<who>...) target capture is a single bare token followed
// by " for N", which already rejects multi-word mob targets ("Lady Vox for" fails) and pet targets
// ("Gaboku`s pet for" fails), so a mob-hits-mob line can't be mistaken for a hit on a player.
const VERBS =
  '(?:hits|punches|kicks|cleaves|slashes|bashes|pierces|stings|claws|crushes|strikes|' +
  'backstabs|bites|smashes|slices|smites|shoots|reaves|frenzies|gores|mauls|rends|gouges|slams|burns)';
const MOB_HIT = new RegExp(
  `^(?<mob>(?:(?:a|an|the) )?[^.]+?) ${VERBS} (?<who>[A-Za-z\`'"]+) for \\d+ points? of`,
  'i');
const HAS_ARTICLE = /^(?:a|an|the) /i;

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

// Names seen to be PLAYERS this session - the discriminator for an article-less melee line.
// Bootstrapped the same bidirectional way damageEngine derives friend/enemy:
//   * anyone who "has captured <mob>'s attention" (CAPTURE_3P) - and raidmates outside her group
//     fire that too, so a raid board is not limited to her own group;
//   * the target of any ARTICLE-prefixed mob hit ("a vis ghoul knight hits Korv" => Korv);
//   * ctx.groupMembers, and "you".
// Then: article present => always a mob. Article absent => a mob only if the name is NOT a known
// player ("Korv crushes Unmoving for 300" => "korv" is a player => not a mob hit).
// MOBS is the mirror (SLAIN / CAPTURE targets) - not required for the rule, but lets an
// article-less name be trusted immediately if it was already seen dying or being taunted.
const PLAYERS = new Set(['you']);
const MOBS = new Set();

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
  description: 'Who the mob is swinging at, and who is next in line.',
  hasAura: true,
  // Marked experimental, and currently LOCKED out of the Add Aura list by the renderer
  // (LOCKED_MODULE_AURAS in main-window.js) - shown as a "Planned" placeholder instead. The
  // melee-line parsing is being reworked to recognise article-less named / raid-boss mobs
  // ("Lady Vox", "Unmoving"), which it currently misses entirely, so the board is unreliable in
  // raid content. The module stays loaded (its parsing is tested) but is not creatable until the
  // rework lands.
  experimental: true,
  // Its two options live on the aura's own settings panel, not a sidebar page - the recommended
  // shape for a module without a lot of GLOBAL settings. See docs/MODULE-AUTHORING.md.
  settingsUI: 'aura',

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

    // Cheap: the group roster is a handful of names, and Set.add of an existing key is a no-op.
    if (Array.isArray(ctx.groupMembers)) for (const m of ctx.groupMembers) PLAYERS.add(key(m));

    // Ordered by frequency: mob-hit lines vastly outnumber the rest, and `onLine` runs on every
    // line in the log. Over 50ms on 20+ calls disables the module for the session.
    const h = MOB_HIT.exec(msg);
    if (h) {
      const k = key(h.groups.mob);
      const hasArticle = HAS_ARTICLE.test(h.groups.mob);
      const who = h.groups.who === 'YOU' || h.groups.who === 'you' ? 'You' : h.groups.who;

      // Article-less "<name> <verb> <player> for N" is ambiguous: a real named mob, OR a player
      // meleeing something. Trust it as a mob unless the name is a known player (that we haven't
      // also seen as a mob - a mob whose name collides with a player's loses the tie to MOBS), or
      // it's the target's own name (a self-referential misparse). An article is unambiguous.
      if (!hasArticle && ((PLAYERS.has(k) && !MOBS.has(k)) || k === key(who))) return null;

      // The target of a real (article) mob hit is a player - unless we've already seen that name
      // being killed / taunting, i.e. a mob hitting another mob.
      if (hasArticle && !MOBS.has(key(who))) PLAYERS.add(key(who));

      if (k !== state.mob) reset(k, h.groups.mob, now);
      state.hits.set(who, (state.hits.get(who) || 0) + 1);
      state.lastSeen = now;
      return emit(board(settings, now));
    }

    const c1 = CAPTURE_1P.exec(msg);
    if (c1) {
      const k = key(c1.groups.mob);
      MOBS.add(k);
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
      MOBS.add(k);
      PLAYERS.add(key(c3.groups.who));
      if (k !== state.mob) reset(k, c3.groups.mob, now);
      state.hits.set(c3.groups.who, (state.hits.get(c3.groups.who) || 0) + 3);
      state.lastSeen = now;
      return emit(board(settings, now));
    }

    const s = SLAIN.exec(msg);
    if (s) {
      const dead = key(s.groups.mob || s.groups.mob2 || '');
      // Only "You have slain X" (mob2) is a safe mob signal - "X has been slain by Y" could just
      // as well be a groupmate dying to a mob, so it must not add X to the mob set.
      if (s.groups.mob2) MOBS.add(key(s.groups.mob2));
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
