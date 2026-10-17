'use strict';

// Undo / Redo for the move panel (owner, 16 Oct).
//
// The history is a list of SETTLED states - where everything the open move session can move sits -
// recorded a moment after each move lands (a drop, a nudge, a centre, a reset). Waiting for things
// to settle folds a quick run of arrow clicks into one step and never records a drag half-way.
// Undo / Redo step through the list and hand the state back to apply(), which puts every aura back
// exactly where that state had it. One history per session: start() when Move / Unlock all opens,
// clear() when it closes.
//
// capture() -> a JSON-clonable state; apply(state) restores one; onChange() is told whenever
// canUndo / canRedo may have changed. Timers are injectable for tests.
const SETTLE_MS = 400;
const MAX_STEPS = 100;

class MoveHistory {
  constructor({ capture, apply, onChange = () => {}, settleMs = SETTLE_MS, max = MAX_STEPS, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.capture = capture;
    this.apply = apply;
    this.onChange = onChange;
    this.settleMs = settleMs;
    this.max = max;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.states = [];
    this.index = -1;
    this.timer = null;
  }

  _cancelTimer() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  start() {
    this._cancelTimer();
    this.states = [this.capture()];
    this.index = 0;
  }

  clear() {
    this._cancelTimer();
    this.states = [];
    this.index = -1;
  }

  isActive() {
    return this.index >= 0;
  }

  // Something moved. Recorded once things have been still for settleMs.
  note() {
    if (!this.isActive()) return;
    this._cancelTimer();
    this.timer = this.setTimer(() => this.record(), this.settleMs);
  }

  record() {
    this._cancelTimer();
    if (!this.isActive()) return false;
    const now = this.capture();
    // Nothing actually moved (an undo's own restore lands here too) - not a new step.
    if (JSON.stringify(now) === JSON.stringify(this.states[this.index])) return false;
    this.states = this.states.slice(0, this.index + 1); // a new move drops whatever Redo had
    this.states.push(now);
    if (this.states.length > this.max) this.states.shift();
    this.index = this.states.length - 1;
    this.onChange();
    return true;
  }

  // dir -1 = Undo, +1 = Redo.
  step(dir) {
    if (this.timer) this.record(); // a move still settling counts as done first
    const next = this.index + dir;
    if (!this.isActive() || next < 0 || next >= this.states.length) return false;
    this.index = next;
    this.apply(this.states[next]);
    this.onChange();
    return true;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.isActive() && this.index < this.states.length - 1;
  }
}

module.exports = { MoveHistory, SETTLE_MS, MAX_STEPS };
