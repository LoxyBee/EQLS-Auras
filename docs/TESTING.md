# Testing checklist

Everything built but not yet confirmed working **in real gameplay**. Isolated Node tests and clean
restarts prove code paths run; they don't prove the app behaves correctly against the live log, so
nothing counts as done until it's been seen working in-game.

**Status key**

- `[ ]` not yet tested live
- `[x]` confirmed working in-game
- `[!]` tested and FAILED — details inline, needs another pass

Mark items `[x]` as they're confirmed. When every item in a section is `[x]`, move the whole
section to **[Confirmed](#confirmed)** at the bottom so the active list stays short.

## Contents

| | Group | What's in it |
|---|---|---|
| 0 | [Start here](#0--start-here) | The automated tests, and the two things to do before anything else |
| 1 | [Detection and the roster](#1--detection-and-the-roster) | The app's actual job: deciding what landed and whose it was |
| 2 | [Debuffs and enemies](#2--debuffs-and-enemies) | Mez, charm, snare, slow — things you cast *at* something |
| 3 | [Making auras](#3--making-auras) | Premades, custom timers, trigger conditions |
| 4 | [How auras look](#4--how-auras-look) | Tiles, colours, merging, text, the move box |
| 5 | [When auras show](#5--when-auras-show) | Loadouts, zones, hiding, the hotkey |
| 6 | [Sounds and alerts](#6--sounds-and-alerts) | Every noise the app makes |
| 7 | [The app window](#7--the-app-window) | Text size, sidebar, share codes, QOL |
| 8 | [Session, memory and stability](#8--session-memory-and-stability) | Restore, gem bar, crashes |
| 9 | [Built, but nothing to test](#9--built-but-nothing-to-test) | Recorded so it isn't lost |
| 10 | [Lockouts and log tools](#10--lockouts-and-log-tools) | Raid lockout grid, reset setting, log trim / rotation / archive |
| — | [Confirmed](#confirmed) | Done, kept as regression guards |

---

# 0 — Start here

## Run the automated tests first

```
npm test
```

Zero dependencies, a few seconds, and it covers a lot of what used to need a character standing in
a zone. If it is red, nothing below is worth doing yet — read the failure text, it says what broke
and why.

**66 suites** as of this writing, growing. The ones worth knowing by name, because each guards something that broke
for real once:

| Suite | Guards |
|---|---|
| `pin.test.js` | the userData pin, including the realistic way to break it — adding a `require` above it in `main.js` |
| `roster.test.js` | roster shape, and a snapshot of what detection can do, so a change that quietly costs coverage fails loudly |
| `roster-migration.test.js` | the one-time roster replacement: custom buffs survive, overlay choices survive, it runs once, and it writes nothing into app data |
| `detection.test.js` | a landing starts a timer, its ended text stops it, a blocked buff never lands, someone else's cast is not counted as yours, and a spell with no duration produces no tile instead of an unkillable one |
| `memorized-cap.test.js` | the fourteen-gem cap, including re-memorising refreshing an entry and an oversized saved file healing on load |
| `focus-game.test.js` | the refocus-EverQuest call: targets `eqgame` by process name, restores a minimised window, never throws |
| `renderer-wiring.test.js` | the settings window's markup against its script: every id looked up exists, every slider is populated from the aura, modals opt out of the drag region |
| `visibility.test.js` | the whole precedence model — profile membership as the on/off switch, "Hide auras" beating unlock, unlocking one aura beating its profile, and off meaning silent as well as invisible |
| `infinite-duration.test.js` | spells that never run out, and the three places where `null <= 30` being true would have broken them |
| `merged-tiles.test.js` | the merging maths, per-person bucketing, and glow/sound matching members rather than tile keys |
| `overwrite-and-failures.test.js` | the twelve "this cast failed" patterns, nine of which once matched nothing at all |
| `damage-parser.test.js` | the five damage wordings and the friend/enemy rules, each broken on purpose in nine ways |
| `zone-routing.test.js` | all 10,712 routes, including the tie-break that looks like dead code and is not |
| `xlsx.test.js` | the spreadsheet reader, including the empty-cell bug that silently shifted every column |

The other suites cover cooldowns, enemy debuffs, gem slots, the resist flash, share codes, sound-only
auras, text auras, the song pulse, zone gating, premades, the profile label, the settings-panel
layout and shapes, bard songs, charm broke, buff+cooldown, reverse/combine-mode triggers, zone
triggers, text justification, zero-duration timers, custom-timer and sound debug logs, per-profile
memorized state, and the evidence-based-detection toggle.

If the roster capability snapshot fails after a deliberate roster change, read the printed delta,
and if every moved number is intended:

```
node test/roster.test.js --update
```

## Do these two first

Everything else can wait behind them — the first costs you detection you are currently losing, and
the second changes what the whole app is working from.

### 1. Your spellbook file is missing, and it is costing you a lot

Across your eight logs — 1.6 million lines — **14,650 buff landings were thrown away** because the
app could not tell whether they were yours, and about **11,000 more became questions** for the same
reason. The cause is that `<Character>-<CLASS>-Spellbook.txt` has never existed in your EQ folder.
EverQuest reuses the same buff wording across many spells; your spellbook is what tells the app
which of them you actually have.

The Setup page used to say it would "pick it up automatically once detected", which was wrong and
is why nobody went looking. It now says what is missing and why it matters.

- [ ] **Run your client's output-file command for your spellbook**, logged in on that character,
      then restart the app. The command is **`/outputfile spellbook`**, shown on the Setup page
      with a **Copy** button next to it.
- [ ] **Check Setup > Spellbook detection.** *Expect*: "Found — N spells", and the amber warning
      gone.
- [ ] **Play a session and compare.** *Expect*: noticeably fewer ambiguity prompts, and buffs
      appearing that used to be silently missing.
- [ ] **If you are willing, send the file back with the repo.** The before/after numbers above are
      measured against a reconstruction; a real one would make them exact.

### 2. The new spell roster

The roster went from 11,337 generic EverQuest entries to the 1,052 spells this server actually has,
rebuilt from the curated spreadsheet plus the game's own `spells_us.txt` / `spells_us_str.txt`. On
first launch a one-time migration replaces the roster in your saved data. Automated tests cover the
mechanics; these cover whether it is *right* in play.

Measured against the 19 Aug log before shipping: recognised landing lines went 45 → 83, and
auto-confirmed 19 → 49. So expect **more** buffs to be picked up and **fewer** questions, not the
reverse.

- [ ] **First launch after the update.** *Expect*: the app starts normally, Known Buffs shows about
      1,052 entries rather than 11,000+.
- [ ] **Your auras still work.** Every aura you had configured still tracks the same buffs. *If any
      aura went blank, stop and report which* — that is the one outcome that matters most.
- [ ] **Fewer ambiguity prompts** for spells you cast often. Prompts should be noticeably rarer.
- [ ] **No prompt asks you to choose between a spell and itself** (e.g. two ranks of Cannibalize).
      Rank variants are collapsed; if one appears, the collapsing missed a case.
- [ ] **Promised Renewal reads 15s**, not 18s or 12s, and does not grow with AA duration bonuses.
- [ ] **Icons still render** on the overlay — the new roster carries icon ids for 1,051 of 1,052.
- [ ] **A buff that used to be recognised no longer is.** Watch for this specifically. Five spells
      in the whole roster genuinely cannot be detected (Calm-line spells that print no text at all)
      — anything beyond those is a regression worth reporting.
- [ ] **Bard songs** still detect and still sit at the right-hand end of the gem bar.

**If something is badly wrong.** The old roster is at `archive/buffs-legacy-11337.json`, kept for
reference. Do **not** copy it back over `src/shared/data/buffs.json` — the app has already migrated
and it would re-introduce the ambiguity the rebuild removed. Report what broke instead; the roster
is rebuildable from the spreadsheet in a minute with `node tools/build-roster.js --write`.

---

# 1 — Detection and the roster

## The detection engine

- [ ] **Quick Buff burst no longer ignores already-active buffs.** Restart the app while several
      self-buffs are already up in-game (so the memorized gem bar starts empty/red), then trigger a
      Quick Buff. *Expect*: nothing silently `IGNORED` that should have landed. Cross-check the
      detection log for `IGNORED ... not currently memorized` lines that look wrong.
- [ ] **Heal-proc auto-resolve.** Cast a buff whose landing text is ambiguous but which also procs
      a heal message — Talisman of Altuna, Symbol of Naltron, Resolution. *Expect*: it resolves
      silently instead of raising an ambiguous-cast prompt. The log should show
      `auto-resolved by a heal-proc line`.
- [ ] **Bard songs no longer wrongly IGNORED as "not memorized".** Sing your own songs and watch
      the detection log. *Note*: only partly addressed — the underlying early-return bug (P0 in
      `CLAUDE.md`) is NOT fixed, so this may still misbehave. Report what you see.

**Where the detection log lives:** a `detection-logs` folder, one file per day, old ones cleaned up
after a fortnight. **Log page → Diagnostics → "Open the detection log folder"**, with the full path
printed beside the button so you can reach it when the app is not running.

## A debuff can never land as a self-buff (reported twice, 24 Aug)

Reported live twice in one day, and the second report is what mattered: *"boil blood is a debuff,
it should never be in buff tracking. second time so there is a wider problem."* Right, and here's
why it was a wider problem rather than one bad spell.

The first report (Languid Pace, a Slow debuff) was patched inside ONE tier - the ambiguous-landing-
text tier's spellbook-narrowing - by filtering out debuff/dot/charm/nuke candidates before it
narrows. That's still in place and still doing real work (`selfPlausible` in `handleLine()`). But
Boil Blood's landing text ("Your blood boils.") is **unique** in the roster, so it never went near
that tier at all - it landed through the highest-confidence one instead (an exact, unshared landing
text), which had no category check of its own. One tier got patched; a different one had the exact
same hole.

Fixed at the single place every self-landing tier already funnels through - `_land()` itself - so
this can't happen a third time from a fourth tier. A first-person landing line ("Your blood boils.")
can only ever mean something was cast AT the player, never BY them - nothing you cast lands with
your own name on it - so any spell the roster marks `debuff`/`dot`/`charm`/`nuke` is refused outright,
not routed anywhere.

- [ ] **Get hit by any mob debuff/DoT/nuke/charm that has its own unique landing text.** *Expect*:
      it does NOT appear in Self Buffs, and the detection log shows `IGNORED "<name>" - detrimental
      (<category>), not something you can self-buff` instead of a `LANDED` line.
      **Attempted self-verification 25 Aug, inconclusive** - injected `Your blood boils.` (Boil
      Blood, the exact spell this fix was reported against) and the result WAS correctly refused,
      but via a different guard: `IGNORED "Boil Blood" - unique text, never scribed by you at all,
      track others OFF` - the earlier spellbook-check tier rejected it before the `_land()`-level
      `ENEMY_SPELL_CATEGORIES` refusal this section is actually about ever got a turn. Same correct
      outcome, wrong tier exercised - this needs an actual mob debuff caught live (or a synthetic
      cast-begin line for something scribed/memorized first, to reach the later tier) to really
      confirm the fix this section describes.
- [ ] **Languid Pace (or any other debuff sharing ambiguous text) still doesn't land either** - the
      original point fix and this blanket one should agree, not just the new one.
- [ ] **Nothing about your REAL buffs changed.** Cast anything ordinary and confirm it still lands
      exactly as before - this only touches the debuff/dot/charm/nuke categories.
- [ ] **If you ever WANT to know when a mob's debuffed you** - there is currently no aura for that
      at all (only auras for debuffs *you* cast, via "Also watch these on enemies"). Say so if you
      want one; it's a real, separate feature, not a side effect of this fix.

## An ally's own buff wrongly landing as YOURS (Insight/Dovairous, 24 Aug)

Reported live: Insight (an Enchanter-only buff) sitting in Self Buffs on a BRD/CLF character, with
"Track buffs cast on me by others" OFF - *"it should not be put on me if it did not see my name
cast it... this is a BASIC check from day 1."* Root-caused from the real, live raw log rather than
guessed - two separate real gaps, both closed:

1. **The spellbook check only ever covered "not currently in a gem".** A spell your class could
   never scribe at all - not "unloaded right now", never once possible - skipped that check
   entirely and fell straight through to a confident `LANDED`. Fixed: absence from the spellbook
   file altogether is now checked directly, not just gated behind "is this even memorizable by me".
2. **The real trigger, found after checking the raw log line by line:** `"Dovairous activates
   Quick Buff."` - an ally triggering the exact same instant multi-buff grant this app already
   documents for the player's OWN use (gotchas #12/#18), just from someone else. It drops a whole
   stack of buffs on the entire group at once with no per-spell cast line for any of them, so the
   existing "recently cast by X" check had nothing to see. Confirmed at scale against a real
   session log: **460 landings** were being silently absorbed as the player's own during these
   ally-triggered bursts. Fixed two ways together: (a) any third-person landing suffix seen on
   ANOTHER person (not just during a burst) is now recorded as evidence, the same way a cast-begin
   line already is; (b) `"<Name> activates X."` is now recognised directly and opens a short window
   of extra caution for the player's own unique-text landings.

- [x] **Get buffed by a group-wide instant grant someone ELSE triggers** (Quick Buff or similar).
      *Expect*: none of what it drops shows up in Self Buffs unless you also turn on "Track buffs
      cast on me by others" - check the detection log for `ALLY ACTIVATE "..." by "..."` followed
      by `IGNORED "..." - ... an ally's instant grant just fired`. **Self-verified 25 Aug** by
      injecting `Dovairous activates Quick Buff.` + `You are infused with power.` into the live
      log and reading the result straight from the detection log: `ALLY ACTIVATE "Quick Buff" by
      "Dovairous"` followed by `IGNORED "Infusion of Spirit" - unique text, an ally's instant grant
      just fired, track others OFF` - exact match, no need for you to check the overlay.
- [ ] **Your OWN Quick Buff (or equivalent) is completely unaffected** - still grants everything it
      always did, same as before this fix.
- [ ] **An ally's buff landing on THEM (not you) while you're doing something else** still doesn't
      interfere with your own real casts - only landings that would otherwise have been blindly
      self-attributed with zero evidence are affected.

## Rank collapsing

- [ ] **Ranked spells no longer prompt.** A landing text shared only by ranks of one spell (e.g.
      "A soft mist surrounds you." — Shauri's Sonorous Clouding plus I/II/III) resolves silently to
      the LOWEST rank. All ranks stay listed in Known Buffs — only the prompt is gone.
      **Attempted 25 Aug, inconclusive** - injecting the cast-begin line ahead of the landing text
      resolved it cleanly (`LANDED "Shauri's Sonorous Clouding" - named cast, confirmed by its
      landing text`), but that's the STRONGER named-cast tier, not the ambiguous-text-only path
      this item is actually asking about. Needs the landing line sent with no preceding cast-begin
      to really test the rank-collapse behaviour.
- [ ] **Genuinely different spells still prompt.** "Your mind clears." (Brilliance vs Cassindra's
      Chant of Clarity) must still ask.
      **Attempted 25 Aug, inconclusive** - injected the bare landing line with no cast-begin, and it
      resolved silently anyway (`LANDED "Cassindra's Chant of Clarity" - ambiguous text "Your mind
      clears." narrowed to 1 by spellbook`) - your account's own spellbook only has one of the two
      candidates scribed, so the spellbook-narrowing tier settled it before it could reach the
      "genuinely ambiguous, must prompt" case this item means. Confirming this needs BOTH spells
      scribed at once (or the spellbook check bypassed), so it isn't something I can manufacture
      from the log alone.

## Buff durations scale with spell rank (notes 11 and 17)

You said duration should be "base duration from the roster, multiplied by the AA's, exaltations,
and rank of the spell". That is in. The rank is the numeral outside the name field — the one the
log prints when *you* cast something.

- [ ] **Cast a ranked buff and check the countdown.** Spirit of the Puma VII should start around
      168 seconds if your duration AAs are maxed, against 60 at rank 0 with no AAs. The exact
      number depends on your AA setting in the app, which is still 0 unless you have set it.
- [ ] **Celestial Healing IV** should start at about 48 seconds on maxed AAs.
- [ ] **Promised Renewal** should stay at 15 seconds at every rank. It ignores both rank and AAs —
      measured across 225 of your castings.
- [ ] **A groupmate's buff on you keeps its plain roster duration.** Their rank is in the log, but
      nothing links which of their casts caused which landing, so I left it unscaled rather than
      guess. If you see a groupmate's buff timing out early, that is why, and it is worth telling
      me.
- [ ] **Set your AA and exaltation levels, then check a mez.** Mesmerize should NOT get longer when
      you raise them. Buffs should.

**A bug this turned up, which would have hit you the moment you set your AA level.** The app was
applying the AA duration bonus to *everything* — including debuffs, damage-over-time and mez. Your
own logs say that is wrong: on 9 and 10 August, when your buffs measured x1.53, Curse measured
31–36 seconds against a base of 30 across 31 castings. If the bonus applied it would have been 45.
So 155 roster entries would have started over-timing by up to 65% — a mez timer still counting down
long after the mob woke up.

**Corrected 23 August, on your instruction:** the AA bonus now applies to spells marked **buff** and
nothing else. I had it applying to buff, heal, heal-over-time and pet summons, on the reasoning that
the bonus is for beneficial spells and those are the beneficial categories. That was me inferring
and calling it a measurement.

One observation still looks like it disagrees, and I want to flag it rather than bury it.
Celestial Healing IV measures 48 to 78 seconds across 32 castings; the mote tier alone predicts 29.
I re-measured rather than trusting the earlier number, and it holds. But I no longer think it is
evidence of anything: a fixed-duration spell measures *tightly* — Spirit of the Puma VII lands in a
14-second band — and a 30-second spread whose median matches no prediction says the
landing-to-wear-off gap for a heal over time is not its duration at all.

- [ ] **If a heal-over-time countdown looks wrong in game**, that is the thing to tell me about —
      it is the one number I could not reconcile.
- [ ] **Debuff and charm/mez rates per tier.** The spreadsheet says +10% per tier and marks it
      *assumed*; every observation in your logs was cut short by the mob dying before the spell ran
      out, so I have nothing to check it against. **Togor's Insects V should show 315 seconds**
      against a base of 210. If it wears off noticeably early or late, that number is the suspect.

## Duration scaling exclusion

- [ ] **"No AA scaling"** in Known Buffs. Tick it on Promised Renewal. *Expect*: its timer uses the
      raw duration, ignoring your Spell Casting Reinforcement / Extended Enhancement bonus. Other
      buffs unaffected. *Note*: Inferno Shield is a SEPARATE problem — don't expect this flag to
      fix it.

## Spells that never run out (Yaulp and Fury)

You said some of the zero-duration spells are genuinely unlimited rather than missing a number, and
named Yaulp and Fury. Those now show a tile with **an infinity symbol instead of a countdown**, a
full bar, sorted to the bottom of the list, and they never disappear on their own.

- [ ] **Cast Yaulp** (any rank — all three are marked) **and Fury.** *Expect*: a tile showing an
      infinity sign where the timer would be, and it stays.
- [ ] **Let one end** — dispelled, zoned, or however it normally goes. *Expect*: the tile
      disappears when the game says it has faded.
- [ ] **Check it is NOT coloured red** as though about to expire, and does not set off a warning
      sound. Those two were real traps in the code and are guarded, but worth seeing.
- [ ] **Check where it sits in the list.** *Expect*: at the bottom, not the top — it is the least
      urgent thing on screen.
- [ ] **Frenzy and Rage share Fury's exact fade message** and are probably the same. I have NOT
      marked them, because you named Fury and guessing on your behalf is how a wrong number gets
      into the roster. Confirm and they are a two-line addition to `tools/roster-overrides.json`.

## Instant spells — nukes, heals, gates

Your rule: a spell with no real duration should not clutter a duration-based aura, but should be
available to sound and text auras "just in case someone wants feedback when a cast is successful or
resisted". That is now how it works.

- [ ] **Watch a normal aura during a fight.** *Expect*: no tiles for your nukes or heals, and no
      tile stuck showing NaN. That last one was the bug — it could only be cleared by restarting.
- [ ] **Make a sound aura, pick a heal or a nuke, turn on the land sound.** *Expect*: it makes the
      noise when the spell goes off, with nothing drawn.
- [ ] **Make a text aura and point it at the same spell.** *Expect*: the words appear briefly and
      then clear themselves.
- [ ] **"Briefly" is now yours to set.** A text aura has a **Show events for** slider, 1 to 60
      seconds, defaulting to 6. Change it and check the words stay up for as long as you asked.
- [ ] **Cast the same nuke twice in a row on a sound aura.** *Expect*: it makes the noise BOTH
      times. An event has no timer to watch go back up, so this needed its own handling — the first
      version would have beeped once and then gone quiet.

**The open decision underneath this.** 275 spells in the roster have a landing message but no
duration. I fixed the NaN tile by refusing to track them, measured it against all 1.6 million
lines, and then **reverted it** — because it removed 67 spells and 18,405 landings. 36 of those are
nukes and heals that should never have had a timer, but 31 are real buffs: Armor of Protection,
Barbcoat, Fury, Wolf Form, Yaulp II, Shrink, Feign Death. Dropping those is a real loss, so the
trade is yours rather than mine.

- [ ] **Decide what those spells should do.** The three options, honestly: **(a)** show with no
      countdown at all and disappear when their "ended" message arrives — works for 18 of the 31,
      and loses least; **(b)** get a default length, which means the app inventing a number;
      **(c)** not be tracked at all, which is what my reverted fix did.

## Stale timers when a buff is replaced (note 26)

This turned out to need no stacking rules at all — the game announces it.

- [ ] **Overbuff a groupmate.** Cast a weaker buff on someone, then a stronger one of the same
      line. The weaker tile should disappear when the game says "Your \<spell\> spell on \<name\>
      has been overwritten", not keep counting down.
- [ ] **Overbuff yourself** — cast a weaker buff on yourself, then a stronger one of the same line.
      The first tile should go and the second appear, with the longer duration.
- [ ] **A buff wearing off a groupmate clears its tile** rather than running to zero on the app's
      own guess.
- [ ] **A groupmate dying does NOT clear their buffs.** They will probably be rezzed, and forgetting
      is the app inventing a change the log never reported. A mob dying still clears its debuffs.

**What changed underneath.** Nine of the twelve "this cast failed" patterns matched nothing at all —
they were written from memory of EverQuest's wording rather than from your logs. The game says
"Your \<spell\> spell fizzles!", not "Your spell fizzles"; "did not take hold", not "would not take
hold". Fixed, and every pattern now carries the count it was measured at. Two casts across your
whole log history stop being credited as landings, both Dexterity, both cases where the cast
demonstrably failed. Nothing else moved.

**Buffs on yourself are covered too — I was wrong about this twice.** I said the app could not tell
Nimble from Agility because they share a fade message. It can: it only matters if both are running
at once, and the stacking rule that causes the overwrite is the same rule that stops that
happening. Verified with Skin like Wood being replaced by Skin like Steel, which share a fade
message with nineteen other spells.

## The Ally Buffs bug (note 28) — needs one more occurrence

I still cannot fix this without seeing it happen once more, but I have stopped it needing to happen
*twice*.

My best guess at the cause: when you activate something, the app opens a short window and treats
buff landings inside it as yours. If a groupmate casts on somebody during that window, it can get
credited to you. The trouble was that the detection log said only "burst context" for both the
correct case and the wrong one, so a report of it looked identical to normal operation.

The log now records **what opened the window and how long ago**:

```
ALLY LANDED "Spirit of the Puma" on "Avenrae" - burst context
(burst opened 4.2s ago by "Cannibalize"), unique third-person landing text
```

The age is the telling part. Half a second after you pressed something is probably genuinely yours;
eight seconds later is probably somebody else's cast arriving inside your window.

- [ ] **Next time you see a buff on Ally Buffs you did not cast**, note the buff name and roughly
      the time, then send me that day's file from the `detection-logs` folder. With the burst
      origin in there I should be able to say what happened without you having to reproduce it.

---

# 2 — Debuffs and enemies

## Debuffs on enemies (mez, charm, snare, slow)

This is off until an aura asks for it. Tick **"Also watch these on enemies"** on a custom aura, and
the spells that aura is watching start tracking on the things you cast them at.

It has to be opt-in. A mob's name is not one alphabetic word — "a greater kobold" — so the
recipient check rejected it, which is why mez and charm never tracked. Relaxing that check for
everything would let 160,000 landings through, over 100,000 of them from two bard songs pulsing on
everything in range.

- [ ] **Mez a mob and the tile appears with its name on it** — "a greater kobold", not blank and
      not your own name.
- [ ] **The tile clears when the mob dies**, without waiting for the timer.
- [ ] **The tile clears when the mez breaks** rather than counting down to zero while the mob is
      already hitting you.
- [ ] **Mesmerize runs 30 seconds, not 24.** The spreadsheet said 24; your own note-17 table said
      30, and 90 natural expiries in your logs stop dead at 30 with nothing above it, so the roster
      now says 30. Worth one check against a stopwatch.
- [ ] **Turning it off puts everything back.** Untick it and the mob tiles should stop appearing
      entirely.
- [ ] **Nothing MIS-fires** — a mob name must never be mistaken for a groupmate.

**One change that happens whether or not you turn this on**, so it is worth knowing about rather
than being surprised by: a debuff tile now disappears when the log says the debuff ended — the mob
died, or the spell wore off — instead of sitting there until its timer runs out. Across your logs
that is 277 tiles, roughly one every few hours of play. Nothing stopped being *detected*; things
stop being *shown* once they are over. If you would rather they stayed put, say so — it is one line.

## The "Watching: cast by an ally" toggle (note 40)

A Custom debuff aura now has a **Watching:** choice — "Cast by you" (the original behaviour above,
unchanged) or "Cast by an ally". Ally mode tracks the same spells on the same enemies with the same
countdown, but doesn't wait for evidence you cast it yourself — it lands the moment the debuff's own
third-person text appears on something enemy-shaped. It never records who actually cast it, only
that it landed, same as you asked for.

- [ ] **Have a groupmate mez/snare/slow something you're fighting, with the aura set to "Cast by an
      ally"** — the tile should appear with the mob's name, the same as if you'd cast it yourself.
- [ ] **With the aura still set to "Cast by an ally", cast the same spell yourself** — it should
      still land (ally mode doesn't exclude your own casts, it just doesn't require them).
- [ ] **Switch the same aura back to "Cast by you"** — a groupmate casting it should now do
      nothing; only your own cast should track.
- [ ] **The tile still clears correctly** — mob dies, spell wears off, mez breaks — the same as
      self-mode above, since it's the same wear-off detection either way.
- [ ] **Two auras on the same spell, one each way** (if you want to check this) — one set to "Cast
      by you", one to "Cast by an ally" — both should track independently.

## One tile, period, for an enemy-debuff aura (notes 12 and 18, scrapped 24 Aug, then simplified again 24 Aug)

First pass, same day: used to count same-named mobs sharing one key as x2/x3. Reported live:
chain-mezzing a single target before it wakes (the normal way to hold CC) hit that same key
exactly the way a second, genuinely different mob would, so the count climbed on what was really
only ever one mezzed mob — the log gives two same-named mobs no separate identity, so there was
never a way to tell the two cases apart from the log alone. Scrapped the counting: one tile per
key (mob + spell), duration refreshed on a new cast, same as a buff on a groupmate already worked.

**Second pass, later the same day: even that was still too many tiles.** An AoE mez landing on
three *different* mobs at once (three distinct keys, since the names differed) drew three separate
tiles - correct by the first pass's own logic, but not what you wanted. Your answer: *"ONE tile
total for the whole aura, always... like a text aura."* So a `trackOnEnemies` aura (Custom debuff
aura, or a single-spell "debuff on an enemy" premade) now gets the exact same one-tile rule a text
aura already had, applied in `overlay.js`'s `visibleBuffs()` regardless of display mode - icon or
list, not just text. The engine underneath still tracks every distinct target (death/wear-off/
mez-broken detection needs that to keep working) - this only narrows what's actually DRAWN.

- [ ] **AoE mez several different mobs at once.** *Expect*: exactly ONE tile on screen, however
      many mobs actually got mezzed. Which one it shows follows the aura's own "Sort by" setting,
      same as a text aura.
- [ ] **Mez one mob, then mez a second, different mob before the first wakes.** *Expect*: still one
      tile - it should now show the SECOND mob, not both.
- [ ] **The tile still clears correctly** whichever mob it's currently showing wakes/dies/wears
      off, and a new one takes its place if another mob is still mezzed underneath.
- [ ] **An ordinary Ally Buffs aura (not tracking enemies) is unaffected** - Clarity on three
      different groupmates should still show three tiles, one per person. This rule only applies
      to `trackOnEnemies`.

## Someone else casting a mez

Add Aura → **Someone else cast a mez**. Or tick **"Warn me when someone else casts these"** on any
text-only aura. This is your design, built the way you specified it: a warning, no countdown.

- [ ] **When a groupmate casts a mez, the warning appears** and names them — "Lumbarin cast
      Mesmerization VII - careful".
- [ ] **It appears as they START casting**, roughly two seconds before the mez actually lands. That
      is deliberate: a warning after the fact is too late to stop you swinging. The cost is that a
      cast which gets resisted still warns you — about one time in ten.
- [ ] **It names whoever cast it rather than saying "a party member".** In your logs, half the mez
      and charm casts by other people are mobs — ``A Teir`Dal ranger``, "A negotiator" — and the
      game's line does not say which is which. Naming them is right every time, and a mob casting
      mez is worth knowing about too. Say the word if you would rather it only ever mentioned
      actual group members and I will explain what that costs.
- [ ] **Your own casts never trigger it.**
- [ ] **There is no timer on it, anywhere.** If you ever see a countdown on one of these, that is a
      bug — report it.
- [ ] **It watches the whole mez and charm family out of the box** — Mesmerize, Mesmerization,
      Dazzle, Charm, Allure, Beguile, Cajoling Whispers. Adding slows or snares is a tick each in
      the aura's buff list.
- [ ] **Picking "Mesmerization" catches the ranks people actually cast** — VI and VII both warn,
      and the warning says which rank it was.

You can reword it. In the aura's **Say:** box, `{caster}` becomes whoever cast it and `{spell}`
becomes what they cast.

## The RESIST flash

Add Aura → **Resist flash**. One aura, covers every spell you cast — you do not pick which.

**Reported live 24 Aug: did nothing at all. Two separate bugs, both fixed, both confirmed by
feeding the exact reported log line straight into the detection engine (it fired correctly on its
own the whole time).**

1. `buffSource:'customTimer'` auras were being run through the ordinary buff-name picker filter in
   the overlay, and that filter is permanently empty for this source (the picker UI is deliberately
   hidden for it, since there is no shared list to pick from - see CLAUDE.md). So every custom-timer
   aura, not just this one, was silently filtering itself down to nothing on the overlay. Fixed in
   `overlay.js`'s `visibleBuffs()`.
2. **Reported again after (1) was fixed, still not appearing** - because `customTimers:active` is
   one broadcast carrying every active timer from EVERY customTimer-sourced widget, and nothing
   scoped a widget's overlay window down to just its OWN definitions. Once you have more than one
   custom-timer aura (Resist flash plus a hand-built one, say), each one's text tile could end up
   showing the OTHER widget's active trigger instead of its own, since a text aura draws only one
   tile and just picks whichever definition sorts first out of the combined pool. Fixed in
   `overlay.js`'s `currentSourceBuffs()` - each widget now only ever sees its own timer ids.

Both affect every checklist item below AND the plain "Custom timer aura" item further down this
file - re-check both, not just this one, and specifically re-check with a SECOND custom-timer aura
also present, since (2) only ever showed up that way.

- [ ] **Get a mez resisted and it flashes "resisted your &lt;spell&gt;"** — the actual spell name,
      not a bare "RESISTED" — then goes away on its own. Reported live 24 Aug: "resist text should
      say 'resisted your [skill name]'." The name comes from whatever the "contains" trigger's own
      match left over on the real line (customTimerEngine's `capturedText`, surfaced through the
      `{spell}` token every text aura already supports) - if your own Resist flash still says the
      old bare word, open its settings and click "Reset to default" to pick up the new message.
- [ ] **It does NOT fire when something resists a spell somebody else cast**, and does NOT fire
      when a spell is resisted *by you* — those are different lines, and there are 761 of the
      second kind in your logs against 970 of the real ones, so if this is wrong the flash will be
      on constantly.
- [ ] **It lasts about a second and a half.** You asked for 1.4s. Timers are swept once a second,
      so in practice it clears somewhere between 1.4 and 2.4 seconds after the resist. If that
      reads as too long or too short, say so — the number is one line.
- [ ] **A plain user-built "Custom timer aura" (list or icon mode, not a premade) also shows on
      the overlay now.** This was broken the same way and never had its own checklist item - add
      one, trigger it, and confirm the tile actually appears in the game overlay, not just in the
      app's own editor.
- [ ] **Try `{spell}` in the "Say" box on any hand-built "contains"-mode custom timer** (not just
      Resist flash) - e.g. a timer watching `"has been slain by"` could say `"{spell} down!"`.
      *Expect*: it fills in with whatever text the trigger actually matched on the real line, not
      the timer's own name.

### Stacked text lines (25 Aug)

New: text auras have a **"Stack multiple lines"** checkbox (Alerts & Sounds card, under "Show
events for"). Off by default everywhere; **the Resist flash premade ships with it ON at 2 lines**.
When on, a second event arriving while an earlier line is still up is added as a new fading line
below it instead of silently replacing the text. A "Lines visible" slider (2-4, default 2) appears
only once the checkbox is on. Identical back-to-back lines merge into one with an `x2` / `x3`
rather than repeating. Built in `overlay.js`'s `renderTextFeed`; engine untouched.

- [ ] **Make a fresh Resist flash aura and eat a few resists in quick succession.** *Expect*: each
      distinct resist shows on its own line, newest at the bottom, up to 2 lines at once; the
      older line fades out on its own a moment before the newer one. Two resists of the *same*
      spell back-to-back should read as one line with `x2`, not two identical lines.
- [ ] **Your own existing Resist flash aura already has stacking on after this update** - a
      `widgets.json` v2->v3 migration turns it on (at 2 lines) for every Resist flash aura that
      already exists, yours included. Open its settings once and confirm "Stack multiple lines" is
      ticked and "Lines visible" shows 2. If you had previously widened it, that number is kept.
- [ ] **A non-Resist text aura (Dispelled, Charm broke, anything hand-built) did NOT get stacking
      turned on** by that migration - only Resist flash.
- [ ] **Turn the checkbox off and the "Lines visible" slider disappears**; turn it back on and it
      comes back at whatever it was. Toggling off then on mid-burst does not resurrect old lines.
- [ ] **Stacked lines respect the text justification setting (27 Aug fix).** With two lines of
      different lengths showing at once, set justification to Center - both line boxes should be
      centred on the same vertical axis, not left-aligned to each other. Check Left and Right too;
      the stack of lines should hug the matching edge and stay put there as messages change length.
- [ ] **A plain (non-stacking) text aura, and the Dispelled premade, still behave exactly as
      before** - one line, replaced each time.
- [ ] **"Lines visible" actually caps it** - set it to 2, force 4 quick events, only the newest 2
      are ever on screen.
- [ ] **Left/Center/Right justification still works** with several lines stacked (each line can be
      a different width - the anchored edge should stay put).

## The "Custom debuff aura" type (note 34)

Add Aura → Custom → **Custom debuff aura**, beside Custom buff aura. A debuff on a mob arrives as a
landing on "not you", so it needs the ally source AND the enemy switch — two settings in two
places, neither obviously about debuffs. That is what this type saves you.

- [ ] **It comes out already set up to watch enemies**, showing each target's name, without you
      having to change any settings afterwards.
- [ ] **Add a mez to it and it tracks mobs**, showing their names.
- [ ] **A Custom buff aura is unchanged** and still comes out watching you.

---

# 3 — Making auras

## Buff Planner page — LOCKED, skip

The sidebar button is removed (Shara's call, until the buff-loadout overlay aura ships), so the
page can't be reached. The planner code (`buffPlanner.js`, `spellEffects.js`, `buffLines.js`) is
still live and unit-tested; its in-game checklist was retired here when the page was locked and
will be rebuilt if the page is re-enabled. See `docs/BUFF-STACKING.md` for the model it uses.

## Self Buffs overlay - stale-tile removal via the heading model (26 Aug)

The Self Buffs aura now drops a tile the moment a buff that replaces it lands, using the same
`buff-lines.json` data as the planner. This is unconditional now (not behind the "Use spell
stacking model" diagnostic toggle) for any pair the line data covers.

- [ ] **Cast a low then a high tier of one line** (e.g. Spirit of the Puma then a higher rank, or
      Frenzy then Fury). *Expect*: the old tile vanishes when the new one lands - not two tiles for
      the same line. Diagnostics debug log (if on) shows `ENDED "<old>" - replaced by "<new>"`.
- [ ] **Cast two buffs that genuinely stack** (Strength then Infusion of Spirit; Fury then
      Strength). *Expect*: BOTH tiles stay up.
- [ ] **A groupmate's buff that shares a line with one of yours** lands on you - the weaker of the
      two should not linger as a dead tile.

*Not built yet: the "Buff Loadout" overlay aura that shows the planned set in-game with missing
buffs greyed out. Page only for now.*

## The "Buff timer" premade

"+ Add aura" → Premade aura → **Buff timer**. Pick one spell, say whether you are watching it on
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
      message can be tracked — not just "no results".

## Cooldown timers

Add Aura → **Cooldown timer**. Pick a spell, check the number, create.

- [ ] **It works for the ranked spells you actually cast.** You pick "Promised Renewal" from the
      list, but you cast "Promised Renewal VII" — that has to start it, and so do V and IX. **This
      is the single thing most likely to be wrong, so please check it first.**
- [ ] **Cast the spell and a countdown appears**, ending when you can cast it again.
- [ ] **The number is recast plus cast time.** Promised Renewal shows 21s: 18s recast plus 3s
      casting. The recast clock starts when the cast finishes but the timer starts when you begin,
      so the two are added. Your consecutive casts in the logs cluster at exactly 21s, which is
      where this came from — but a stopwatch check would be welcome.
- [ ] **An interrupted cast leaves no timer running.** Start a cast, get hit, have it interrupt —
      the countdown should vanish rather than sit there saying the spell is unavailable.
- [ ] **Somebody else's interrupt does not clear yours.**
- [ ] **You can change the recast time before creating it**, and it keeps what you set. Recast
      times come from the game data and are usually right but not always — of the two you checked,
      one was wrong — so if any spell looks off, the number is yours to correct.

Two things it does NOT do yet, so they are not bugs: it does not shorten the recast for higher mote
tiers (the sheet says 2% per tier), and it does not handle a spell that has both a duration and a
cooldown — that is note 10, below.

## Timers that roll into a cooldown (note 10)

On a custom timer, under Duration, there is now **"Then cooldown: N s"**. Optional — leave it empty
and nothing changes.

- [ ] **Set one up with both.** When the duration runs out the same tile keeps counting, down to
      when you can use the thing again, then disappears.
- [ ] **The tile looks different while cooling down** — dimmed and dashed — and hovering it says
      "cooling down, ready in Ns". A cooldown and a duration show the same digits and mean opposite
      things, so the tile has to say which.
- [ ] **The trigger line arriving again DURING the cooldown does nothing.** That is deliberate: the
      ability is not available, so the line cannot mean you used it, and restarting would hide the
      countdown you are waiting on.
- [ ] **During the duration, the trigger still restarts it**, as it always has.
- [ ] **Editing a timer keeps its cooldown**, and emptying the box removes it.

The cooldown field sits behind a **Cooldown** section that expands like the other collapsible
sections. If a timer has one set, the section shows the value beside its title even when shut, and
opens by itself when you edit that timer — a setting hidden behind a closed section is the one way
a collapsible menu can actively mislead.

**Also new on that form: how the trigger matches.** Two radios under the raw trigger box — *the
whole line, exactly* (what every timer has always done) or *any line containing it*. The second is
for lines the game writes a name into: "Orc centurion resisted your Mesmerize!" will never match a
fixed string, but "resisted your Mesmerize" catches all of them. It existed in the engine and could
only be reached by a premade until now.

- [ ] **Build a "containing" timer and check it fires.** Be specific with the text — a short word
      set to "containing" will fire on nearly every line.

## Multi-condition timers

The "Extra conditions" per-trigger feature was removed and replaced by a per-aura AND/OR combine
mode on the ordinary trigger list. See **"Trigger combine modes"** under [Confirmed](#confirmed).

## Add timer form layout (reported live 24 Aug) — the "Extra conditions" half is now moot

Two complaints about the Add/Edit timer box, both about ORDER, not new functionality. The first is
still real; the second refers to a section (Extra conditions) removed 25 Aug, see the note above.

- [ ] **The icon picker gallery opens right next to the icon box, name and duration fields**, not
      down below Cooldown. It was always the very next thing in the markup after those fields -
      what pushed it visually far below them was Cooldown (and, at the time, Extra conditions -
      since removed) being nested inside that same block, above it.
- [x] ~~Extra conditions and Cooldown now sit at the bottom of the form~~ — Extra conditions is
      gone entirely (see above); Cooldown alone still sits at the bottom, below "What starts it?"
      and the trigger-specific fields, which is the part of this claim that's still true.
- [ ] **Nothing about what Cooldown DOES changed** — this is only where it sits. A timer
      with a cooldown already set should show it exactly as before, just lower on
      the page.

## Damage parser (note 19)

New premade, in **+ Add aura → Premade aura → Damage parser**. It replaces the greyed-out "Damage
parser" that used to sit in the Not-built-yet list, so you should now see exactly one of them and
it should be clickable.

One row per person for the fight you are in, biggest first, with a total line on top carrying the
fight's damage and its rate per second. It works out who is on your side from the log itself —
there is no group list to keep up to date.

- [ ] **Make one and pull something.** Rows should appear as damage happens and the numbers should
      climb. The percentages should add up to 100.
- [ ] **Stop fighting for ten seconds.** The whole thing should clear itself. Then pull again — it
      should start from zero, not carry the last fight forward.
- [ ] **Check it counts your groupmates, not the mobs.** A monster hitting you must never get a
      row. If you ever see a mob's name in the list, tell me what the line in the log looked like —
      that is the one thing here that could go wrong in a way I cannot see from your logs.
- [ ] **Check the numbers are believable.** Not exact — I have no way to verify against the game —
      but if someone's damage looks wildly wrong, say whose and roughly by how much.

Three settings on the aura's own page, under **Damage meter**:

- [ ] **A fight ends after** (3–60s, default 10). Lower it and a slow pull should split into two
      fights; raise it and a chain of quick pulls should join into one.
- [ ] **Only show my own row.** Hides everyone else. Your percentage should still be your share of
      the *whole* fight, not jump to 100%.
- [ ] **Show the total line at the top.** Off should remove just that row.

Two things to flag rather than have you discover:

- **On your character it will mostly show other people.** That is correct, not broken. Across your
  1.5 million logged lines your own damage is 2,712 lines against roughly 346,000 from everyone
  else, so a meter showing only you would be nearly empty.
- **It learns who is who from your own attacks.** If you play a session where you never damage or
  debuff anything at all, it may stay empty. Mez, snare and slow count as well as nukes, so this
  should be rare — but if you get an empty meter during a fight, that is the likely reason and I
  want to know.

What I verified so you do not have to: replayed against a full day of your log, it reads 14,235
damage lines and credits 9,306 (the rest are monsters hitting you, correctly left out), with
nothing left unclassified. On your largest log it found a five-person fight totalling 195.7k at
369/s.

## Travel guide (note 20)

New premade in **+ Add aura → Premade aura → Travel guide**. Pick a destination and it shows the
shortest way there from wherever you are, one step per line, redrawing every time you zone.

- [ ] **Idle means fully gone (fixed 26 Aug, after the first version still showed a "Pick a
      destination" placeholder)** — with no destination set, the aura should be completely
      invisible: no text, no tile, nothing on screen at all, not even while the picker popup is
      open setting one up. It only appears once a destination is actually picked.
- [ ] **The top line reads "Current zone: \<zone\>"** while something IS being tracked (added
      26 Aug) — not shown at all while idle, per the point above.
- [ ] **Make one pointing somewhere far away and walk about.** The list should shorten as you get
      closer, and the line right under the zone header should always be the next thing to do.
- [ ] **Arrive.** It should say "You are in \<zone\>" for a moment, then clear itself back to "Pick
      a destination" on its own (added 26 Aug) — you shouldn't have to do anything to close it out.
- [ ] **Check it uses your travel spells.** If you have a portal or a Circle scribed that helps, it
      should say "Cast \<spell\>" instead of walking you. If it offers a spell you do NOT have,
      that is a bug — tell me which.
- [ ] **Boats and portals should be named as such** — "Sail to" and "Portal to" rather than "Go to".
- [ ] **List width and Row size** (Travel guide's settings page, added 26 Aug) actually resize the
      aura live — a long leg like "Sail to Butcherblock Mountains" shouldn't get clipped once you
      widen it.

**Setting the destination, redesigned 26 Aug.** The original design read the *exact word* you
typed in a failed `/tell` as a possible zone name (`/tell qeynos`). Dropped after you pointed out
the real problem with it: "Freeport" is both a real zone AND a real player could be named it, so an
ordinary social `/tell` to an offline guildmate could look exactly like a travel command — and it
was actually happening, not just theoretical. **`/tell <a real zone name>` no longer does anything
at all now** — the app never reads a /tell's target as a zone name any more, full stop.

The only thing that does anything is one word, `/tell eqtm` by default — but now editable on the
Travel guide settings page (added 26 Aug): a "Command word" text box, right above the destination
readout. Short by your own choice, over a longer word past EverQuest's 15-letter name cap that
would've made collision impossible rather than just unlikely — worth remembering if a real player
named "Eqtm" ever shows up, and worth knowing you can change it yourself if that ever happens.

- [ ] **Changing the Command word box** to something else and pressing Tab/clicking away should
      make `/tell <new word>` work and `/tell eqtm` stop working, immediately, no restart needed.
- [ ] **Clearing the box entirely** should fall back to `eqtm` rather than leaving the command
      unreachable.

- [ ] **`/tell eqtm`** opens a small popup titled "Where are you going?" with a search
      box and the full zone list — type to filter, click one to pick it.
- [ ] **An ordinary `/tell` to a real (offline) person should do absolutely nothing to this aura** —
      no message on the overlay, no popup. This is the actual bug that prompted the redesign, so
      it's worth deliberately testing with a real guildmate's name, not just assuming.
- [ ] **Typing `/tell eqtm` again while the popup is already open closes it** instead of
      doing nothing or reopening it — one command to remember either way.
- [ ] **The popup should not steal focus from the game** — it appears without you having to alt-tab,
      and you should be able to click a zone in it without the game losing focus first (a click on
      it does focus the popup window itself, same as the ambiguous-cast popup already behaves).
- [ ] **The ✕ button dismisses it** without picking anything - the old destination (if any) is
      left untouched, this is cancel, not clear.
- [ ] **"Stop tracking" (destination popup only, added 26 Aug)** clears the destination entirely -
      reported live that there was no way to actually stop once one was set, closing the popup just
      left the old route showing. After this, the aura goes back to "Pick a destination" idle.
- [ ] **"Wrong current zone? Fix it" (destination popup only, added 26 Aug)** opens the "Where are
      you now?" picker even though the app already thinks it knows your zone — reported live after
      accidentally picking the wrong one, with no way back in short of physically zoning. `/tell
      eqtm` alone can't reach this: once a current zone is set (even a wrong one) the command falls
      through to the destination picker, so this button is the only way to correct it by hand.
- [ ] **If the app doesn't know what zone you're currently in yet** (a fresh app launch, before it's
      seen a real zone-change line in your log), setting a destination should chain straight into a
      second popup, "Where are you now?", asking you to pick your current zone the same way.
      Answering it should make the route appear immediately, using the zone you picked as the
      starting point.
- [ ] **The reverse chain always continues to the destination picker (fixed 26 Aug)** — if `/tell
      eqtm` opened the "Where are you now?" popup first (because the zone was unknown) and there
      was already an OLD destination active, answering it should immediately open the destination
      picker next rather than just closing and silently leaving that stale destination in place.
      Previously this only chained when no destination existed at all.
- [ ] **`/tell eqtm` asks "Where are you now?" directly, skipping the destination popup, whenever
      the zone is what's actually unknown** (fixed 26 Aug — previously this always reopened the
      destination popup, which did nothing to fix an aura stuck on "Waiting for a zone line" if you
      never physically zone during a session, e.g. camped in one dungeon after a restart).
- [ ] **The zone list (both popups) no longer offers instance-tier variants** — no "Befallen 1
      (Awakened)", "Befallen 3 (Fused)", etc., just the base zone names. `findRoute` still knows how
      to route to a specific tier internally; it's only the pick-a-zone list that's narrowed.
- [ ] **Walking to an actual new zone afterwards** should still update the route the normal way —
      picking a current zone by hand is only ever a one-time stand-in for a real zone line, not a
      replacement for the log-driven tracking.

Three things to know:

- **Some zone names are a guess.** 38 of the 104 are zones you have never entered, so I have no
  record of EQL's exact wording — usually a question of a leading "The". They have to be in the
  list because real routes pass through them (Faydwer to Antonica goes via the Ocean of Tears). If
  you see a name that is wrong, tell me the right one.
- **Instance tiers are entered, not walked into.** Route to "Befallen 3 (Fused)" and the last line
  says "Enter Befallen 3 (Fused)" once you are standing in Befallen, because there is no zone line
  into a specific tier.
- **One pair I could not resolve**: "Permafrost Keep" and "The Permafrost Caverns - Group". Classic
  EverQuest has one zone there; your app's list has two names. I have treated them as the same
  place. **If they are actually two different zones in EQL, routing to the second will send you to
  the wrong door.**

What I checked myself: all 5,852 ordered pairs between the 77 real places route, and all 10,712
pairs once instance tiers are included.

## Text auras and the dispel announcer

A new **Custom text aura** in "+ Add aura" → Custom aura, and a real **You Have Been Dispelled**
premade. A text aura draws one line of words and nothing else — no icon, no countdown — and only
ever shows one thing at a time.

- [ ] **Add a Custom text aura**, point it at a buff you can cast on yourself, and cast it.
      *Expect*: your words (or the buff's name) appear in large text, and nothing else.
- [ ] **Let it run out.** *Expect*: the text disappears.
- [ ] **Type something into "Say"**, e.g. PUMA UP. *Expect*: it says that instead of the buff name.
      Clear the box again and the name comes back.
- [ ] **Drag the "Text size" slider up.** *Expect*: it gets properly large — up to 120px — and the
      aura's window grows to fit rather than clipping it.
- [ ] **Check it is readable over a bright zone** (snow, desert, water). The dark plate behind the
      words is there for exactly this; say so if it is still hard to read anywhere.
- [ ] **Pick several buffs on one text aura and have two active at once.** *Expect*: still only ONE
      line of text. Which one it picks follows the aura's "Sort by" setting.
- [ ] **Switch its "Buffs shown" to "Your own text triggers"** and add a trigger. *Expect*: the
      option is there at all — a text aura is the only type that can change source after it is made
      — and the trigger announces when the line appears.
- [ ] **Confirm the Display style radios are NOT shown** on a text aura, and that no fourth "Text"
      option has appeared on your other auras.
- [ ] **The picker card says "Triggers", not "Buffs shown", on a text aura.** Reported live 24 Aug:
      "buffs shown" describes an icon/list aura's whole reason to exist (a grid of things it
      displays) - a text aura shows none of that, it fires one line of words when a picked spell
      lands. Originally relabelled "Buff to trigger"; reworded again 25 Aug to plain "Triggers",
      reported live as clearer. Switch back to Self Buffs or another icon/list aura and confirm
      THAT one still says "Buffs shown" - the heading is shared DOM across every widget's panel.
- [ ] **A text aura pointed at ally buffs no longer offers "Group by player" or "Hide the player
      name on each buff".** Reported live in the same pass - grouping needs per-person TILES, and a
      text aura never draws more than one line total, so neither option could ever do anything for
      one. (An icon/list aura on the ally source should still offer both, same as always.)

**Bigger, not done this pass:** you also said the whole text-aura settings panel needs a real
rebuild - it's still built on top of the icon-aura panel with most of its fields hidden rather than
a panel designed for what a text aura actually has, and the two fixes above are targeted patches to
the worst of it, not that rebuild. Flagging so it isn't mistaken for finished.

**The dispel announcer**, from "+ Add aura" → Premade aura:

**Same root cause as the Resist flash bug above (24 Aug) - this one had never been reported, but
had the identical latent bug and should be re-checked for real now that it's fixed.**

- [ ] **Add "You Have Been Dispelled".** *Expect*: it lands on its own settings page, already set
      up, drawing nothing yet.
- [ ] **Get dispelled.** *Expect*: DISPELLED in large letters for eight seconds, then gone.
- [ ] **Only one of its three triggers is confirmed from your logs:** "You feel very dispelled."
      The other two — "You feel dispelled." and "You feel a bit dispelled." — are an inference from
      the third-person versions. **If you get a weaker dispel and nothing shows, tell me the exact
      line** and it is a one-word fix.
- [ ] **Check it does not fire when someone ELSE is dispelled** ("Avenrae feels very dispelled.").
      It should not — the triggers are whole-line exact matches.

## "Buffs shown" is its own card, with gem slots

- [ ] **Open any aura's settings.** "Buffs shown" is a card of its own between **Display & size**
      and **Configuration**.
- [ ] **What the aura watches is now a row of spell icons**, not a list of ticked names. Hover one
      to see which spell it is; click it to stop watching it.
- [ ] **The dashed "+" slot** focuses the search box. It stays visible even when nothing is picked,
      because otherwise there is no way to add the first one.
- [ ] **Your existing auras still have their spells.** Nothing about how they are stored changed —
      the gems are just how the same list is drawn — so this should be true, but it is the thing to
      check first.
- [ ] **Try to add a debuff to an aura that has buffs in it.** It should refuse and say why, rather
      than silently not appearing. Same the other way round.
- [ ] **The picker row "Watching:"** (you / an ally / your own text triggers) has moved up into this
      card, out of Display & size.

---

# 4 — How auras look

## Coloured edges by spell type (note 37) — CHANGES HOW YOUR EXISTING AURAS LOOK

Every tile now gets a coloured edge saying what kind of spell it is, and it is **on by default on
auras you already have** — so the first launch after this will look different. Turn it off per aura
with "Colour each tile's edge by spell type".

- [ ] **Look at your Self Buffs aura.** *Expect*: blue edges on ordinary buffs, and other colours
      where the spell is something else. Nothing should have moved or resized — only the colour of
      the edge changes.
- [ ] **Check a heal-over-time and a damage-over-time** if you have either up. *Expect*: dark green
      and dark amber respectively, distinctly darker than their instant versions.
- [ ] **Find a spell with no type** (242 of the 1,052 have none). *Expect*: its ordinary edge, not
      a guessed colour.
- [ ] **A custom timer aura.** *Expect*: no coloured edge at all — there is no spell behind it.
- [ ] **Turn the setting off on one aura.** *Expect*: that aura only goes back to normal.
- [ ] **Try it in icon mode as well as list mode.**
- [ ] **Worth your judgement:** you asked for red for damage and green for heals, which is the one
      pair that is hardest for colour-blind players. The colours differ in brightness as well as
      hue to soften that. If any two are hard to tell apart on your monitor, say which — they are
      eight lines in one stylesheet.

## Merged tiles

A per-aura **Merge buffs that share a duration into one tile** checkbox, plus an app-wide **Merged
tiles** card on the Setup page choosing what counts as "the same". Off by default everywhere.

- [ ] **Leave it off on every aura and use the app normally for a bit.** *Expect*: no difference at
      all. This is the check that matters most — nothing should have changed for anything you have
      not deliberately turned on.
- [ ] **Turn it on for your Ally Buffs aura and cast a group buff set.** *Expect*: one tile per
      person instead of a wall, showing the soonest to run out, that person's name, and a small
      "x6" style badge.
- [ ] **Watch one of the merged buffs run out.** *Expect*: the count drops by one and the tile
      switches to counting down the next one.
- [ ] **On the Setup page, switch between "Same length" and "Same length, cast together".**
      *Expect*: the change takes effect immediately on every aura, without a restart.
- [ ] **With "Same length" chosen**, look for unrelated 24-minute buffs merging together. They
      will, and that is the rule doing what it says — switch to the other one if you dislike it.
- [ ] **With "Same length, cast together" chosen**, cast one buff, wait a minute, then cast another
      of the same length. *Expect*: two separate tiles.
- [ ] **Check the glow and the sounds still work on a merged aura.** Turn on "Glow when a buff
      lands" and a land sound, then re-cast one member of a merged group. *Expect*: the tile
      flashes and the sound plays. **This is the one most likely to be silently wrong.**
- [ ] **Check the pre-expiry warning fires once, not once per merged buff** — and then check it
      fires AGAIN next time round, after those buffs are recast. The second half is the one that
      was broken: a merged tile warned once and then stayed silent for the whole session.
- [ ] **Recast the buff a merged tile is counting down, before it drops.** *Expect*: the tile
      switches to naming and counting down whichever buff is now soonest. It used to keep the old
      name while counting down the new one.
- [ ] **Turn the merge checkbox on while a buff is already inside its warning window.** *Expect*:
      no beep from the act of ticking the box.
- [ ] **In list mode, look at the badge as a merged tile runs low.** *Expect*: it stays readable
      and does not take on the colour of the bar behind it.
- [ ] **Try it in icon mode as well as list mode.** *Expect*: the badge in the tile's top-right
      corner, not overlapping the countdown.
- [ ] **Turn it off again.** *Expect*: every tile comes straight back, unchanged.
- [ ] Under **"Same length, cast together"**, two buffs cast within a second or so of the
      three-second window may occasionally split into two tiles and rejoin. That is a known limit,
      not a new bug — the countdown the overlay receives is whole seconds.

## Aura names in the move box

- [ ] **Unlock an aura.** *Expect*: its blue box now shows the aura's name in a small pill above
      the "Click and drag to move" text.
- [ ] **Drag the box by the area around the pill.** *Expect*: it still moves normally. This is the
      one to watch — the pill has to be a hole in the draggable area, and too big a hole means the
      aura you are trying to move is the one you cannot.
- [ ] **Click the pill.** *Expect*: the settings window comes to the front and opens that aura's
      page. If the window was minimised it should restore.
- [ ] **Expect EverQuest to lose focus when it does.** With auto-hide on, your other auras
      disappear at that moment. Unlocked ones stay. That is intended, not a bug.
- [ ] **Rename an aura while it is unlocked.** *Expect*: the pill updates immediately.
- [ ] **Unlock several auras at once.** *Expect*: you can tell which box is which, which is the
      entire point of the note.
- [ ] **Unlock a custom text aura while it's idle (nothing currently flashing).** *Expect*: a
      reasonably wide box, not a small square. Reported live as "custom text aura when moving is
      just icon shaped" - the box IS the window's real bounds, and an idle text aura renders no
      tile at all (nothing to flash), so its measured content width used to collapse toward the
      bare 40px floor every other idle window also has. Fixed with a wider floor specific to text
      auras (160px) so idling doesn't make it read as an icon tile.

## Renaming an aura from the sidebar

Right-click any aura in the sidebar → **Rename**.

- [ ] **It actually opens something.** Reported live as doing nothing at all - root cause:
      `window.prompt()`, which Electron's renderer never implements, so the dialog never appeared
      and there was nothing to notice going wrong. Fixed to instead open the aura's own settings
      page and focus/select its existing Name field (the one under "Display & size" - it already
      saved correctly, it was only ever reachable by scrolling to it by hand before).
- [ ] **The Name field is focused and its text pre-selected** - you should be able to just start
      typing the new name immediately, no clicking into the box first.
- [ ] **Typing a name and clicking away (or pressing Enter/Tab) saves it**, same as editing the
      Name field normally always has.

---

# 5 — When auras show

## Loadouts, and the loadout label

The profile bar has **one** button now, "Loadouts", where the "+" and the cog used to be. It opens
a modal that adds, renames and deletes loadouts, and holds the loadout-label switch.

- [ ] **The one button opens the modal**, and adding a loadout from inside it still works exactly
      as the old "+" did.
- [ ] **Make a second loadout and the label turns itself on**, without you asking. With one loadout
      it has nothing to tell you.
- [ ] **Turn it off, then make a third loadout — it must STAY off.** **This is the one I would check
      hardest.** Gating on "do you have two loadouts" would turn it back on every time you added
      one, and you would be switching it off forever.
- [ ] **The tick box shows the truth** when the label switched itself on — open the modal and it
      should already be ticked.
- [ ] **The label follows a switch immediately**, and is still there on a loadout created after it.
- [ ] **Drag it, untick, re-tick** — it comes back where you left it.
- [ ] **Rename a loadout and the label follows.**

You can reword and resize it in its own settings like any aura — `{profile}` in the **Say:** box
becomes the loadout name.

### The name box in "New loadout profile" (note 33)

You reported you could not click into it. The window is frameless and its title bar is a drag
region; drag regions are hit-tested by Windows before the page sees the click, so modal content
overlapping the top 32px cannot be clicked — the click moves the window instead. A tall modal in a
short window centres far enough up for that to reach its first input, which fits the symptom.
Modals now opt out of the drag region.

**This was never reproduced, so the diagnosis may be wrong.** It is the one item where I genuinely
do not know whether it is fixed.

- [ ] **Loadouts → Add a loadout, click the name box, type.** *Expect*: a cursor appears and typing
      works.
- [ ] **Repeat with the window as short as it goes** (480px minimum) and with several auras
      configured, so the checklist makes the modal tall. This is the case the theory predicts used
      to fail.
- [ ] **Repeat maximised.** If it fails **here**, the diagnosis is wrong — say so, because the real
      cause is then still unfound.

## Profile-gated visibility

- [ ] **Switch loadout profiles and confirm the right auras appear/disappear.** *Expect*: an aura
      shows only while a profile it belongs to is active; an aura with **no** profiles ticked shows
      on all of them. There is no longer a global "Show this aura" toggle — profile membership is
      the on/off control.
- [ ] **Aura visibility survives a restart** with the same profile active.

## Hide all auras, and the hotkey (notes 4 and 31)

Built as one change because separately they argue over which override wins. There is a **Hide
auras** button at the right-hand end of the profile bar, always visible.

**The hotkey is Scroll Lock, not Pause.** Pause has never once worked: Electron refuses that key
outright, and refuses it by *throwing* rather than by saying no — so the code meant to handle
"another program owns this key" never ran, and the top bar cheerfully advertised it the whole time.
No test caught it because none of them start the actual app. Nine seconds of launching it did.
Scroll Lock is the same corner of the keyboard and equally unused in game; if something else owns
it, the app falls back to Alt+Shift+H and the hint tells you which one you got.

- [ ] **Press Hide auras.** *Expect*: every aura disappears at once, and the button turns red and
      reads "Auras hidden — show". Press again and they all come back exactly as they were.
- [ ] **Press Scroll Lock in game.** *Expect*: exactly the same thing, and the button in the app
      updates to match even though you never touched it.
- [ ] **The hint next to the "Hide auras" button names the key you actually have.**
- [ ] **The button and the key agree** — use one, then the other, and the button should look right
      both times.
- [ ] **Confirm Scroll Lock does nothing in EverQuest any more** while the app is running. That is
      the cost of a global hotkey.
- [ ] **Close the app and press Scroll Lock again.** *Expect*: EverQuest gets the key back.
- [ ] If Scroll Lock is wrong for you, say so — it is one line, and any key Electron accepts will do.
- [ ] **Unlock an aura, then press Hide auras.** *Expect*: it hides too. Hiding deliberately beats
      unlocking — if that turns out to be the wrong way round for you, it is one line.
- [ ] **Restart the app while auras are hidden.** *Expect*: they come back visible. The hide is
      deliberately not remembered, so a forgotten one cannot look like a broken app.
- [ ] **Untick every profile for an aura so it is switched off, then press its Unlock to move.**
      *Expect*: it appears on screen so you can drag it, even though it is switched off. Lock it
      again and it goes away. This did nothing at all before.
- [ ] **Do the same but with "Unlock all auras" instead.** *Expect*: your switched-off auras stay
      away. Only unlocking one by hand pulls it onto the screen.
- [ ] **Move a switched-off aura while it is unlocked, then re-lock, then switch its profile back
      on.** *Expect*: it is where you put it.

## Zone-gated auras (note 38)

In an aura's settings, under the loadout toggles: **"Only in:"**. Leave it empty and the aura shows
everywhere. Type a zone and press Enter, or pick from the list, to limit it.

**The zone-tracking half is self-verified 25 Aug** by injecting `You have entered North
Freeport.` into the live log and reading it straight back from the detection log: `ZONE now "North
Freeport"`. That confirms the app correctly learns where you are from a synthetic zone line, same
as a real one. **The aura-visibility half below still needs a real zone-gated aura to exist** -
you don't currently have one, and I didn't create one myself: doing that means writing to
`widgets.json` while the app has it open, which risks racing the app's own save and corrupting
your real config, so this half is left for you (or a future session with the app closed).

- [ ] **Limit an aura to the zone you are in.** It should stay on screen.
- [ ] **Zone somewhere else.** It should disappear, and its settings should say *"Hidden right now:
      you are in X, which is not on its list."*
- [ ] **Zone back.** It returns.
- [ ] **Click a zone chip to remove it.** With none left, the aura shows everywhere again.
- [ ] **Instances are separate, as you asked.** An aura limited to `Befallen` will NOT show in
      `Befallen 1 (Awakened)` — add each one you want. Same for `The Plane of Fear` and `The Plane
      of Fear - Group`.
- [ ] **Unlocking an aura still shows it in the wrong zone**, so you can move it wherever you happen
      to be standing.

**One thing worth knowing before it surprises you.** The app only learns which zone you are in when
you *change* zone — the game prints nothing otherwise, and there is no way to ask. So if you start
the app while already sitting somewhere, it does not know where you are until you next zone.
**Zone-gated auras show anyway during that window**, and the settings panel says so. That is
deliberate: in your logs the wait for the next zone line, from a random start, averages about 55
minutes of play and once ran five hours. An aura silently missing for five hours with no
explanation is far worse than one showing where you did not ask for it.

The zone box offers the 66 zones seen in your logs and accepts anything you type.

## Overlay auto-hide

- [ ] **Auto-hide split into two settings** (now on the Overlay Auras page, under "All auras"). The
      second one, "Also show auras while EQLS Auras itself is the focused window", is OFF by
      default. *Expect*: with it off, tabbing to this app no longer drags every aura back on
      screen; with it on, it does.
- [ ] **Both auto-hide settings moved** off the Setup page into the "All auras" card on Overlay
      Auras. Check they still actually work from their new home — the wiring is by element id so it
      should be unaffected, but worth confirming rather than assuming.

---

# 6 — Sounds and alerts

## Sound follows the on/off switch, not the screen

Hiding an aura's window never silenced it — a hidden overlay carries on receiving updates and
carries on playing its alert sounds. That was invisible while every aura had tiles; it stops being
invisible the moment an aura is nothing but sound. The rule is now:

- **Switched off for this profile** — silent, and not on screen. Off means off.
- **Hidden by "Hide auras", or by auto-hide while EverQuest is unfocused** — still audible. You
  usually want to hear a buff about to drop even when you are looking at something else.

- [ ] **Set up any aura with a sound, untick every profile for it, and make its buff land or
      expire.** *Expect*: silence. Before this change it would still have beeped.
- [ ] **Put it back on your profile, press Hide auras, and do the same.** *Expect*: you still hear
      it. This one is meant to keep making noise.
- [ ] **Same again with EverQuest focused so auto-hide kicks in.** *Expect*: still audible.

## Sound-only auras

A **Custom sound aura** in the Add aura list. An aura in this mode draws nothing at all and exists
purely to make a noise.

The one to watch hardest is the third item. A sound-only aura is deliberately exempt from the
auto-hide-when-EverQuest-is-unfocused behaviour, because there is nothing of it on screen to hide
and a hidden window is one Chromium is entitled to throttle. That reasoning is sound but it has not
been observed, and if it is wrong the symptom is a missed alert, not an error.

- [ ] **Add one from "+ Add aura" → Custom aura → Custom sound aura.** *Expect*: it lands on its own
      settings page, drawing nothing anywhere on screen. It used to be a Display style radio and a
      premade; both are gone, so check there is now exactly ONE way to make one.
- [ ] **Pick a buff under "Buffs shown", leave "Play a sound when a buff expires" on, and let that
      buff run out.** *Expect*: a sound, and nothing drawn at any point.
- [ ] **Do the same with EverQuest in focus, then with the app in focus and EverQuest behind it,
      then with EverQuest minimised.** *Expect*: the sound every time. If it goes quiet in any of
      those, say which — that is the throttling question above, and the most likely thing to be
      wrong.
- [ ] **Check the Display style radios are not shown** on a sound aura or a text aura, and that
      List and Icons are the only two options on your other auras.
- [ ] **Switch a sound aura's "Buffs shown" to "Your own text triggers"** and add one. *Expect*: the
      option is there, and the trigger makes the noise.
- [ ] **The settings page hides what cannot apply**: no Sort by, no Opacity, no Unlock/Reset
      position, no Timer text or Alerts sections. Sounds, Buffs shown, profiles and the name box
      all stay.
- [ ] **Unlock it** (via "Unlock all auras" on the overview, since it has no unlock button of its
      own). *Expect*: still nothing on screen — no dashed blue box. Every other aura should still
      show theirs.
- [ ] **Switch an existing aura that has tiles on screen to Sound only.** *Expect*: its tiles
      disappear immediately, without waiting for a buff to change, and it keeps making its sounds.
- [ ] **Switch it back to List.** *Expect*: it returns exactly as it was — same width, same
      opacity, same sort order. Nothing should have been lost.
- [ ] **Untick every profile for it.** *Expect*: it goes silent. Profile membership is still the
      on/off switch, and this is the check that it did not get exempted along with everything else.
- [ ] **Restart the app.** *Expect*: still sound-only, still silent on screen, still audible.
- [ ] **Export its share code and import it back.** *Expect*: the copy is sound-only too. A custom
      sound FILE deliberately does not travel — the copy falls back to the default beep, which is
      correct, not a bug.
- [ ] **Pick a custom sound file for it, then press Export.** *Expect*: a line under the code saying
      the file will NOT travel, worded more strongly than on an ordinary aura because for this one
      the sound is the whole aura. With only the default beeps, no message at all.

## Sounds on every aura type

Sound settings were already available on every kind of aura; nothing needed adding. Worth one pass
to confirm that is true in practice as well as in the markup.

- [ ] Open the **Sounds** section on Self Buffs, on an Ally Buffs aura, on a custom buff aura, and
      on a custom timer aura. *Expect*: the same controls in all four, and the volume slider showing
      that aura's own saved value rather than always 100%.
- [ ] The volume slider stays **0–100**, as asked. If a sound is too quiet at 100, that is the
      source file, not the slider.

## Trade request ping

The line pattern is tested against your real logs; whether a sound comes out of your speakers is
not testable here.

- [ ] **Turn it on in Setup → Trade requests.** *Expect*: a two-note ping the moment you enable it,
      confirming what was just switched on.
- [ ] **Test button** plays the same ping.
- [ ] **Have someone request a trade.** *Expect*: the ping fires once, and nothing appears on screen
      — this is the first sound in the app with no tile behind it.
- [ ] **Complete or cancel that trade.** *Expect*: NO further ping. Only the request pings.
- [ ] **It survives a restart** with the checkbox still ticked.
- [ ] **With the setting off**, a trade request pings nothing.
- [ ] **Does it ping when the settings window is minimised?** It lives in that window's renderer.
      The window stays alive for the app's whole lifetime, so it should — but browsers throttle
      background timers, and if it turns out to miss pings while minimised, say so.

---

# 7 — The app window

## Refocus EverQuest after answering an ambiguous cast

The call itself is unit-tested; whether Windows honours it is not testable without a real desktop.
Windows refuses foreground changes from a process that is not already foreground under some
conditions, so **this is the one that most plausibly does nothing in practice.**

- [ ] **Answer an ambiguous cast popup with EQ behind it.** *Expect*: EQ comes to the front by
      itself, no alt-tab needed.
- [ ] **With several questions queued, answer the first.** *Expect*: focus does NOT jump to the
      game yet — it should only happen once the last one is answered, or you get thrown out of the
      popup mid-way.
- [ ] **Answer a question with EQ minimised.** *Expect*: the game is restored, not merely focused.
- [ ] **Close EQ, trigger a question from a replayed log, answer it.** *Expect*: nothing happens and
      no error appears.

## App text size

Scaling is done with Electron's zoom factor rather than by rewriting the stylesheet, because
`main-window.css` carries 316 hardcoded px values across 39 distinct sizes and converting them by
hand, with no layout tests, would get some wrong in ways only visible by eye. Zoom scales text,
spacing and controls together and cannot drift out of step with itself.

The wiring is tested; how it *looks* is not. I attempted a screenshot and could not get a reliable
one without stealing focus from the running game, so this is yours.

- [ ] **Setup → App text size** moves the whole window together — text, padding, buttons — with
      nothing clipped or overlapping at 80% or at 160%.
- [ ] **It survives a restart.** Set 130%, close, reopen. *Expect*: still 130%, and the slider reads
      130 rather than snapping back.
- [ ] **Your auras are unaffected** at every setting. They have their own sizes per aura and must
      not move.
- [ ] **Reset returns to 100%.**
- [ ] At 160%, check the **frameless title bar** still looks right and the window can still be
      dragged and closed.
- [ ] **Auras must NOT rezoom.** Set 160%, then look at an aura. Chromium keys zoom by origin within
      a session, and every window here loads a `file://` page in the same session — so "it cannot
      leak" is an assumption, not something the code enforces. If auras DO change size, say so: the
      fix is to give them their own session partition.
- [ ] **Ctrl+R does not reset it.** Reload the window at 130%. *Expect*: still 130%. An earlier
      version used a one-shot listener that did not re-arm.
- [ ] At 160%, **open a modal** (Add aura) and check its content is reachable — a scaled-up modal is
      taller, which is exactly the case the drag-region fix is about.

## Resizable sidebar

- [ ] **Drag the edge of the sidebar.** *Expect*: it resizes smoothly, the cursor becomes a
      horizontal resize arrow over the handle, and the drag keeps working when the pointer moves
      fast enough to outrun the handle.
- [ ] **It survives a restart.** Widen it, close, reopen. *Expect*: still wide.
- [ ] **Double-click the handle** restores the default width.
- [ ] **Shrink the window very narrow, then widen it again.** *Expect*: the sidebar gives way while
      narrow, and your chosen width comes back when there is room. It must NOT be permanently
      shrunk — that is the specific bug the two-clamp split exists to prevent.
- [ ] **Profile tooltips still escape the sidebar** rather than being clipped — the reason a real
      handle was used instead of CSS `resize`.
- [ ] **At 640px wide** (the minimum window width) the widest pages still read sensibly. The page
      area gained `min-width: 0`, which changes how narrow windows lay out independently of the
      sidebar.
- [ ] **Combined with App text size at 160%**, both still behave — the sidebar width is in CSS
      pixels, so zoom scales it too.

## Share codes

- [ ] **Export an aura**: the code should start `EQLSAURAS1-`. Import it back and confirm it works.
- [ ] **An old `EQBT2-` code is refused** rather than importing something broken. A clear "not a
      valid code" is the expected result for now; a friendlier "this is from an older version"
      message is not built yet.

### Share codes pasted into chat (note 30)

This was blocked on two questions and both are now answered from your logs. You told me "+= survive
fine in a chat line" and the logs back you up: across 1.5 million lines, 1,393 chat messages contain
a +, 135 contain an =, and 921 contain a /. The other half — the per-line character limit — is not
published anywhere, so I measured it: the longest message anyone has typed in your logs is 403
characters. Real aura codes come out at 79 to 231 characters, so they fit with room to spare.

When someone pastes a code into any chat channel, a strip appears at the bottom of the main window:
"\<name\> shared an aura: \<name\>." with **Look at it** and **Ignore**.

- [ ] **Get someone to paste a code**, or paste one yourself in /say. The strip should appear naming
      who sent it and what the aura is called.
- [ ] **Look at it** should open the normal import screen with the code already filled in. It should
      NOT import anything by itself — you still press Import, and every warning that screen already
      gives you still happens.
- [ ] **Ignore** should make it go away.
- [ ] **The same code twice** should only offer once per session.
- [ ] **A code in a tell, in guild, in group, in a channel** should all work. I checked the wordings
      against your logs, so if one of them does not register, tell me which channel.

Deliberate: it never imports on its own. A code in chat is text another player typed, and applying
it automatically would let anyone reconfigure your app by talking in guild chat.

**The one real limit.** A very elaborate aura — 40 spells, six timers and three zone limits — comes
to 651 characters and will not fit in one chat line. If a code arrives cut off, the strip says it
looks cut off rather than calling it invalid, so you know it is a length problem and not a bad code.

## QOL batch

- [ ] **Reset remembered choices is red**, matching Delete aura.
- [ ] **"Unlock all auras" appears ONLY on the Overlay Auras overview** — select any individual aura
      and the whole "All auras" card (including the two auto-hide checkboxes) should be gone.
- [ ] **The per-aura "Unlock to move" button is still there** on each aura's own settings. Scoping
      the master control down is exactly when its sibling might be taken with it.
- [ ] **The alert volume slider shows the aura's real value** when you select an aura, not always
      the middle of the track. Set one aura to 40%, another to 100%, switch between them: the handle
      should move. *This is almost certainly the whole of the "starts in the middle but it's 100%"
      report* — the slider was never populated, and an HTML range with no value defaults to the
      midpoint.
- [ ] **The Add Aura premade list shows eight greyed "Not built yet" entries** below the working
      ones, and none of them can be clicked.
- [ ] **Window size and position persist** across restarts. Resize/move the window, close, reopen.
      *Expect*: it returns where you left it. *Edge case worth checking*: maximize, close, reopen —
      it should restore to the pre-maximize size, not a screen-sized non-maximized window.

---

# 8 — Session, memory and stability

## Session restore

- [ ] **Timers survive a restart.** With buffs running, close the app and reopen within 5 minutes.
      *Expect*: they come back with time already deducted for the gap (a 100min buff closed 3min
      shows ~97min), and anything that expired while closed is simply absent. Confirmed working
      against real data (7 timers restored after a 6s restart) — this is about confirming it feels
      right in play.
- [ ] **Ally buffs and custom timers restore too**, not just self buffs.
- [ ] **A long gap does NOT restore.** Close for more than 5 minutes and reopen — the overlay should
      be empty rather than showing stale buffs. The detection log will say "Did not restore timers:
      closed for Ns, over the 300s limit".

## Memorized gem bar (landing page)

- [ ] **Never shows more than 14 gems.** Play a session with several loadout swaps, including
      closing the app mid-swap. *Expect*: the count stays at or below 14 and never creeps up over
      days.
- [ ] **An already-drifted count heals itself.** If your bar currently shows more than 14, one
      launch of this build should bring it to 14 with the most recent kept.
- [ ] **Re-memorising a spell you already have does not evict it.** Memorise a full bar, re-memorise
      the first spell, then memorise one more. *Expect*: the re-memorised spell is still there and
      the stalest one went instead.

## Stability

- [ ] **App no longer closes itself.** It was observed exiting unprompted (exit 0, no crash dump,
      cause unknown). Shutdown logging is now in place — **if it happens again, check the detection
      log for `SHUTDOWN:` lines** and report which one appears. That identifies the cause.

---

# 9 — Built, but nothing to test

Recorded here so it is not lost, and so nobody goes looking for a test that cannot exist yet.

## The song-pulse check (note 24)

You said: "you do not need proof, it happens... the proof is that I told you it is." You were right,
and I measured it anyway because the app needed a number to work with: across your 1,521,971 log
lines, the gap between consecutive repeats of an identical line is exactly 6 seconds on **314,324**
occasions — four times more often than any other gap, and all ten of the most-repeated lines pulse
at 6s.

The check is built and wired. It is also, right now, **dormant** — it exists to break a tie between
a song and a non-song sharing one landing text, and after the roster rebuild there are no such ties
left. 108 messages are shared between two or more spells; not one is that pairing. The old
11,337-entry roster had them; replacing it removed them.

There is a test that fails the day a song and a spell share a message again, so it will not sit
there rotting unnoticed. **Nothing for you to test.** Recorded because you said "this 6 second timer
check will be needed later", and this is me saying it is ready and waiting.

## Global recovery time (note 25)

Still a disabled placeholder. The `castOf` trigger that the cooldown premade introduced is the piece
it needs, when you want it built.

---

# 10 — Lockouts and log tools

Shipped on `feat/lockouts` (PR #15): `ff4b7a5` plus follow-ups. All of this needs the real EQ
client and, for the trim/rotation checks, a real log that spans more than one lockout week. See
`docs/EVIDENCE.md` for why the lockout parser refuses to name a reset day it hasn't observed.

## The weekly reset control

- [ ] **Change the reset day/hour on the Lockouts page** — it mirrors to Setup, and a change made
      on Setup mirrors back. It is one setting shown in two places.
- [ ] **The grid's period heading follows it** — e.g. "Aug 25 – Sep 1, 2026" (short month names),
      recomputed whenever the reset changes.
- [ ] **The hour shown above the grid is your local time**; the control itself is labelled US
      Eastern. Default is **Tuesday 11:00 US Eastern**.
- [ ] **DST**: the reset resolves to the same real instant whether the PC clock is on Pacific,
      Eastern or London, and across the daylight-saving change.

## Reading a different log file

- [ ] **"Change log file"** — pick a split or archived file; the grid re-reads it. **"Back to
      live log"** restores the live tail.
- [ ] **A missing target is dropped** — if the chosen file no longer exists, the app falls back to
      the live log and persists that (stored target back to `null`), with no error.
- [ ] **"Add split files"** — the picker pre-ticks only this week's day-files; earlier weeks start
      unticked. The grid updates to include whatever you add.
- [ ] **"Trim log to this week" disappears** once any extra file has been added.

## Trimming and archiving

- [ ] **"Trim log to this week"** on a live log spanning several weeks — an archive is created and
      its size verified, the live log is rewritten down to the current lockout week, and the grid
      rebuilds. The kept week is **not** re-emitted to the buff engine or re-split.
- [ ] **"Archive log now"** uses an in-app modal, not a native dialog. When the log still holds the
      current lockout week it shows a danger warning and an "Archive anyway" button.
- [ ] **Weekly rotation is ON by default.** It does **not** rotate a log that has play after the
      reset (`skippedSpansBoundary`); the status line explains why when it skips.

## "EQ is running but not logging"

- [ ] With EQ up and `/log` off, a modal appears after ~2.5 minutes.
- [ ] `/log on` in-game plus "I've done it" clears it; and starting to log while the modal is open
      dismisses it on its own.

## Backfill and split correctness

- [ ] **Backfill reads only the live log**, not the whole Logs folder.
- [ ] **A re-split from offset 0 doesn't double lines** in the day file.
- [ ] **Grid cells show the kill date.**
- [ ] **Crash-safe config writes** — a crash mid-save can't leave a half-written `.json` (temp
      file then rename).

---

# Confirmed

Kept as regression guards — each of these was broken once.

## Custom timers

- [x] **Add timer** opens the modal with every field visible.
- [x] **Edit** opens the same modal pre-populated; title says "Edit timer", button says "Save
  changes", and "Save as new" appears.
- [x] **Save as new** creates a second timer without altering the original.
- [x] **Icon gem box** — click opens the picker, picking sets the art, the picker is full height and
  usable (it was previously clipped to a sliver).
- [x] Two timers sharing a name *and* trigger text both fire, with their own distinct icons.
  *(Regression guard — this was a real bug.)*
- [ ] **Zone change trigger (25 Aug).** In "+ Add trigger", pick "Zone change" (was disabled
  "Planned" until now). *Expect*: a zone dropdown (only zones you've actually visited while the
  app was watching show up — same list as "Only in") plus Entering/Leaving radios. Zone in-game
  to a zone on the list: an "Entering" trigger set to that zone should start its timer the instant
  you arrive; a "Leaving" trigger set to that same zone should start when you zone back OUT of it.
  *Note*: a "Leaving" trigger cannot fire the very first time you leave a zone you were already
  standing in when the app launched — only from a zone the app itself saw you arrive in during
  this session. This is deliberately different from "Only in" (that gates whether the whole aura
  is visible while you're in a zone, persistently) — this is a one-shot timed event on the moment
  of entry/exit. Engine behaviour is unit-tested end to end in `test/zone-trigger.test.js`; what's
  left is confirming it reads right live.
- [ ] **Reverse detection (25 Aug).** Tick "Reverse detection" in the Custom triggers card, next
  to "+ Add trigger" (was a disabled per-trigger "Planned" checkbox in the timer modal until now —
  moved to be whole-aura instead, per Shara's correction that it needed to work across triggers
  without setting a flag on each one separately). *Expect*, with a single Independent-mode trigger:
  the tile shows immediately, with no countdown (∞-style), from the moment the checkbox is ticked —
  with nothing logged yet. Trigger the text in-game (or via a synthetic log line): the tile should
  disappear entirely (not just change colour) for the Duration set above, then reappear on its own
  showing ∞ again.
  - [ ] **Two Independent triggers on the same aura** — each should get its own default-visible
    tile, and each hides independently when its own trigger fires (the other stays visible).
  - [ ] **AND mode, the motivating case** ("this skill is ready, cast it to make it go away"): the
    combo tile should stay visible until BOTH triggers have fired (within the AND window), then hide
    as one tile — one trigger firing alone must not hide it.
  - [ ] **OR mode**: the combo tile should hide the moment EITHER trigger fires.
  - [ ] **Works in all three display modes** — icon/tile, list, and text — not just icon mode.

  Engine behaviour (including the AND/OR combo cases) is unit-tested end to end in
  `test/reverse-trigger.test.js`; what's left is confirming it reads right live.

## Sounds

- [x] **Preview** plays the chosen sound.
- [x] **Volume slider** affects both custom sounds and the default beeps.
- [x] **Open sounds folder** opens the folder the picker defaults to.
- [x] Real in-game alerts (land / expire / warning) actually play.

## Ally buff grouping

- [x] **Group by player** on an ally aura splits it into a section per person with their name as a
  heading. Groups are ordered **alphabetically** and stay put as timers tick — they should never
  reshuffle.
- [x] **Stack groups vertically / side by side** both lay out correctly, in list mode and icon mode.
- [x] **The name prefix disappears from tiles while grouping is on** (the heading covers it), and
  the separate "Hide the player name" toggle drops it when grouping is off.
- [x] **Nothing breaks over time.** Leave a grouped aura running a few minutes — tiles must stay
  inside their group, not drift out into a flat pile.
- [x] The grouping section is **hidden** on self-buff and custom-timer auras.

## Bard Songs (backlog #15, 25 Aug)

New premade aura — "+ Add aura" → Premade widget → **Bard Songs**. Every bard song currently on
the player, no matter who cast it, grouped by caster (using the same grouping UI Ally Buffs already
has) with an **Unknown** group for anything that can't be attributed. Engine behaviour is
unit-tested end to end in `test/bard-songs.test.js`.

**Attribution itself confirmed live, 25 Aug, game down — synthetic lines injected directly into the
real combat log, verified against the real debug log, "Track buffs cast on me by others" OFF the
whole time:**
```
[16:58:32] BARD SONG "Anthem de Arms" - attributed to You        (self-cast: "You begin singing...")
[16:59:15] BARD SONG "Anthem de Arms" - attributed to Unknown    (landing with no cast-begin evidence)
[17:03:38] BARD SONG "Anthem de Arms" - attributed to Avenrae    (ally cast-begin: "Avenrae begins singing...")
```
That third line is also the confirmation for the veto-waiver design change (see CLAUDE.md #15):
the ally-cast landing would ordinarily be `IGNORED` with the toggle off - the log shows it landing
anyway ("landed anyway (bard song)") specifically because `known.isBardSong` was true, not because
the global toggle was on. **What's still open is the on-screen half** - none of the above confirms
the actual widget renders these correctly, since it was checked at the engine/debug-log level only:

- [ ] **Settings panel shows exactly**: display style (list/icon), sort, merge, borders, timer
  text, opacity, position, alerts/sounds, and the ally-grouping controls (Group by player,
  Stack vertically/side by side, Hide the player name). *Expect*: **no** "Buffs shown" card/buff
  picker, and **no** "Track buffs cast on me by others" toggle (that one's global and lives on Self
  Buffs already) — if either shows up, the shape wiring is wrong.
- [ ] **Sing a song yourself in game.** *Expect*: it appears in the aura on screen, grouped under
  **"You"**.
- [ ] **An ally in your group sings a song, for real.** *Expect*: it appears on screen grouped
  under their real name, with "Track buffs cast on me by others" left OFF.

## Buff + cooldown toggle, and the nuke filter (25 Aug)

- [ ] **Add Aura → Premade → Buff timer, pick a spell with both a duration and a recast** (e.g.
  Alacrity). *Expect*: an "Also track when it's ready to cast again" checkbox appears under the
  "On:" radios, only while "Yourself" is selected - switching to "Someone you cast it on" should
  hide it. Check it and create the aura: the tile should count down the buff's own duration first,
  then roll straight into the recast countdown without resetting or disappearing in between -
  confirm both phases actually look different (see the existing cooldown-phase styling).
- [ ] **Pick a spell with no known recast time** (most buffs). *Expect*: the checkbox never
  appears at all - just the ordinary Buff timer flow, unchanged.
- [ ] **Anarchy (or any nuke) no longer appears in the Buff timer / Debuff on an enemy pickers.**
  *Expect*: only spells with a real duration are offered now; a real mez/charm/snare/slow debuff
  should still be there.

## Charm Broke premade (25 Aug)

- [ ] **Add Aura → Premade → Event alerts → Charm Broke.** Charm something, let it break (or wait
  for it to wear off). *Expect*: a flash reading "{target name} has broken free!" appears and
  clears itself after a few seconds - confirmed against the real log's own wording
  (`"Your Beguile spell has worn off of a greater kobold."`) via synthetic injection, but not yet
  seen firing from an actual in-game charm break.
- [ ] **An ally's buff wearing off (not a charm)** should NOT fire this aura - only the roster's
  own charm-category spells should.
- [ ] **A song already running when the app starts, or whose cast line was missed**, should land
  under **"Unknown"** rather than being guessed as yours — this is the honest-uncertainty case the
  whole feature exists for.
- [ ] **Two different casters both maintaining the same song on you** (yourself and a groupmate,
  or two groupmates) should show as two separate tiles/rows, one per caster, not one overwriting
  the other.
- [ ] **List mode and icon mode** both work, matching how Self Buffs/Ally Buffs already look in
  each mode.

## Memorized gem bar

- [x] **Persists across restarts.** Memorize some spells, close the app, reopen. *Expect*: the bar
  comes back populated, not empty and red.
- [x] **Click a gem to forget it** — gem disappears, stays gone after restart.
- [x] **"Forget all"** clears the whole bar.
- [x] **Bard songs sit at the right-hand end**, underlined; regular spells fill from the left.
- [x] **Non-buff spells** (a nuke, a heal) show their real icon greyed out with a dotted border, and
  hovering says "(not a tracked buff)".
- [x] **Empty state is red/warning** on a genuinely fresh memory.

## Overlay behaviour

- [x] **An unlocked aura is never auto-hidden.** Click Unlock to move on one aura while EQ isn't
  focused — it should stay visible so you can actually drag it. Re-locking hands it back to the
  normal rules.
- [x] **"Unlock all auras"** toggle unlocks/re-locks every aura at once, and the per-aura Unlock
  button label stays in sync with it (and vice versa).

## QOL

- [x] **"Add a new buff" and "View custom buffs"** now sit together in one Custom buffs card; both
  still open their modals.
- [x] **"Open sounds folder"** now at the bottom of the Sounds section, still opens the right folder.
- [x] **Profile toggles moved into aura settings.** Now an always-visible row of chips at the top of
  an aura's settings, not a modal. *Expect*: ticking/unticking shows/hides the aura immediately.
  **Behaviour change**: unticking *every* profile now hides the aura entirely (it used to mean "show
  on all profiles"). With a single profile this is your plain on/off switch.
- [x] **Profile chip in the top bar** is now solid brass when active — should be obvious at a glance
  which profile is live.
- [x] **Unlock to move / Reset position** moved into Display & size, above a dotted rule. "Unlock to
  move" is accent-outlined, and goes solid brass while actually unlocked.
- [x] **Timer text colour / Label text colour** pickers now work (icon mode and list mode).
  *Expect*: a buff about to expire still goes red — the low-time warning deliberately overrides any
  custom colour.
- [x] **Margin width** slider now works — changes the gap between icons in icon mode.
- [ ] **Progressive disclosure, three gaps found by audit and fixed (25 Aug):**
  - [ ] **Auto-hide.** With "Hide auras when EverQuest isn't the focused window" OFF, "Also show
    them while this app is the focused window" should be hidden entirely (it did nothing while
    off, and stayed visible/clickable anyway). Ticking the auto-hide checkbox reveals it
    immediately, unticking hides it again — no reselect/reopen needed.
  - [ ] **Log splitting.** With "Enable log splitting" OFF, the gap-detection checkbox, output
    folder row, and the Change/Reset buttons should all be hidden. Ticking the enable checkbox
    reveals them immediately.
  - [ ] **"Always on screen" vs "Show events for".** On a text or ally-alert aura, ticking "Always
    on screen, with nothing to wait for" should hide the "Show events for: Xs" slider immediately
    (it directly contradicted the always-on label before this fix). Unticking brings it back.

## Detection

- [x] **Bard song opt-in + "Show bard songs" toggle.** Songs hidden by default; toggling shows them.
  Previously the toggle did nothing at all because only 1 of 11,337 roster entries was tagged as a
  song.
- [x] **Ally buff detection.** Buffs cast on other people now appear on the Ally Buffs aura —
  confirmed with Shield of Flame on both Avenrae and Lasartik. Had **never** fired before: the tier
  was gated on the recipient being a known group member, and group membership is only learned from
  join/leave lines seen live.

## Trigger combine modes (25 Aug)

Replaces the old per-trigger "Extra conditions" all-of list, reported live as "not in an obvious
place." The list of triggers on a custom-text aura (the same "+ Add trigger" list that already
existed) now has a button next to each row, to the left of Edit, that cycles the whole aura through
three modes: **Independent** (unchanged default), **AND**, **OR**. Engine behaviour is unit-tested
end to end in `test/trigger-combine-mode.test.js`; what's left is confirming it reads right live.

- [x] **The combine-mode button** shows the same label on every row of one aura's trigger list, and
  clicking any row's button moves them all together (Independent → AND → OR → Independent).
  **Confirmed live 25 Aug** - you set your "Custom timer aura" (triggers "hi"/"hii") to OR
  yourself via this button; both triggers work as OR under it (see below).
- [x] **Independent** (the Dispelled premade, unchanged): all three severities still fire
  independently exactly as before. **Self-verified 25 Aug** by injecting `You feel very
  dispelled.` while your Dispelled aura was actually set to OR (not Independent) at the time -
  debug log showed `FIRED "Dispelled" - trigger: "You feel very dispelled."` then `ENDED
  "Dispelled" - duration ran out` 4s later, exactly as expected either mode.
- [x] **OR**, tried on a custom aura with two different, genuinely unrelated triggers (not the
  built-in mutually-exclusive dispel text): only ONE tile ever shows, whichever trigger fired most
  recently, even if both are separately true. **Confirmed live 25 Aug** on your real "Custom timer
  aura" (triggers "hi" and "hii", combine mode OR) - "hi" fired correctly; the root cause of "hi"
  firing but not a third word ("hello") was that the second trigger's text was actually "hii", not
  "hello" - confirmed by reading widgets.json directly, not a combine-mode bug.
- [ ] **AND**, same two-trigger aura: nothing appears until BOTH triggers have happened; then one
  combined tile shows, using the first trigger's icon/name. Not yet tried on a real aura - only
  unit-tested (`test/trigger-combine-mode.test.js`) so far.
- [ ] **"Extra conditions" is gone** — editing an existing trigger that used to have one no longer
  shows that section at all; the trigger still fires on its plain text as before.
- [ ] **Cooldown wording** — opening a trigger with a cooldown set now reads as a forced gap before
  it can fire again, not just "the tile keeps counting." No behaviour change expected here, only
  the words.
- [ ] **The "Triggers" heading** — a text aura's buff/trigger picker card says "Triggers", not "Buff
  to trigger".

## Settings-panel rework (25 Aug) — "additive" cards per aura type

Grew out of the Ally Buffs conversation: "can you wire everything in to make sure it does NOT
break anything?" This rebuilt how the per-aura SETTINGS panel (the page you land on after picking
an aura in the sidebar) decides what to show, for every aura type at once - not the Add Aura
creation modal, the page you configure an aura on afterward.

**Before:** one shared panel built for a buff aura, with two functions
(`updateDisplayModeVisibility` + half of `renderBuffFilter`) each independently hiding fields that
didn't apply, using their own `isTextAura`/`isSoundOnly`/`announcer` booleans - with a real ordering
bug between the two (ally-grouping visibility had to be set in the SECOND function specifically
because the first one would get overwritten by it). This is the exact shape of bug CLAUDE.md
already flagged twice: the old "Extra conditions" section buried where nobody would look, and
Damage parser/Travel guide still showing a buff-picker and a "Watching:" row that mean nothing for
either.

**After:** every aura resolves to one of twelve SHAPES (`widgetShape()`), and a single table
(`SHAPE_FIELDS`) lists exactly which optional rows/cards each shape gets, computed once per render.
Two accidental leaks are fixed as part of this, not carried forward: Damage parser and Travel guide
no longer show the buff-picker "Buffs shown" card or the "Watching:" row - nobody had decided to
show either on purpose, there was simply no branch that said otherwise. This also closes half of
CLAUDE.md's still-open "Standalone-tool auras need their own settings-panel layout" note.

**Structurally verified already** (source-level tests, not live play): a new `test/settings-panel-
shapes.test.js` checks every one of the 12 shapes against every one of 22 fields in both
directions (present where it should be, absent everywhere else) - 264 checks in one test, plus the
actual wiring (selectWidget computing the shape once and handing the same Set to renderBuffFilter,
both radio-change listeners recomputing it correctly). Every other affected test file
(ally-cast-alert, category-borders, enemy-debuffs, merged-tiles, profile-label, sound-only,
text-aura, text-justify) was rewritten to match, and the whole suite (42 files) passes. A temporary
console-message listener confirmed the app launches with zero NEW renderer errors from this change
(it did surface one genuinely pre-existing, unrelated bug - see below - present before this rework
and before this whole session, now removed from the code once confirmed).

What's left is confirming it actually LOOKS right in the running app, which no amount of source-
level testing can stand in for:

- [ ] **Open Self Buffs and an Ally Buffs aura's settings.** Should look completely unchanged from
      before - gem-slot picker, max-duration slider, Display & size, everything.
- [ ] **Open an ordinary Custom buff aura (icon or list mode).** Unchanged - picker, Watching: row,
      sort/merge/borders/opacity/position/Alerts all present.
- [ ] **Open a Custom debuff aura.** "Watching:" row gone, "Cast by you/an ally" row present
      instead, picker restricted to debuffs, everything else as an ordinary buff aura.
- [ ] **Open a plain Custom text aura.** Say/size/justify fields, "Show events for", the ally-alert
      toggle, Always-on toggle, opacity/position/Alerts all visible; no Display style radios, no
      Sort by, no Merge, no coloured borders, no Timer text topic.
- [ ] **Open "Someone else cast a mez" (or any allyDebuffAlert text aura).** Same as plain text,
      but the "Watching:" row must be completely absent (not just showing the wrong thing).
- [ ] **Open a text aura switched to "Your own text triggers"** (Resist flash, the Dispelled
      premade, or a hand-built one). Custom triggers card shown instead of the buff picker; no
      "Show events for" slider (nothing to filter - each trigger has its own duration now);
      Watching: row still present so you can switch back off triggers.
- [ ] **Open a Custom sound aura.** Only the buff picker and the Sounds section - no Display style,
      no icon/list settings, no sort/merge/borders/opacity/position/Alerts/Timer text.
- [ ] **Open a sound aura switched to "Your own text triggers."** Custom triggers card instead of
      the picker; still no opacity/position/Alerts (sound-only hides those regardless of source).
- [ ] **Open a plain Custom timer aura (icon or list, not text/sound).** No "Watching:" row (source
      fixed at creation); Custom triggers card; sort/merge/borders/opacity/position/Alerts all
      present like an ordinary buff aura.
- [ ] **Open a Damage parser aura.** **Behaviour change, look at this one specifically**: no
      "Buffs shown" card and no "Watching:" row any more - previously both showed but did nothing.
      Its own Damage meter settings, plus sort/merge/borders/opacity/position/Alerts, remain.
- [ ] **Open a Travel guide aura.** **Narrowed further 26 Aug**, when creation was unlocked: same
      as Damage parser (no picker, no Watching: row) but ALSO no Sort by, no Merge, no coloured
      borders (none of the three mean anything for a route leg - see CLAUDE.md's Standalone-tool
      section for why removing them was safe, not just tidy). Its own read-only destination
      display, List width/Row size sliders, and Timer text topic remain. See the dedicated Travel
      guide checklist above for the `/tell`/popup behavior itself.
- [ ] **Switch an aura's Watching: row between self/ally while its settings are open** (an ordinary
      custom buff aura). Ally-grouping options should appear/disappear immediately, correctly, with
      no stale state left over from the previous source - this is the exact bug the old two-
      function ordering bug could produce.
- [ ] **Switch Display style between List and Icons while an aura's settings are open.** Icon-only
      and list-only sub-sections should swap immediately and correctly, same as before this rework.

### A separate, pre-existing bug this surfaced - FIXED, confirmed by reading the code 25 Aug

While confirming the above launched clean, a one-off console listener caught three **uncaught
ReferenceErrors on every single app launch**, entirely unrelated to the settings-panel work and
confirmed (via `git diff` against the commit before this whole session started) to predate it:
`HOTKEY_LABELS is not defined` and `selectedId is not defined` (twice), all inside
`initDetectionSettingsPanel()`'s hotkey-hint and zone-change callbacks. Both names are real, but
declared inside a *different* function (`initWidgetsPanel()`) - a cross-function scope reference
that has probably never worked. Practical effect: the hint text next to the "Hide auras" button
that's supposed to say which key you actually got ("or press Scroll Lock") likely never populates
from this path, and two of the zone-change listeners throw instead of refreshing anything.

**No longer true.** Both the `currentZone`/`knownZones` block and the `HOTKEY_LABELS` hint-text
block now live inside `initWidgetsPanel()` itself, alongside the `selectedId` they depend on - the
in-code comments at both sites say so directly ("Moved here, into the function that actually uses
it"). Still worth a `[ ]` confirm below since nobody has watched the console on a clean launch
since it moved, but this is very likely already resolved rather than still open.

- [ ] **Open the main window and check the console for `ReferenceError`.** Should be silent now.
      If `HOTKEY_LABELS is not defined` or `selectedId is not defined` still appears, the fix above
      didn't fully take - flag it, don't assume.

## P0 detection rework, cast-time filter, and self-buff overwrite detection (25 Aug) — none tested live

Three related, independently-switchable Experimental toggles under **Log page → Diagnostics**, all
**off by default**. See `CLAUDE.md`'s "P0 — Detection engine" section for the full reasoning
behind each. None of the three has been run against a real play session — that's the biggest thing
left in this whole document.

- [ ] **"Use evidence-based detection" OFF (default/legacy).** Confirm nothing changed from before
      this session — same landings, same `IGNORED`s, same prompts as always. This is the safety net:
      if anything below looks wrong, turning this back off should restore exactly today's behaviour.
- [ ] **"Use evidence-based detection" ON, one real session.** Watch for landings that used to be
      silently `IGNORED` (bard songs "not currently memorized," or right after an ally's burst)
      turning into disambiguation prompts instead. Specifically worth watching: does this produce
      *more* prompts than feels reasonable, or does it correctly stay quiet for the ordinary case?
- [ ] **"Use cast-time-aware confirmation" ON.** Cast something with a long cast time and confirm
      the fallback confirm/cancel window feels proportionate rather than firing early/late. Watch
      the detection log for the scaled window it computed.
- [ ] **"Use self-buff overwrite detection" ON.** Cast a self-buff that should overwrite another
      already active by the game's own stacking rule (e.g. two stat buffs sharing an effect slot)
      and confirm the stale tile disappears immediately instead of running out its old timer. Also
      confirm an UNRELATED pair of self-buffs both stay up as normal — a false conflict here would
      be worse than a missed one.
- [ ] **All three ON together, one full session.** They're independent switches but interact by
      sharing the same landings; a full session with all three on is the realistic way you'd
      actually run this once trusted.
- [ ] **`node tools/replay-log.js` against a real log, toggles off.** Confirms the legacy baseline
      (129 distinct buffs / 211,546 landings / 840 ally landings / 27 prompts / 91 unknown texts)
      is unchanged — this could not be run in the session that wrote this checklist, since the log
      files live at a path this machine didn't have.

## Smaller items from the same session, not yet confirmed live

- [ ] **Bard-song caster attribution.** Sing something yourself, and separately have a groupmate
      sing something that lands on you - confirm the Bard Songs aura groups them correctly (You vs.
      the ally's name vs. Unknown when neither signal fired), and that ending one caster's song
      doesn't touch another caster's copy of the same song.
- [ ] **Charm Broke premade.** Charm something, let the charm break naturally, confirm the alert
      names the freed target and doesn't fire for an ordinary buff/debuff wearing off elsewhere.
- [ ] **currentlyMemorized scoped per profile.** Swap loadout profiles (the chip bar), then check
      the "Currently memorized" gem display resets to unknown for the new profile rather than
      carrying over the old loadout's gems.
- [ ] **Custom-timer and sound debug logs.** Turn on Diagnostics, fire a custom trigger and an
      alert sound, confirm both show up in the detection log with useful FIRED/ENDED/played lines.
- [ ] **Sidebar status dot.** Look at a widget restricted to a profile OTHER than the one active
      now - dot should read grey. Switch to a profile it IS active on - dot should turn green,
      live, without needing to reselect the widget.
- [ ] **Coloured-border width control.** Turn on note 37's category-border toggle on an icon-mode
      aura and confirm a width slider/control appears; confirm it stays hidden for list-mode auras
      and for the toggle switched off.
- [ ] **Text-aura justification.** Set a text aura to left/right/middle and watch it cycle through
      short and long messages (e.g. "DISPELLED" vs. a full resist line) - confirm the anchored edge
      stays fixed while the other edge moves, matching the picked side.
- [ ] **Zero-duration custom timer.** Build a trigger with 0s duration and just a land sound.
      Confirm it beeps exactly once (not twice) and shows no visible tile flash.
- [ ] **Custom triggers duration consolidation.** Open an existing Custom timer aura from before
      this session - confirm it still has a sensible duration (migrated from whichever per-trigger
      value it used to have) and that the one aura-level slider is what now controls every trigger
      on it.

## Premade defaults now match her own live setup (25 Aug) - needs a fresh-install check

Reported live: "look into my section of auras that i have created... override the premade settings
with the ones i have... screen position included." Self Buffs, Ally Buffs, Bard Songs, Resist
flash, Dispelled and Charm Broke's code-level defaults (`defaultSelfBuffsWidget`/
`defaultAllyBuffsWidget`/`defaultBardSongsWidget`/`TEXT_AURA_PRESETS` in `widgetStore.js`) were
rewritten field-by-field to match her own currently-saved widgets - position included, per her
explicit ask. Two things deliberately NOT copied: `alwaysOn` on her live Resist flash widget (it
was `true`, which `overlay.js`'s `visibleBuffs()` reads as "show one permanent static tile and
ignore every real trigger" - copying it would have broken the very flash it's attached to, so this
stayed `false`; worth asking her to check whether that `true` was a live bug on her end), and any
`landSoundId`/`expireSoundId`/`warningSoundId` (those name files in HER `customSounds` folder
specifically and would point at nothing on a fresh install).

Verified only against a plain Node script instantiating `WidgetStore` directly with a mock store
(both the fresh-install path and the legacy pre-widget-system upgrade path were checked to make
sure the migration code in `_loadOrMigrate()` doesn't silently override the new defaults back to
the old hardcoded ones - it originally did, and was fixed as part of this same change). The whole
suite passes (three tests that hardcoded the OLD factory values - resist-flash durationSec/message,
the dispel message, and the two-premades trigger-duration test - were updated to expect the new
ones). **Not yet confirmed by actually deleting `widgets.json` and launching a truly fresh app**,
which is the only way to see the new defaults land for real rather than by reading code:

- [ ] **Rename or move `widgets.json` aside (do not delete anyone's real data), launch the app
      fresh, and confirm Self Buffs seeds in at the new position/size/icon layout** rather than the
      original small list-mode box.
- [ ] **From that same fresh state, add a new Ally Buffs, Bard Songs, Resist flash, Dispelled and
      Charm Broke aura from "+ Add Aura"** and confirm each lands at the position/size copied above
      instead of stacking at the old default spot.
- [ ] **Confirm Resist flash still actually flashes** (cast something that gets resisted) rather
      than showing one permanent static tile - this is the specific thing the `alwaysOn` exclusion
      above is protecting against.
- [ ] **Restore the real `widgets.json`** afterward so her actual live auras come back untouched.

## Bundled sounds folder inside the install (25 Aug) - never confirmed against a real packaged build

Requested directly: "a standalone sounds folder INSIDE the install itself that people would add
to, with some pre added sounds." Built as `soundService.js`'s `bundledSoundsDir()` - a real `sounds/`
folder shipped next to the .exe via `package.json`'s new `extraFiles` entry, seeded with five
synthesized starter sounds (`tools/generate-bundled-sounds.js`), and wired in as the "Choose
sound..." picker's default folder ahead of `C:\Windows\Media`. A separate, bigger version of this
request - moving ALL saved data (buffs, widgets, settings, logs) into the install folder too - was
proposed and then explicitly walked back once the owner realized Windows' uninstaller deletes the
whole install directory; `userData` stays where it's always been for anything actually saved. See
CLAUDE.md's `soundService.js` entry for the full reasoning.

Verified so far: three tests in `test/bundled-sounds.test.js` covering the dev-vs-packaged path
resolution and the picker-defaults-to-it behaviour, against a stubbed Electron (no real app ever
launched for this - see the test file's own header for why the packaged-path case matters most: a
wrong answer there is silent, since `defaultPickerDir()` just falls through to the next candidate
rather than throwing). `npm run dist` was NOT run as part of this - the `extraFiles` config is
standard electron-builder and copies verbatim from a working example, but nothing has actually
built the installer and confirmed the `sounds/` folder lands next to the real .exe with real
starter sounds in it:

- [ ] **Run `npm run dist`, install the result, and check the install folder for a `sounds/`
      subfolder** sitting next to `EQLS Auras.exe`, containing the five starter `.wav` files
      (Chime, Soft Ping, Alert, Bell, Klaxon).
- [ ] **From the installed app, open any aura's Sounds section and click "Choose sound..." for the
      first time** (or after clearing `lastSoundPickerDir.json` from userData) - the dialog should
      open directly in that `sounds/` folder, showing the five starters.
- [ ] **Drop a new file into that install-folder `sounds/` folder via Explorer**, then open
      "Choose sound..." again - the new file should be right there alongside the starters, with no
      app restart needed.
- [ ] **Pick one of the starter sounds and confirm it actually plays** as a land/expire/warning
      alert - it still gets copied into `userData/customSounds` under a fresh id exactly like any
      other picked sound (this was a deliberate choice, not an oversight - see CLAUDE.md), so this
      also confirms that copy step still works when the source is the bundled folder instead of an
      arbitrary user file.
- [ ] **Uninstall, then reinstall, and confirm the starter sounds are back** (this is the actual
      point of shipping them in the install folder rather than userData - they should always come
      back with the app, unlike anything the user picked or tuned).
- [ ] **Setup page → "Open sounds folder"** (new "Sounds" card, requested directly as "an easy jump
      point"). Should open the exact same folder as the per-aura button above - both call the same
      `sounds:openFolder` IPC handler. Smoke-launched clean with no console errors; not yet clicked
      in the real app.

## AA-activated abilities now get the mote-tier duration bonus (25 Aug) - real bug, needs a live recheck

Reported live: "Amplification II" (activated from the AA window, not cast/sung) landed at 50s
against its own tooltip's `"0:30 (1:00)"`. Root cause and fix are in CLAUDE.md gotcha #30 - the
short version is that `matchActivate` lines never fed their rank numeral into `_rankForEntry()`,
so any AA-activated ranked ability got the AA/Exaltation bonus but silently NONE of the mote-tier
one. Verified against the real roster and the real `handleLine()` pipeline (50 → 59, matching the
formula exactly - `test/duration-scaling.test.js`), mutation-tested (reverting the one new line
turns the fix's own test back into a failure, `50 !== 59`), and `npm run test`/`smoke-launch` both
clean. **Not yet re-confirmed against the real game**, and there's one specific open question:

- [ ] **Re-cast "Amplification II" (or any other AA-activated ranked ability) and watch its
      countdown against the in-game tooltip.** Should now read 59s where it used to read 50s.
- [ ] **Check whether the tooltip's own "(1:00)" is exact or itself rounded.** The fix's predicted
      59s is 0.6s short of a clean 60 by the formula's own math (30 × 1.2 × 1.65 = 59.4) - if the
      real wear-off timing is closer to 59 than 60, the tooltip is just rounding for display and
      nothing else needs chasing; if it's genuinely, precisely 60, there's a smaller residual
      question left (rounding order, or the mote rate itself) worth its own measurement.
- [ ] **Check a second AA-activated ranked ability if one exists**, to confirm this isn't specific
      to Amplification - anything reached via "You activate X." with a Roman-numeral rank in its
      own name.

## Small QOL batch (25 Aug) - none clicked in the real app yet

Requested as a batch from the QOL backlog; all pass their own tests and the app smoke-
launches clean, but none has actually been clicked through in a live session.

- [ ] **Tell-ping cooldown.** Setup page → Trade requests → turn on "Play a sound when you get a
      tell" → a "Minimum gap" slider should appear. Have someone (or yourself on an alt) send
      several tells in quick succession - only the first should ping until the gap elapses, then
      the next one after the gap pings again. Set it to 0 and confirm every tell pings again,
      however close together.
- [ ] **Alerts & Sounds merge.** Open any aura's settings and confirm there's one "Alerts & Sounds"
      topic, not two separate ones - every field that used to be split across both (expiring-soon
      flash, landing glow, land/expire/warning sounds, volume, open-sounds-folder) should all be
      inside it, nothing missing or duplicated.
- [ ] **Copy bug report.** About page → "Copy bug report" → paste the clipboard somewhere. Should
      show the app version and (if Diagnostics has ever been turned on under the Log page) the
      tail of today's detection log. With Diagnostics never turned on, confirm it still copies
      cleanly with the version info and an honest note that there's no log, rather than an error.
- [ ] **"Skill ready reminder" example premade.** Add Aura → Timers group → should appear right
      after Cooldown timer. Pick a skill with a real recast time, create it, then actually cast
      that skill in game - the tile should be showing BEFORE the cast (skill is ready) and
      disappear the moment you cast it, which is the opposite of every other timer in this app.
      Confirm the underlying aura's Custom triggers card shows "Reverse detection" ticked, same as
      if you'd built it by hand.
- [ ] **"Action Bars" placeholder tab.** New nav button in the sidebar, between Log and About -
      confirm it opens a page with just a "Coming soon" card, no errors, nothing else on it yet.

## Bard-song self-attribution fix (25 Aug) - needs a real ranked recast to confirm

Reported live: singing "Selo's Accelerating Chorus VI" got attributed to "Imperius" - a MOB seen
singing an identically-named ability ~20 minutes earlier, not a real groupmate. Root-caused to the
raw log and fixed in `buffEngine.js`'s `_attributeBardSongCaster()` - see CLAUDE.md gotcha #31.
Verified against the real engine with a fictional ranked song (mutation-tested: reverting the fix
reproduces `'Imperius' !== 'You'` exactly), but not yet re-confirmed against the real game:

- [ ] **Sing "Selo's Accelerating Chorus" (or any other ranked bard song) yourself again** and
      confirm the Bard Songs aura attributes it to "You", not a stale name from earlier in the
      session - especially if a mob with an identically-shaped ability name has cast anything
      recently.
- [ ] **Sing an UNRANKED bard song too**, to confirm that case (which already worked before this
      fix) is still unaffected.
