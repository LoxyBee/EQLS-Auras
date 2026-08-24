'use strict';
/**
 * Note 30 - spotting a share code somebody has pasted into chat.
 *
 * The note was blocked on two questions and both are now answered from the owner's own logs
 * rather than guessed at.
 *
 * DO + AND = SURVIVE A CHAT LINE? Yes. Shara said so on 23 August ("+= survive fine in a chat
 * line") and the logs agree: across 1,521,971 lines, 1,393 chat messages contain a +, 135 contain
 * an =, and 921 contain a /. Base64's whole alphabet passes through intact.
 *
 * WHAT IS THE PER-LINE LIMIT? Not published anywhere, so it was measured instead. The longest
 * player-typed message in her logs is 403 characters, which makes 403 the floor - the real limit
 * is at least that and possibly higher. Against that, real share codes measure:
 *
 *     79   an untouched Self Buffs aura
 *    119   the debuff template
 *    131   a damage meter
 *    167   a travel guide
 *    231   a cooldown timer
 *    651   a deliberately heavy aura - 40 buff names, 6 timers with conditions, 3 zone limits
 *
 * So ordinary auras fit in one chat line with room to spare, and an elaborate one does not. That
 * is a real limit and it is handled by saying so (see splitReason) rather than by pretending: a
 * truncated code fails to decode, and "that code was cut off by the chat line limit" is something
 * a person can act on where "invalid code" is not.
 *
 * NOTHING HERE IMPORTS ANYTHING. This module only recognises. A code arriving from chat is text
 * another player typed, and applying it would let someone else reconfigure the app by talking -
 * so the only thing that ever happens automatically is a prompt.
 */

// Must match widgetStore's SHARE_CODE_PREFIX. Not imported from there on purpose: widgetStore
// pulls in the profile store and the filesystem, and this has to be usable from a plain parser.
// The test suite asserts the two are the same string, which is the part that would actually break.
const SHARE_CODE_PREFIX = 'EQLSAURAS1-';

// Base64 alphabet only. Deliberately NOT a lazy ".+" - a code sits inside a chat message that can
// have words after it ("EQLSAURAS1-abc123 try this one"), and anything looser would swallow them
// and turn a valid code into an invalid one.
const CODE_PATTERN = new RegExp(`${SHARE_CODE_PREFIX}[A-Za-z0-9+/=]+`);

/**
 * The chat wordings the game uses, measured from the owner's logs rather than listed from memory:
 * "tells the guild" (1,478), "tells the group" (115), "says" (101), "tells general1:1" (76),
 * "tells you" (44), "says out of character" (9), "tells the raid" (6).
 *
 * Everything before the comma-quote is the speaker and the channel. The name is captured because a
 * prompt saying who sent it is the difference between a person deciding and a person guessing.
 */
const CHAT_PATTERN =
  /^(?:\[[^\]]+\]\s*)?([A-Za-z]+) (says out of character|says|shouts|auctions|tells [^,]+), '(.*)'$/;

/**
 * A share code pasted into chat, or null.
 *
 * Returns { sender, channel, code }. Anything that is not a chat line, or is a chat line with no
 * code in it, is null - including a line the GAME wrote that happens to contain the prefix, since
 * those do not match the chat shape.
 */
function matchShareCodeInChat(line) {
  if (typeof line !== 'string') return null;
  const chat = CHAT_PATTERN.exec(line.trim());
  if (!chat) return null;
  const found = CODE_PATTERN.exec(chat[3]);
  if (!found) return null;
  return { sender: chat[1], channel: chat[2], code: found[0] };
}

/**
 * Why a code that will not decode probably will not decode, in words a person can act on.
 *
 * Only ever a guess at the cause, which is why it is phrased as one. The caller has already tried
 * to decode and failed; this exists so the message is "it looks cut off" rather than "invalid".
 */
function splitReason(code) {
  if (typeof code !== 'string') return null;
  const body = code.slice(SHARE_CODE_PREFIX.length);
  // Base64 arrives in groups of four. A length that is not a multiple of four, on a code long
  // enough to have run into a line limit, is the signature of a message cut short.
  if (body.length >= 300 && body.length % 4 !== 0) {
    return 'It looks like the message was cut off - the aura may be too big to send in one line.';
  }
  return null;
}

module.exports = { matchShareCodeInChat, splitReason, SHARE_CODE_PREFIX };
