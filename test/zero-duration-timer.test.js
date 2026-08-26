'use strict';
/**
 * A 0-second custom timer trigger - see setTriggerDurationSec's own comment in widgetStore.js for
 * why 0 is a legitimate duration at all (a trigger built purely to make a noise, with nothing
 * meaningful to count down).
 *
 * Reported live: such a timer's sound went off "multiple times in a row" instead of once, and the
 * user asked for no visible tile popup at all for one. Two real, separate causes, both in
 * overlay.js's render()/checkSoundWarnings:
 *
 *   - checkSoundWarnings treats remainingSec against a threshold, and remainingSec is already 0
 *     the instant a 0-duration trigger lands - so `0 <= thresholdSec` is true for any positive
 *     threshold, firing a "warning" beep in the same breath as the land beep.
 *   - The tile disappears on the very next engine tick after landing (its own duration having
 *     already elapsed), which render() reads as a genuine expiry and fires the expire beep too -
 *     land, warning and expire all landing within under a second sounds like one sound repeating,
 *     not three different, correctly-behaving alerts.
 *
 * overlay.js as a whole needs a DOM (see merged-tiles.test.js's own note on this), so - like every
 * other overlay.js suite that isn't lifting a pure function out to run - this checks the SHAPE of
 * the fix via its source rather than executing render() for real.
 *
 * Two more, found after the first pass shipped and was reported still broken live:
 *
 *   - The tile was STILL visibly pulsing despite opacity:0. Cause: remainingSec is 0 for one of
 *     these too, which is always <= the low-time threshold, so it also got the .low class - and
 *     .low's CSS runs `animation: pulse infinite`, which ANIMATES opacity. A CSS animation
 *     overrides a static opacity value on the same property regardless of selector specificity,
 *     so .low's pulse was winning over .zero-duration-ping's opacity:0 the entire time.
 *   - The land sound sometimes played twice, timing-dependent on the engine's tick - render() is
 *     invoked from a dozen separate broadcast listeners (self buffs, ally buffs, custom timers,
 *     merge rule, etc - see the block of onXChanged wiring near the bottom of the file), so two
 *     near-simultaneous broadcasts could each independently observe a "new" landing. Fixed with a
 *     floor on how close together two plays of the SAME alert kind can land, in playAlertSound
 *     itself - a general guard rather than chasing every possible source of overlap.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const storeSrc = read('src', 'main', 'widgetStore.js');

test('a 0-second trigger is a legitimate duration at the store level, not clamped up to 1', () => {
  assert.match(
    storeSrc,
    /Math\.max\(0, Math\.min\(3600, Math\.round\(n\)\)\)/,
    'setTriggerDurationSec no longer allows 0 - this whole fix depends on 0 being reachable at all'
  );
});

test('the expire sound is checked against a set with zero-duration keys filtered out, not the raw justExpired', () => {
  const fn = overlaySrc.match(/function render\(buffs\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'render has been renamed or restructured');
  const body = fn[1];
  assert.match(
    body,
    /const justExpiredForSound = new Set\(\[\.\.\.justExpired\]\.filter\(\(name\) => !zeroDurationKeys\.has\(name\)\)\);/,
    'justExpiredForSound is missing or no longer filters zeroDurationKeys'
  );
  assert.match(
    body,
    /if \(currentConfig\.soundOnExpire && justExpiredForSound\.size > 0\) playAlertSound\('expire'\);/,
    'the expire check still reads the unfiltered justExpired - a 0s trigger will beep expire right alongside land again'
  );
  // zeroDurationKeys must be refreshed from the CURRENT buffs, not the visible/filtered list - the
  // whole point is remembering keys that are about to vanish from `buffs` entirely, and a widget's
  // own filters (buffFilterMode, excludedBuffNames, etc) are irrelevant to that.
  assert.match(
    body,
    /zeroDurationKeys = new Set\(\s*buffs\s*\.filter\(\(b\) => currentConfig\.buffSource === 'customTimer' && b\.durationSec === 0\)/,
    'zeroDurationKeys is no longer rebuilt from the raw buffs list with the right condition'
  );
});

test('checkSoundWarnings skips a 0-duration custom timer entirely, same as it already skips infinite buffs', () => {
  const fn = overlaySrc.match(/function checkSoundWarnings\(visible\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'checkSoundWarnings has been renamed or restructured');
  const body = fn[1];
  const infiniteAt = body.indexOf('if (buff.infinite)');
  const zeroDurAt = body.indexOf("currentConfig.buffSource === 'customTimer' && buff.durationSec === 0");
  const thresholdCheckAt = body.indexOf('if (buff.remainingSec > thresholdSec)');
  assert.ok(infiniteAt >= 0, 'the infinite-buff skip is gone - this test needs a different anchor');
  assert.ok(zeroDurAt >= 0, 'the zero-duration skip clause is missing');
  assert.ok(thresholdCheckAt >= 0, 'the threshold check has been restructured');
  // Must come before the threshold comparison, or `0 <= thresholdSec` is evaluated first and a
  // warning fires before this clause ever gets a chance to bail out.
  assert.ok(zeroDurAt < thresholdCheckAt, 'the zero-duration skip must run before the threshold check');
});

test('a 0-duration custom timer tile is given zero opacity, not skipped from rendering entirely', () => {
  // Skipping the tile outright would also skip it from `visible`/`visibleSet`, and sound only
  // ever fires for buffs a widget is actually "displaying" (see render()'s own comment on that
  // rule) - an invisible-but-present tile keeps the sound working, a missing one would not.
  const fn = overlaySrc.match(/function updateRef\(ref, buff, isIcon\) \{([\s\S]*?)\n {2}const threshold/);
  assert.ok(fn, 'updateRef has been restructured, or the zero-duration toggle has moved');
  assert.match(
    fn[1],
    /const isZeroDurationPing = currentConfig\.buffSource === 'customTimer' && buff\.durationSec === 0;/,
    'the zero-duration flag is no longer computed correctly'
  );
  assert.match(
    fn[1],
    /ref\.root\.classList\.toggle\('zero-duration-ping', isZeroDurationPing\);/,
    'the zero-duration-ping class is no longer toggled from the flag'
  );
});

test('.low is withheld from a zero-duration ping tile - the real cause of it still visibly pulsing', () => {
  // remainingSec is 0 for one of these too, which is always <= the low-time threshold, so without
  // this exclusion it also got .low - and .low's CSS runs `animation: pulse infinite`, which
  // animates opacity and overrides .zero-duration-ping's static opacity:0 outright, regardless of
  // selector specificity. Confirmed live: the "invisible" tile kept visibly pulsing until this.
  const fn = overlaySrc.match(/function updateRef\(ref, buff, isIcon\) \{([\s\S]*?)\n {2}const cooling/);
  assert.ok(fn, 'updateRef has been restructured');
  assert.match(
    fn[1],
    /const low = !isZeroDurationPing && !buff\.infinite && threshold > 0 && buff\.remainingSec <= threshold;/,
    'the low computation no longer excludes a zero-duration ping tile'
  );
});

test('the zero-duration-ping class hides the tile with !important, not just opacity:0 - and still via opacity, not display:none', () => {
  const rule = overlayCss.match(/\.zero-duration-ping\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'the .zero-duration-ping rule is missing from overlay.css');
  assert.match(
    rule[1],
    /opacity:\s*0\s*!important;?/,
    '!important is gone - a future animated class sharing this element could silently win over opacity again, the same way .low once did'
  );
  assert.doesNotMatch(
    rule[1],
    /display:\s*none/,
    'display:none would also pull the tile out of layout, causing its neighbours to visibly shift into its spot the instant it disappears - opacity keeps the layout stable'
  );
});

test('a widget that is not sourced from customTimer never gets its instants opacity-hidden by this rule', () => {
  // The buffSource check matters: self/ally instants (nukes, heals) also carry durationSec 0 and
  // are deliberately SHOWN on a text aura (see visibleBuffs' INSTANTS comment) - this fix must not
  // silently hide those too.
  const fn = overlaySrc.match(/function updateRef\(ref, buff, isIcon\) \{([\s\S]*?)\n {2}const threshold/);
  assert.ok(fn);
  assert.match(fn[1], /currentConfig\.buffSource === 'customTimer'/, 'the buffSource guard is missing - self/ally instants would be hidden too');
});

test('playAlertSound refuses to replay the same kind within a short floor - the fix for the double-firing land sound', () => {
  const fn = overlaySrc.match(/function playAlertSound\(kind\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'playAlertSound has been restructured');
  assert.match(fn[1], /const now = Date\.now\(\);/, 'no timestamp is taken any more');
  assert.match(
    fn[1],
    /const lastPlayed = lastAlertPlayedAt\.get\(kind\);/,
    'no longer reads a per-kind last-played time'
  );
  assert.match(
    fn[1],
    /if \(lastPlayed !== undefined && now - lastPlayed < MIN_ALERT_INTERVAL_MS\) return;/,
    'the debounce check is gone - two near-simultaneous broadcasts can double-fire the same alert again'
  );
  // Must record AFTER the debounce check, or the very first call would immediately debounce
  // itself (comparing now against a timestamp it just set for the very same call).
  const debounceAt = fn[1].indexOf('if (lastPlayed !== undefined');
  const recordAt = fn[1].indexOf('lastAlertPlayedAt.set(kind, now)');
  assert.ok(recordAt >= 0, 'the last-played time is never recorded');
  assert.ok(debounceAt < recordAt, 'recording the timestamp before checking it would debounce every single call, including the first');
  // Must come before the audible check bails out early, or muting the aura part-way through would
  // leave a stale timestamp that then debounces the very next real alert once sound comes back on.
  assert.match(fn[1], /if \(!audible\) return;\s*\n\s*const now = Date\.now\(\);/, 'the debounce must be evaluated on every call, not skipped while inaudible');
});

test('the debounce is per KIND, not global - a land and an expire in the same second must both still sound', () => {
  const fn = overlaySrc.match(/const lastAlertPlayedAt = new Map\(\);[\s\S]*?\n\n/);
  assert.ok(fn, 'lastAlertPlayedAt is missing or has moved');
  assert.match(fn[0], /kind -> ms timestamp/, "the map's own comment no longer documents it as per-kind");
  // The strongest proof it is actually keyed by kind rather than one shared timestamp: both
  // .get(kind) and .set(kind, ...) inside playAlertSound.
  const body = overlaySrc.match(/function playAlertSound\(kind\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /lastAlertPlayedAt\.get\(kind\)/);
  assert.match(body, /lastAlertPlayedAt\.set\(kind, now\)/);
});

module.exports = () => report('zero-duration-timer');
if (require.main === module) process.exit(report('zero-duration-timer') ? 1 : 0);
