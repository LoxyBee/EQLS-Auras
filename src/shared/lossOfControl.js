'use strict';
/**
 * Every "you can't act right now" landing/ending line pair the game is known to write for a
 * charm/fear/root/stun/mez/snare landing on the PLAYER. Originally lived only in widgetStore.js
 * (backlog #36's "Loss of control" text aura); moved here 16 Sep so damageEngine can recognize
 * the same lines without pulling in widgetStore's aura-building code. Both consumers read this
 * SAME list - see each one's own comment for how it uses it.
 *
 * `land` is the exact line the game writes when that control lands ON THE PLAYER, `end` a
 * substring of the line when it lifts. Both drawn from the roster's own landingText/endedText for
 * the charm / fear / root / snare / mez families plus what actually appears in the owner's logs
 * ("You are stunned!" / "You are no longer stunned." 352/387 times, "You are ensnared." / "You
 * have been entranced."). The game's universal "You are no longer X." fade wording makes `end`
 * reliable; the per-timer `secs` is only a safety net for a missed fade line. Not exhaustive -
 * mob-specific positional stuns and unusual roots won't all be here.
 *
 * `pausesCombat: true` marks the kinds that stop the player from swinging or casting at all
 * (charm/stun/mez/fear) - damageEngine's fight-idle timer pauses while one of these is active, so
 * a raid-wide fear (or similar) doesn't split one continuous pull into several. ROOTED/SNARED are
 * deliberately NOT flagged - you can still melee and cast while rooted or snared, only movement is
 * denied, so there's no reason to pause the fight-end clock for either.
 */
const LOSS_OF_CONTROL = [
  // The generic catch-all. The game writes "You lose control of yourself!" for a charm landing on
  // the player when no spell-specific land line is emitted - confirmed in the owner's log (8x on
  // 30 Aug, always paired with "You have control of yourself again." 6-35s later). Without this the
  // per-spell CHARMED entries below missed every charm that only produced the generic line. Listed
  // first so it is the fallback the others refine. 45s safety net matches the CHARMED entries (one
  // observed instance ran 35s); the end substring is what actually clears it.
  { label: 'CONTROLLED', land: 'You lose control of yourself!', end: 'You have control of yourself again.', secs: 45, pausesCombat: true },
  { label: 'STUNNED', land: 'You are stunned!', end: 'You are no longer stunned.', secs: 10, pausesCombat: true },
  { label: 'STUNNED', land: 'You are stunned by a gust of air.', end: 'You are no longer stunned.', secs: 10, pausesCombat: true },
  { label: 'STUNNED', land: 'You are struck by a sudden force.', end: 'You are no longer stunned.', secs: 10, pausesCombat: true },
  { label: 'MESMERIZED', land: 'You have been entranced.', end: 'You are no longer entranced.', secs: 45, pausesCombat: true },
  { label: 'MESMERIZED', land: 'You are mesmerized.', end: 'You are no longer mesmerized.', secs: 45, pausesCombat: true },
  { label: 'CHARMED', land: 'You have been charmed.', end: 'You are no longer charmed.', secs: 45, pausesCombat: true },
  { label: 'CHARMED', land: 'You are captivated by the bewitching tune.', end: 'You are no longer captivated.', secs: 45, pausesCombat: true },
  { label: 'CHARMED', land: 'You are captivated by the haunting tune.', end: 'You are no longer captivated.', secs: 45, pausesCombat: true },
  { label: 'AFRAID', land: 'Your mind fills with fear.', end: 'You are no longer afraid.', secs: 30, pausesCombat: true },
  { label: 'AFRAID', land: 'Your mind snaps in terror.', end: 'You are no longer terrified.', secs: 30, pausesCombat: true },
  // Screaming Terror (and other fears that write no "mind fills with fear" line) - confirmed in the
  // owner's log: "You begin to scream." on the land, "You stop screaming." when it breaks. A third-
  // person fear reads "<Name> begins to scream." the same way.
  { label: 'AFRAID', land: 'You begin to scream.', end: 'You stop screaming.', secs: 30, pausesCombat: true },
  { label: 'ROOTED', land: 'Your feet adhere to the ground.', end: 'Your feet come free.', secs: 40 },
  { label: 'ROOTED', land: 'Your feet become entwined.', end: 'The roots fall from your feet.', secs: 40 },
  // Earth Elemental Attack (an NPC-only proc, not a player spell) - confirmed spell data, 13 Sep:
  // "Your feet sink into the ground." on land, "Your feet come free." on wear-off (3 ticks = 18s;
  // the 40s safety net matches the rest of this ROOTED family rather than the exact spell duration,
  // same reasoning as the entries above it).
  { label: 'ROOTED', land: 'Your feet sink into the ground.', end: 'Your feet come free.', secs: 40 },
  { label: 'SNARED', land: 'You are ensnared.', end: 'You are no longer ensnared.', secs: 40 },
  { label: 'SNARED', land: 'Your legs feel weak.', end: 'Strength returns to your legs.', secs: 40 },
  { label: 'SNARED', land: 'You slow down as your feet are covered in tangling weeds.', end: 'The tangling weeds wither away.', secs: 40 },
];

module.exports = { LOSS_OF_CONTROL };
