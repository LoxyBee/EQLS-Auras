# Testing checklist

Everything built but not yet confirmed working **in real gameplay**. Isolated
Node tests and clean restarts prove code paths run; they don't prove the app
behaves correctly against the live log, so nothing counts as done until it's
been seen working in-game.

**Status key**
- `[ ]` not yet tested live
- `[x]` confirmed working in-game
- `[!]` tested and FAILED - details inline, needs another pass

Mark items `[x]` as they're confirmed. When everything in a section is `[x]`,
move the whole section to "Confirmed" at the bottom so the active list stays
short.

---

## Run the automated tests first

```
npm test
```

Zero dependencies, a few seconds, and it covers a lot of what used to need a
character standing in a zone. If it is red, nothing below is worth doing yet -
read the failure text, it says what broke and why.

Eighteen suites at the time of writing:

| Suite | Guards |
|---|---|
| `test/pin.test.js` | the userData pin, including the realistic way to break it - adding a `require` above it in `main.js` |
| `test/roster.test.js` | roster shape, and a snapshot of what detection can do, so a change that quietly costs coverage fails loudly |
| `test/roster-migration.test.js` | the one-time roster replacement: custom buffs survive, overlay choices survive, it runs once, and it writes nothing into app data |
| `test/memorized-cap.test.js` | the fourteen-gem cap, including re-memorising refreshing an entry and an oversized saved file healing on load |
| `test/focus-game.test.js` | the refocus-EverQuest call: targets `eqgame` by process name, restores a minimised window, never throws |
| `test/renderer-wiring.test.js` | the settings window's markup against its script: every id looked up exists, every slider is populated from the aura, modals opt out of the drag region |
| `test/trade-ping.test.js` | the trade-request line pattern, run against your own real logs - it must fire on requests and on nothing else |
| `test/sound-only.test.js` | sound-only auras: the mode survives saving and sharing, a foreign mode cannot arrive by either import route, every aura type still carries every sound setting, and the overlay's early return stays between the alerts and the drawing |
| `test/visibility.test.js` | the whole precedence model - profile membership as the on/off switch, "Hide auras" beating unlock, unlocking one aura beating its profile, and off meaning silent as well as invisible |
| `test/move-box.test.js` | the name pill in the move box: that it opts out of the drag region (a click inside one never fires), that it does not swallow the draggable area, and that every hop from the pill to the settings page exists |
| `test/buff-timer-premade.test.js` | the Buff timer premade: that it builds one-spell auras in a single call, offers only spells the app can detect, and refuses to offer ally tracking for a spell that has no third-person message |
| `test/infinite-duration.test.js` | spells that never run out: that they are marked in the overrides file with a reason, that no sweep removes them, that nothing instant got marked by mistake, and the three places where `null <= 30` being true would have broken them |
| `test/detection.test.js` | the detection engine's first real coverage - a landing starts a timer, its ended text stops it, a blocked buff never lands, someone else's cast is not counted as yours, and a spell with no duration produces no tile instead of an unkillable one |
| `test/spellbook-diagnostic.test.js` | that the spellbook status says what is missing and how to fix it, rather than promising it will appear on its own |
| `test/category-borders.test.js` | the coloured edges: that the roster's categories, the overlay's list and the stylesheet's colours all still agree, since a spell whose category nothing has a colour for loses its edge silently |
| `test/text-aura.test.js` | text auras: the one-tile rule, what the words say, that it never becomes a fourth Display style radio, and that the dispel announcer's attested trigger still appears in your own logs |
| `test/merged-tiles.test.js` | the merging maths run for real - both rules, per-person bucketing, which member the tile names - plus the two places merging meets the rest of the overlay: glow and sound matching members rather than tile keys, and a changing count forcing a rebuild |
| `tools/lib/xlsx.test.js` | the spreadsheet reader, including the empty-cell bug that silently shifted every column |

If the roster capability snapshot fails after a deliberate roster change, read
the printed delta, and if every moved number is intended:

```
node test/roster.test.js --update
```

---

## NEEDS THE LIVE CLIENT - Shara only

Everything in this section was **deliberately not attempted** in the build
environment. It needs EverQuest actually running, and driving the app by
synthetic clicks while a real session is open is not safe - during this work a
stray automated click landed in the game window, which is exactly the reason
this section exists.

Nothing here has been verified. Treat every item as unknown, not as working.

### Refocus EverQuest after answering an ambiguous cast *(new)*

The call itself is unit-tested; whether Windows honours it is not testable
without a real desktop. Windows refuses foreground changes from a process that
is not already foreground under some conditions, so this is the one that most
plausibly does nothing in practice.

- [ ] Answer an ambiguous cast popup with EQ behind it. *Expect*: EQ comes to
      the front by itself, no alt-tab needed.
- [ ] With **several** questions queued, answer the first. *Expect*: focus does
      NOT jump to the game yet - it should only happen once the last one is
      answered, or you get thrown out of the popup mid-way.
- [ ] Answer a question with EQ **minimised**. *Expect*: the game is restored,
      not merely focused.
- [ ] Close EQ, trigger a question from a replayed log, answer it. *Expect*:
      nothing happens and no error appears.

### The un-clickable name box in "New loadout profile" *(fix applied, unconfirmed)*

The window is frameless and its title bar is a drag region. Drag regions are
hit-tested by Windows before the page sees the click, so modal content
overlapping the top 32px cannot be clicked - the click moves the window instead.
A tall modal in a short window centres far enough up for that to reach its first
input, which fits the symptom. Modals now opt out of the drag region.

**This was never reproduced, so the diagnosis may be wrong.**

- [ ] Open the `+` new-profile dialog and click the name box. *Expect*: a
      cursor appears and typing works.
- [ ] Repeat with the window **as short as it goes** (480px minimum) and with
      several auras configured, so the checklist makes the modal tall. This is
      the case the theory predicts used to fail.
- [ ] Repeat maximised. If it fails **here**, the diagnosis is wrong - say so,
      because the real cause is then still unfound.

### App text size *(new - needs looking at)*

Scaling is done with Electron's zoom factor rather than by rewriting the
stylesheet, because main-window.css carries 316 hardcoded px values across 39
distinct sizes and converting all of them by hand, with no layout tests, would
get some wrong in ways only visible by eye. Zoom scales text, spacing and
controls together and cannot drift out of step with itself.

The wiring is tested; how it *looks* is not. I attempted a screenshot and could
not get a reliable one without stealing focus from the running game, so this is
yours.

- [ ] **Setup > App text size** moves the whole window together - text, padding,
      buttons - with nothing clipped or overlapping at 80% or at 160%.
- [ ] **It survives a restart.** Set 130%, close, reopen. *Expect*: still 130%,
      and the slider reads 130 rather than snapping back.
- [ ] **Your auras are unaffected** at every setting. They have their own sizes
      per aura and must not move.
- [ ] **Reset returns to 100%.**
- [ ] At 160%, check the **frameless title bar** still looks right and the
      window can still be dragged and closed.
- [ ] **Auras must NOT rezoom.** Set 160%, then look at an aura. Chromium keys
      zoom by origin within a session, and every window here loads a `file://`
      page in the same session - so "it cannot leak" is an assumption, not
      something the code enforces. If auras DO change size, say so: the fix is
      to give them their own session partition.
- [ ] **Ctrl+R does not reset it.** Reload the window at 130%. *Expect*: still
      130%. An earlier version used a one-shot listener that did not re-arm.
- [ ] At 160%, open a modal (Add aura) and check its content is reachable -
      a scaled-up modal is taller, which is exactly the case the drag-region
      fix above is about.

### Resizable sidebar *(new - needs looking at)*

- [ ] **Drag the edge of the sidebar.** *Expect*: it resizes smoothly, the
      cursor becomes a horizontal resize arrow over the handle, and the drag
      keeps working when the pointer moves fast enough to outrun the handle.
- [ ] **It survives a restart.** Widen it, close, reopen. *Expect*: still wide.
- [ ] **Double-click the handle** restores the default width.
- [ ] **Shrink the window very narrow, then widen it again.** *Expect*: the
      sidebar gives way while narrow, and your chosen width comes back when
      there is room. It must NOT be permanently shrunk - that is the specific
      bug the two-clamp split exists to prevent.
- [ ] **Profile tooltips still escape the sidebar** rather than being clipped -
      the reason a real handle was used instead of CSS `resize`.
- [ ] **At 640px wide** (the minimum window width) the widest pages still read
      sensibly. The page area gained `min-width: 0`, which changes how narrow
      windows lay out independently of the sidebar.
- [ ] **Combined with App text size at 160%**, both still behave - the sidebar
      width is in CSS pixels, so zoom scales it too.

### Trade request ping *(new - needs looking at)*

The line pattern is tested against your real logs; whether a sound comes out of
your speakers is not testable here.

- [ ] **Turn it on in Setup > Trade requests.** *Expect*: a two-note ping the
      moment you enable it, confirming what was just switched on.
- [ ] **Test button** plays the same ping.
- [ ] **Have someone request a trade.** *Expect*: the ping fires once, and
      nothing appears on screen - this is the first sound in the app with no
      tile behind it.
- [ ] **Complete or cancel that trade.** *Expect*: NO further ping. Only the
      request pings, deliberately.
- [ ] **It survives a restart** with the checkbox still ticked.
- [ ] **With the setting off**, a trade request pings nothing.
- [ ] Worth one check: **does it ping when the settings window is minimised?**
      It lives in that window's renderer. The window stays alive for the app's
      whole lifetime, so it should - but browsers throttle background timers,
      and if it turns out to miss pings while minimised, say so.

### Sound-only auras *(new - needs looking at)*

A new **Display style: Sound only**, plus a **Sound only** entry in the premade
list. An aura in this mode draws nothing at all and exists purely to make a
noise. Everything below is about whether the sound actually reaches your
speakers and whether the aura truly leaves no mark on screen - neither of which
can be checked without the client.

The one thing worth watching hardest is the third item. A sound-only aura is
deliberately exempt from the auto-hide-when-EverQuest-is-unfocused behaviour,
because there is nothing of it on screen to hide and a hidden window is one
Chromium is entitled to throttle. That reasoning is sound but it has not been
observed, and if it is wrong the symptom is a missed alert, not an error.

- [ ] **Add one from "+ Add aura" > Custom aura > Custom sound aura.** *Expect*: it lands on its
      own settings page, drawing nothing anywhere on screen. It used to be a Display style radio
      and a premade; both are gone, so check there is now exactly ONE way to make one.
- [ ] **Check the Display style radios are not shown** on a sound aura or a text aura, and that
      List and Icons are the only two options on your other auras.
- [ ] **Switch a sound aura's "Buffs shown" to "Your own text triggers"** and add one. *Expect*:
      the option is there, and the trigger makes the noise.
- [ ] **The settings page hides what cannot apply**: no Sort by, no Opacity, no
      Unlock/Reset position, no Timer text or Alerts sections. Sounds, Buffs
      shown, profiles and the name box all stay.
- [ ] **Pick a buff under "Buffs shown", leave "Play a sound when a buff
      expires" on, and let that buff run out.** *Expect*: a sound, and nothing
      drawn at any point.
- [ ] **Do the same with EverQuest in focus, then with the app in focus and
      EverQuest behind it, then with EverQuest minimised.** *Expect*: the sound
      every time. If it goes quiet in any of those, say which - that is the
      throttling question above, and it is the most likely thing to be wrong.
- [ ] **Unlock it** (via "Unlock all auras" on the overview, since it has no
      unlock button of its own). *Expect*: still nothing on screen - no dashed
      blue box. Every other aura should still show theirs.
- [ ] **Switch an existing aura that has tiles on screen to Sound only.**
      *Expect*: its tiles disappear immediately, without waiting for a buff to
      change, and it keeps making its sounds.
- [ ] **Switch it back to List.** *Expect*: it returns exactly as it was -
      same width, same opacity, same sort order. Nothing should have been lost.
- [ ] **Untick every profile for it.** *Expect*: it goes silent. Profile
      membership is still the on/off switch, and this is the check that it did
      not get exempted along with everything else.
- [ ] **Restart the app.** *Expect*: it is still sound-only, still silent on
      screen, still audible.
- [ ] **Export its share code and import it back.** *Expect*: the copy is
      sound-only too. A custom sound FILE deliberately does not travel - the
      copy falls back to the default beep, which is correct, not a bug.
- [ ] **Pick a custom sound file for it, then press Export.** *Expect*: a line under the code
      saying the file will NOT travel, worded more strongly than on an ordinary aura because for
      this one the sound is the whole aura. With only the default beeps, no message at all.

### Sounds on every aura type

Sound settings were already available on every kind of aura; nothing needed
adding. Worth one pass to confirm that is true in practice as well as in the
markup.

- [ ] Open the **Sounds** section on Self Buffs, on an Ally Buffs aura, on a
      custom buff aura, and on a custom timer aura. *Expect*: the same
      controls in all four, and the volume slider showing that aura's own
      saved value rather than always 100%.
- [ ] The volume slider stays **0-100**, as asked. If a sound is too quiet at
      100, that is the source file, not the slider.

### Hide all auras, and unlocking a switched-off aura *(new - needs looking at)*

Notes 4 and 31, built as one change because separately they argue over which override wins.
There is a new **Hide auras** button at the right-hand end of the profile bar, always visible.

- [ ] **Press Hide auras.** *Expect*: every aura disappears at once, and the button turns red and
      reads "Auras hidden - show". Press again and they all come back exactly as they were.
- [ ] **Press the Pause key**, with EverQuest focused. *Expect*: exactly the same thing, and the
      button in the app updates to match even though you never touched it.
- [ ] **Confirm Pause does nothing in EverQuest any more** while the app is running. That is the
      cost of a global hotkey and the reason you were asked to pick a key you do not use.
- [ ] **Close the app and press Pause again.** *Expect*: EverQuest gets the key back.
- [ ] **Unlock an aura, then press Hide auras.** *Expect*: it hides too. Hiding deliberately
      beats unlocking - if that turns out to be the wrong way round for you, it is one line.
- [ ] **Restart the app while auras are hidden.** *Expect*: they come back visible. The hide is
      deliberately not remembered, so a forgotten one cannot look like a broken app.
- [ ] **Untick every profile for an aura so it is switched off, then press its Unlock to move.**
      *Expect*: it appears on screen so you can drag it, even though it is switched off. Lock it
      again and it goes away. This did nothing at all before.
- [ ] **Do the same but with "Unlock all auras" instead.** *Expect*: your switched-off auras stay
      away. Only unlocking one by hand pulls it onto the screen.
- [ ] **Move a switched-off aura while it is unlocked, then re-lock, then switch its profile back
      on.** *Expect*: it is where you put it.

### Your spellbook file is missing, and it is costing you a lot *(do this one first)*

Across your eight logs - 1.6 million lines - **14,650 buff landings were thrown away** because the
app could not tell whether they were yours, and about **11,000 more became questions** for the same
reason. The cause is that `<Character>-<CLASS>-Spellbook.txt` has never existed in your EQ folder.
EverQuest reuses the same buff wording across many spells; your spellbook is what tells the app
which of them you actually have.

The Setup page used to say it would "pick it up automatically once detected", which was wrong and
is why nobody went looking. It now says what is missing and why it matters.

- [ ] **Run your client's output-file command for your spellbook**, logged in on that character,
      then restart the app.
- [ ] **Check Setup > Spellbook detection.** *Expect*: "Found - N spells", and the amber warning
      gone.
- [ ] **Play a session and compare.** *Expect*: noticeably fewer ambiguity prompts, and buffs
      appearing that used to be silently missing.
- [ ] The command is **`/outputfile spellbook`**, shown on the Setup page with a **Copy** button
      next to it.
- [ ] **If you are willing, send the file back with the repo.** The before/after numbers above are
      measured against a reconstruction; a real one would make them exact.

### Spells that never run out *(new - Yaulp and Fury)*

You said some of the zero-duration spells are genuinely unlimited rather than missing a number,
and named Yaulp and Fury. Those now show a tile with **an infinity symbol instead of a countdown**,
a full bar, sorted to the bottom of the list, and they never disappear on their own.

- [ ] **Cast Yaulp** (any rank - all three are marked) **and Fury.** *Expect*: a tile that shows
      an infinity sign where the timer would be, and stays.
- [ ] **Let one end** - dispelled, zoned, or however it normally goes. *Expect*: the tile
      disappears when the game says it has faded.
- [ ] **Check it is NOT coloured red** as though it were about to expire, and does not set off a
      warning sound. Those two were real traps in the code and are guarded, but worth seeing.
- [ ] **Check where it sits in the list.** *Expect*: at the bottom, not the top - it is the least
      urgent thing on screen, not the most.
- [ ] **Frenzy and Rage share Fury's exact fade message** and are probably the same. I have NOT
      marked them, because you named Fury and guessing on your behalf is how a wrong number gets
      into the roster. Confirm and they are a two-line addition to
      `tools/roster-overrides.json`, which now carries the instructions.

### The "Buff timer" premade *(new - the first one that asks a question)*

"+ Add aura" > Premade aura > **Buff timer**. Pick one spell, say whether you are watching it on
yourself or on someone you cast it on, and the aura is built.

- [ ] **Search for a buff you use** and pick it. *Expect*: a list that narrows as you type, each
      entry saying how long the spell lasts and whether it can be watched on an ally.
- [ ] **Create it on yourself and cast the spell.** *Expect*: one tile, counting down.
- [ ] **Do it again with "Someone you cast it on"** for a spell you buff others with. *Expect*: it
      tracks per person, the same as the Ally Buffs aura does.
- [ ] **Find a spell where "Someone you cast it on" is greyed out.** *Expect*: an explanation
      underneath saying the app has no message for that spell landing on someone else. 53 of the
      720 trackable spells are like this. If one you rely on is in that group, tell me the exact
      line the game prints when it lands on someone else and it becomes trackable.
- [ ] **Search for something nonsense.** *Expect*: a message saying only spells with a landing
      message can be tracked - not just "no results".

### Instant spells - nukes, heals, gates *(new - and this fixed the NaN tile)*

Your rule: a spell with no real duration should not clutter a duration-based aura, but should be
available to sound and text auras "just in case someone wants feedback when a cast is successful
or resisted". That is now how it works.

- [ ] **Watch a normal aura during a fight.** *Expect*: no tiles for your nukes or heals, and no
      tile stuck showing NaN. That last one was the bug - it could only be cleared by restarting.
- [ ] **Make a sound aura, pick a heal or a nuke, turn on the land sound.** *Expect*: it makes the
      noise when the spell goes off, with nothing drawn.
- [ ] **Make a text aura and point it at the same spell.** *Expect*: the words appear briefly and
      then clear themselves.
- [ ] **"Briefly" is now yours to set.** A text aura has a **Show events for** slider, 1 to 60
      seconds, defaulting to 6 so it works without anyone going looking for it. Change it and
      check the words stay up for as long as you asked.
- [ ] **Cast the same nuke twice in a row on a sound aura.** *Expect*: it makes the noise BOTH
      times. An event has no timer to watch go back up, so this needed its own handling - the
      first version would have beeped once and then gone quiet.

### The older no-duration measurement *(kept for the record - the fix above supersedes it)*

275 spells in the roster have a landing message but no duration. When one of those landed, the app
worked out its expiry as "not a number", and the once-a-second cleanup asks "is the expiry time in
the past" - which is never true for "not a number". The tile showed **NaN:NaN**, never counted
down, and could not be dismissed except by restarting.

Forty-five of those spells appear in your logs; the most common, "Your mind clears.", 12,798 times.

I fixed this by refusing to track those spells, measured it against all 1.6 million lines, and
then **reverted it** - because it removed 67 spells and 18,405 landings. 36 of those are nukes and
heals that should never have had a timer, but 31 are real buffs: Armor of Protection, Barbcoat,
Fury, Wolf Form, Yaulp II, Shrink, Feign Death. Dropping those is a real loss, so the trade is
yours to make rather than mine.

- [ ] **Look for a stuck tile** showing NaN, or a timer that never moves. If you have ever seen
      one and wondered why it would not go away, this is why.
- [ ] **Decide what those spells should do.** The three options, honestly:
      **(a)** show with no countdown at all and disappear when their "ended" message arrives -
      works for 18 of the 31, and is the option that loses least;
      **(b)** get a default length, which means the app inventing a number;
      **(c)** not be tracked at all, which is what my reverted fix did.

### Coloured edges by spell type *(new - CHANGES HOW YOUR EXISTING AURAS LOOK)*

Note 37. Every tile now gets a coloured edge saying what kind of spell it is, and it is **on by
default on auras you already have** - so the first launch after this will look different. Turn it
off per aura with "Colour each tile's edge by spell type".

- [ ] **Look at your Self Buffs aura.** *Expect*: blue edges on ordinary buffs, and other colours
      where the spell is something else. Nothing should have moved or resized - only the colour of
      the edge changes.
- [ ] **Check a heal-over-time and a damage-over-time** if you have either up. *Expect*: dark
      green and dark amber respectively, distinctly darker than their instant versions.
- [ ] **Find a spell with no type** (242 of the 1,052 have none). *Expect*: its ordinary edge,
      not a guessed colour.
- [ ] **A custom timer aura.** *Expect*: no coloured edge at all - there is no spell behind it.
- [ ] **Turn the setting off on one aura.** *Expect*: that aura only goes back to normal.
- [ ] **Try it in icon mode as well as list mode.**
- [ ] **Worth your judgement:** you asked for red for damage and green for heals, which is the one
      pair that is hardest for colour-blind players. The colours differ in brightness as well as
      hue to soften that. If any two are hard to tell apart on your monitor, say which and they
      can be changed - they are eight lines in one stylesheet.

### Text auras and the dispel announcer *(new - needs looking at)*

A new **Custom text aura** in "+ Add aura" > Custom aura, and a real **You Have Been Dispelled**
premade. A text aura draws one line of words and nothing else - no icon, no countdown - and only
ever shows one thing at a time.

- [ ] **Add a Custom text aura**, point it at a buff you can cast on yourself, and cast it.
      *Expect*: your words (or the buff's name) appear in large text, and nothing else. No icon,
      no timer, no bar.
- [ ] **Let it run out.** *Expect*: the text disappears.
- [ ] **Type something into "Say"**, e.g. PUMA UP. *Expect*: it says that instead of the buff
      name. Clear the box again and the name comes back.
- [ ] **Drag the "Text size" slider up.** *Expect*: it gets properly large - up to 120px - and
      the aura's window grows to fit rather than clipping it.
- [ ] **Check it is readable over a bright zone** (snow, desert, water). The dark plate behind
      the words is there for exactly this; say so if it is still hard to read anywhere.
- [ ] **Pick several buffs on one text aura and have two active at once.** *Expect*: still only
      ONE line of text. Which one it picks follows the aura's "Sort by" setting.
- [ ] **Switch its "Buffs shown" to "Your own text triggers"** and add a trigger. *Expect*: the
      option is there at all - a text aura is the only type that can change source after it is
      made - and the trigger announces when the line appears.
- [ ] **Confirm the Display style radios are NOT shown** on a text aura, and that no fourth
      "Text" option has appeared on your other auras.

**The dispel announcer**, from "+ Add aura" > Premade aura:

- [ ] **Add "You Have Been Dispelled".** *Expect*: it lands on its own settings page, already set
      up, drawing nothing yet.
- [ ] **Get dispelled.** *Expect*: DISPELLED in large letters for eight seconds, then gone.
- [ ] **Only one of its three triggers is confirmed from your logs:** "You feel very dispelled."
      The other two - "You feel dispelled." and "You feel a bit dispelled." - are an inference
      from the third-person versions, where all three strengths do appear. **If you get a weaker
      dispel and nothing shows, tell me the exact line** and it is a one-word fix.
- [ ] **Check it does not fire when someone ELSE is dispelled** ("Avenrae feels very
      dispelled."). It should not - the triggers are whole-line exact matches.

### Merged tiles *(new - needs looking at)*

A per-aura **Merge buffs that share a duration into one tile** checkbox, plus an app-wide
**Merged tiles** card on the Setup page choosing what counts as "the same". Off by default
everywhere, so an aura you do not touch behaves exactly as it does today.

- [ ] **Leave it off on every aura and use the app normally for a bit.** *Expect*: no difference
      at all. This is the check that matters most - nothing should have changed for anything you
      have not deliberately turned on.
- [ ] **Turn it on for your Ally Buffs aura and cast a group buff set.** *Expect*: one tile per
      person instead of a wall, showing the soonest to run out, that person's name, and a small
      "x6" style badge.
- [ ] **Watch one of the merged buffs run out.** *Expect*: the count drops by one and the tile
      switches to counting down the next one.
- [ ] **On the Setup page, switch between "Same length" and "Same length, cast together".**
      *Expect*: the change takes effect immediately on every aura, without a restart.
- [ ] **With "Same length" chosen**, look for unrelated 24-minute buffs merging together. They
      will, and that is the rule doing what it says - switch to the other one if you dislike it.
- [ ] **With "Same length, cast together" chosen**, cast one buff, wait a minute, then cast
      another of the same length. *Expect*: two separate tiles.
- [ ] **Check the glow and the sounds still work on a merged aura.** Turn on "Glow when a buff
      lands" and a land sound, then re-cast one member of a merged group. *Expect*: the tile
      flashes and the sound plays. This is the one most likely to be silently wrong.
- [ ] **Check the pre-expiry warning fires once, not once per merged buff** - and then check it
      fires AGAIN next time round, after those buffs are recast. The second half is the one that
      was broken: a merged tile warned once and then stayed silent for the whole session.
- [ ] **Recast the buff a merged tile is counting down, before it drops.** *Expect*: the tile
      switches to naming and counting down whichever buff is now soonest. It used to keep the old
      name while counting down the new one.
- [ ] **Turn the merge checkbox on while a buff is already inside its warning window.** *Expect*:
      no beep from the act of ticking the box.
- [ ] **In list mode, look at the badge as a merged tile runs low.** *Expect*: it stays readable
      and does not take on the colour of the bar behind it.
- [ ] Under **"Same length, cast together"**, two buffs cast within a second or so of the
      three-second window may occasionally split into two tiles and rejoin. That is a known
      limit, not a new bug - the countdown the overlay receives is whole seconds.
- [ ] **Try it in icon mode as well as list mode.** *Expect*: the badge in the tile's top-right
      corner, not overlapping the countdown.
- [ ] **Turn it off again.** *Expect*: every tile comes straight back, unchanged.

### Aura names in the move box *(new - needs looking at)*

- [ ] **Unlock an aura.** *Expect*: its blue box now shows the aura's name in a small pill above
      the "Click and drag to move" text.
- [ ] **Drag the box by the area around the pill.** *Expect*: it still moves normally. This is
      the one to watch - the pill has to be a hole in the draggable area, and too big a hole
      means the aura you are trying to move is the one you cannot.
- [ ] **Click the pill.** *Expect*: the settings window comes to the front and opens that aura's
      page. If the window was minimised it should restore.
- [ ] **Expect EverQuest to lose focus when it does.** With auto-hide on, your other auras
      disappear at that moment. Unlocked ones stay. That is intended, not a bug.
- [ ] **Rename an aura while it is unlocked.** *Expect*: the pill updates immediately, without a
      restart.
- [ ] **Unlock several auras at once.** *Expect*: you can tell which box is which, which is the
      entire point of the note.

### Sound follows the on/off switch, not the screen *(new - a real bug was found here)*

Hiding an aura's window never silenced it - a hidden overlay carries on receiving updates and
carries on playing its alert sounds. That was invisible while every aura had tiles; it stops
being invisible the moment an aura is nothing but sound. The rule is now:

- **Switched off for this profile** - silent, and not on screen. Off means off.
- **Hidden by "Hide auras", or by auto-hide while EverQuest is unfocused** - still audible. You
  usually want to hear a buff about to drop even when you are looking at something else.

- [ ] **Set up any aura with a sound, untick every profile for it, and make its buff land or
      expire.** *Expect*: silence. Before this change it would still have beeped.
- [ ] **Put it back on your profile, press Hide auras, and do the same.** *Expect*: you still
      hear it. This one is meant to keep making noise.
- [ ] **Same again with EverQuest focused so auto-hide kicks in.** *Expect*: still audible.

### Detrimental spells on enemies *(data landed, engine not yet changed)*

The roster now carries all 327 detrimental spells with their real text, and
`" has been mesmerized."` is an ordinary third-person suffix. The engine cannot
use them yet: the ally path requires a recipient name matching `^[A-Za-z]+$`,
and mob names contain spaces, so `a worry wraith` is rejected.

- [ ] Confirm no debuff timers appear yet, and that nothing MIS-fires - a mob
      name must not be mistaken for a groupmate.

---

## New spell roster *(biggest change - test this first)*

The roster went from 11,337 generic EverQuest entries to the 1,052 spells this
server actually has, rebuilt from the curated spreadsheet plus the game's own
`spells_us.txt` / `spells_us_str.txt`. On first launch a one-time migration
replaces the roster in your saved data. Automated tests cover the mechanics;
these cover whether it is *right* in play.

Measured against the 19 Aug log before shipping: recognised landing lines went
45 -> 83, and auto-confirmed 19 -> 49. So expect **more** buffs to be picked up
and **fewer** questions, not the reverse.

- [ ] **First launch after the update.** *Expect*: the app starts normally,
      Known Buffs shows about 1,052 entries rather than 11,000+.
- [ ] **Your auras still work.** Every aura you had configured still tracks the
      same buffs. *If any aura went blank, stop and report which* - that is the
      one outcome that matters most.
- [ ] **Fewer ambiguity prompts** for spells you cast often. Prompts should be
      noticeably rarer, not more common.
- [ ] **No prompt asks you to choose between a spell and itself** (e.g. two
      ranks of Cannibalize). Rank variants are collapsed; if one appears, the
      collapsing missed a case.
- [ ] **Promised Renewal reads 15s**, not 18s or 12s, and does not grow with AA
      duration bonuses.
- [ ] **Icons still render** on the overlay - the new roster carries icon ids
      for 1,051 of 1,052 spells.
- [ ] **A buff that used to be recognised no longer is.** Watch for this
      specifically. Five spells in the whole roster genuinely cannot be
      detected (Calm-line spells that print no text at all) - anything beyond
      those is a regression worth reporting.
- [ ] **Bard songs** still detect and still sit at the right-hand end of the
      gem bar.

### If something is badly wrong

The old roster is at `archive/buffs-legacy-11337.json` in the project folder,
kept for reference. Do **not** copy it back over `src/shared/data/buffs.json` -
the app has already migrated and it would re-introduce the ambiguity the rebuild
removed. Report what broke instead; the roster is rebuildable from the
spreadsheet in a minute with `node tools/build-roster.js --write`.

---

## Detection engine

- [ ] **Quick Buff burst no longer ignores already-active buffs.**
  Restart the app while several self-buffs are already up in-game (so the
  memorized gem bar starts empty/red), then trigger a Quick Buff.
  *Expect*: nothing silently `IGNORED` that should have landed. Cross-check
  `detection-debug.log` for `IGNORED ... not currently memorized` lines that
  look wrong.

- [ ] **Heal-proc auto-resolve.**
  Cast a buff whose landing text is ambiguous but which also procs a heal
  message - Talisman of Altuna, Symbol of Naltron, Resolution.
  *Expect*: it resolves silently instead of raising an ambiguous-cast prompt.
  `detection-debug.log` should show `auto-resolved by a heal-proc line`.

- [ ] **Bard songs no longer wrongly IGNORED as "not memorized".**
  Sing your own songs and watch `detection-debug.log`.
  *Note*: only partly addressed - the underlying early-return bug (P0 in
  CLAUDE.md) is NOT fixed, so this may still misbehave. Report what you see.

---

## Auras & profiles

- [ ] **Profile-gated visibility.**
  Switch loadout profiles and confirm the right auras appear/disappear.
  *Expect*: an aura shows only while a profile it belongs to is active; an
  aura with **no** profiles ticked shows on all of them. There is no longer a
  global "Show this aura" toggle - profile membership is the on/off control.

- [ ] **Aura visibility survives a restart** with the same profile active.

---

## Memorized gem bar (landing page)

- [ ] **Never shows more than 14 gems.** *(new cap)* Play a session with several
      loadout swaps, including closing the app mid-swap. *Expect*: the count
      stays at or below 14 and never creeps up over days.
- [ ] **An already-drifted count heals itself.** If your bar currently shows
      more than 14, one launch of this build should bring it to 14 with the
      most recent kept.
- [ ] **Re-memorising a spell you already have does not evict it.** Memorise a
      full bar, re-memorise the first spell, then memorise one more. *Expect*:
      the re-memorised spell is still there and the stalest one went instead.

- [x] **Persists across restarts.** Memorize some spells, close the app,
  reopen. *Expect*: the bar comes back populated, not empty and red.
- [x] **Click a gem to forget it** - gem disappears, stays gone after restart.
- [x] **"Forget all"** clears the whole bar.
- [x] **Bard songs sit at the right-hand end**, underlined; regular spells
  fill from the left.
- [x] **Non-buff spells** (a nuke, a heal) show their real icon greyed out
  with a dotted border, and hovering says "(not a tracked buff)".
- [x] **Empty state is red/warning** on a genuinely fresh memory.

---

## Custom timers

- [x] **Add timer** opens the modal with every field visible.
- [x] **Edit** opens the same modal pre-populated; title says "Edit timer",
  button says "Save changes", and "Save as new" appears.
- [x] **Save as new** creates a second timer without altering the original.
- [x] **Icon gem box** - click opens the picker, picking sets the art, the
  picker is full height and usable (it was previously clipped to a sliver).
- [x] Two timers sharing a name *and* trigger text both fire, with their own
  distinct icons. *(Regression guard - this was a real bug.)*

---

## Sounds

- [x] **Preview** plays the chosen sound.
- [x] **Volume slider** affects both custom sounds and the default beeps.
- [x] **Open sounds folder** opens the folder the picker defaults to.
- [x] Real in-game alerts (land / expire / warning) actually play.

---

## QOL batch

- [ ] **Reset remembered choices is red**, matching Delete aura. *(new)*
- [ ] **"Unlock all auras" appears ONLY on the Overlay Auras overview** - select
      any individual aura and the whole "All auras" card (including the two
      auto-hide checkboxes) should be gone. *(new)*
- [ ] **The per-aura "Unlock to move" button is still there** on each aura's own
      settings. Scoping the master control down is exactly when its sibling
      might be taken with it.
- [ ] **The alert volume slider shows the aura's real value** when you select an
      aura, not always the middle of the track. *(bug fix)* Set one aura to 40%,
      another to 100%, switch between them: the handle should move.
      *This is almost certainly the whole of the "starts in the middle but it's
      100%" report* - the slider was never populated, and an HTML range with no
      value defaults to the midpoint.
- [ ] **The Add Aura premade list shows eight greyed "Not built yet" entries**
      below the working ones, and none of them can be clicked. *(new)*
- [ ] **Share codes.** Export an aura: the code should start `EQLSAURAS1-`.
      Import it back and confirm it works. *(new prefix)*
- [ ] **An old `EQBT2-` code is refused** rather than importing something
      broken. A clear "not a valid code" is the expected result for now; a
      friendlier "this is from an older version" message is not built yet.

- [ ] **Window size and position persist** across restarts. Resize/move the
      window, close, reopen. *Expect*: it returns where you left it.
      *Edge case worth checking*: maximize, close, reopen - it should restore
      to the pre-maximize size, not a screen-sized non-maximized window.
- [x] **"Add a new buff" and "View custom buffs"** now sit together in one
      Custom buffs card; both still open their modals.
- [x] **"Open sounds folder"** now at the bottom of the Sounds section, still
      opens the right folder.
- [x] **Profile toggles moved into aura settings.** Now an always-visible row
      of chips at the top of an aura's settings, not a modal.
      *Expect*: ticking/unticking shows/hides the aura immediately.
      **Behaviour change**: unticking *every* profile now hides the aura
      entirely (it used to mean "show on all profiles"). With a single profile
      this is your plain on/off switch. Worth checking no existing aura
      vanished unexpectedly.
- [x] **Profile chip in the top bar** is now solid brass when active - should
      be obvious at a glance which profile is live.
- [x] **Unlock to move / Reset position** moved into Display & size, above a
      dotted rule. "Unlock to move" is accent-outlined, and goes solid brass
      while actually unlocked.
- [x] **Timer text colour / Label text colour** pickers now work (icon mode
      and list mode). *Expect*: a buff about to expire still goes red - the
      low-time warning deliberately overrides any custom colour.
- [x] **Margin width** slider now works - changes the gap between icons in
      icon mode.

## Overlay behaviour

- [ ] **Auto-hide split into two settings** (now on the Overlay Auras page,
      under "All auras"). The second one,
      "Also show auras while EQLS Auras itself is the focused window", is OFF
      by default. *Expect*: with it off, tabbing to this app no longer drags
      every aura back on screen; with it on, it does.
- [x] **An unlocked aura is never auto-hidden.** Click Unlock to move on one
      aura while EQ isn't focused - it should stay visible so you can actually
      drag it. Re-locking hands it back to the normal rules.
- [x] **"Unlock all auras"** toggle unlocks/re-locks every aura at once, and
      the per-aura Unlock button label stays in sync with it (and vice versa).
- [ ] **Both auto-hide settings moved** off the Setup page into the "All
      auras" card on Overlay Auras. Check they still actually work from their
      new home - the wiring is by element id so it should be unaffected, but
      worth confirming rather than assuming.

## Rank collapsing

- [ ] **Ranked spells no longer prompt.** A landing text shared only by ranks
      of one spell (e.g. "A soft mist surrounds you." - Shauri's Sonorous
      Clouding plus I/II/III) resolves silently to the LOWEST rank.
      All ranks stay listed in Known Buffs - only the prompt is gone.
- [ ] **Genuinely different spells still prompt.** "Your mind clears."
      (Brilliance vs Cassindra's Chant of Clarity) must still ask.

## Ally buff grouping

- [x] **Group by player** on an ally aura splits it into a section per person
      with their name as a heading. Groups are ordered **alphabetically** and
      stay put as timers tick - they should never reshuffle.
- [x] **Stack groups vertically / side by side** both lay out correctly, in
      list mode and icon mode.
- [x] **The name prefix disappears from tiles while grouping is on** (the
      heading covers it), and the separate "Hide the player name" toggle drops
      it when grouping is off.
- [x] **Nothing breaks over time.** Leave a grouped aura running a few minutes
      - tiles must stay inside their group, not drift out into a flat pile.
- [x] The grouping section is **hidden** on self-buff and custom-timer auras.

## Duration scaling exclusion

- [ ] **"No AA scaling"** in Known Buffs. Tick it on Promised Renewal.
      *Expect*: its timer uses the raw duration, ignoring your Spell Casting
      Reinforcement / Extended Enhancement bonus. Other buffs unaffected.
      *Note*: Inferno Shield is a SEPARATE problem, not this one - don't
      expect this flag to fix it.

## Session restore

- [ ] **Timers survive a restart.** With buffs running, close the app and
      reopen within 5 minutes. *Expect*: they come back with time already
      deducted for the gap (a 100min buff closed 3min shows ~97min), and
      anything that expired while closed is simply absent.
      Confirmed working against real data (7 timers restored after a 6s
      restart) - this is about confirming it feels right in play.
- [ ] **Ally buffs and custom timers restore too**, not just self buffs.
- [ ] **A long gap does NOT restore.** Close for more than 5 minutes and
      reopen - the overlay should be empty rather than showing stale buffs.
      `detection-debug.log` will say "Did not restore timers: closed for Ns,
      over the 300s limit".

## Debuffs on enemies (mez, charm, snare, slow)

This is off until an aura asks for it. Tick **"Also watch these on enemies"**
on a custom aura, and the spells that aura is watching start tracking on the
things you cast them at.

- [ ] **Mez a mob and the tile appears with its name on it** - "a greater
      kobold", not blank and not your own name. Nothing showed here before,
      for any spell, because a mob's name is not one word and the recipient
      check only accepted one word.
- [ ] **The tile clears when the mob dies**, without waiting for the timer.
- [ ] **The tile clears when the mez breaks** rather than counting down to
      zero while the mob is already hitting you.
- [ ] **AoE mez shows one tile per mob.** Two mobs with the *same* name
      currently collapse into a single tile - that is a known gap, note 18,
      not something to report as a bug.
- [ ] **Mesmerize runs 30 seconds, not 24.** The spreadsheet said 24; your own
      note-17 table said 30, and 90 natural expiries in your logs stop dead at
      30 with nothing above it, so the roster now says 30. Worth one check
      against a stopwatch.
- [ ] **Turning it off puts everything back.** Untick it and the mob tiles
      should stop appearing entirely.

**One change that happens whether or not you turn this on**, so it is worth
knowing about rather than being surprised by: a debuff tile now disappears when
the log says the debuff ended - the mob died, or the spell wore off - instead of
sitting there until its timer runs out. Across your logs that is 277 tiles,
roughly one every few hours of play. Nothing stopped being *detected*; things
stop being *shown* once they are over. If you would rather they stayed put,
say so - it is one line to put back.

## Timers that roll into a cooldown (note 10)

On a custom timer, under Duration, there is now **"Then cooldown: N s"**.
Optional — leave it empty and nothing changes.

- [ ] **Set one up with both.** When the duration runs out the same tile keeps
      counting, down to when you can use the thing again, then disappears.
- [ ] **The tile looks different while cooling down** — dimmed and dashed — and
      hovering it says "cooling down, ready in Ns". A cooldown and a duration
      show the same digits and mean opposite things, so the tile has to say
      which.
- [ ] **The trigger line arriving again DURING the cooldown does nothing.**
      That is deliberate: the ability is not available, so the line cannot mean
      you used it, and restarting would hide the countdown you are waiting on.
- [ ] **During the duration, the trigger still restarts it**, as it always has.
- [ ] **Editing a timer keeps its cooldown**, and emptying the box removes it.

**Also new on that form: how the trigger matches.** Two radios under the raw
trigger box — *the whole line, exactly* (what every timer has always done) or
*any line containing it*. The second is for lines the game writes a name into:
"Orc centurion resisted your Mesmerize!" will never match a fixed string, but
"resisted your Mesmerize" catches all of them. It existed in the engine and
could only be reached by a premade until now.

- [ ] **Build a "containing" timer and check it fires.** Be specific with the
      text — a short word set to "containing" will fire on nearly every line.

The cooldown field sits behind a **Cooldown** section that expands like the
other collapsible sections, so it is out of the way unless you want it. If a
timer has one set, the section shows the value beside its title even when shut,
and opens by itself when you edit that timer — a setting hidden behind a closed
section is the one way a collapsible menu can actively mislead.

## Counting mobs with the same name (notes 12 and 18)

- [ ] **AoE mez three "a greater kobold" and the tile should say x3.** One
      tile, not three rows.
- [ ] **Kill one — it becomes x2. Kill another — x1.** At x1 the count
      disappears entirely rather than showing "x1".
- [ ] **The countdown is the one breaking soonest**, not the last.
- [ ] **A mez wearing off, a mob dying, and a mez being broken each remove
      exactly one**, not all of them.
- [ ] **Buffing a groupmate three times still shows one**, with no count. A
      re-buff is a refresh, not a second target.

Worth knowing what this cannot do: the game never distinguishes two mobs with
the same name, so when one of three kobolds wakes up the app knows only that
*one* did. It drops the one closest to expiring, which is the best guess
available and is right nearly always.

## Zone-gated auras (note 38)

In an aura's settings, under the loadout toggles: **"Only in:"**. Leave it empty
and the aura shows everywhere. Type a zone and press Enter, or pick from the
list, to limit it.

- [ ] **Limit an aura to the zone you are in.** It should stay on screen.
- [ ] **Zone somewhere else.** It should disappear, and its settings should say
      *"Hidden right now: you are in X, which is not on its list."*
- [ ] **Zone back.** It returns.
- [ ] **Click a zone chip to remove it.** With none left, the aura shows
      everywhere again.
- [ ] **Instances are separate, as you asked.** An aura limited to `Befallen`
      will NOT show in `Befallen 1 (Awakened)` — add each one you want. Same for
      `The Plane of Fear` and `The Plane of Fear - Group`.
- [ ] **Unlocking an aura still shows it in the wrong zone**, so you can move it
      wherever you happen to be standing.

**One thing worth knowing before it surprises you.** The app only learns which
zone you are in when you *change* zone — the game prints nothing otherwise, and
there is no way to ask. So if you start the app while already sitting somewhere,
it does not know where you are until you next zone. **Zone-gated auras show
anyway during that window**, and the settings panel says so. That is deliberate:
in your logs the wait for the next zone line, from a random start, averages
about 55 minutes of play and once ran five hours. An aura silently missing for
five hours with no explanation is far worse than one showing where you did not
ask for it.

The zone box offers the 66 zones seen in your logs and accepts anything you
type, so a zone you have not visited yet costs one line of typing.

## The hide-auras hotkey (it never worked)

**It was Pause, and Pause has never once worked.** Electron refuses that key
outright, and refuses it by throwing rather than by saying no - so the code that
was there to handle "another program owns this key" never ran, and the top bar
cheerfully said "or press Pause" the whole time. No test caught it because none
of them start the actual app. Nine seconds of launching it did.

**It is Scroll Lock now** - same corner of the keyboard, equally unused in game.
If something else on your machine owns Scroll Lock it falls back to Alt+Shift+H
and the hint in the top bar tells you which one you actually got.

- [ ] **Press Scroll Lock in game.** Every aura should vanish; press again and
      they come back.
- [ ] **The hint next to the "Hide auras" button names the key you actually
      have.**
- [ ] **The button and the key agree** - use one, then the other, and the button
      should look right both times.
- [ ] If Scroll Lock is wrong for you, say so - it is one line, and any key
      Electron accepts will do.

## Stale timers when a buff is replaced (note 26)

This turned out to need no stacking rules at all - the game announces it.

- [ ] **Overbuff a groupmate.** Cast a weaker buff on someone, then a stronger
      one of the same line. The weaker tile should disappear when the game says
      "Your <spell> spell on <name> has been overwritten", not keep counting
      down.
- [ ] **A buff wearing off a groupmate clears its tile** rather than running to
      zero on the app's own guess.
- [ ] **A groupmate dying does NOT clear their buffs.** They will probably be
      rezzed, and forgetting is the app inventing a change the log never
      reported. A mob dying still clears its debuffs.

**What changed underneath, worth knowing.** Nine of the twelve "this cast
failed" patterns in the app matched nothing at all - they were written from
memory of EverQuest's wording rather than from your logs. The game says "Your
<spell> spell fizzles!", not "Your spell fizzles"; "did not take hold", not
"would not take hold". Fixed, and every pattern now carries the count it was
measured at.

Two casts across your whole log history stop being credited as landings, both
Dexterity, both cases where the cast demonstrably failed and the app was
attributing a later landing to it. Nothing else moved.

**Buffs on yourself are covered too - I was wrong about this twice.** I said the
app could not tell Nimble from Agility because they share a fade message. It
can: it only matters if both are running at once, and the stacking rule that
causes the overwrite is the same rule that stops that happening. Verified with
Skin like Wood being replaced by Skin like Steel, which share a fade message
with nineteen other spells.

- [ ] **Overbuff yourself** - cast a weaker buff on yourself, then a stronger one
      of the same line. The first tile should go and the second appear, with the
      longer duration.

## "Buffs shown" is its own card, with gem slots

- [ ] **Open any aura's settings.** "Buffs shown" is a card of its own between
      **Display & size** and **Configuration**.
- [ ] **What the aura watches is now a row of spell icons**, not a list of
      ticked names. Hover one to see which spell it is; click it to stop
      watching it.
- [ ] **The dashed "+" slot** focuses the search box. It stays visible even
      when nothing is picked, because otherwise there is no way to add the
      first one.
- [ ] **Your existing auras still have their spells.** Nothing about how they
      are stored changed - the gems are just how the same list is drawn - so
      this should be true, but it is the thing to check first.
- [ ] **Try to add a debuff to an aura that has buffs in it.** It should refuse
      and say why, rather than silently not appearing. Same the other way
      round.
- [ ] **The picker row "Watching:"** (you / an ally / your own text triggers)
      has moved up into this card, out of Display & size.

## Loadouts, and the loadout label

The profile bar has **one** button now, "Loadouts", where the "+" and the cog
used to be. It opens a modal that adds, renames and deletes loadouts, and holds
the loadout-label switch.

- [ ] **The one button opens the modal**, and adding a loadout from inside it
      still works exactly as the old "+" did.
- [ ] **Make a second loadout and the label turns itself on**, without you
      asking. With one loadout it has nothing to tell you.
- [ ] **Turn it off, then make a third loadout — it must STAY off.** This is the
      one I would check hardest. Gating on "do you have two loadouts" would turn
      it back on every time you added one, and you would be switching it off
      forever.
- [ ] **The tick box shows the truth** when the label switched itself on — open
      the modal and it should already be ticked.
- [ ] **The label follows a switch immediately**, and is still there on a
      loadout created after it.
- [ ] **Drag it, untick, re-tick** — it comes back where you left it.
- [ ] **Rename a loadout and the label follows.**

You can reword and resize it in its own settings like any aura — `{profile}` in
the **Say:** box becomes the loadout name.

## Cooldown timers

Add Aura -> **Cooldown timer**. Pick a spell, check the number, create.

- [ ] **Cast the spell and a countdown appears**, ending when you can cast it
      again.
- [ ] **It works for the ranked spells you actually cast.** You pick "Promised
      Renewal" from the list, but you cast "Promised Renewal VII" - that has to
      start it, and so do V and IX. This is the single thing most likely to be
      wrong, so please check it first.
- [ ] **The number is recast plus cast time.** Promised Renewal shows 21s: 18s
      recast plus 3s casting. The recast clock starts when the cast finishes
      but the timer starts when you begin, so the two are added. Your
      consecutive casts in the logs cluster at exactly 21s, which is where this
      came from - but a stopwatch check would be welcome.
- [ ] **An interrupted cast leaves no timer running.** Start a cast, get hit,
      have it interrupt - the countdown should vanish rather than sit there
      saying the spell is unavailable.
- [ ] **Somebody else's interrupt does not clear yours.**
- [ ] **You can change the recast time before creating it**, and it keeps what
      you set. Recast times come from the game data and are usually right but
      not always - of the two you checked, one was wrong - so if any spell
      looks off, the number is yours to correct.

Two things it does NOT do yet, so they are not bugs: it does not shorten the
recast for higher mote tiers (the sheet says 2% per tier), and it does not
handle a spell that has both a duration and a cooldown - that is note 10.

## Someone else casting a mez

Add Aura -> **Someone else cast a mez**. Or tick **"Warn me when someone else
casts these"** on any text-only aura.

This is your design, built the way you specified it: a warning, no countdown.

- [ ] **When a groupmate casts a mez, the warning appears** and names them -
      "Lumbarin cast Mesmerization VII - careful".
- [ ] **It appears as they START casting**, roughly two seconds before the mez
      actually lands. That is deliberate: a warning after the fact is too late
      to stop you swinging. The cost is that a cast which gets resisted still
      warns you - about one time in ten.
- [ ] **It names whoever cast it rather than saying "a party member".** In your
      logs, half the mez and charm casts by other people are mobs - ``A
      Teir`Dal ranger``, "A negotiator" - and the game's line does not say
      which is which. Naming them is right every time, and a mob casting mez is
      worth knowing about too. Say the word if you would rather it only ever
      mentioned actual group members and I will explain what that costs.
- [ ] **Your own casts never trigger it.**
- [ ] **There is no timer on it, anywhere.** If you ever see a countdown on one
      of these, that is a bug - report it.
- [ ] **It watches the whole mez and charm family out of the box** - Mesmerize,
      Mesmerization, Dazzle, Charm, Allure, Beguile, Cajoling Whispers. Adding
      slows or snares is a tick each in the aura's buff list.
- [ ] **Picking "Mesmerization" catches the ranks people actually cast** - VI
      and VII both warn, and the warning says which rank it was.

You can reword it. In the aura's **Say:** box, `{caster}` becomes whoever cast
it and `{spell}` becomes what they cast.

## The RESIST flash

Add Aura -> **Resist flash**. One aura, covers every spell you cast - you do not
pick which.

- [ ] **Get a mez resisted and RESISTED flashes up**, then goes away on its own.
- [ ] **It does NOT fire when something resists a spell somebody else cast**,
      and does NOT fire when a spell is resisted *by you* - those are different
      lines, and there are 761 of the second kind in your logs against 970 of
      the real ones, so if this is wrong the flash will be on constantly.
- [ ] **It lasts about a second and a half.** You asked for 1.4s. Timers are
      swept once a second, so in practice it clears somewhere between 1.4 and
      2.4 seconds after the resist. If that reads as too long or too short,
      say so - the number is one line.

## Stability

- [ ] **App no longer closes itself.** It was observed exiting unprompted
  (exit 0, no crash dump, cause unknown). Shutdown logging is now in place -
  **if it happens again, check `detection-debug.log` for `SHUTDOWN:` lines**
  and report which one appears. That identifies the cause.

---

## Confirmed

- [x] **Bard song opt-in + "Show bard songs" toggle.** Songs hidden by
  default; toggling shows them. Previously the toggle did nothing at all
  because only 1 of 11,337 roster entries was tagged as a song.
- [x] **Ally buff detection.** Buffs cast on other people now appear on the
  Ally Buffs aura - confirmed with Shield of Flame on both Avenrae and
  Lasartik. Had **never** fired before: the tier was gated on the recipient
  being a known group member, and group membership is only learned from
  join/leave lines seen live.
