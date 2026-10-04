'use strict';
/**
 * A player typing a buff's exact wear-off text in chat must not remove that buff's tile.
 * Wear-off matching is a substring search of the whole line, so before this guard any say / tell /
 * shout / channel line containing the text counted as the buff fading.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { isChatLine } = require('../src/main/buffParser');

const TS = '[Wed Aug 19 19:23:03 2026] ';
const NAME = 'Test Fictional Ward';
const LAND = 'A fictional ward shimmers around you.';
const ENDED = 'The fictional ward fades away.';

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  buffStore.upsert(NAME, 600, { landingText: LAND, endedText: ENDED });
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  return engine;
}

function landed() {
  const engine = makeEngine();
  engine.handleLine(`${TS}You begin casting ${NAME}.`);
  engine.handleLine(`${TS}${LAND}`);
  assert.equal(engine.getActiveBuffs().length, 1, 'fixture: the ward should be active');
  return engine;
}

test('isChatLine recognises the chat wordings, and not game messages', () => {
  for (const l of [
    "Baxa says, 'hi'", "Baxa tells you, 'hi'", "Baxa tells the group, 'hi'",
    "Baxa tells General:1, 'hi'", "Baxa shouts, 'hi'", "Baxa auctions, 'hi'",
    "Baxa says out of character, 'hi'", "You say, 'hi'", "You told Baxa, 'hi'", "You tell the guild, 'hi'",
    `${TS}Baxa tells the guild, 'hi'`,
  ]) assert.equal(isChatLine(l), true, l);
  for (const l of [ENDED, LAND, 'You begin casting Foo.', 'Your Foo spell has worn off of Baxa.']) {
    assert.equal(isChatLine(l), false, l);
  }
});

test('chat containing the wear-off text does not end the buff', () => {
  const engine = landed();
  engine.handleLine(`${TS}Baxa tells the group, '${ENDED}'`);
  engine.handleLine(`${TS}You say, '${ENDED}'`);
  engine.handleLine(`${TS}Baxa tells General:1, 'lol ${ENDED}'`);
  assert.equal(engine.getActiveBuffs().length, 1, 'chat removed the tile');
});

test('the real wear-off line still ends it', () => {
  const engine = landed();
  engine.handleLine(`${TS}${ENDED}`);
  assert.equal(engine.getActiveBuffs().length, 0);
});

module.exports = () => report('chat-cannot-end-buff');
if (require.main === module) report('chat-cannot-end-buff').then((n) => process.exit(n ? 1 : 0));
