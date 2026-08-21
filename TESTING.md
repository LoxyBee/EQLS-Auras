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

Six suites at the time of writing:

| Suite | Guards |
|---|---|
| `test/pin.test.js` | the userData pin, including the realistic way to break it - adding a `require` above it in `main.js` |
| `test/roster.test.js` | roster shape, and a snapshot of what detection can do, so a change that quietly costs coverage fails loudly |
| `test/roster-migration.test.js` | the one-time roster replacement: custom buffs survive, overlay choices survive, it runs once, and it writes nothing into app data |
| `test/memorized-cap.test.js` | the fourteen-gem cap, including re-memorising refreshing an entry and an oversized saved file healing on load |
| `test/focus-game.test.js` | the refocus-EverQuest call: targets `eqgame` by process name, restores a minimised window, never throws |
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
