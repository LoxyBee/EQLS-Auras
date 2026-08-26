# Where every note stands

All 40 of your notes, in order, with what is built and what is not. Written 21 Aug 2026, brought
up to date 24 Aug, the prose sections below the table corrected 25 Aug, and note 26 moved to DONE
later the same day once `src/main/spellStacking.js` landed - see that row and "What's actually
still open" below for what changed.

## The short version

**39 done. 0 partial. 1 blocked. 1 skipped.**

- **#28** needs the bug to happen once more. The detection log now records what opened the burst
  and how long ago, which is the fact that was missing, so one occurrence should be enough.
- **#2** you told me to skip — you have solved first-aggro elsewhere and will bring it yourself.

Everything marked DONE is built and has a test suite behind it. It still wants your eyes in game;
that list is `TESTING.md`.

**Status words used here**

| | |
| --- | --- |
| **DONE** | Built, tested, and there is a test suite that fails if someone breaks it. |
| **PART** | Some of it works. The missing half is named. |
| **NOT** | Not built. Nothing is stopping it. |
| **BLOCKED** | Not built, and it cannot be until something specific arrives — named each time. |
| **SKIPPED** | You have told me not to build it. |

**A note on what DONE means here, corrected 23 August.** Anything sitting in `TESTING.md` waiting
for you to try it in game is DONE, not partial. Testing is yours; building is mine, and I was
wrongly counting "she has not confirmed it yet" as unfinished work.

Anything marked DONE still needs your eyes in game. That list is `TESTING.md`, not this one.

---

## 1–10

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 1 | Promised Renewal is 15s and never scales with AA | **DONE** | 15s, scaling off. Reuse corrected to your 18s — the game data says 21.5 and is wrong. |
| 2 | First-aggro premade, placeholder in the meantime | **SKIPPED** | Your call, 23 Aug — you have solved this elsewhere and will bring it yourself. The placeholder stays. |
| 3 | Only remember 14 memorised spells | **DONE** | Capped at 14, oldest dropped, on load as well as on insert. |
| 4 | One toggle to hide every aura, ideally a hotkey | **DONE** | **Scroll Lock**, not Pause — Electron refuses Pause outright and the hotkey had never worked. |
| 5 | Make "Reset remembered choices" look dangerous | **DONE** | Red. |
| 6 | Aura name in the move box, click it to open its settings | **DONE** | |
| 7 | Make the app's own text bigger | **DONE** | |
| 8 | Merge same-duration buffs into one tile with a count | **DONE** | |
| 9 | Triggers that need any-of / all-of several lines | **DONE** | Both halves built. "All-of" follows your 23 August answer: no shared window, each part holds for its own time, a zone part holds until you leave. |
| 10 | A trigger that runs its duration then rolls into a cooldown | **DONE** | "Then cooldown" on the timer form. Tile dims and says which phase. Not the sub-panel version. |

## 11–20

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 11 | Track AoE mez per mob, duration by rank, case-insensitive | **DONE** | Per-mob tracking was already built. Rank scaling now lands too: duration is base x mote tier x AA, with the tier read off your own cast. Two of the spreadsheet's rates were measured from your logs and confirmed. |
| 12 | One mez tile: soonest timer, count, mob name | **SCRAPPED (24 Aug), then redefined (24 Aug)** | The x2/x3 counting was reported live as wrong: the log can't tell a second same-named mob apart from a recast refreshing the one you already have, so chain-mezzing a single target (the normal way to hold CC) inflated the count on what was really only one mob. First fix: one tile per key, a new landing refreshes its duration exactly like a groupmate buff always did - but an AoE mez landing on several *different* mobs still drew one tile each, which you also didn't want. Your final answer: "ONE tile total for the whole aura, always... like a text aura." `trackOnEnemies` auras now get the text-aura one-tile rule in icon/list mode too, in `overlay.js`. The engine still tracks every distinct target underneath for death/wear-off detection - only what's drawn is collapsed. |
| 13 | Drag the sidebar wider | **DONE** | |
| 14 | Buff-timer premade: pick a spell, pick self or ally | **DONE** | Now also offers "something you cast it at". |
| 15 | Cooldown premade: pick a skill, get its recast countdown | **DONE** | Add Aura -> Cooldown timer. Recast pre-filled and editable. Works with the ranked spells you cast. |
| 16 | Debuff-on-an-enemy premade, resist alert, ally toggle | **DONE** | All three. The ally part is built as you specified it on 21 Aug — a warning, not a timer. See below. |
| 17 | Mesmerize worked example: rank, per-mob timer, RESIST flash | **DONE** | Per-mob timer and RESIST flash were built. The rank now sets your own duration as well. Charm and mez carry the spreadsheet's +10%/tier unmeasured — every observation in your logs was cut short by the mob dying. |
| 18 | Count same-named mobs from the land and resist lines | **SCRAPPED (24 Aug)** | Superseded by note 12's scrap - see that row. The counting mechanism this note asked for is what turned out to double-count a refreshed single target. |
| 19 | Damage parser premade, placeholder in the meantime | **DONE** | Built. The placeholder is gone because the real one replaces it. |
| 20 | Travel guide premade that knows your travel spells | **DONE** | Unblocked by research and built. Zone graph plus 61 travel spells, sourced EQL-specific and cross-checked against three others. |

## 21–30

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 21 | An aura showing which loadout profile is active | **DONE** | In the Loadouts modal, and switches itself on once when you make a second loadout. |
| 22 | "Unlock all" only on the main Overlay Auras page | **DONE** | |
| 23 | Text-only display style, own size, own dwell time | **DONE** | Built as a *type* chosen when you create the aura, not a fourth radio — you agreed to that change. The dwell time is a setting, default 6s. |
| 24 | Detection priority rework, plus a song-pulse check | **DONE** | All three built, including the 6s pulse check — you were right and I measured 314,324 gaps at exactly 6s to confirm it. The pulse check is wired and currently has nothing to decide, because no landing text on the rebuilt roster is split song/non-song; a test fires if that changes. |
| 25 | A disabled "Global recovery time" placeholder | **DONE** | Still a placeholder. The `castOf` trigger note 15 introduced is the piece it needs, when you want it built. |
| 26 | Drop a stale timer when a buff gets overwritten | **DONE** | Overwrites, refused casts, and buffs on others were already done. The self-buff half - the genuinely open question below for weeks - is now also done, 25 Aug: `src/main/spellStacking.js` reimplements the core of EQEmu's public stacking-conflict rule against the game's own spell data, verified against 7 confirmed pairs from your logs. Ships as an opt-in "Use self-buff overwrite detection" Experimental toggle under Diagnostics, off by default pending a real in-game session - see `docs/HANDOFF.md`. |
| 27 | Promote "Buffs shown" to its own section, add gem slots | **DONE** | Own card, gem slots, "+" slot, buffs and debuffs kept apart. Your existing auras were not touched. |
| 28 | Bug: Ally Buffs showed a buff you never cast | **BLOCKED** | Still needs it to happen once more — but the next time will be diagnosable. The log now records which of your actions opened the burst and how long ago, which is the missing fact that made a report of this indistinguishable from a correct landing. |
| 29 | Put EverQuest back in front after answering a popup | **DONE** | |
| 30 | Read share codes out of chat | **DONE** | Both blockers answered by measurement — you were right about + and =, and the line limit is at least 403 characters, which ordinary codes fit inside. It offers, never imports. |

## 31–39

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 31 | Unlocking an aura shows it even when its profile is off | **DONE** | |
| 32 | Volume slider forgets its saved value; re-range it | **DONE** | Load bug fixed. You decided to keep it 0–100, so nothing else is outstanding. |
| 33 | Can't click the name box in New loadout profile | **DONE** | Fix is in. It is in TESTING.md for you to confirm — which is a test, not outstanding work. |
| 34 | Buff and Debuff premade templates with sensible defaults | **DONE** | Both exist as their own choices in Add Aura. "Custom debuff aura" builds one set to watch the things you cast at, which is the separate template you asked for. This row was stale, not the work. |
| 35 | Archive the old roster, rebuild from the EQL spreadsheet | **DONE** | 1,052 spells, every one categorised. Old 11,337-entry roster archived, not deleted. |
| 36 | Sound ping on an incoming trade request | **DONE** | |
| 37 | Colour tile borders by spell type, with a toggle | **DONE** | On by default. |
| 38 | Apply an aura only in a certain zone | **DONE** | "Only in:" on each aura. Zones kept separate as you asked. Says so when the rule is hiding an aura. |
| 39 | Write down the multi-trigger idea, don't build it | **DONE** | Recorded, correctly unbuilt. Same feature as note 9. |
| 40 | Custom debuff needs a watching toggle: your casts vs. an ally's casts | **DONE** | Built same day, smaller than first scoped. You cut the P0b dependency yourself: "the name doesn't matter for now, just have it tracked that a debuff happened from someone, it doesn't need a name." So this never gained caster identity — it's a new `debuffCastBy` field (`self`/`ally`) on a Custom debuff aura. `self` is the untouched original tier (needs `recentSelfCast` or your own burst window). `ally` is a new tier with no such gate at all: the moment the debuff's own third-person landing text appears on an enemy-shaped name, it lands, regardless of who cast it. Same duration data, same wear-off detection — only the gate differs. (The per-instance counting mentioned here at the time was scrapped 24 Aug - see note 12's row.) A "Watching:" radio pair on the aura's settings panel, shown only for Custom debuff auras. 8 new tests, mutation-checked (killed the tier, confirmed 4 tests catch it, restored). P0b (naming the caster) is still open and unrelated now — nothing here blocks it or is blocked by it. |

---

## The things worth reading properly

**Notes 11, 16 and 17 were never actually blocked, and you were right about that.**
`FEATURES.md` claimed there was not a single mez line in your logs. That was written from one log
instead of all seven. Across all of them: 251 mez landings, 129 charms, 970 resists, 1,440
wear-offs. The real blocker was something else entirely — a landing on someone else was only
accepted if the name was one single word, and a mob is "a greater kobold". That is now fixed, but
only for spells an aura has explicitly asked to watch on enemies. It has to be opt-in: relaxing it
for everything would have let in around 160,000 landings, and 106,876 of those are two bard songs
pulsing on every mob in earshot.

**Note 18's starting assumption is wrong, and it matters.** It says a mez broken early by damage
may print nothing. It prints `<Name> has been awakened by <Breaker>.` — 142 times in your logs,
naming who broke it. Roughly four breaks in five emit it. But before building on that: for a mez
*you* cast it is redundant, because the wear-off line arrives in the same second and always first
(98 times out of 98).

**Note 18's counting will read `x1` almost always, with your current book.** `Mesmerize` is
single-target: 214 of your 239 casts produced exactly one landing and not one produced a genuine
multi-landing. Every AoE case in your logs is somebody else's `Mesmerization VI` or `VII`. The
counting idea is sound — two `a sonic bat` landings from one cast really is two bats, and two
separate death lines confirm it — but the tile will not light up until you cast a ranked mez.

**Note 16's last piece is built, and your answer was better than either option I offered.** I had
put two to you — an ally's debuff without a countdown, or not at all. You picked a third: make it a
*warning* rather than a tracker. That dissolves the problem instead of working around it, because a
warning has no duration to be wrong about.

It is a toggle on text-only auras, where you asked for it, plus a premade. Two things in it are my
decisions rather than yours, and both are worth overruling if you disagree:

- **It fires as they start casting, not when the mez lands.** About two seconds earlier — 96% of
  landings in your logs arrive exactly two seconds after the cast line. A warning that arrives
  after the mez is already on is too late to stop you swinging. The cost is that a cast which gets
  resisted still warns you, roughly one time in ten.
- **It names whoever cast it rather than saying "a party member".** Half the mez and charm casts by
  other people in your logs are mobs — ``A Teir`Dal ranger`` 13 times, "A negotiator" 6 — and the
  game's line does not distinguish them. So "a party member has cast" would have been wrong about
  half the time it fired. Naming them is right every time, and a mob casting mez is worth knowing
  about too. I could restrict it to actual group members, but the app only learns who is in your
  group from join and leave lines it sees live, so it would go silently dead every time you start
  the app mid-session. Say the word if you want it anyway.

---

## One thing I still need from you

Note 21's auto-enable question (below this section originally) is answered and built - it ticks
itself on the first time you make a second loadout, and stays off again if you turn it back off.
See the note 21 row in the table above; nothing left to decide there.

**Note 26 — resolved 25 Aug, not by guessing.** I told you there are no buff "types". That was
wrong of me: your spreadsheet's category column carries **HP Buff (Line 1)** (17 spells) and **HP
Buff (Line 2)** (3), it is in the app's roster too, and 28 of the 33 blocked pairs in your logs
share a category. What I should have said is narrower: the *engine* works in numbered effect slots
rather than named types, so the app cannot compute conflicts from first principles from that column
alone — but the game's own `spells_us.txt` carries exactly the effect-slot data EQEmu's public
`Mob::CheckStackConflict` rule needs, and that's what `src/main/spellStacking.js` now reads.

For buffs on other people, the game just says so: **"Your Shield of Thistles spell on Avenrae has
been overwritten."** 109 of those in your logs, always the same shape, naming both spell and
target — done for a long time.

**The self-buff half — the real open question for weeks — is done now too.** There is no such line
for a buff on *yourself*, not even a "worn off," and some spells share their fade text (Nimble and
Agility both say "Your agility fades"; Symbol of Pinzarn and Symbol of Naltron both say "The mystic
symbol fades"), so a fade line alone can't say which of two active buffs it belongs to.
`spellStacking.js` sidesteps needing to guess: it computes, from the game's own spell data, whether
a newly-landed self-buff would silently overwrite one already active, checked against 7 confirmed
real pairs from your logs (five "did not take hold... (Blocked by X)" lines, plus the two
shared-fade-text pairs above). When it says overwritten, the stale timer is removed immediately
instead of waiting on an ambiguous fade line. Deliberately narrower than the full EQEmu rule — no
illusions, no Complete Heal, no DoT-vs-DoT — so it only ever removes a timer both directions of the
check agree is stale, never invents a conflict.

Ships as **"Use self-buff overwrite detection"** under Log page → Diagnostics, **off by default**
next to two related detection toggles from the same session (see the P0 section below) — turned on
deliberately, not silently, since none of the three has been run against a real play session yet.

## The detection log exists now, and you can find it

You said it did not exist. It did — as a loose file called `detection-debug.log` in
`%APPDATA%/EQ Buff Tracker`, sitting among `Cache`, `Code Cache`, `DawnGraphiteCache`, `GPUCache`,
`Local Storage` and `Network`. That is not a reasonable place to expect anyone to look, and note 28
sat blocked for days on evidence that was being written the whole time. Your report was right even
though the file was there.

It now lives in a **detection-logs** folder, one file per day named by the date, old ones cleaned
up after a fortnight. **Log page → Diagnostics → "Open the detection log folder"**, with the full
path printed beside the button so you can reach it when the app is not running. Your old file was
moved into the folder rather than thrown away.

**Note 3, recorded:** cooldowns and negative/reverse detection are separate mechanics. That
comparison was mine and it was wrong; nothing is built on it.

## Note 9 — done, redesigned as "combine mode" rather than the original ask

This whole section used to say "all of these lines" was fully designed but not built, with three
open questions blocking it. That's stale - it shipped 23-25 Aug as `triggerCombineMode`
(`independent`/`and`/`or`) on the aura itself rather than a per-timer "extra conditions" list, and
the three questions below got answered as part of building it, not before:

- Over what window must both lines arrive? **No shared window at all** - your own correction to my
  original framing. Each part of the condition is satisfied for its own duration after it fires,
  and a part with no duration (a zone check) stays satisfied until it stops being true. The timer
  runs while every part is satisfied at once - a state intersection, not two events and a
  stopwatch.
- Does anything show while waiting for the second line? Nothing, by design - same "no guessing"
  posture as detection elsewhere in the app.
- If only half arrives, does it expire? It just never activates; nothing times out or needs
  clearing.

"Any of these lines" (`or`) shipped alongside it - same cycle-through-modes control on the aura.
See `src/main/customTimerEngine.js`'s `_resolveActivations` and the combine-mode button in the
widget settings panel. `test/all-of-triggers.test.js` (the old per-timer design) was replaced by
`test/trigger-combine-mode.test.js`, which is the current, accurate coverage.

## The P0 detection-engine rework — 25 Aug, outside the numbered notes

This isn't one of your 40 notes, but it was `CLAUDE.md`'s own top-priority backlog item, so it
belongs here too: the architectural fix for "every check that doesn't pass should continue, not
end the check" - your own diagnosis of why bard songs, Quick Buff, and disambiguation candidates
kept coming up wrong from three different angles.

Built as **"Use evidence-based detection"**, a third Experimental toggle alongside note 26's
stacking toggle, off by default under Log page → Diagnostics. Before this, the unique-landing-text
tier's "not currently memorized" / "an ally's burst just fired" checks could silently `IGNORE` a
real landing outright - a soft signal treated as a hard veto, with no later tier ever getting a
chance to resolve it correctly. With the toggle on, those two signals still count as evidence
against the match, but the outcome becomes a queued disambiguation prompt instead of a silent drop.
A genuine "never scribed this at all" stays a hard veto either way - that one is real negative
evidence, not just an absence of positive evidence.

A fourth, related toggle - **"Use cast-time-aware confirmation"** - answers the P0c idea `CLAUDE.md`
had explicitly parked ("not now"): it scales the fallback confirm/cancel window by the spell's own
cast time instead of one flat window for every spell, using the mote-spreadsheet's per-tier
cast-time rates plus a confirmed Spell Casting Deftness AA multiplier.

**None of these three toggles (evidence model, cast-time filter, stacking model) has been run
against a real log session yet.** Each has its own test file against the real roster, and the
legacy behaviour (all off) still matches the old baseline, but "does this actually fix the three
live-reported symptoms without introducing new ones" is a question only a real play session can
answer. See `docs/HANDOFF.md` for what to do first.

## What's actually still open

1. **Turning the three new detection toggles on and testing them live.** See the P0 section just
   above and `docs/HANDOFF.md`. This is now the real "what's left" item that note 26's old entry
   used to be.
2. **Note 2** — needs log samples that do not exist yet, and you said you're bringing this one
   yourself. Not blocking anything else.
3. **Two file deletions from this session worth a second look before committing**:
   `needs-duration-review.txt` and `new spell roster to be added.xlsx` (the roster's documented
   authoritative source) are both gone from the working tree. See `docs/HANDOFF.md`'s housekeeping
   section.
