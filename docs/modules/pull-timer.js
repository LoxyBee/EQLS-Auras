// Pull Timer - a worked example module for EQLS Auras. See docs/MODULE-AUTHORING.md.
//
// This file lives with the source as a reference. To USE it, copy it into
//   <userData>/modules/pull-timer.js
// (on Windows: %APPDATA%\EQ Buff Tracker\modules\). It is not loaded from docs/.
//
// What it does: watches guild / group / say chat for a start word ("pulling" by default) and
// starts a countdown of a configurable length on the overlay; a cancel word ("hold") clears it.

module.exports = {
  id: 'pull-timer',
  name: 'Pull Timer',
  apiVersion: 1,
  description: 'A shared countdown started from a chat command.',
  hasAura: true,
  // 'aura' (the default) puts the three controls below on this module's aura settings panel, with
  // no sidebar nav button. That is the recommended shape - reach for settingsUI: 'sidebar' only
  // when a module has enough GLOBAL options that an aura panel would be cramped.
  settingsUI: 'aura',

  page: [
    { section: 'Timing' },
    { key: 'seconds', type: 'slider', label: 'Pull length', min: 3, max: 30, step: 1, default: 10 },
    { section: 'Trigger' },
    { key: 'startWord', type: 'text', label: 'Start on the word', default: 'pulling' },
    { key: 'cancelWord', type: 'text', label: 'Cancel on the word', default: 'hold' },
  ],

  onLine(line, ctx, settings) {
    const msg = ctx.stripTimestamp(line);

    // Only react to chat the player or a groupmate typed, not combat spam or emotes.
    if (!/ (tells the group|tells the guild|say[s]?),/.test(msg)) return null;

    const lower = msg.toLowerCase();
    if (settings.cancelWord && lower.includes(settings.cancelWord.toLowerCase())) {
      return { key: 'pull', clear: true };
    }
    if (settings.startWord && lower.includes(settings.startWord.toLowerCase())) {
      const s = Number(settings.seconds) || 10;
      return { key: 'pull', name: 'Pull', durationSec: s, remainingSec: s };
    }
    return null;
  },
};
