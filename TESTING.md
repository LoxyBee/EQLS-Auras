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

- [ ] **Persists across restarts.** Memorize some spells, close the app,
  reopen. *Expect*: the bar comes back populated, not empty and red.
- [ ] **Click a gem to forget it** - gem disappears, stays gone after restart.
- [ ] **"Forget all"** clears the whole bar.
- [ ] **Bard songs sit at the right-hand end**, underlined; regular spells
  fill from the left.
- [ ] **Non-buff spells** (a nuke, a heal) show their real icon greyed out
  with a dotted border, and hovering says "(not a tracked buff)".
- [ ] **Empty state is red/warning** on a genuinely fresh memory.

---

## Custom timers

- [ ] **Add timer** opens the modal with every field visible.
- [ ] **Edit** opens the same modal pre-populated; title says "Edit timer",
  button says "Save changes", and "Save as new" appears.
- [ ] **Save as new** creates a second timer without altering the original.
- [ ] **Deleting the timer currently open** closes the modal.
- [ ] **Icon gem box** - click opens the picker, picking sets the art, the
  picker is full height and usable (it was previously clipped to a sliver).
- [ ] Two timers sharing a name *and* trigger text both fire, with their own
  distinct icons. *(Regression guard - this was a real bug.)*

---

## Sounds

- [ ] **Preview** plays the chosen sound.
- [ ] **Volume slider** affects both custom sounds and the default beeps.
- [ ] **Open sounds folder** opens the folder the picker defaults to.
- [ ] Real in-game alerts (land / expire / warning) actually play.

---

## QOL batch

- [ ] **Window size and position persist** across restarts. Resize/move the
      window, close, reopen. *Expect*: it returns where you left it.
      *Edge case worth checking*: maximize, close, reopen - it should restore
      to the pre-maximize size, not a screen-sized non-maximized window.
- [ ] **"Add a new buff" and "View custom buffs"** now sit together in one
      Custom buffs card; both still open their modals.
- [ ] **"Open sounds folder"** now at the bottom of the Sounds section, still
      opens the right folder.
- [ ] **Profile toggles moved into aura settings.** Now an always-visible row
      of chips at the top of an aura's settings, not a modal.
      *Expect*: ticking/unticking shows/hides the aura immediately.
      **Behaviour change**: unticking *every* profile now hides the aura
      entirely (it used to mean "show on all profiles"). With a single profile
      this is your plain on/off switch. Worth checking no existing aura
      vanished unexpectedly.
- [ ] **Profile chip in the top bar** is now solid brass when active - should
      be obvious at a glance which profile is live.
- [ ] **Unlock to move / Reset position** moved into Display & size, above a
      dotted rule. "Unlock to move" is accent-outlined, and goes solid brass
      while actually unlocked.
- [ ] **Timer text colour / Label text colour** pickers now work (icon mode
      and list mode). *Expect*: a buff about to expire still goes red - the
      low-time warning deliberately overrides any custom colour.
- [ ] **Margin width** slider now works - changes the gap between icons in
      icon mode.

## Overlay behaviour

- [ ] **Auto-hide split into two settings** (now on the Overlay Auras page,
      under "All auras"). The second one,
      "Also show auras while EQLS Auras itself is the focused window", is OFF
      by default. *Expect*: with it off, tabbing to this app no longer drags
      every aura back on screen; with it on, it does.
- [ ] **An unlocked aura is never auto-hidden.** Click Unlock to move on one
      aura while EQ isn't focused - it should stay visible so you can actually
      drag it. Re-locking hands it back to the normal rules.
- [ ] **"Unlock all auras"** toggle unlocks/re-locks every aura at once, and
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

- [ ] **Group by player** on an ally aura splits it into a section per person
      with their name as a heading. Groups are ordered **alphabetically** and
      stay put as timers tick - they should never reshuffle.
- [ ] **Stack groups vertically / side by side** both lay out correctly, in
      list mode and icon mode.
- [ ] **The name prefix disappears from tiles while grouping is on** (the
      heading covers it), and the separate "Hide the player name" toggle drops
      it when grouping is off.
- [ ] **Nothing breaks over time.** Leave a grouped aura running a few minutes
      - tiles must stay inside their group, not drift out into a flat pile.
- [ ] The grouping section is **hidden** on self-buff and custom-timer auras.

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
