// Stance/invocation "active" tracking for Action Bar gems (CLAUDE.md's "Action bar cover
// replacements" backlog). Genuinely separate from buff detection - stances and invocations are
// not spells with landing text, they are a toggle mechanic with their own log wording, confirmed
// directly against the user's live log rather than guessed:
//
//   You begin to change your stance.          <- precursor, fires before the pick is known
//   You assume an evasive stance.              <- the actual confirmed pick
//   You begin to change your invocation.       <- precursor
//   You begin reciting the divine invocation.  <- the actual confirmed pick
//
// Only the confirmed lines are matched - the precursor never says WHICH one was chosen, so it is
// not useful evidence here.
//
// Requested directly: activating one stance (or one invocation) puts every OTHER gem in the same
// group on a cooldown too, matching how the game only lets one be active at a time, and the gem
// actually picked additionally shows a green "active" border on top of the ordinary cooldown
// overlay. Stances share a fixed 6s cooldown (the game's own rule); invocations use each gem's own
// configured toggleDurationSec.
//
// The cooldown and the "active" border are DELIBERATELY on separate lifetimes, not the same
// timer - requested directly after the first version tied them together: "the green border goes
// away after the cooldown, it needs to be permanent till a swap." The cooldown is real GCD-style
// lockout time (you can't swap again yet); "active" is a STATE (this is what you're currently
// in), which the game itself keeps true indefinitely until you actually change it. activeSlotByGroup
// is never cleared by time - only by a later _activate() call actually matching a different gem
// (or matching nothing, in which case nobody can honestly be shown as active any more).
//
// This list is a starting set, seeded from names actually observed live - not a claim that it is
// exhaustive. "N/A"/placeholder rows and the many other "X Stance" spell entries elsewhere in the
// game's own spells_us.txt do NOT use this same templated wording (confirmed: none of them appear
// as "You assume a/an <name> stance." in the log), so the list can't be mined from that file the
// way bard songs are - it has to grow from what's actually seen firing.
const KNOWN_STANCES = ['Evasive Stance', 'Offensive Stance', 'Channeler Stance'];

const KNOWN_INVOCATIONS = [
  'Arcane Mastery Invocation',
  'Divine Invocation',
  'Overchannel Invocation',
  'Inviolable Invocation',
  'Inversion Invocation',
  'Recovery Invocation',
];

// Case-insensitive, and deliberately not anchored to a fixed article ("a"/"an") - matches
// whatever the log actually says, e.g. "You assume an evasive stance." or "You assume a channeler
// stance.".
const STANCE_LINE = /^You assume (?:a|an) (.+) stance\.$/i;
const INVOCATION_LINE = /^You begin reciting the (.+) invocation\.$/i;

function stripTimestamp(line) {
  return line.replace(/^\[[^\]]*\]\s*/, '');
}

// name -> 'Evasive Stance' shape, from whatever the log captured (lowercase, no "stance"/
// "invocation" suffix) - e.g. "evasive" -> "Evasive Stance".
function toDisplayName(spoken, suffix) {
  const trimmed = spoken.trim();
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)} ${suffix}`;
}

class AbilityGroupTracker {
  constructor() {
    // group -> Map<slotKey, {expiresAt}> - every gem in the group currently on cooldown,
    // regardless of which one was actually picked. slotKey is `${barId}:${slotIndex}`.
    this.cooldownByGroup = { stance: new Map(), invocation: new Map() };
    // group -> slotKey | null - the one gem in the group that gets the green "active" border.
    // Persists indefinitely, independent of cooldownByGroup's own expiry - see the header comment.
    this.activeSlotByGroup = { stance: null, invocation: null };
    // (barId, group) => [{index, toggleName, toggleDurationSec}] - injected rather than reading
    // actionBarStore directly, same DI reasoning as every other cross-module boundary in this
    // codebase (widgetManager's getActiveProfileIdFn, customTimerEngine's getWidgetsFn, etc.).
    this.getGroupSlotsFn = () => [];
    this.onChangeFn = () => {};
  }

  setGetGroupSlotsFn(fn) {
    this.getGroupSlotsFn = fn;
  }

  setOnChangeFn(fn) {
    this.onChangeFn = fn;
  }

  handleLine(rawLine) {
    const line = stripTimestamp(rawLine).trim();
    const stanceMatch = STANCE_LINE.exec(line);
    if (stanceMatch) {
      this._activate('stance', toDisplayName(stanceMatch[1], 'Stance'), 6);
      return;
    }
    const invocationMatch = INVOCATION_LINE.exec(line);
    if (invocationMatch) {
      this._activate('invocation', toDisplayName(invocationMatch[1], 'Invocation'), null);
    }
  }

  // durationSec is null for invocations - each matched gem's own toggleDurationSec is used
  // instead of one shared number, since invocations were asked to keep "their own cooldown".
  _activate(group, name, fixedDurationSec) {
    const slots = this.getGroupSlotsFn(group); // [{barId, index, toggleName, toggleDurationSec}]
    if (slots.length === 0) return;
    const lower = name.toLowerCase();
    const now = Date.now();
    let matchedKey = null;
    for (const slot of slots) {
      const key = `${slot.barId}:${slot.index}`;
      const durationSec = fixedDurationSec ?? slot.toggleDurationSec ?? 6;
      this.cooldownByGroup[group].set(key, {
        barId: slot.barId,
        index: slot.index,
        durationSec,
        expiresAt: now + durationSec * 1000,
      });
      if (slot.toggleName && slot.toggleName.toLowerCase() === lower) {
        matchedKey = key;
      }
    }
    // Every configured gem in the group goes on cooldown regardless of a match (mutual exclusion
    // - the game only lets one be active, so an unmatched activation still means every OTHER one
    // just stopped being ready) - only the specific one that was actually named gets the border.
    this.activeSlotByGroup[group] = matchedKey;
    this.onChangeFn();
  }

  // Flat list of every gem worth telling the renderer about, across every bar - same sparse-list
  // shape customTimerEngine's own getActive() already broadcasts, so the renderer side filters it
  // the same way. Two independent reasons a gem appears here: it's still within its own cooldown
  // window (durationSec/remainingSec are set), or it's the group's current active pick (isActive
  // true) regardless of whether that pick's cooldown has long since run out - see this file's own
  // header comment on why those are deliberately not the same lifetime. Lazily prunes any expired
  // cooldown entry as a side effect (the active flag survives that prune on its own).
  getAllActiveStates() {
    const now = Date.now();
    const out = [];
    for (const group of ['stance', 'invocation']) {
      for (const [key, entry] of this.cooldownByGroup[group]) {
        if (entry.expiresAt <= now) this.cooldownByGroup[group].delete(key);
      }
      const activeKey = this.activeSlotByGroup[group];
      const seen = new Set();
      for (const [key, entry] of this.cooldownByGroup[group]) {
        seen.add(key);
        out.push({
          barId: entry.barId,
          index: entry.index,
          group,
          durationSec: entry.durationSec,
          remainingSec: (entry.expiresAt - now) / 1000,
          isActive: key === activeKey,
        });
      }
      // The active gem's own cooldown may already be gone (pruned above, or never started this
      // session at all after a restart) - it still needs reporting so the border keeps showing.
      if (activeKey && !seen.has(activeKey)) {
        const slot = this.getGroupSlotsFn(group).find((s) => `${s.barId}:${s.index}` === activeKey);
        if (slot) {
          out.push({ barId: slot.barId, index: slot.index, group, durationSec: null, remainingSec: null, isActive: true });
        }
      }
    }
    return out;
  }

  // Called on a slower interval (see main.js) purely to broadcast countdown ticks and clear
  // expired cooldown entries even when nothing new has fired - same reasoning as every other
  // cooldown sweep in this app (customTimerEngine's own tick does the same).
  sweep() {
    const hadAnyCooldown = this.cooldownByGroup.stance.size > 0 || this.cooldownByGroup.invocation.size > 0;
    const hadAnyActive = this.activeSlotByGroup.stance || this.activeSlotByGroup.invocation;
    if (hadAnyCooldown || hadAnyActive) this.onChangeFn();
    this.getAllActiveStates(); // prunes expired cooldown entries even if nothing above was true
  }
}

module.exports = { AbilityGroupTracker, KNOWN_STANCES, KNOWN_INVOCATIONS };
