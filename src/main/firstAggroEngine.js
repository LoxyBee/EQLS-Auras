'use strict';

const EventEmitter = require('events');
const { parseDamageLine } = require('../shared/damageLines');
const { matchZoneChange, matchSlain } = require('./buffParser');

// The "First aggro" aura (owner's original note #2). It answers one question at the start of a
// fight: who took the first hit - did someone in the group hit the mob, or did the mob hit one of
// yours first (the body-pull tell). One line, held for the fight, gone when the mob dies or you
// zone.
//
// A pure log-line observer, same DI shape as the other engines (no electron, no fs, no clock -
// `now` is passed in). The hard "is this name a mob or a player" question is settled the same way
// the aggro-board module settles it: an article (a / an / the) in front of a name is
// unambiguously a mob; "You" is unambiguously you; a bare name that isn't either is left
// unlabelled rather than guessed at.

const FIGHT_GAP_MS = 12000; // no combat for this long => the next hit is a fresh pull
const ARTICLE = /^(?:a|an|the) /i;

function isMob(name) {
  return ARTICLE.test(name || '');
}

class FirstAggroEngine extends EventEmitter {
  constructor() {
    super();
    this.lastCombatAt = 0;
    this.current = null; // { attacker, target, kind, side, at }
    this._debugLog = () => {};
  }

  setDebugLogFn(fn) { this._debugLog = typeof fn === 'function' ? fn : () => {}; }

  // No timers, nothing to tear down - kept for parity with the other engines' lifecycle.
  stop() {}

  reset() {
    const had = this.current !== null;
    this.current = null;
    this.lastCombatAt = 0;
    if (had) this.emit('changed', this.getActive());
  }

  // --- session restore (see sessionRestore.js) -------------------------------
  // One line, held for the fight. A quick restart mid-fight keeps it; the registry only offers it
  // back within a short window (2 min) because "X pulled" goes stale fast. `at`/`lastCombatAt` are
  // absolute, so the next genuinely fresh hit (> FIGHT_GAP_MS after lastCombatAt) still correctly
  // replaces a restored line rather than being folded into it.
  captureState() {
    if (!this.current) return null;
    return { current: this.current, lastCombatAt: this.lastCombatAt };
  }

  restoreState(s) {
    if (!s || !s.current) return 0;
    this.current = s.current;
    this.lastCombatAt = typeof s.lastCombatAt === 'number' ? s.lastCombatAt : 0;
    this.emit('changed', this.getActive());
    return 1;
  }

  handleLine(line, now = Date.now()) {
    if (typeof line !== 'string') return;

    // A zone line ends the current fight context - never replays, so nothing to rebuild.
    if (matchZoneChange(line)) { this.reset(); return; }

    // The tracked mob died: the fight is over, drop the line.
    const slain = matchSlain(line);
    if (slain && this.current) {
      const dead = slain.toLowerCase();
      const t = (this.current.target || '').toLowerCase();
      const a = (this.current.attacker || '').toLowerCase();
      if (dead === t || dead === a) { this.reset(); return; }
    }

    const hit = parseDamageLine(line);
    if (!hit) return;
    // A damage-shield tick is always a RETALIATION - the mob had to hit you for your shield to
    // fire - so it can never be the opening hit of a pull. Let it move lastCombatAt (the fight is
    // clearly live) but never let it START a fight record.
    const canOpen = hit.kind !== 'shield';

    const fresh = canOpen && (this.current === null || (now - this.lastCombatAt) > FIGHT_GAP_MS);
    this.lastCombatAt = now;
    if (!fresh) return;

    const attacker = hit.attacker;
    const target = hit.target;
    let side = 'unknown';
    if (attacker === 'You') side = 'you';
    else if (isMob(attacker) && !isMob(target)) side = 'mob';        // a mob hit one of yours first
    else if (!isMob(attacker) && isMob(target)) side = 'friend';     // a groupmate hit the mob first

    this.current = { attacker, target, kind: hit.kind, side, at: now };
    this._debugLog(`FIRST AGGRO ${this.getActive()[0].text} (${side}, ${hit.kind})`);
    this.emit('changed', this.getActive());
  }

  // At most one row. The overlay draws it as an infinite, buff-shaped tile (see main.js).
  getActive() {
    if (!this.current) return [];
    const { attacker, target, side } = this.current;
    let text;
    if (side === 'you') text = `You pulled ${strip(target)}`;
    else if (side === 'friend') text = `${strip(attacker)} pulled ${strip(target)}`;
    else if (side === 'mob') text = `${strip(attacker)} hit ${strip(target)} first`;
    else text = `${strip(attacker)} → ${strip(target)}`;
    return [{ text, side }];
  }
}

// Drop a leading article for display ("a zol ghoul knight" -> "zol ghoul knight") - the article is
// the mob/player signal, not part of the name anyone reads.
function strip(name) {
  return String(name || '').replace(ARTICLE, '');
}

module.exports = { FirstAggroEngine, FIGHT_GAP_MS };
