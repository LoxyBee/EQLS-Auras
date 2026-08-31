'use strict';
/**
 * Note 20's destination command, as the owner specified it on 23 August:
 *
 *   "the user should then be able to use a command to say where they want to go, the widget should
 *    then display the route. the user would type '/tell qeynos' which would then print 'qeynos is
 *    not online at this time', when this is seen, the widget would read qeynos as the destination."
 *
 * It is a good trick and it needed no new data to confirm, because she had already tried it - both
 * of these are sitting in her logs:
 *
 *     Qeynos is not online at this time.
 *     Me is not online at this time.
 *
 * Why it beats a text box: EverQuest has no way for an overlay to take typed input while the game
 * has focus, and alt-tabbing to the app to type a zone name is the thing anyone would stop doing
 * after the second time. A failed /tell is the only channel the game gives back for free - the
 * server echoes the name you typed, exactly, on one line.
 *
 * A /tell name cannot contain a space, which is why the resolver in zoneRouting has to work from
 * one word: "qeynos" rather than "South Qeynos".
 */

// The exact wording, measured rather than remembered. Character names are letters only - the same
// shape the rest of this codebase uses for a player name - which is also what stops this matching
// a sentence somebody typed in chat that happens to end the same way.
//
// Anchored on the timestamp for the same reason the zone matcher is: it is what proves the line
// came from the game rather than from inside somebody's chat message.
const OFFLINE_TELL_PATTERN =
  /^\[[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}\] ([A-Za-z]+) is not online at this time\.$/;

/**
 * The name from a failed /tell, or null.
 *
 * Returns the word as typed. Resolving it to a zone is somebody else's job - see
 * resolveDestinationName in zoneRouting - because "is this a zone" and "did the game just tell me
 * a name" are separate questions, and only one of them needs the zone graph.
 */
function matchOfflineTell(line) {
  if (typeof line !== 'string') return null;
  const m = OFFLINE_TELL_PATTERN.exec(line.trim());
  return m ? m[1] : null;
}

module.exports = { matchOfflineTell };
