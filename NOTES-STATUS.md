# Where every note stands

All 39 of your notes, in order, with what is built and what is not. Written 21 Aug 2026.

**Status words used here**

| | |
| --- | --- |
| **DONE** | Built, tested, and there is a test suite that fails if someone breaks it. |
| **PART** | Some of it works. The missing half is named. |
| **NOT** | Not built. Nothing is stopping it. |
| **BLOCKED** | Not built, and it cannot be until something specific arrives — named each time. |

Anything marked DONE still needs your eyes in game. That list is `TESTING.md`, not this one.

---

## 1–10

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 1 | Promised Renewal is 15s and never scales with AA | **DONE** | 15s, scaling off. Reuse corrected to your 18s — the game data says 21.5 and is wrong. |
| 2 | First-aggro premade, placeholder in the meantime | **PART** | Placeholder is in the Add Aura list. The feature needs a log sample of a real pull showing both damage directions. |
| 3 | Only remember 14 memorised spells | **DONE** | Capped at 14, oldest dropped, on load as well as on insert. |
| 4 | One toggle to hide every aura, ideally a hotkey | **DONE** | Pause key. Unlocking an aura still shows it, which is what you wanted. |
| 5 | Make "Reset remembered choices" look dangerous | **DONE** | Red. |
| 6 | Aura name in the move box, click it to open its settings | **DONE** | |
| 7 | Make the app's own text bigger | **DONE** | |
| 8 | Merge same-duration buffs into one tile with a count | **DONE** | |
| 9 | Triggers that need any-of / all-of several lines | **NOT** | A trigger is still one line of text. See the note under 10. |
| 10 | A trigger that runs its duration then rolls into a cooldown | **NOT** | Cheaper than it was: note 15 built both halves separately, so this is joining them rather than inventing them. |

## 11–20

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 11 | Track AoE mez per mob, duration by rank, case-insensitive | **PART** | Per-mob tracking is built and working — see the paragraph below. Missing: the duration still comes from the roster, not from which rank you cast. |
| 12 | One mez tile: soonest timer, count, mob name | **PART** | Falls out of note 8's merging, so same-named mobs already collapse into one counted tile. There is no mez-specific tile and no yellow-to-red-at-8s rule. |
| 13 | Drag the sidebar wider | **DONE** | |
| 14 | Buff-timer premade: pick a spell, pick self or ally | **DONE** | Now also offers "something you cast it at". |
| 15 | Cooldown premade: pick a skill, get its recast countdown | **DONE** | Add Aura -> Cooldown timer. Recast pre-filled and editable. Works with the ranked spells you cast. |
| 16 | Debuff-on-an-enemy premade, resist alert, ally toggle | **DONE** | All three. The ally part is built as you specified it on 21 Aug — a warning, not a timer. See below. |
| 17 | Mesmerize worked example: rank, per-mob timer, RESIST flash | **PART** | Per-mob timer built. RESIST flash built. Missing: using the rank to set *your own* mez duration — though the app now reads the rank off other people's casts and shows it. |
| 18 | Count same-named mobs from the land and resist lines | **NOT** | Two things you should know before this gets built — below. |
| 19 | Damage parser premade, placeholder in the meantime | **PART** | Placeholder only. |
| 20 | Travel guide premade, placeholder in the meantime | **PART** | Placeholder only. The feature needs zone-connection data that does not exist anywhere yet. |

## 21–30

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 21 | An aura showing which loadout profile is active | **PART** | A global toggle on the Overlay Auras page, as you asked — not in Add Aura. Missing only the auto-enable. |
| 22 | "Unlock all" only on the main Overlay Auras page | **DONE** | |
| 23 | Text-only display style, own size, own dwell time | **DONE** | Built as a *type* chosen when you create the aura, not a fourth radio — you agreed to that change. The dwell time is a setting, default 6s. |
| 24 | Detection priority rework, plus a song-pulse check | **PART** | Spellbook now outranks the gem list. Rival-caster tracking built. Missing: the post-cast song-pulse auto-resolve, which needs a log sample proving the 6s repeat. |
| 25 | A disabled "Global recovery time" placeholder | **DONE** | Still a placeholder. The `castOf` trigger note 15 introduced is the piece it needs, when you want it built. |
| 26 | Drop a stale timer when a buff gets overwritten | **PART** | Done for buffs on other people — the game announces it. Not done for buffs on yourself; there is no line for it. |
| 27 | Promote "Buffs shown" to its own section, add gem slots | **PART** | Now a top-level card between Display & size and Configuration. Gem slots not built — waiting on your go-ahead. |
| 28 | Bug: Ally Buffs showed a buff you never cast | **BLOCKED** | Needs `detection-debug.log` from 19 Aug around 12:15. The debug log now names the rival caster, so if it happens again the evidence will be there. |
| 29 | Put EverQuest back in front after answering a popup | **DONE** | |
| 30 | Read share codes out of chat | **BLOCKED** | Needs the server's per-line character limit confirmed, and whether + and = survive a chat line. |

## 31–39

| # | What you asked for | | Where it stands |
| --- | --- | --- | --- |
| 31 | Unlocking an aura shows it even when its profile is off | **DONE** | |
| 32 | Volume slider forgets its saved value; re-range it | **DONE** | Load bug fixed. You decided to keep it 0–100, so nothing else is outstanding. |
| 33 | Can't click the name box in New loadout profile | **PART** | A fix is in — the modal now opts out of the window-drag region, which would cause exactly that. **Never reproduced**, so it needs you to confirm. |
| 34 | Buff and Debuff premade templates with sensible defaults | **PART** | The buff half is note 14's premade; the debuff half is note 16's. There is no separate "Debuff template" beyond that. |
| 35 | Archive the old roster, rebuild from the EQL spreadsheet | **DONE** | 1,052 spells, every one categorised. Old 11,337-entry roster archived, not deleted. |
| 36 | Sound ping on an incoming trade request | **DONE** | |
| 37 | Colour tile borders by spell type, with a toggle | **DONE** | On by default. |
| 38 | Apply an aura only in a certain zone | **NOT** | **Confirmed not blocked** — the zone line is in your logs across 58 zones. Watch out for instances: `Befallen` and `Befallen 1 (Awakened)` are different strings. |
| 39 | Write down the multi-trigger idea, don't build it | **DONE** | Recorded, correctly unbuilt. Same feature as note 9. |

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

## Three things I need from you

**Note 27 — the gem slots.** The section move is done. The gem-slot half changes how an aura
stores which spells it watches, and that is the one change in this whole backlog that could empty
auras you have already set up. I want your go-ahead specifically for that, not a general yes to
note 27. When you give it, I will version-gate the change so old auras convert rather than break.

**Note 21 — should the label switch itself on?** Now that it is a setting rather than an aura, the
auto-enable you asked for is much less annoying than auto-creating would have been: it would tick
the box once, the first time you make a second loadout. Say the word. Also: show "Default" while
you are on the default loadout, or stay blank? Blank means the label vanishing is itself the
signal, which reads like a bug.

**Note 26 — mostly answered, and the answer was simpler than the question.** The research came
back and it turns out there are no buff "types" in the game at all. "HP type 1" is what players
call the Courage/Center/Daring/Bravery line — the engine works in twelve numbered effect slots,
and two spells clash only when they put the same effect in the same numbered slot. The app has no
slot data and could not work it out.

None of which matters, because the game just says so: **"Your Shield of Thistles spell on Avenrae
has been overwritten."** 109 of those in your logs, always the same shape, naming both spell and
target. So it is done for buffs on other people.

**What is left of it, and it is a real question.** There is no such line for a buff on *yourself* —
none at all, not even a "worn off". The only signal is each spell's own fade message, which the app
already reads. The problem is that some spells share one: Nimble and Agility both say "Your agility
fades", and Symbol of Pinzarn and Symbol of Naltron both say "The mystic symbol fades". When one of
those overwrites the other, the app sees one fade message and cannot tell which of the two ended. I
have left it alone rather than guess. If self-buff overwrites matter to you, say so and I will work
out how far a best guess can be trusted.

## What I would do next, in order

1. **Note 27, the "Buffs shown" section.** Largest unbuilt piece. Needs the two answers above.
2. **Note 26, overwrite detection.** The only open item that makes the app show something wrong.
   Costs you one cast to unblock.
3. **Notes 9 and 10 together.** Widen the trigger model once. Note 10 is cheaper now that the
   cooldown half exists. Notes 38 and 39 both sit behind it.
4. **Note 12, the mez tile.** Now that mez tracking works, the counted tile is worth revisiting.
5. **Note 2, 19, 20** — all three need log samples or data that does not exist yet.
