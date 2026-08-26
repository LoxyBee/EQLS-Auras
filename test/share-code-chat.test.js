'use strict';
/**
 * Note 30 - noticing a share code somebody pasted into chat.
 *
 * The note was blocked on two questions. Both are answered from the owner's logs, and the numbers
 * are asserted here rather than left in a commit message, because they are the whole reason this
 * stopped being blocked:
 *
 *   Do + and = survive a chat line?  Yes. 1,393 chat messages in her logs contain a +, 135 an =,
 *                                    921 a /. She said so too; the logs agree.
 *   What is the per-line limit?      Unpublished, so measured: the longest player-typed message in
 *                                    1,521,971 lines is 403 characters. Real codes run 79-231 for
 *                                    ordinary auras, so they fit; a deliberately heavy one hits
 *                                    651 and does not.
 *
 * The other thing under test is the safety shape. A code in chat is text another player typed, so
 * this module recognises and never applies - and there is deliberately no channel that would let
 * it.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { matchShareCodeInChat, splitReason, SHARE_CODE_PREFIX } = require('../src/shared/shareCodeChat');

const T = '[Wed Aug 19 21:14:02 2026] ';
const chat = (who, how, msg) => `${T}${who} ${how}, '${msg}'`;

// ---------------------------------------------------------------------------
// Recognising one
// ---------------------------------------------------------------------------

// Every wording here was counted in the owner's logs: tells the guild (1,478), tells the group
// (115), says (101), tells general1:1 (76), tells you (44), says out of character (9),
// tells the raid (6). Written from the measurements, not from memory.
test('every chat wording the game actually uses is recognised', () => {
  for (const how of [
    'says',
    'shouts',
    'auctions',
    'says out of character',
    'tells the guild',
    'tells the group',
    'tells the raid',
    'tells you',
    'tells general1:1',
  ]) {
    const found = matchShareCodeInChat(chat('Avenrae', how, `${SHARE_CODE_PREFIX}abc123`));
    assert.ok(found, `not recognised: ${how}`);
    assert.equal(found.sender, 'Avenrae');
    assert.equal(found.channel, how);
  }
});

test('the code is picked out of a message with words around it', () => {
  const found = matchShareCodeInChat(chat('Avenrae', 'says', `try this ${SHARE_CODE_PREFIX}abc123 and tell me`));
  assert.equal(found.code, `${SHARE_CODE_PREFIX}abc123`);
});

// The reason the pattern is a base64 character class and not a lazy match: a looser one swallows
// the words after the code and turns a valid code into an invalid one.
test('trailing words are not swallowed into the code', () => {
  const found = matchShareCodeInChat(chat('Avenrae', 'says', `${SHARE_CODE_PREFIX}abc123 hello there`));
  assert.equal(found.code, `${SHARE_CODE_PREFIX}abc123`);
  assert.ok(!found.code.includes('hello'));
});

// Base64's full alphabet, which is the half of the blocker Shara answered directly.
test('a code containing + / and = comes through whole', () => {
  const code = `${SHARE_CODE_PREFIX}ab+cd/ef==`;
  assert.equal(matchShareCodeInChat(chat('Avenrae', 'says', code)).code, code);
});

test('a chat line with no code in it is nothing', () => {
  assert.equal(matchShareCodeInChat(chat('Avenrae', 'says', 'no code here')), null);
});

// A line the GAME wrote is not somebody speaking, even if the prefix appears in it.
test('a game line containing the prefix is not treated as chat', () => {
  assert.equal(matchShareCodeInChat(`${T}Your Plague III spell has worn off. ${SHARE_CODE_PREFIX}abc`), null);
  assert.equal(matchShareCodeInChat(`${T}You have entered Rivervale.`), null);
});

test('rubbish input is refused rather than throwing', () => {
  for (const bad of [null, undefined, 42, '', '   ']) {
    assert.equal(matchShareCodeInChat(bad), null);
  }
});

// ---------------------------------------------------------------------------
// The prefix, which lives in two files
// ---------------------------------------------------------------------------

// widgetStore is not imported into the parser on purpose - it pulls in the profile store and the
// filesystem. So the two copies of the prefix are checked against each other here, because a
// silent drift between them means codes stop being recognised with nothing to show why.
test('the prefix matches the one widgetStore actually writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'widgetStore.js'), 'utf8');
  const m = src.match(/const SHARE_CODE_PREFIX = '([^']+)'/);
  assert.ok(m, 'widgetStore no longer declares SHARE_CODE_PREFIX the same way');
  assert.equal(SHARE_CODE_PREFIX, m[1]);
});

// ---------------------------------------------------------------------------
// Codes that will not fit
// ---------------------------------------------------------------------------

test('a code cut off by the line limit is explained rather than called invalid', () => {
  // 301 base64 characters, which is not a multiple of four - the signature of a truncated message.
  const truncated = SHARE_CODE_PREFIX + 'a'.repeat(301);
  const reason = splitReason(truncated);
  assert.ok(reason, 'a long ragged code should get an explanation');
  assert.match(reason, /cut off/);
});

test('a short code that simply does not decode gets no invented explanation', () => {
  assert.equal(splitReason(`${SHARE_CODE_PREFIX}abc`), null);
});

test('a long well-formed code is not accused of being truncated', () => {
  assert.equal(splitReason(SHARE_CODE_PREFIX + 'a'.repeat(400)), null);
});

// ---------------------------------------------------------------------------
// The measurements the unblocking rests on
// ---------------------------------------------------------------------------

// Real codes, from the real exporter. If a future change makes ordinary auras export much larger
// codes, the "it fits in one chat line" claim stops being true and this is where it shows up.
test('an ordinary aura exports a code that fits in a chat line', () => {
  const { WidgetStore } = require('../src/main/widgetStore');
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const ws = new WidgetStore(store);
  // 403 is the longest player-typed message measured across her logs, so it is the floor for what
  // the server accepts - not a published limit, which is why this is a measurement and not a spec.
  const MEASURED_CHAT_FLOOR = 403;
  const cases = [
    ['self buffs', ws.getAll()[0].id],
    ['debuff template', ws.createDebuff('Mez').id],
    ['damage meter', ws.createDamageMeter('Damage').id],
    ['travel guide', ws.createTravelGuide('To Faydark', { destination: 'The Greater Faydark' }).id],
    ['cooldown timer', ws.createCooldownTimer('CD', { spellName: 'Cannibalize', cooldownSec: 12 }).id],
  ];
  for (const [label, id] of cases) {
    const len = ws.exportCode(id).length;
    assert.ok(len <= MEASURED_CHAT_FLOOR, `${label} exports ${len} chars, over the ${MEASURED_CHAT_FLOOR} measured`);
  }
});

// The honest other half. An elaborate aura does NOT fit, and that is recorded rather than papered
// over - the app says the message looks cut off instead of pretending the code was invalid.
test('a heavy aura genuinely does not fit, which is why the explanation exists', () => {
  const { WidgetStore } = require('../src/main/widgetStore');
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const ws = new WidgetStore(store);
  const big = ws.createDebuff('Everything');
  ws.update(big.id, {
    buffNames: Array.from({ length: 40 }, (_, i) => `Some Long Spell Name ${i}`),
    visibleInZones: ['Rivervale', 'Misty Thicket', 'The Greater Faydark'],
  });
  for (let i = 0; i < 6; i += 1) {
    ws.addCustomTimer(big.id, {
      name: `Timer ${i}`,
      durationSec: 30,
      triggerText: `a fairly long trigger line number ${i}`,
      endedText: `a fairly long ended line for timer number ${i} as well`,
    });
  }
  assert.ok(ws.exportCode(big.id).length > 403, 'if this now fits, the limitation has gone away');
});

// ---------------------------------------------------------------------------
// Nothing imports itself
// ---------------------------------------------------------------------------

// The safety shape, checked structurally because it is the kind of thing a later change could undo
// without anything failing. A code from chat must reach a person before it reaches the store.
test('there is no channel that applies a code straight from chat', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload-main.js'), 'utf8');
  const at = preload.indexOf('onShareCodeOffered');
  assert.notEqual(at, -1, 'the offer channel has been renamed');
  // Receive-only: the renderer is told, and everything after that is a button someone presses.
  assert.ok(
    !preload.includes('shareCode:apply') && !preload.includes('shareCode:import'),
    'a channel that imports a chat code without asking has appeared'
  );
});

test('the main process offers rather than imports', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  // lastIndexOf, not indexOf. The first occurrence is the require at the top of the file, and a
  // window starting there contains none of the handler - so the check passed nothing and failed
  // for the wrong reason the first time it ran.
  const at = main.lastIndexOf('matchShareCodeInChat');
  assert.notEqual(at, -1);
  const block = main.slice(at, at + 1600);
  assert.ok(block.includes('peekShareCode'), 'it should look at the code');
  assert.ok(
    !block.includes('importCode') && !block.includes('applyCodeToSelfBuffs'),
    'the chat path must never call an import function'
  );
});

module.exports = () => report('share-code-chat');
if (require.main === module) process.exit(report('share-code-chat') ? 1 : 0);
