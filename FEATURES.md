# Feature list

Everything wanted but not built. Bugs and architectural work live in
`CLAUDE.md`'s backlog instead - this file is *new capability* only.

**Status key**
- `[ ]` not started
- `[~]` partly built (what's done is noted inline)
- `[x]` built - move to `TESTING.md` for live confirmation, then delete here

Order within each tier is rough priority, not a commitment. Anything marked
**needs design** should get a conversation before code.

---

## Quick wins

Cheap, low risk, no dependencies. Worth doing as one batch.

- [x] Buff library: "Add a new buff" merged into the Custom buffs card as the
      leftmost button, next to "View custom buffs" - the two were separate
      cards saying much the same thing.
- [x] Active profile chip now solid brass when active.
- [x] Remember the main window's size and position between launches.
- [x] "Unlock to move" / "Reset position" moved into Display & size.
- [x] Move "Open sounds folder" to the bottom of the Sounds section.
- [x] Timer text colour and label text colour - wired end to end.
- [x] Margin width between icons - wired end to end.

---

## Medium

Self-contained, a day or less each.

- [ ] **Default alert sound on an incoming tell**, with a cooldown so a burst
      of tells does not machine-gun the sound. Cooldown length probably wants
      to be a setting, defaulting to a few seconds.
- [ ] **Death wipes buffs on whoever died.** EQ drops every buff on death, so
      the app should too rather than counting down timers for buffs that are
      already gone. Applies to the player AND to a groupmate whose ally buffs
      are being tracked. *Needs the exact death lines from a real log first* -
      both the player own-death wording and the third-person one.
- [ ] **Cooldown mode for custom trackers.** A timer that represents an
      ability being unavailable rather than a buff being active. Related to,
      but not the same as, the reverse/negative detection below - worth
      deciding whether one mechanism covers both before building either.
- [ ] **In-app bug report route.** Simplest useful version: a button that
      opens a prefilled report with the app version and the last chunk of
      `detection-debug.log` attached, since that log is what actually makes a
      detection report diagnosable. Plus a Discord invite link somewhere
      obvious (About page).

- [ ] **Sounds: progressive disclosure.** Only show a sound picker once its
      "Play a sound" toggle is on. Make "Warn before expiry" a toggle first
      (it's a bare slider today) that expands into its own options.
- [ ] **Merge Alerts into Sounds** so the warning sound sits next to the
      warning threshold instead of in a separate topic.
- [ ] **Planned features tab.** A real page listing what's coming, replacing
      today's scattered disabled "Planned" placeholders. Worth more than it
      looks for shipping - turns "this seems broken" into "not built yet".
- [ ] **Example library** in the premade aura list, e.g. a skill-cooldown
      tracker built from a custom timer. Mostly content once the custom-timer
      work below lands.
- [ ] **Sounds per trigger** rather than per aura. *Your own open question* -
      weigh against the settings-UI complexity it adds.

---

## New trigger types

All hang off the custom-timer work. The trigger picker is already
data-driven (`TRIGGER_TYPES` in `main-window.js`), so each of these is: add an
entry with a `fieldsId`, add that panel's markup, handle the mode in
`readTimerFormData`. Zone change and Combat state already show as disabled
"Planned" entries.

- [ ] **Zone detection** - starts when you enter or leave a zone.
      *Needs a real log sample* to know what the line looks like.
- [ ] **Combat detection** - starts when you enter or leave combat.
      *Needs a real log sample.*
- [ ] **Reverse / negative detection** - show a tile while the trigger has
      NOT happened, hide it for the duration once it does. Inverted from every
      existing timer, so it needs its own branch in `customTimerEngine.js`,
      not a flag. *Checkbox already ships disabled + Planned.*
- [ ] **Static text labels** - show fixed text with no countdown while a
      trigger is active. A genuinely new display mode.

---

## Large - needs design

- [~] **Custom timer / Add Aura overhaul.**
      *Done*: the per-timer form is now a modal with every field visible for
      both add and edit, and the trigger picker is data-driven.
      *Left*: the **Add Aura** modal itself still needs the same treatment.
- [ ] **Multi-step / sequential aura type.** A new aura *kind* where a defined
      sequence of triggers must fire in order, and only ONE tile is ever
      active at a time. Real new data model plus engine behaviour.
- [ ] **Unified aura scale.** One control scaling icon + list + text together,
      draggable on the overlay via the existing blue move-mode box.
      *Your open question*: should it replace icon size outright rather than
      sitting alongside it?
- [ ] **"You Have Been Dispelled" aura.** An event-notification category - no
      timer, no active/inactive state. Different from everything the widget
      model handles today, so it means designing that category first.
- [ ] **Dedicated Bard Song aura.** Now has real justification: self-vs-ally
      is undecidable for songs, so isolating them beats polluting Self Buffs.
      Design it as deliberately not caring about self-vs-ally.

---

## Separate subsystem - biggest item, unrelated to buff tracking

- [ ] **Action bar cover replacements.** Images/borders overlaid on the game's
      hotbar buttons, with a configurable layout and size percentage - from
      full custom icons down to plain coloured/transparent border frames.
      Border-image support doesn't exist yet.
  - [ ] Pixel-stepper nudge controls for fine positioning.
  - [ ] Icon border support - useful for buff icons too, not just these.

---

## Sorted backlog — your raw notes, organised

Everything that was in the loose list at the bottom of this file is here, nothing dropped.
Each note kept its number so you can trace it back, and the original wording is preserved
verbatim at the end of this section.

Three things were worked out that are not visible from the notes themselves, and they are the
reason this is grouped the way it is:

- **Some notes are the same feature written twice.** 8 and 12 are one render primitive. 14 and
  34 are nearly the same request. 9 and 39 are one feature. Built separately they get built
  three different ways and only one handles the hard part.
- **One note that reads as a small styling job is not.** Coloured borders by spell type (37)
  needs a spell-category field that does not exist anywhere in the app yet, so it is entirely
  downstream of the roster work.
- **Share codes couple to almost everything.** `SHAREABLE_FIELDS` is a hand-maintained list and
  a share code is a diff against defaults, so every note that adds an aura field quietly changes
  what an existing share code means.

### Build order — least volatile first

Each step leaves the app working and testable before the next one starts. Shared foundations
land before the things that sit on them.

1. **Roadmap placeholders (25) + red danger button (5)**
   Two additive edits. The app is testable in minutes and the in-app roadmap turns "this seems
   broken" into "not built yet".

2. **Small correctness: memorized cap (3), refocus game (29), profile name box (33)**
   Do 3 first. The memorized list feeds every detection tier, so an oversized one is bad
   evidence going into all of them.

3. **Main window chrome: UI scaling (7), sidebar resize (13), master-page-only unlock (22)**
   Scaling first — it re-bases every pixel value the sidebar drag maths sits in. None of this
   touches detection or saved data.

4. **Alert layer: volume bug (32), then trade ping (36)**
   32 is a real bug on a field that already exists. Fix it before 36 adds a second consumer.

5. **Visibility precedence: hide-all (4) **with** unlock-shows-hidden (31), then aura names in move boxes (6)**
   4 and 31 must be one change. Separately they fight over which override wins.

6. **Merged tiles (8)**
   The first of two overlay render jobs. Run it over buff sources that already work, so the
   tile is proven before anything new feeds it.

7. **Text-only display mode (23), then profile label aura (21)**
   The second render job. Strictly after step 6, never in parallel — both rewrite the same
   render path. Landing 23 unblocks four other notes.

8. **Promised Renewal fix (1), then the spell data foundation (35)**
   Start sourcing 35's data **now**, in parallel with steps 1–7. It is blocked on data-
   gathering, not on engineering time.

9. **Detection rework (24), with overwrite detection (26) and the ally misfire (28) inside it**
   Your own diagnosis: a failed check should continue, not end the check. Fixing that makes 26
   an appended tier rather than surgery.

10. **Premade builder shell (14), then 34's buff half, then cooldown premade (15), then gem slots (27)**
   15 needs step 8 finished, because recast times come from the same empty column.

11. **Custom trigger overhaul (9 + 10 as one), then zone gating (38). Record 39, do not build it.**
   The trigger is one flat string today. Widen it once, rather than bending it per feature.

12. **Enemy debuff engine (11), then mez example (17), consolidated mez tile (12), AoE counting (18), debuff premade (16)**
   11 is the mechanism and 16 is the generalisation, so 11 goes first. Blocked until mez log
   lines exist.

13. **Share-code import from chat (30) — last**
   Do it once the set of aura fields has stopped moving, or it will need redoing.

### Waiting on something before they can start

These need a real log line, a decision, or data that does not exist yet. Every one is exact-text
matching against wording nobody has captured — building on guessed wording produces confident,
silent wrongness, which is worse than the feature simply being absent.

- **#2 New premade aura: a 'first aggro' checker showing who hit the boss first, or who the boss hit first - and add a disabled 'Planned' placeholder for it in the Add Aura list now**
  Needs a real log sample of a pull: the first melee/spell damage lines in both directions
  (you hitting the boss, the boss hitting someone) plus whatever line marks the fight starting
  and ending, captured on EverQuest Legends specifically.
- **#11 Track AoE mez per mob: start each timer from the land line (never the cast), take the duration from whichever Mesmerization rank was cast in the last ~4 seconds, and match names case-insensitively**
  Needs a real log sample of the mez lines from EQ Legends - the exact land, resist, worn-off
  and slain wording. Detection is exact-text matching and none of these lines exist anywhere
  in the code today; Mesmerization is not in buffs.json at all (I checked all 11,337 entries).
- **#15 Premade "spell cooldown" aura: pick a skill from a dropdown and get a recast/cooldown countdown, plus a placeholder entry for it in the Add Aura premade list**
  Per-spell recast/reuse seconds do not exist anywhere in this project. I checked: buffs.json
  has no cooldown field at all, and in 'new spell roster to be added.xlsx' the "reuse" column
  (L) is empty on all 1052 rows, as are "landed on you", "landed on other" and "SPell faded".
  The game's own spells_us.txt probably carries a recast field, but its position is unverified
  and this project's rule (CLAUDE.md, gameSpellData.js:15-26) is to verify a field position
  empirically against the real file rather than trust a schema doc. Someone needs to either
  mine and verify that field, or fill in column L.
- **#16 Premade "debuff on an enemy" aura (mez, malo, slow, etc.) that shows every debuff currently active on each mob the way Ally Buffs shows every buff on each ally, with a text alert when the target resists, plus an optional toggle to also track debuffs an ally applied (for boss debuffing), and a placeholder entry in the Add Aura premade list**
  The "also count an ally's debuff" toggle needs a decision from you before it can be built at
  all - see notes. Separately, the detrimental-spell mine needs the EQ install's spells_us.txt
  / spells_us_str.txt, which I could not reach from here (your logs are on the Desktop but the
  game folder is not under C:/Users/Lindsey).
- **#17 Build the Mesmerization aura as the first worked example of the enemy-debuff system: remember the rank from the cast line but start no timer, start a per-mob timer when the mob is mesmerized, flash a red RESIST message for about 1.4 seconds when a mob resists, and clear a mob when the mez wears off or the mob dies**
  The red RESIST flash needs the "text only aura" display mode from your other note (fixed
  text, no countdown, with a timed on-screen duration) - that mode does not exist and every
  render path in overlay.js today is driven by remainingSec. Nothing else here is blocked: I
  confirmed every log line you listed against your real logs.
- **#20 Travel guide premade aura that knows which travel spells you have scribed and shows the shortest route to where you want to go, plus a placeholder entry in the Add Aura premade list**
  A zone-connectivity map plus a table of which travel spell lands you in which zone. Neither
  exists in the app, in buffs.json, or in the new spreadsheet (which has no destination column
  at all), and because EverQuest Legends is a custom server the standard live-EQ zone layout
  cannot be assumed to be correct. Someone has to source or build that dataset before routing
  is possible.
- **#21 An in-game aura showing which loadout profile is currently active, appearing automatically once a second profile is created, and able to be switched off - built on the text-only aura feature**
  The "text only aura" display mode from your other note - specifically its "always" on-screen
  option. This aura is a permanent static string with no countdown, and every render path in
  overlay.js today is driven by remainingSec, so there is nothing to build on until that mode
  exists.
- **#24 Rework spell detection into the stated priority order - and add a new post-cast check that waits to see whether an ambiguous landing text repeats on the next song pulse, resolving buff-vs-bard-song automatically instead of asking, with the popup showing a countdown to the next check**
  Needs a real log sample of an ambiguous bard-song landing text repeating - e.g. Cassindra's
  Chant of Clarity's "Your mind clears." - to confirm the game re-prints the landing text on
  every song pulse and that the interval really is 6 seconds. The entire new check rests on
  that assumption and cannot be built on it unverified.
- **#26 Detect when a newly landed buff overwrites one that is already running, and drop the stale timer instead of counting it down**
  Needs one raw log sample of a real overwrite - cast a stronger version of a buff you already
  have running, and send the lines. That single sample decides whether this is a few hours of
  work or several days, which is why I can't size it yet.
- **#28 Bug: the Ally Buffs aura showed Berserker Spirit on 19 Aug at 12:15 for a buff she never cast**
  Needs the detection-debug.log from userData (\AppData\Roaming\EQ Buff Tracker\detection-
  debug.log) covering 2026-08-19 12:15, and ideally the raw eqlog lines around the same
  timestamp. The debug log records the exact decision the engine made and would separate the
  two possible causes outright - the raw log alone would leave it a guess.
- **#30 Watch the log for aura share codes people post in chat, and offer them as a pickable list under a new "Import from log" option when adding an aura**
  Needs the owner to confirm EverQuest's real per-chat-line character limit on this server,
  and that it doesn't mangle + / = characters - because measured codes are far longer than one
  chat line (see notes).
- **#33 The name box in the "New loadout profile" dialog can't be clicked**
  Needs one repro detail from you: does the dialog open normally? Is the box visible but
  ignoring clicks, or visible and clickable but refusing typed text, or not visible at all?
- **#34 Add "Buff" and "Debuff" premade aura templates that ask you to pick one spell (and for a buff, whether it's on you or an ally) and then build the aura for you with sensible defaults**
  The debuff half needs real log samples for detrimental spells on this server - the land
  line, the resist line and the worn-off line. You've written candidate wording for
  Mesmerization in FEATURES.md, but it hasn't been taken from an actual log, and this app
  matches text exactly.
- **#35 Archive the current spell roster and rebuild it from the new EQL spell spreadsheet, including its per-tier (roman numeral) scaling rules and spell categories**
  The four columns detection actually runs on - "landed on you", "landed on other", "spell
  faded", "reuse" - are completely empty in the sheet (header row only, zero data rows). Only
  298 of its 1,052 spells name-match the current roster, so 754 have no text available from
  anywhere in this project. Filling them needs either a fresh mine of your spells_us.txt or
  scraping the site the sheet was pasted from (https://amerzel.github.io/eql-info/ - every
  spell name links to one page there), and that's a decision plus real work, not an estimate.

Two notes were **checked and are NOT blocked** — the lines are already in your own logs:

- **#36 trade ping** — `<Name> is interested in making a trade.` is there, 9 times.
- **#38 zone gating** — `You have entered <Zone>.` is there, across 58 distinct zones. Note the
  instance suffixes though: `Befallen`, `Befallen 1 (Awakened)` and `Befallen 3 (Fused)` are
  separate strings, so "only in Befallen" has to mean base-name matching, not exact matching.

**#11 / #17 mez really is blocked** — there is not a single mez land, resist, worn-off or slain
line anywhere in your logs, which makes sense for CLR/BRD/SHM. Someone has to cast one.

### The twelve groups

#### Roadmap placeholders — the in-app "Planned" list

*Notes #2, #19, #20, #25 · start with **#25** · under an hour*

CLUSTER: this is only the PLACEHOLDER HALF of notes 2, 19 and 20 - their real features stay in
their own clusters and are not made cheap by this. The infrastructure already exists
(PLANNED_PREMADE_WIDGETS at main-window.js:1814 already ships two entries), so all four
placeholders are one array literal, well under an hour total. Do not let this item's triviality
hide that note 2 is needs-design and note 20 is blocked on a dataset that does not exist
anywhere.

#### Alert layer — volume correctness and new alert sources

*Notes #32, #36 · start with **#32** · a few hours*

CLUSTER: the alert layer. Small, self-contained, worth doing early because half of it is a real
bug on a field that already exists. TWO SEPARATE THINGS LIVE IN NOTE 32 AND ONLY ONE IS A BUG.
The bug: the slider never loads the aura's saved volume - main-window.js:2025-2033 wires an
input listener and reads the value, but nothing populates it from config when you select an
aura, so it always shows its markup default. That half is genuinely minutes. The second half -
re-ranging to 0-200 with 100% in the middle - is NOT a bug fix and is not trivial: it is a data-
meaning change (see risk) plus a real audio change, because an HTML audio element's volume caps
at 1.0, so anything above 100% needs a Web Audio gain node in overlay.js's playCustomSound path.
Size and ticket the two halves separately. NOTE 36 HAS AN AMBIGUITY WORTH RESOLVING BEFORE
ANYONE STARTS: alert volume today is a PER-AURA field (widgetStore.js:62-66 - one shared volume
per widget across its three alert slots). A trade request is not per-aura, it is a global app
event. So where does its volume come from, and where do you configure its sound? Either it needs
a new global alert setting (small, but new) or it must be modelled as a custom trigger on some
aura, which makes it note 9's problem instead. I read your note as wanting a simple global
alert, but say which you meant rather than letting an implementer pick. BUILD ORDER: step 4 of
13. Fix 32's load bug first so note 36 is added onto a working volume path rather than a broken
one.

#### Merged/consolidated tiles — N entries collapsed into one

*Notes #8, #12, #18 · start with **#8** · about a day*

CLUSTER - AND THIS IS THE ONE YOU ALMOST CERTAINLY DO NOT SEE. Note 8 ('merge buffs that share a
duration into one icon: lowest remaining time, recipient name, count') and note 12 ('one mez
tile: 12.4 x6 a greater kobold') ARE THE SAME RENDER PRIMITIVE. Both are 'collapse N tracked
entries into one tile showing min-remaining + a count + a name'. Note 18 (counting how many mobs
were actually affected) is where 12's x6 comes from. Written as three separate tickets they will
be built three different ways and only one of them will handle the key problem correctly.
KEYSTONE IS 8, NOT 12, DELIBERATELY: 8 runs over self/ally buffs that already work today, needs
no new engine and no log sample, so the tile primitive gets proven live before anything unproven
feeds it. BUILDING IT GIVES YOU FREE: note 12 stops being render work and becomes a data-source
swap (point the same merged tile at note 11's mez engine), and note 18's count is already the
tile's own x-count. BUILD ORDER: step 6 of 13. Strictly sequential with note 23, which follows
it. AMBIGUITY I HAD TO INTERPRET: note 8 says 'buffs that share the same duration'. I read that
as the same nominal durationSec - i.e. one spell cast on several people - NOT the same remaining
time. Same-remaining would regroup every tick and thrash the DOM. These are very different
features; confirm which you meant before anyone builds it. COUPLING WARNING: note 12 specifies
yellow turning red at 8 seconds, but overlay.js already has a reserved low-time danger colour
that CLAUDE.md says must not be themeable away (widgetStore.js:80-85). Whoever builds the mez
tile's colours must extend that system, not add a second competing one - otherwise an aura can
end up with two disagreeing ideas of 'about to expire'.

#### Aura visibility and unlock — one precedence model

*Notes #4, #6, #22, #31 · start with **#4** · about a day*

CLUSTER: everything that decides whether an aura window is on screen and whether you can grab
it. KEYSTONE IS 4, because a master hide-all is what forces the precedence question into the
open; once it is answered, note 31 is a single clause in the same expression. BUILD 4 AND 31 AS
ONE CHANGE - this is my strongest coupling warning here, and the pair genuinely reads as
unrelated. One is 'a hide-everything button for doing UI work', the other is 'unlocking should
show an aura that is switched off for this profile'. Both add a new override on top of
widgetManager's isVisibleForActiveProfile plus the existing foreground auto-hide. The moment
they coexist there is a question with no default answer: hide-all is ON and you unlock an aura -
does it appear? Note 4 says the screen should be clear; note 31 says unlocking must reveal. Two
people in two weeks will answer that differently and whichever ships second wins silently.
Decide the precedence first. My suggestion: unlocked ALWAYS wins, because CLAUDE.md already
establishes 'an unlocked aura is never auto-hidden' as the existing rule - which means note 31's
behaviour is arguably already the intended design and note 4 must respect it. BUILDING 4 GIVES
YOU FREE: a single named 'why is this window hidden' resolver replacing the current scatter of
independent hide reasons. That is what makes 31 a one-liner and makes future hide reasons safe
to add - note 38's zone filter, if you take its per-aura-dropdown reading, plugs straight into
it. NOTE 22 IS TRIVIAL AND UNBLOCKED, ship it in step 1: the All auras card is at
index.html:168-180 inside page-overlay, and the per-aura settings panel is at index.html:203 in
the same section, which is exactly why the master controls sit on top of every individual aura's
page. It needs nothing from the rest of this cluster. NOTE 6's HIDDEN COST: showing the aura's
name in the blue move box is easy; making that name CLICKABLE means the overlay window must
become click-receptive in that one spot while unlocked, then send an IPC message that focuses
the main window and routes to that aura's settings. The routing target already exists
(focusWidget), so the real work is the click-through carve-out, not the navigation. COUPLING
WARNING (looks unrelated): notes 6 and 22. Both change how you get from an aura to its settings
page - 6 adds a new entry point into it, 22 removes controls from it. Same page, same routing
code, different weeks. BUILD ORDER: step 5 of 13, except note 22 which goes in step 1.

#### Main window chrome — scaling, sidebar, button styling

*Notes #5, #7, #13, #33 · start with **#7** · about a day*

HONEST FRAMING: this is a BATCH, not a hidden single feature. I am not going to claim notes 5, 7
and 13 are secretly one thing - they are three independent main-window changes that share a
stylesheet and nothing else. I group them because batching them is what makes the build order
least volatile: all three touch the same CSS, none touch detection, saved widget data, or the
overlay, so this is the safest work in the entire backlog to hand to a second person in
parallel. ORDER WITHIN THE BATCH IS A REAL DEPENDENCY, NOT A MANUFACTURED ONE: do note 7 (UI
scaling) FIRST. It re-bases every px value in the settings window, and note 13's sidebar drag-
to-resize math sits in that coordinate system. Landing 7 last means redoing 13's measurements.
NOTE 7 IS MUCH EASIER THAN IT SOUNDS IF SCOPED RIGHT: Electron gives you
webContents.setZoomFactor, which scales the whole main window from one persisted number with
zero stylesheet work - that is about an hour. A proper rem-based type scale with text sizing
independent of chrome is a day-plus. Your note says 'text/UI size scaling options for the app
window itself', which I read as the cheap whole-window version - also the one that cannot break
layout. Confirm if you meant text-only. NOTE 7 EXPLICITLY DOES NOT COVER THE OVERLAY. Auras
already have their own textSize/iconSize/rowSize controls (widgetStore.js:26-30), and your note
says 'the app window itself'. Do not let this extend into overlay scaling. NOTE 13's HIDDEN
COST: a draggable sidebar needs its width persisted app-level (store.js), not per-aura. Trivial
work, but it is a new persisted setting, so decide where it lives before writing it. NOTE 33
SHOULD NOT BE GUESSED AT. 'Can't be clicked' has at least three distinct causes at that markup:
a modal-backdrop z-order or pointer-events problem, a focus trap, or the input never being
reached at all. Each is a different one-line fix, and picking the wrong one wastes a live test
cycle. One sentence from you settles it. BUILD ORDER: step 3 of 13 for notes 7 and 13; note 5
goes in step 1 (a CSS class swap onto an existing button, ship it with the placeholders); note
33 in step 2 once repro'd.

#### Text-only display mode — the third render path

*Notes #2, #17, #19, #21, #23 · start with **#23** · several days*

CLUSTER: 23 is the keystone and a hard prerequisite for 17 and 21 (both notes say so outright)
and the natural home for 2 and 19. BUILDING THE KEYSTONE GIVES YOU FREE: (a) a third displayMode
value; (b) the render path decoupled from remainingSec, which is the actual architectural change
- today there is no way to draw anything that is not a countdown; and (c) the on-screen LIFETIME
model (always / for N seconds / until a closing text is seen). That lifetime model is the real
prize: note 17's 1.4-second RESIST flash, note 21's permanent profile label, note 2's first-
aggro name and note 19's damage numbers are all that one model with different text in it. The
'until a closing text is seen' option is mechanically what customTimerEngine.js:84-89 already
does with endedText - reuse it rather than writing a second closing-text matcher. BUILD ORDER:
step 7 of 13. Must be adjacent to and strictly AFTER note 8's merged tile (step 6). Never in
parallel - two people rewriting overlay.js's render loop in the same fortnight is the most
volatile thing available in this backlog. Land note 21 immediately after as the cheapest real
consumer, which proves the 'always' lifetime before note 17 leans on the timed one. COUPLING
WARNING (looks unrelated, would collide): 23 and note 27. Note 27 restructures the aura settings
panel, and main-window.js:1483-1530 is exactly the per-display-mode show/hide logic 27 would
rewrite. If 27 lands first not knowing a third mode is coming, its new information architecture
has no slot for text-only's own text-size control - and note 23 specifically wants that size
allowed to go MUCH larger than list/icon text, which must be a separate persisted field, not a
widened range on the existing textSize, or every existing aura's size meaning changes. HIDDEN
COST: that new size field needs a SHAREABLE_FIELDS entry (widgetStore.js:236-275) or it silently
does not travel in a share code.

#### Enemy debuff tracking — the per-mob fourth buff source

*Notes #11, #12, #16, #17, #18, #34 · start with **#11** · several days*

CLUSTER: the debuff/mez/AoE family - one feature seen from five angles. KEYSTONE IS 11 (the
mechanism), NOT 16 (the generalisation): 16 is needs-design AND blocked on a decision AND
blocked on a spell mine, so it structurally cannot go first. BUILDING 11 GIVES YOU FREE: (a) a
fourth buffSource - the only structurally expensive part, and what note 16's entire premade aura
sits on; (b) engine state keyed by (spell + mob) instead of by spell, plus the case-insensitive
mob matching, which IS note 18 - counting distinct entries sharing a mob name falls straight out
of that map with no extra feature at all; (c) the cast-rank-to-land-line correlation window
(remember the rank from the cast, start the timer from the land, take duration from whichever
rank was cast in the last ~4s), which is precisely note 17's spec; (d) note 12 becomes a data-
source swap onto note 8's merged tile. SEQUENCE INSIDE THE CLUSTER: 11 -> 17 (one spell end to
end, proves it live) -> 12 (render) -> 18 (falls out) -> 16 (generalise). Note 17 additionally
needs note 23's text-only mode for its RESIST flash, so 23 must already have shipped. BUILD
ORDER: step 12 of 13 - second to last. Not because it is unimportant, but because it has the
most prerequisites: text-only mode, the merged tile, the detection rework, and a log sample you
do not have. COUPLING WARNING (looks unrelated, would collide): 11 and note 24. Both edit the
same ~500-line handleLine chain. Note 24 rewrites it from first-match-wins into keep-checking -
your own diagnosis, quoted in CLAUDE.md. Anyone inserting 11's four new line types into the OLD
chain in a different week is guaranteed rework, and may re-introduce exactly the auto-fail-then-
stop behaviour 24 exists to remove. ONE THING THAT IS MUCH EASIER THAN IT SOUNDS: note 18. Once
11 exists you are not building a counter, you are reading a map's size. Do not size it as its
own feature.

#### Premade aura builder — the spell-picker template shell

*Notes #14, #15, #16, #27, #34 · start with **#14** · several days*

CLUSTER: the premade-aura family. FIRST, A DUPLICATE YOU SHOULD KNOW ABOUT: notes 14 and 34 are
substantially the same request. Note 14 is 'pick a spell from a dropdown and whether it's on you
or an ally, and have the aura built for you'. Note 34's buff half is 'ask you to pick one spell
(and for a buff, whether it's on you or an ally) and build the aura with sensible defaults'.
That is one feature written twice. 34's only genuinely additional content is its debuff half,
which belongs to the note-11 cluster and is blocked there anyway. BUILDING 14 GIVES YOU FREE:
today every premade entry is a zero-question one-click creator - create(name) at main-
window.js:1806 takes a name and nothing else, and renderPremadeList wires the click straight
through to it. There is no mechanism anywhere for a template to ASK something first. Build that
once and you get a reusable roster spell-picker plus the 'collect answers, then call
widgetStore.create with a prefilled config' pattern. After that, notes 15, 16 and 34 are the
same shell with a different question list, and note 27's gem-slot modal is that same picker
again. BUILD ORDER: step 10 of 13. After note 35 (step 8), because note 15's recast seconds only
exist if that data job is done, and after the detection rework so the roster is not moving under
the picker. NOTE 27 IS THE BIG ONE AND IT IS A HUB. Be aware there are currently TWO things
called 'Buffs shown' in the UI - a buff-source radio row at index.html:246 and a filter topic at
index.html:567 - and your note only means the second. Its buff/debuff mode toggle is the note-11
cluster's fourth buffSource surfaced in UI, so 27 cannot be fully finished before 11 lands:
build its gem-slot half against buffs first and ship the debuff toggle disabled. EASIER THAN IT
SOUNDS: note 27 explicitly says 'no and/or logic yet', which means it does NOT wait on note 9.
Do not let anyone couple them - that would park the biggest UI win in the backlog behind the
biggest engine change. COUPLING WARNING (looks unrelated, would collide): notes 15 and 35. One
reads as a feature, the other as a data chore, but they share one single blocker - the empty
'reuse' column L. Source that data once and both are unblocked; source it twice and you paid for
it twice.

#### Spell data foundation — roster rebuild, tiers and categories

*Notes #1, #15, #26, #35, #37 · start with **#35** · several days*

CLUSTER: everything downstream of what the app knows about a spell. KEYSTONE IS 35 and it is the
longest CALENDAR pole in the backlog - start sourcing its data now, in parallel with steps 1-7,
because it is blocked on data-gathering rather than on engineering time. BUILDING IT GIVES YOU
FREE: (a) note 15's recast seconds (same empty column L); (b) note 37's spell categories - and
this is the non-obvious one, because note 37 reads as a pure CSS job ('coloured borders by spell
type, red for damage/DoTs, green for heals/HoTs') when in fact there is NO damage/heal/DoT/HoT
field anywhere in this project. Note 37 is 100% blocked on note 35 and is not a small feature;
(c) note 34's debuff land/resist/faded text; (d) note 16's detrimental spell list; and (e) the
per-tier roman-numeral scaling rules, which is the closest this app will ever get to the per-
spell tier field it currently does not have - today it is one GLOBAL duration multiplier plus a
per-buff noDurationScaling boolean (buffEngine.js:872), which is exactly the mechanism note 1 is
working around. COUPLING WARNING (looks unrelated, would collide): notes 35 and 1. Note 1 is a
one-field correction to Promised Renewal and reads as five minutes of work - it is - but note 35
archives and REBUILDS the roster, which can silently discard it. buffStore's upgrade path is
version-gated and deliberately avoids clobbering user edits, so whether note 1 survives depends
entirely on HOW it was applied: a bundled buffs.json edit gets overwritten by a rebuild, a user-
side edit may survive and then disagree with the new data. Do note 1 now because it has real
value today, but write on the note-35 ticket that it must be re-verified afterwards. SECOND
COUPLING: notes 35 and 26. Note 26's blocker is one raw log sample, but its actual FIX probably
needs to know which spells overwrite which - a stacking/spell-line relationship that only exists
in game data. If a mine is being written anyway, capture the spell-line field in the same pass
rather than mining twice. PROCESS REQUIREMENT: any new field position must be verified
empirically against the real file (gameSpellData.js:15-26), not trusted from a schema doc - this
is a custom server. And the rebuild must be diffed entry-by-entry against the current roster
before it ships, with STARTER_VERSION bumped deliberately. BUILD ORDER: step 8 of 13 for the
engineering, step 1 for the data-sourcing decision.

#### Detection engine rework — the P0 tier chain

*Notes #3, #24, #26, #28, #29 · start with **#24** · several days*

CLUSTER: the detection-correctness family. This is CLAUDE.md's own P0 and the project bible is
emphatic that these are one problem with several symptoms, not several bugs to fix individually.
BUILDING 24 GIVES YOU FREE: the chain stops being first-match-wins and becomes keep-checking -
your own diagnosis, quoted verbatim in CLAUDE.md ('every check if not passed, should continue,
not end the check'). Once a failed tier continues instead of ending the check, note 28's whole
class of bug becomes much harder to reach, and note 26's overwrite detection becomes one more
tier to append rather than a surgical insert into a fragile ordering. THE NON-OBVIOUS MEMBER IS
NOTE 3, AND THIS IS THE COUPLING PAIR I MOST WANT YOU TO SEE. Notes 3 (memorized list grows past
14) and 28 (Berserker Spirit appeared on 19 Aug for a buff you never cast) look like two
unrelated small bugs. They are not. currentlyMemorized is not a display list - gotchas #8 and
#16 make it a detection TIER INPUT, it is persisted across launches, and #16 states outright
that a wrong entry is worse than a missing one. A list holding 20+ entries means the engine
believes spells are in gem slots that are not, which is exactly the wrong-evidence condition
that makes a buff appear that you never cast. FIX 3 FIRST, then re-check 28 before spending the
debug-log analysis - 3 may change 28's repro or resolve it entirely. BUILD ORDER: notes 3 and 29
go in step 2 (both small, both reduce daily noise). The rework itself is step 9 of 13 - after
the display and chrome work so the app stays testable throughout, and before note 11's mez
engine so 11 is written against the new chain. NOTE 29 IS SMALLER THAN IT LOOKS AND SHOULD JUST
BE DONE EARLY: foregroundWatcher.js already runs inline PowerShell/P-Invoke to identify the
foreground window, so the machinery to ADDRESS the EQ window exists. It needs a
SetForegroundWindow call, not a new subsystem. Doing it before 24 also means 24's popup changes
land on already-correct focus behaviour.

#### Custom trigger model — conditions and lifecycles

*Notes #9, #10, #38, #39 · start with **#9** · several days*

CLUSTER: the custom-timer overhaul. CLAUDE.md's own P4 already says to do this BEFORE the
individual combat/zone/negative trigger features, since they are designed to hang off it and
building them piecemeal means redoing them once the overhaul lands. NOTES 9 AND 39 ARE THE SAME
FEATURE. Note 9 is 'let a custom aura's timer fire on a combination of triggers (any-of / all-
of)'. Note 39 is 'new aura category for multi-trigger auras with AND/OR conditions'. Note 39
says record it, do not build it now - so treat 39 as the acceptance criteria for 9 rather than
as separate work. BUILDING 9 GIVES YOU FREE: the trigger stops being one flat string
(customTimerEngine.js:66 is literally a single case-insensitive equality) and becomes a
condition list. That same list is where note 38's zone condition plugs in as one more condition
type, and where note 27's and/or logic would eventually live. BUILD 9 AND 10 TOGETHER - a
coupling pair that reads as unrelated: 9 is about what STARTS a timer, 10 is about what the
timer DOES after it starts. Different features, same object. Both rewrite the persisted
definition at widgetStore.js:449, both rewrite readTimerFormData (main-window.js:2134), both
rewrite customTimerEngine's handleLine, both need a widgets.json migration. Sequentially that is
one migration and one form rewrite; in parallel it is two of each, in conflict. NOTE 38 IS
AMBIGUOUS AND THE TWO READINGS COST VERY DIFFERENT AMOUNTS. Your note offers 'an extra and-only-
in-this-zone condition on a trigger' OR 'a per-aura zone dropdown under when to show them'. The
first is a trigger condition, belongs here, and depends on 9. The second is a widget-level
visibility filter that plugs into note 4's visibility resolver instead, needs nothing from 9,
and is much cheaper. Both readings need one thing neither mentions: there is no zone tracking in
this app today, so somebody must confirm the real zone-change line wording first. The picker
placeholder already exists (main-window.js:888); the tracker does not. BUILD ORDER: step 11 of
13. After the premade builder (step 10) so the two form-building efforts do not overlap inside
main-window.js.

#### Share-code import from chat log

*Notes #30 · start with **#30** · several days*

NOT PART OF ANY CLUSTER, but it carries the worst hidden-coupling risk in the backlog, which is
why it gets its own item. THE COUPLING, AND IT IS INVISIBLE FROM EVERY OTHER NOTE:
SHAREABLE_FIELDS (widgetStore.js:236-275) is a hand-maintained allowlist of which aura fields
travel in a share code, and the v2 format is a DIFF AGAINST DEFAULTS - only non-default fields
are encoded. That means every note in this backlog that adds an aura field, or changes an aura
default, silently changes what a share code means. Specifically: note 8 (merge toggle), note 23
(third displayMode plus its own larger text-size field), note 27 (gem slots - a whole new nested
per-slot structure), note 37 (border colours and toggle), notes 9 and 10 (a restructured
customTimers shape - and customTimers is ALREADY in the allowlist at line 252), note 12, note
38. Any of those built without touching SHAREABLE_FIELDS produces a field that simply does not
travel, with no error anywhere. WORSE, BECAUSE OF THE DIFF FORMAT: changing a DEFAULT
retroactively changes how already-circulating codes decode. Note 32's volume re-range is exactly
this - a code minted while alertVolume's default meant 100 decodes differently once that default
means something else. THAT IS WHY 30 IS DEAD LAST, step 13 of 13. Not because it is hard, but
because shipping a sharing feature while the aura schema is still moving means every code
exchanged during that window is quietly lossy, and you get bug reports that cannot be
reproduced. CHEAP MITIGATION YOU COULD DO NOW: put a schema version number in the code and have
importCode refuse a code from a newer schema instead of silently dropping unknown fields. Small
change today, and it makes note 30 safe to build whenever you like. THE BLOCKER IS REAL AND MAY
CHANGE THE FEATURE: measured codes are far longer than one chat line, so 'watch the log for
codes people post in chat' likely requires multi-line reassembly - a code split across several
says, in order, without interleaving from other chatters. That is a substantially harder feature
than the note describes. One real code pasted into real chat answers it before anyone writes a
line.

### Every note at a glance

| # | What it is | Type | Effort | Blocked |
|---|---|---|---|---|
| 1 | Correct Promised Renewal in the roster: its real duration is 15 seconds... | data | trivial |  |
| 2 | New premade aura: a 'first aggro' checker showing who hit the boss firs... | core-feature | needs-design | yes |
| 3 | Bug: the remembered-memorized-spells list grows past 14; cap it at the ... | bug | small |  |
| 4 | QoL: a 'hide all auras' master toggle on the main menu, as a temporary ... | qol | small |  |
| 5 | Style the 'Reset remembered choices' button red/danger, matching the ot... | qol | trivial |  |
| 6 | While auras are unlocked, show each aura's name in its blue move box, a... | qol | small |  |
| 7 | Add text/UI size scaling options for the app window itself | feature | small |  |
| 8 | Per-aura toggle: merge buffs that share the same duration into one icon... | feature | medium |  |
| 9 | Let a custom aura's timer fire on a combination of triggers (any-of / a... | feature | needs-design |  |
| 10 | Let one custom trigger run a duration and then roll straight into a coo... | feature | medium |  |
| 11 | Track AoE mez per mob: start each timer from the land line (never the c... | core-feature | large | yes |
| 12 | Show mez as a single consolidated tile - the mob breaking soonest, a co... | feature | medium |  |
| 13 | Make the main window's left sidebar resizable by dragging its edge | qol | small |  |
| 14 | Premade "buff timer" aura: pick a spell from a dropdown and whether it'... | core-feature | medium |  |
| 15 | Premade "spell cooldown" aura: pick a skill from a dropdown and get a r... | core-feature | medium | yes |
| 16 | Premade "debuff on an enemy" aura (mez, malo, slow, etc.) that shows ev... | core-feature | needs-design | yes |
| 17 | Build the Mesmerization aura as the first worked example of the enemy-d... | feature | large | yes |
| 18 | For AoE debuffs, use the fact that mobs sharing a name produce one succ... | feature | small |  |
| 19 | Damage parser premade aura, plus a placeholder entry for it in the Add ... | feature | needs-design |  |
| 20 | Travel guide premade aura that knows which travel spells you have scrib... | feature | needs-design | yes |
| 21 | An in-game aura showing which loadout profile is currently active, appe... | qol | small | yes |
| 22 | Show the "All auras" master controls (Unlock all auras) only on the Ove... | qol | trivial |  |
| 23 | Add a third display style, "Text only", alongside List and Icons - with... | core-feature | large |  |
| 24 | Rework spell detection into the stated priority order - and add a new p... | core-feature | large | yes |
| 25 | Add a disabled "Global recovery time" entry to the premade aura list as... | qol | trivial |  |
| 26 | Detect when a newly landed buff overwrites one that is already running,... | feature | needs-design | yes |
| 27 | Promote "Buffs shown" out of Configuration into its own section, sittin... | core-feature | large |  |
| 28 | Bug: the Ally Buffs aura showed Berserker Spirit on 19 Aug at 12:15 for... | bug | small | yes |
| 29 | After you answer the ambiguous-cast popup, put keyboard focus straight ... | qol | small |  |
| 30 | Watch the log for aura share codes people post in chat, and offer them ... | feature | large | yes |
| 31 | Unlocking an aura to move it should put it on screen even when that aur... | qol | small |  |
| 32 | Fix the alert volume slider so it loads the aura's saved volume, and re... | bug | small |  |
| 33 | The name box in the "New loadout profile" dialog can't be clicked | bug | trivial | yes |
| 34 | Add "Buff" and "Debuff" premade aura templates that ask you to pick one... | feature | needs-design | yes |
| 35 | Archive the current spell roster and rebuild it from the new EQL spell ... | data | needs-design | yes |
| 36 | Play an alert sound when someone asks to trade with you | feature | small |  |
| 37 | Give each aura tile a coloured border by spell type (red for damage/DoT... | feature | large |  |
| 38 | Let an aura apply only while you are in a specific zone - either as an ... | feature | needs-design |  |
| 39 | New aura category for multi-trigger auras with AND/OR conditions - reco... | feature | needs-design |  |

### The detail

#### #1 — Correct Promised Renewal in the roster: its real duration is 15 seconds, and it never gets the AA duration bonus

`data` · `trivial` (under an hour)

Much easier than it sounds, with one catch. The mechanism you need already exists: a previous
session set Promised Renewal to 12s + 'No AA scaling' in YOUR local data (HANDOFF.md line 50),
so this note is a correction of 12 -> 15, not new work - you can do it yourself in Known Buffs
right now, no build required. The catch is that the bundled starter roster still says 18s with
no flag, and buffStore's upgrade pass deliberately refuses to touch entries that already have
landingText (buffStore.js:57-63), so editing the bundled file alone changes nothing for you and
nothing for an existing installed user - a fresh install would get 15s, everyone else stays
where they are. That's the same 'bundled roster is stale' item already flagged in HANDOFF.md;
worth batching this fix into that job rather than doing a one-off migration for a single spell.
Two ambiguities I did not resolve for you: (a) 'Promised Renewal XII' is a SEPARATE roster entry
(buffs.json:59172) with different landing text, still 18s - I assumed your 15s applies only to
the base spell; (b) if the 15s was measured while the cast line carried a rank numeral
('Promised Renewal IX'), the server's rank-scaling effect (CLAUDE.md gotcha #13) may be
inflating or deflating what you saw. Finally: every one of the ~30 'Promised X' spells in the
roster carries the same 18s and no flag, and they are all the same delayed-heal mechanic - if
Promised Renewal is really 15s and unscalable, most of that family probably is too, so measuring
two more and fixing the family at once beats correcting them one bug report at a time.

**Risk:** Almost none for the timer itself; the only real risk is a bundled-roster edit silently
not reaching your own install (or, if a migration is added, overwriting a duration you later
tuned by hand).

**Touches:**
- `src/shared/data/buffs.json:59165-59171 (Promised Renewal entry: durationSec 18 -> 15, add "noDurationScaling": true)`
- `your live roster in userData (buffs.json) - currently 12s per HANDOFF.md; editable with no code via Known Buffs > edit duration + tick 'No AA scaling'`
- `src/main/buffStore.js:8 (STARTER_VERSION) + constructor merge pass at :44-67 - only needed if the fix must reach OTHER people's installs`
- `src/main/buffEngine.js:872 _scaledDuration (already honours the flag - no change)`

#### #2 — New premade aura: a 'first aggro' checker showing who hit the boss first, or who the boss hit first - and add a disabled 'Planned' placeholder for it in the Add Aura list now

`core-feature` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** Needs a real log sample of a pull: the first melee/spell damage lines in both
directions (you hitting the boss, the boss hitting someone) plus whatever line marks the fight
starting and ending, captured on EverQuest Legends specifically.

The placeholder you asked for in the parentheses is genuinely 10 minutes -
PLANNED_PREMADE_WIDGETS already exists and renders disabled entries, so adding 'First Aggro'
there today is trivial and I'd just do it. The feature behind it is the largest thing in your
seven notes and I want to be blunt about why. (1) This app has never parsed a single combat line
- buffParser only knows casts, memorize/forget, group joins and heal procs, so damage parsing is
new from zero. (2) Custom timers cannot be bent into this: customTimerEngine matches a trigger
by testing whole-line equality (customTimerEngine.js:69), so 'any line where the boss hits
anyone' is not expressible. (3) Every aura the overlay draws is a countdown; 'first aggro' is a
latched fact with no duration, which is the same missing category as the planned 'You Have Been
Dispelled' notification - build one and you have most of the other. (4) The real design
questions are yours, not mine, and they're what make this needs-design: how does the app know
which mob is 'the boss' (you type its name? whatever you targeted? the first named mob to
swing?), when does it reset (fight over, mob dies, zone, a timeout, a manual clear?), and does
'first' mean the first line in your log - which only contains what your client was in range to
see, so a raider on the other side of the room may be invisible to it. That last point is a real
accuracy ceiling and I'd want you to hear it before we build: the answer will sometimes be wrong
in a way the app cannot detect. Also note CLAUDE.md already lists 'combat detection' as an open
question needing the same log sample, so one capture unblocks both.

**Risk:** Your log only contains what your client was in range to see, so the app can
confidently name the wrong person as 'first' and have no way to know it did - and adding a whole
combat-line parser near the detection engine risks slowing or destabilising buff detection if it
is not kept in its own module.

**Touches:**
- `src/renderer/main-window/main-window.js:1814-1827 PLANNED_PREMADE_WIDGETS (the placeholder half - a 6-line addition)`
- `src/main/buffParser.js:154-232 (new matchers for melee/spell damage lines - no combat parsing exists in this app at all today)`
- `new src/main/ engine module (nothing existing models 'first event wins, then latch until reset')`
- `src/main/widgetStore.js:349-353 defaultsForKind + :160 buffSource (a non-countdown aura kind does not exist yet)`
- `src/renderer/overlay/overlay.js (every tile today is a countdown; this shows a name and no timer)`
- `src/main/main.js:456-472 (IPC for a new widget kind)`

#### #3 — Bug: the remembered-memorized-spells list grows past 14; cap it at the 14 gem slots and drop the oldest entry when a 15th arrives

`bug` · `small` (a few hours)

Correct diagnosis and the right fix, with three implementation details that decide whether it
helps or hurts. (1) 'Delete from the back' is ambiguous and the two readings differ: the gem bar
displays alphabetically sorted (getCurrentlyMemorized sorts with localeCompare,
buffEngine.js:1149-1152), so the entry visually at the back is NOT the oldest one. I read your
intent as 'keep the 14 most recent, discard the stalest', which is right, but it means eviction
has to work off insertion order, not what the bar shows. (2) A JS Map does not move an existing
key to the end when you re-set it, so re-memorizing a spell you already have will not refresh
its age - without a delete-then-set, the cap would happily evict the gem you just re-loaded.
Small detail, completely changes the behaviour. (3) The overflow only ever exists because the
app missed a 'You forget X.' line (app closed during a swap, or a loadout change), so the
stalest entry is usually the wrong one and eviction is the right call - but it is still a guess,
and per gotcha #16 a wrong entry is worse than a missing one. Two things make it safe: trim on
load as well as on insert (so an already-drifted saved file heals on next launch), and keep the
summary line honest - if you have observed 17, say you dropped 3 rather than quietly showing 14.
Worth pairing with a test in the new harness feeding 16 memorize lines and asserting the Map
holds 14 and holds the RIGHT 14; that's most of the few hours. Note the UI already assumes 14
(GEM_SLOTS, main-window.js:331) and silently loses the overflow from the middle of the bar, so
this makes the data agree with what you're already looking at.

**Risk:** currentlyMemorized is real evidence in detection - evicting a gem you actually still
have loaded makes buffEngine.js:589-600 treat your own buff landing as 'not currently memorized'
and IGNORE it outright, which is exactly the bard-song misdetection class already in the P0
backlog.

**Touches:**
- `src/main/buffEngine.js:166-172 (currentlyMemorized Map construction - trim on load too, not just on insert)`
- `src/main/buffEngine.js:390-397 (matchMemorizeFinished handler - where the cap belongs)`
- `src/main/buffEngine.js:1213-1215 _saveCurrentlyMemorized`
- `src/renderer/main-window/main-window.js:326-410 renderMemorized (GEM_SLOTS = 14 and the 'N spells remembered' summary line at :406)`

#### #4 — QoL: a 'hide all auras' master toggle on the main menu, as a temporary override that clears the screen while doing UI work - possibly with a hotkey too

`qol` · `small` (a few hours)

Cheap, because the plumbing you need already exists twice over - foregroundHidden is the same
shape of flag, and 'Unlock all auras' is the same shape of master control with its own IPC pair
and toggle button. The toggle alone is an hour or two. Three decisions I'd want from you rather
than guessing: (1) 'Primary menu' - I read that as somewhere always visible rather than buried,
which points at the profile bar across the top; the natural sibling location is the existing
'All auras' card on the Overlay Auras page, but that is one click away and you'd be clicking it
exactly when you can't be bothered to navigate. (2) Precedence over unlocked auras: you said
it's for UI work, which I take to mean you want the screen genuinely clear, so master-hide
should win even over an unlocked aura - the opposite of how auto-hide currently behaves, and it
needs to be deliberate, not accidental. (3) Whether it survives a restart: I'd argue NOT
persisting it, because a forgotten hide would look exactly like 'all my auras broke overnight' -
and if it does persist, the button state has to be loud. On the hotkey: it's real but separate
infrastructure (globalShortcut is used nowhere in this app today), and the tradeoff is that a
global hotkey is swallowed before EverQuest sees it, so the key has to be one you never use in
game. A hardcoded key is a small add; a user-configurable key-capture UI roughly doubles the
job. Also worth knowing you can already approximate this today by unticking every profile, which
is unpleasant and destructive - your toggle is the right answer.

**Risk:** shouldBeOnScreen currently lets an UNLOCKED aura beat auto-hide, so unless master-hide
is placed above that check, hitting 'hide all' while auras are unlocked will appear to do
nothing; and a hotkey registered via globalShortcut takes that key away from EverQuest entirely
while the app runs.

**Touches:**
- `src/main/widgetManager.js:38 (foregroundHidden - add a sibling masterHidden flag, runtime-only)`
- `src/main/widgetManager.js:354-358 shouldBeOnScreen (the single visibility decision point)`
- `src/main/widgetManager.js:386-393 setForegroundHidden (mirror it as setMasterHidden) + exports at :726-727`
- `src/main/main.js:429-430 (next to overlay:getMasterState / overlay:setAllUnlocked - the exact pattern to copy) and app.whenReady for globalShortcut if the hotkey is wanted`
- `src/preload/preload-main.js:78-97 area`
- `src/renderer/main-window/index.html:168-178 ('All auras' card) or :39-46 (the always-visible profile bar)`
- `src/renderer/main-window/main-window.js:2176-2200 renderMasterButtons/refreshMasterButtons`

#### #5 — Style the 'Reset remembered choices' button red/danger, matching the other destructive buttons

`qol` · `trivial` (under an hour)

One attribute. The class is already written and already carries a comment saying it marks
genuinely destructive actions, and the button already puts up a confirm dialog first (main-
window.js:783-786), so this is purely making the styling honest about what the button does. One
thing to decide while we're in there: today only ONE button in the whole app uses btn-danger
('Delete aura', index.html:647), so 'like other delete choices' is really 'like the one other
delete choice'. The other candidates that arguably deserve the same treatment are 'Forget all'
on the memorized gem bar and the buff-blocking / no-longer-track actions - say the word and they
get it in the same pass, but I have deliberately not widened your note on my own since the CSS
comment says the red is kept rare on purpose.

**Risk:** None beyond visual consistency - the .btn-danger class already exists and the button
already asks for confirmation before clearing anything.

**Touches:**
- `src/renderer/main-window/index.html:106 (add class="btn-danger" to #reset-ambiguous-btn)`
- `src/renderer/main-window/main-window.css:873-882 (.btn-danger, already defined)`

#### #6 — While auras are unlocked, show each aura's name in its blue move box, and clicking that name should jump straight to that aura's settings

`qol` · `small` (a few hours)

Two halves with very different costs, and the first half is nearly free: the overlay renderer
already receives the aura's full config including its name (widgetManager sends the whole object
on widget:configChanged), so replacing the hardcoded 'Click and drag to move' text with the
aura's name is a couple of lines - just remember to re-render it when you rename an aura, or the
box will show the old name until restart. The second half is the fiddly one. The whole blue box
is -webkit-app-region: drag (overlay.css:62), which is what makes it draggable and which also
eats mouse events, so the name has to become a small no-drag pill inside the box, and it needs
to be big enough to hit and small enough that the rest of the box still drags. Then it needs a
new IPC route the overlay windows do not have yet (preload-overlay.js is currently receive-only
apart from reportContentSize), plus a main-process handler to raise and focus the main window.
Once the main window gets the message the work is done for you - focusWidget(id) at main-
window.js:1789 already navigates to an aura's settings and is exactly what the premade-aura flow
calls; the only wrinkle is that it lives inside initWidgetsPanel's closure, so the listener has
to be registered in there with it. Worth noting the click will pull EverQuest out of focus (it's
raising another window), which with auto-hide on is the moment your other auras vanish -
unlocked ones stay put, so in practice this is fine, but do not be surprised by it.

**Risk:** The move box is a Chromium drag region, so a click handler placed directly on it will
silently never fire - the clickable name must be a no-drag child, and making too much of the box
no-drag is exactly how you lose the ability to drag the aura you're trying to move.

**Touches:**
- `src/renderer/overlay/index.html:10 (the static 'Click and drag to move' text in #drag-overlay)`
- `src/renderer/overlay/overlay.js:803-805 applyLockState and applyConfig at :814+ (config.name already arrives here in full)`
- `src/renderer/overlay/overlay.css:48-67 (.drag-overlay carries -webkit-app-region: drag)`
- `src/preload/preload-overlay.js (new channel - the overlay has no send-to-main path for this today)`
- `src/main/main.js:456-472 (new ipcMain handler: show/focus the main window, then tell it which aura to open)`
- `src/renderer/main-window/main-window.js:1789-1795 focusWidget (the nav function this needs already exists) and :435-440 activateNavButton`

#### #7 — Add text/UI size scaling options for the app window itself

`feature` · `small` (a few hours)

Cheaper than it looks IF we scale the whole window rather than only the text. Electron gives us
a per-window zoom factor, so a slider or +/- buttons plus a saved number is a few hours end to
end, it persists naturally next to the window size you already save, and it scales text, spacing
and icons together - which is normally what people actually want when a UI is too small to read
comfortably. The expensive version is scaling text ONLY while leaving layout fixed: the
stylesheet has 57 hardcoded pixel font sizes and no shared type scale, so that means converting
the whole stylesheet to relative units first, which is a multi-day refactor with a lot of visual
regression risk and no obvious benefit over zoom. My recommendation is the zoom route, and if it
reads wrong at high settings we fix specific spots rather than refactoring everything. Two
things I had to interpret: (1) I read 'app' as the main settings window, not the auras - the
overlay auras already have their own per-aura text size and icon size sliders, and the planned
unified aura-scale control in your backlog is the item that covers those, so I have deliberately
not merged the two; say so if you meant one control for both. (2) Whether it should also cover
the small ambiguous-cast popup window, which is its own window and would otherwise stay small
while everything else grows - I'd include it. Also worth knowing: Ctrl+scroll and
Ctrl+plus/minus can be wired to the same setting for almost nothing once the plumbing exists,
which is what most people reach for by reflex.

**Risk:** Scaling up past roughly 125% can crowd fixed-width areas like the sidebar and the
modals against the window's 640x480 minimum, so this needs a look at each page at the largest
setting rather than being assumed to just work.

**Touches:**
- `src/main/mainWindow.js:41-70 createMainWindow (apply the saved factor on did-finish-load, alongside the existing bounds restore)`
- `src/main/main.js (new IPC get/set pair, saved via the same loadJson/saveJson store as mainWindowBounds)`
- `src/preload/preload-main.js`
- `src/renderer/main-window/index.html (a control on the Setup page) + main-window.js (its handler)`
- `src/renderer/main-window/main-window.css (57 font-size declarations, nearly all hardcoded px - only relevant if you want the harder approach below)`

#### #8 — Per-aura toggle: merge buffs that share the same duration into one icon showing the lowest remaining time, the recipient's name, and a count of how many are merged

`feature` · `medium` (about a day)

One real ambiguity I had to interpret: "THE PLAYER NAME". A Self Buffs aura has no name to show.
I read it as the recipient's name (buff.allyName), which is also where the payoff is biggest -
Quick Buff on a group is ~14 tiles per ally today. If you meant your own character name, that is
derivable from the log filename (main.js:184) but is not plumbed anywhere near the overlay yet.
Second interpretation: "exact same duration" = the buff's full durationSec, not its remaining
time - which will also merge unrelated buffs that merely share a duration (a large slice of the
roster is 1440s), so it may want to be duration + landed-in-the-same-burst. The count badge is
the genuinely reusable half - note 12 wants the identical "x6" badge, so build it once as a
shared piece, which is exactly what your parenthetical asks for.

**Risk:** Every glow/sound/warning Map in overlay.js is keyed by keyFor(); a merged tile whose
key changes each time a member lands or drops will read as a brand-new landing, re-firing the
land glow and 'on land' sound repeatedly - and the per-buff Remove / "Don't track here" buttons
in the main window lose their one-to-one target.

**Touches:**
- `src/renderer/overlay/overlay.js:490 visibleBuffs() - new combine step after filtering/sorting`
- `src/renderer/overlay/overlay.js:128 keyFor() - a merged tile needs its own stable identity key`
- `src/renderer/overlay/overlay.js:235 buildListRow() / :303 buildIconTile() / :456 updateRef() - count badge element + lowest-remaining text`
- `src/renderer/overlay/overlay.js:576-673 tileRefs / landedNames / shownNames / warnedAt / lastRemainingSec bookkeeping in render()`
- `src/renderer/overlay/overlay.css - badge styling`
- `src/main/widgetStore.js:17 defaultSelfBuffsWidget, :124 defaultCustomWidget, :237 SHAREABLE_FIELDS, :291 normalizeWidget - new boolean field`
- `src/main/widgetManager.js:610 (setter, mirroring setWrapText)`
- `src/main/main.js:493 (ipcMain handler)`

#### #9 — Let a custom aura's timer fire on a combination of triggers (any-of / all-of), not just one trigger line

`feature` · `needs-design` (needs a decision first)

These are two very different jobs and worth splitting. OR is small and self-contained:
triggerText becomes a list and _findTriggerMatches matches any of them. AND is the part that
cannot be estimated yet - your note doesn't say over what window both triggers must fire,
whether anything shows on screen while waiting for the second, or whether an unmatched half ever
expires. Your own later note agrees ("AND/OR TRIGGERS MULTI TRIGGER AURAS SHOULD PROBABLY BE
IT'S OWN CUSTOM CATAGORY? ... not execute now"). Also worth knowing before designing: the
matcher today compares the whole log line for exact equality (case-insensitively), so there is
no "line contains" trigger yet, and an AND can never be satisfied by a single line.

**Risk:** Changing the stored trigger shape touches every custom timer already saved in
widgets.json; a timer that half-migrates silently stops matching, and there is no way to rebuild
a user's timers if that happens.

**Touches:**
- `src/main/customTimerEngine.js:53 _findTriggerMatches() - currently exact full-line equality against a single triggerText`
- `src/main/customTimerEngine.js:72 handleLine() + new pending-condition state and its expiry in :136 _tick()`
- `src/main/widgetStore.js:446 addCustomTimer / :475 updateCustomTimer - the stored timer shape ({triggerText} -> a list plus an operator)`
- `src/renderer/main-window/main-window.js:874 TRIGGER_TYPES, :2134 readTimerFormData, :1597 resetTimerForm, :1625 populateTimerForm`
- `src/renderer/main-window/index.html:1062-1176 custom timer modal markup`

#### #10 — Let one custom trigger run a duration and then roll straight into a cooldown countdown, with the cooldown behind a toggle that opens its own duration fields

`feature` · `medium` (about a day)

Much easier than it sounds on the engine side - the entries already store an absolute expiresAt,
so a phase field plus a transition in _tick is roughly 30 lines, and the restart snapshot keeps
working for free. The cost is the form and the display: if the tile doesn't visibly say which
phase it is in, the number on screen is actively misleading. Cheapest useful version is one
extra "then count down N" field with the tile dimmed during cooldown; the "toggle that opens a
menu" wording implies a sub-panel, which is the more expensive half. This is the same item as
FEATURES.md's "Cooldown mode for custom trackers", where you had already asked whether one
mechanism should cover both this and reverse/negative detection - that question is still open
and is worth answering before either gets built.

**Risk:** handleLine unconditionally overwrites an active entry when the trigger text is seen
again (customTimerEngine.js:101), so without an explicit rule the same line that started the
ability would silently reset its cooldown. Snapshot restore also needs the phase field to ride
along or a restart resurrects a cooldown as if it were the buff still running.

**Touches:**
- `src/main/customTimerEngine.js:101-109 handleLine activation (add a phase to the stored entry)`
- `src/main/customTimerEngine.js:136 _tick() - expire currently deletes; it needs to transition duration -> cooldown instead`
- `src/main/customTimerEngine.js:164 getActive() - expose the phase so the tile can show which countdown it is`
- `src/main/customTimerEngine.js:115 getSnapshotState / :122 restoreSnapshot`
- `src/main/widgetStore.js:446 addCustomTimer / :475 updateCustomTimer - new cooldownSec field`
- `src/renderer/main-window/index.html:1084-1096 (duration row) and the trigger modal below it - toggle + cooldown fields`
- `src/renderer/main-window/main-window.js:2134 readTimerFormData, :1597 resetTimerForm, :1625 populateTimerForm`
- `src/renderer/overlay/overlay.js:456 updateRef() - visual distinction between the two phases`

#### #11 — Track AoE mez per mob: start each timer from the land line (never the cast), take the duration from whichever Mesmerization rank was cast in the last ~4 seconds, and match names case-insensitively

`core-feature` · `large` (several days)  · **blocked**

**Blocked:** Needs a real log sample of the mez lines from EQ Legends - the exact land,
resist, worn-off and slain wording. Detection is exact-text matching and none of these lines
exist anywhere in the code today; Mesmerization is not in buffs.json at all (I checked all
11,337 entries).

Your rank-to-duration table (30/36/36/40) has nowhere to live right now - there is no per-spell
rank or tier field anywhere in the app, and duration has exactly one global multiplier plus a
per-buff opt-out. So this needs its own small table, or the new EQL spreadsheet from your
PRIORITY FIX note. Also decide whether the global duration multiplier should apply at all to a
debuff on a mob (I would say no). On casing: you are right that it matters - the mob name sits
at sentence start on the land line, so match lowercased and display whatever casing you saw at
land time. Mobs sharing a name genuinely cannot be told apart, which your note already accepts,
so track a list of instances per name rather than a map keyed by name - that also gives you the
"two lands means two bats" counting you wanted elsewhere. Two scoping notes: the RESIST flash
from your fuller mez spec is not in this note and needs the text-only aura type, which doesn't
exist yet; and I would build this as its own mobDebuffEngine.js alongside customTimerEngine.js
rather than as new tiers inside buffEngine.handleLine, because the P0 detection rework is going
to restructure that chain and anything added there now gets rewritten.

**Risk:** This is the app's most regression-prone area. "You begin casting Mesmerization V."
already creates a pending self-cast that the buff engine will try to resolve against the player
(no roster entry, so it falls into the unknown-buff list or a timeout path), and a resist line
is shaped exactly like the existing FAILURE_PATTERNS that cancel pending casts. Any new tier
dropped into handleLine's first-match-wins chain can also consume a line a later tier needed.

**Touches:**
- `src/main/buffParser.js:15-55 (new patterns for the land / resist / worn-off / slain lines) and :91-104 FAILURE_PATTERNS, which already swallows resist-shaped lines`
- `src/main/buffEngine.js:303 handleLine() - a new detection path, or better a separate engine`
- `src/main/buffEngine.js:84-205 constructor state, :877 _land / :897 _landOnAlly (the pattern a mob-debuff land would mirror), :1185 getSnapshotState / :1199 restoreSnapshot`
- `src/main/main.js:180 line routing to engines, ~:490-580 ipcMain handlers`
- `src/preload/preload-overlay.js and src/renderer/overlay/overlay.js:797 currentSourceBuffs() - a new buff source`
- `src/main/widgetStore.js:160 buffSource field and :307 normalizeWidget's buffSource fallback`

#### #12 — Show mez as a single consolidated tile - the mob breaking soonest, a count, and the mob name ("12.4  x6  a greater kobold") - yellow, turning red at 8 seconds, with per-mob state tracked internally but never displayed as separate rows

`feature` · `medium` (about a day)

The colour half is nearly free and already exists: set the aura's timer text colour to yellow
and its low-time threshold to 8, and you get exactly "yellow, red at <=8s" - the red is a
reserved warning colour that deliberately cannot be themed away. So the only genuinely new work
is the consolidation and the tenths, and if you can live with whole seconds this drops to small.
Your reasoning about per-mob rows being false precision matches a constraint the app already
documents, and it is the right call - keep tracking mobs individually for the count, just don't
render them. The "x6" badge should be the same component built for note 8.

**Risk:** The tenths are the expensive part: every engine rounds to whole seconds and broadcasts
once a second (customTimerEngine.js:173, buffEngine's tick), so "12.4" means either sending
expiresAt to the overlay and ticking locally at ~100ms, or broadcasting ten times as often for
every aura - the latter multiplies the overlay's per-second work across every open window.

**Touches:**
- `src/renderer/overlay/overlay.js:490 visibleBuffs() and :623 render() - consolidation into one tile`
- `src/renderer/overlay/overlay.js:157 formatTime() - a tenths format`
- `src/renderer/overlay/overlay.js:456 updateRef() and :380-408 applyTilePositionedTextStyle() - the reserved low-time colour is hardcoded #ff8080 there`
- `src/renderer/overlay/overlay.js:235 buildListRow / :303 buildIconTile - count badge (shared with note 8)`
- `whichever engine note 11 lands in - the payload would need expiresAt, not just whole-second remainingSec`

**Needs first:** #11

#### #13 — Make the main window's left sidebar resizable by dragging its edge

`qol` · `small` (a few hours)

Easier than most things on this list. The drag itself is well under an hour. The only thing that
makes it more than trivial is remembering the width between launches: the renderer uses no
browser-local storage anywhere, every preference goes through the main-process JSON store, so
persisting it costs one more IPC pair. Worth deciding at the same time whether long aura names
in the submenu should ellipsize or wrap once the bar gets narrow.

**Risk:** Low - overlay windows are untouched. The only real failure is a saved width that
leaves the nav unusable, so clamp it to a sensible min and max.

**Touches:**
- `src/renderer/main-window/index.html:49-63 (sidebar markup, add a drag handle)`
- `src/renderer/main-window/main-window.css:271-280 .sidebar (fixed width:190px) and :65-69 .app-body`
- `src/renderer/main-window/main-window.css:350 .nav-sub-name (aura names in the submenu at narrow widths)`
- `src/renderer/main-window/main-window.js (new drag handler)`
- `for persistence: src/main/main.js + src/preload/preload-main.js (one ipc pair, following the setWrapText pattern at main.js:493 / preload-main.js:141), or the saved-bounds pattern in src/main/mainWindow.js:15,75-85`

#### #14 — Premade "buff timer" aura: pick a spell from a dropdown and whether it's cast on you or on an ally, and have the aura built for you - and add it to the premade aura list

`core-feature` · `medium` (about a day)

No new detection at all - "self buff on one named spell" and "ally buff on one named spell" are
both already fully supported aura configurations. This is purely a guided way to create one,
which is why it is worth doing. The cost is that every premade entry today is a one-line
create(name) with no configuration step, so this adds the first premade that asks a question
first. A literal dropdown won't work over 11,337 roster entries - reuse the existing searchable,
capped buff list instead. Two cheap wins: adding it as a disabled "Planned" entry in the premade
list right now is a five-minute change if you want it visible before it's built; and building
the picker generically means your premade cooldown timer and premade enemy-debuff timer notes
reuse it instead of each growing their own. This note is also the narrower version of your later
note about a premade buff/debuff flow that asks for the skill and then asks self-or-ally - same
feature, so build it that shape.

**Risk:** Ally tracking only fires for spells whose roster entry carries third-person landing
text, so offering "cast on an ally" for a spell that has none produces an aura that silently
never lights up - the picker should filter or warn rather than offer every spell equally.

**Touches:**
- `src/renderer/main-window/main-window.js:1801 PREMADE_WIDGETS and :1814 PLANNED_PREMADE_WIDGETS`
- `src/renderer/main-window/main-window.js:1829 renderPremadeList(), :1895 modal panel switcher, :1910 addWidget()`
- `src/renderer/main-window/main-window.js:1717 applyBuffFilterSearch / :1727 renderBuffFilterList - the searchable spell list to reuse`
- `src/renderer/main-window/index.html:1001-1060 add-aura modal (new panel markup)`
- `src/main/widgetStore.js:422 create() and src/main/widgetManager.js - optionally a create-with-config call so the new aura isn't built by four chained IPC round trips`

#### #15 — Premade "spell cooldown" aura: pick a skill from a dropdown and get a recast/cooldown countdown, plus a placeholder entry for it in the Add Aura premade list

`core-feature` · `medium` (about a day)  · **blocked**

**Blocked:** Per-spell recast/reuse seconds do not exist anywhere in this project. I checked:
buffs.json has no cooldown field at all, and in 'new spell roster to be added.xlsx' the
"reuse" column (L) is empty on all 1052 rows, as are "landed on you", "landed on other" and
"SPell faded". The game's own spells_us.txt probably carries a recast field, but its position
is unverified and this project's rule (CLAUDE.md, gameSpellData.js:15-26) is to verify a field
position empirically against the real file rather than trust a schema doc. Someone needs to
either mine and verify that field, or fill in column L.

The two halves of this note have wildly different costs and should be split. The "add to premade
placeholder" half is genuinely trivial - one object literal in PLANNED_PREMADE_WIDGETS (main-
window.js:1814) and it shows in the app today; the same is true for notes 16, 19 and 20, so all
four placeholders could ship in one sitting for well under an hour total. The working feature is
the part that is blocked. The trap is that "just give a drop down for skill" reads as pure UI,
but the app has no idea what any spell's cooldown is - the dropdown would be a list of names
with nothing to count down. Two ways out worth deciding between: (a) let the dropdown fill in
the name/trigger and have you type the cooldown once per spell, which the app then remembers -
shippable this week with no data work at all, or (b) do the spells_us.txt recast-field
verification first. Also: the dropdown must NOT be the full roster - that is 11,337 entries.
spellbookService already parses your character's actual scribed spells (usually a few dozen),
which is a far better list and costs nothing extra. Two other notes of yours overlap this and
should be built once, not three times: "GLOBAL RECOVERY TIME PREMADE MODULE" and "triggers that
have both a cooldown and a duration". Last thing: the scaling sheet says Reuse drops 2% per mote
tier, so once base cooldowns exist the displayed number still has to move with the roman numeral
in the cast line.

**Risk:** Cooldown triggers need to match "You begin casting Mesmerization V." where the rank
numeral varies, so the engine needs prefix/pattern matching.
customTimerEngine._findTriggerMatches currently does strict whole-line equality - if that is
loosened globally rather than opted into per timer, every existing custom timer starts firing on
lines it never used to match.

**Touches:**
- `src/renderer/main-window/main-window.js:1801-1810 (PREMADE_WIDGETS - the real entry)`
- `src/renderer/main-window/main-window.js:1814-1827 (PLANNED_PREMADE_WIDGETS - the placeholder half)`
- `src/renderer/main-window/index.html:1008 (add-widget choices) and :1062-1103 (custom timer modal, for the new spell-picker panel)`
- `src/main/customTimerEngine.js:53-70 (_findTriggerMatches - today it is exact whole-line equality, a cooldown trigger needs prefix matching)`
- `src/main/customTimerEngine.js:72-111,164-181`
- `src/main/widgetStore.js:124-207 (defaultCustomWidget) and :446-490 (addCustomTimer/updateCustomTimer - a cooldownSec field)`
- `src/main/buffParser.js:15,154 (CAST_BEGIN_PATTERN / matchCastBegin) and :129-152 (stripRankSuffix / rankValue)`
- `src/main/spellbookService.js:62-89 (the only sane source for the dropdown's spell list)`

#### #16 — Premade "debuff on an enemy" aura (mez, malo, slow, etc.) that shows every debuff currently active on each mob the way Ally Buffs shows every buff on each ally, with a text alert when the target resists, plus an optional toggle to also track debuffs an ally applied (for boss debuffing), and a placeholder entry in the Add Aura premade list

`core-feature` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** The "also count an ally's debuff" toggle needs a decision from you before it can
be built at all - see notes. Separately, the detrimental-spell mine needs the EQ install's
spells_us.txt / spells_us_str.txt, which I could not reach from here (your logs are on the
Desktop but the game folder is not under C:/Users/Lindsey).

The honest headline: this is much bigger than it looks, and the reason is data, not code. The
roster is beneficial spells only - I checked all 11,337 entries and there are zero detrimental
ones: no Mesmerization, no Malo, no Slow, no Cripple. There is also no "landed on your enemy"
text field anywhere; the roster has landingText (on you) and othersLandingSuffix (on a
groupmate) and that is it. The new spreadsheet does have 327 detrimental spells with categories,
which is a real head start, but its "landed on other" and "SPell faded" columns are empty on
every row, so the text still has to be mined from the game's string table and the field position
verified empirically the way the icon field was. The good news, and it is genuinely good: your
instinct that debuffs are "similar to ally buffs" is exactly right at the code level. buffEngine
already keys ally buffs as ally-name plus spell-name and renders them grouped by person with a
heading - swapping ally for mob reuses that whole shape including the group-by-heading settings.
So the engine work is a variation on something that already works, not a new invention. The part
that actually needs a decision from you is the ally toggle. The mob's landing line does not say
who cast it - "a greater kobold has been mesmerized." is identical whether you or your chanter
did it. The only way to attribute it is to correlate a nearby "<Ally> begins casting
Mesmerization." line, which is a guess, and this project has a hard no-guessing rule baked into
the detection engine. So: are you willing to accept a best-effort guess for the ally case
(useful for boss debuffing, occasionally wrong), or should the aura only ever show debuffs it is
certain you applied? That answer changes the design, so I have not estimated past it. I did
confirm from your real logs that the raw material is all there and correctly worded: "A vis
ghoul knight resisted your Denon's Dissension!" (note the trailing exclamation mark, and the
spell name can carry a rank numeral - "resisted your Plague III"), "Your Quickness spell has
worn off of Avenrae.", and both "A shin ghoul knight has been slain by Onomar!" and "You have
slain a lizard protector!". So no new log samples are needed from you for this - I have them.
The placeholder half of this note is trivial and can ship today independently.

**Risk:** This adds a third buff source to a data model that has had exactly two, and CLAUDE.md
gotcha #13 warns explicitly that any new source must be checked for name collisions in
overlay.js's keyFor. Here collisions are guaranteed rather than possible - two mobs called "a
shin ghoul knight" is the normal case, not the edge case - so a mob-keyed map will silently
merge or overwrite entries unless each mez gets its own synthetic instance id.

**Touches:**
- `src/shared/data/buffs.json (the roster itself - it is beneficial-only today)`
- `src/main/buffStore.js:8 (STARTER_VERSION) and its lookup indexes / one-shot migrations`
- `src/main/gameSpellData.js:24-37,96-104 (spells_us_str.txt field map - field 3 is landed-on-me, field 5 is wore-off; the landed-on-*other* field is not identified yet)`
- `src/main/buffEngine.js:205 (allyBuffs), :303 (handleLine), :430-470 (the ally landing tiers), :897-911 (_landOnAlly), :1263-1281 (getActiveAllyBuffs) - the debuff path is structurally this, keyed by mob instead of ally`
- `src/main/buffParser.js:33 (matchOtherCastBegin) and :233 (a new matchResist / matchDebuffWornOff / matchSlain)`
- `src/main/widgetStore.js:155-165 (buffSource), :86-94 (groupAllyBuffs family, which generalises to group-by-mob), :237-276 (SHAREABLE_FIELDS), :291-347 (normalizeWidget)`
- `src/renderer/overlay/overlay.js:128 (keyFor), :490-514 (visibleBuffs), :797-801 (currentSourceBuffs)`
- `src/main/main.js:204-210,264 (broadcast channels), :456-524 (widget IPC)`

#### #17 — Build the Mesmerization aura as the first worked example of the enemy-debuff system: remember the rank from the cast line but start no timer, start a per-mob timer when the mob is mesmerized, flash a red RESIST message for about 1.4 seconds when a mob resists, and clear a mob when the mez wears off or the mob dies

`feature` · `large` (several days)  · **blocked**

**Blocked:** The red RESIST flash needs the "text only aura" display mode from your other note
(fixed text, no countdown, with a timed on-screen duration) - that mode does not exist and
every render path in overlay.js today is driven by remainingSec. Nothing else here is blocked:
I confirmed every log line you listed against your real logs.

Every line you listed checks out against your real logs, with two corrections. "<mob> has been
slain" is never the actual wording - the real line is "A shin ghoul knight has been slain by
Onomar!" when someone else lands the kill and "You have slain a lizard protector!" when you do,
so that is two patterns, not one. And the resist line ends in an exclamation mark: "A vis ghoul
knight resisted your Denon's Dissension!". On duration, there is a discrepancy worth resolving
before anyone codes it. You gave 30 / 36 / 36 / 40s for Mesmerization, II, III and V. The new
spreadsheet lists Mesmerization's base duration as 24s and its scaling sheet puts mez at +10%
duration per mote tier, which does not reproduce your numbers from that base (24 to 30 is +25%).
The spreadsheet itself warns the upgrade numbers are reverse-engineered from community tooltips
and unverified. So your measured table is the authority here - hardcode it for this premade
rather than computing it, and treat the general rank-to-duration formula (backlog #13) as a
separate unsolved problem this feature deliberately steps around. That is a good thing: it means
this can ship without waiting on #13. One place I had to interpret you, and it matters: note 17
on its own reads as one timer per mob, but elsewhere in FEATURES.md you specified the opposite
for exactly this case - one consolidated countdown showing the mob breaking soonest plus a
count, like "12.4 x6 a greater kobold", yellow, red at 8s or less, tracking mobs individually
behind the scenes because per-mob rows are false precision when mobs share a name. I have
carried that forward as the intended display, because it is the more considered version of the
same request and it is what makes note 18 useful. It is also a tile shape nothing in overlay.js
draws today, which is part of why this is large. You could build this as a standalone hardcoded
mez tracker without doing note 16 first, and it would be quicker. I would not: it is the same
mistake CLAUDE.md already flags for the custom-timer trigger types, where building the
individual features before the system they hang off meant redoing them.

**Risk:** Mez durations are exact and short, and the app applies a single GLOBAL duration
multiplier to everything (your 65% Reinforcement/Exaltation). If the mez timer goes through the
normal duration path it will be silently inflated by that multiplier and read long - which on a
mez is the difference between recasting in time and getting hit. The per-buff noDurationScaling
opt-out is the existing escape hatch and must be set, or the mez path must bypass
_scaledDuration entirely.

**Touches:**
- `src/main/buffParser.js:15,154 (matchCastBegin, already handles the cast line), :141-152 (rankValue), :233 (exports for new matchers: mez landing, resist, worn-off-of, slain)`
- `src/main/buffEngine.js:303 (handleLine tier chain), :897-911 (_landOnAlly as the template for a per-mob land), :1121-1140 (_tick), :1188-1211 (snapshot/restore)`
- `src/main/sessionSnapshot.js:1-72 (mez state has to survive a restart the same way ally buffs do)`
- `src/renderer/overlay/overlay.js:235 (buildListRow), :303 (buildIconTile), :456-482 (updateRef - remainingSec-driven today), :623 (render)`
- `src/main/widgetStore.js:124-207 (a mez/debuff widget kind and its defaults)`
- `src/renderer/main-window/main-window.js:1801-1810 (premade entry)`
- `src/main/main.js:204-210 (a new broadcast channel)`

**Needs first:** #16

#### #18 — For AoE debuffs, use the fact that mobs sharing a name produce one success or resist line each to count how many of them were actually affected - two "a bat" mez landings proves there are two bats in the fight

`feature` · `small` (a few hours)

This is a genuinely clever read of the log and it is correct - the game really does emit one
line per affected mob, so counting them is sound inference, not a guess. It is also cheap once
note 17 exists: the landings are already arriving one per mob, so counting them per name inside
the existing burst window is a small amount of code, and the "xN" display is already part of the
consolidated-tile design you specified for mez. The honest caveat is about what the number means
over time rather than at the moment of the cast. At cast time it is trustworthy. After that,
three things erode it: a mob that resists and is then re-mezzed produces two landing lines and
looks like two mobs; expiry and death lines do not identify which instance ended; and a mez
broken early by damage may produce no line at all. So treat it as "at least this many, as of the
last cast" rather than a live census. That matches how you already described it - individual
tracking behind the scenes, one number on screen - so I do not think this changes what you want,
it just sets expectations for what the number can promise. Worth noting this also generalises
beyond mez for free: the same counting works for any AoE detrimental (an AoE slow, an AoE
snare), so it should be built into the debuff engine rather than into the mez premade
specifically.

**Risk:** The count can only ever go up reliably. When one of six mezzes ends, the log line
"Your Mesmerization spell has worn off of a greater kobold." does not say which of the six it
was, and neither does the slain line - so decrementing is a heuristic (drop the soonest-expiring
instance) and the count can drift away from reality during a long fight.

**Touches:**
- `src/main/buffEngine.js (the mez/debuff landing handler added by note 17 - counting per name within the cast burst)`
- `src/main/buffParser.js:20-31 (BURST_WINDOW_MS is the existing precedent for "these lines all belong to one action")`
- `src/renderer/overlay/overlay.js:199-214 (displayName) and :456-482 (updateRef) - the "xN" suffix on the tile`

**Needs first:** #17

#### #19 — Damage parser premade aura, plus a placeholder entry for it in the Add Aura premade list

`feature` · `needs-design` (needs a decision first)

I have marked this needs-design rather than guessing a number, because the one line of the note
leaves the three decisions that determine the size completely open, and any estimate before they
are answered would be fiction. Those decisions are: what does it show (a running total, damage
per second for the current fight, a per-target breakdown, a top-three list of who is doing
what), what counts as a fight starting and ending (this is the classic hard part of every EQ
parser - a timeout since the last damage line is the usual answer and it is always somewhat
wrong), and whose damage counts (the log records everyone in range, so your damage, your pet's,
and your whole group's are all sitting in the same file). On feasibility, the raw material is
definitely there. I pulled these straight out of your logs: "You crush a wan ghoul knight for 60
points of damage.", "A wan ghoul knight has taken 147 damage from your Curse." for damage over
time, and "A shin ghoul knight is pierced by Onomar's thorns for 17 points of non-melee damage."
for damage shields. So no log samples are needed from you. What is not enumerated yet is the
long tail - misses, ripostes, critical wording, pet attribution, other players' spell damage -
and a parser that silently drops a third of the damage is worse than none. The part that makes
this genuinely different from everything else in the app, and the reason I would not fold it
into the aura system: every aura today is a countdown tile - it has a name, an icon, a duration
and a remaining time, and the whole render path is built around remainingSec. A damage readout
has none of those. It is numbers that change, with no expiry. That is a new display category,
the same way you already identified the "You Have Been Dispelled" notification as a new
category. Realistically this is closer in size to the action-bar-cover work than to any other
premade in your list. You also already spotted the key limitation yourself in your detection-
order notes - unique landing text is a buff signal and does nothing for a damage parser. That is
right, and it means this shares almost no machinery with the existing engine. The placeholder
half is trivial and can ship today, decoupled from all of the above.

**Risk:** Nothing existing breaks - this is additive and touches no detection tier. The risk is
scope: it is a second parser sitting alongside the buff engine, reading the same log lines for a
completely different purpose, and it will need its own tests rather than riding on the buff
engine's.

**Touches:**
- `src/main/buffParser.js:233 (a new family of damage matchers - melee, damage-over-time, damage shield, misses, criticals)`
- `a new src/main/damageEngine.js (fight boundaries and aggregation - none of the existing engines model this)`
- `src/renderer/overlay/overlay.js:235,303,456-482,490-514 (every render path is remainingSec-driven and filters by buff name; a damage table is neither)`
- `src/main/widgetStore.js:155-165 (buffSource) and :124-207`
- `src/main/main.js:204-210 (broadcast), :456-524 (widget IPC)`
- `src/renderer/main-window/main-window.js:1814-1827 (the placeholder, which is the trivial part)`

#### #20 — Travel guide premade aura that knows which travel spells you have scribed and shows the shortest route to where you want to go, plus a placeholder entry in the Add Aura premade list

`feature` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** A zone-connectivity map plus a table of which travel spell lands you in which
zone. Neither exists in the app, in buffs.json, or in the new spreadsheet (which has no
destination column at all), and because EverQuest Legends is a custom server the standard
live-EQ zone layout cannot be assumed to be correct. Someone has to source or build that
dataset before routing is possible.

Two halves again, and they are very unevenly matched. "Track spellbook spells" is nearly free:
spellbookService already reads your character's <Name>-<Class>-Spellbook.txt and reloads it
every 30 seconds, so listing which ports and teleports you actually have is a small piece of
work on top of code that already runs. Zone awareness is also cheap - I confirmed "You have
entered The Ruins of Old Guk." appears verbatim in your logs, which incidentally also unblocks
the Zone change custom-timer trigger that is currently shipped as a disabled Planned entry, and
your separate "only apply an aura when in a specific zone" idea. "Shortest route" is the
expensive half, and it is expensive for a reason that has nothing to do with code difficulty:
the app has no idea how zones connect to each other or where any port spell goes. That is a few
hundred zones of world knowledge that has to come from somewhere, and on a custom server it
cannot safely be copied from live EQ. There is also a shape problem I want to flag rather than
quietly design around. Auras are transparent, click-through, always-on-top windows with no input
- that is deliberate, it is what makes them safe to leave on screen while playing. A route
planner needs you to tell it where you want to go, which an aura cannot accept. So either this
is not an aura at all but a page in the main window (my reading of what would actually be
usable), or it is an aura that only ever shows a single fixed thing - for example "the ports you
can cast from where you are standing right now" - which is genuinely useful, needs no routing at
all, and would be small. I did not want to pick between those for you, because they are
different features and I would rather ask than narrow your request.

**Risk:** Low risk to anything existing - this reads data and touches no detection tier or saved
widget state.

**Touches:**
- `src/main/spellbookService.js:62-89 (already parses your scribed spells - the "track spellbook spells" half is largely done)`
- `src/main/buffParser.js:233 (a zone matcher - "You have entered <Zone>.")`
- `a new zone-graph / port-destination data file under src/shared/data/`
- `src/renderer/main-window/ (this probably belongs here, not in an aura - see notes)`
- `src/renderer/main-window/main-window.js:1814-1827 (the placeholder)`

#### #21 — An in-game aura showing which loadout profile is currently active, appearing automatically once a second profile is created, and able to be switched off - built on the text-only aura feature

`qol` · `small` (a few hours)  · **blocked**

**Blocked:** The "text only aura" display mode from your other note - specifically its
"always" on-screen option. This aura is a permanent static string with no countdown, and every
render path in overlay.js today is driven by remainingSec, so there is nothing to build on
until that mode exists.

This is the cheapest thing in my batch and the one I would ship first once text-only auras
exist. Almost everything it needs is already built: profileStore knows the active profile and
its name, and main.js already broadcasts profiles:activeChanged and profiles:changed to every
window on every switch, so the aura updating itself is essentially free - it just listens to a
channel that already fires. One ambiguity I had to interpret. "Should become auto displayed when
a second profile is created" could mean it is created at that moment, or that a pre-existing
hidden one is switched on. I read it as created at that moment, since with one profile it has
nothing to say. I would strongly suggest making that a one-time event, version-gated the way
widgets.json's v1-to-v2 bard-song migration already is - otherwise if you delete this aura
because you decided you did not want it, it will silently reappear the next time you add a
profile, and you will have to delete it again forever. "Can be toggled off" needs no new
machinery at all: unticking every profile in the aura's own settings is already how you switch
an aura off, so it comes free with the existing model rather than needing a dedicated checkbox.
Worth confirming that is what you meant, though - if you wanted a one-click toggle sitting next
to the profile chips in the main window instead, that is a slightly different and slightly
larger ask. One thing to decide when building it: whether it shows the profile name on every
profile including the default. Showing "Default" permanently may be noise, but hiding it means
the aura vanishing is itself the signal, which is easy to misread as a bug.

**Risk:** An aura's visibility IS its profile membership - so this one has to be a member of
every profile, including every profile created in future. Miss that and it disappears the moment
you switch to the new profile, which is exactly the situation it was created to help with. Auto-
adding it in the profiles:create handler is the fix, and it needs to be deliberate rather than
assumed.

**Touches:**
- `src/main/main.js:528-542 (profiles:create - the auto-create hook), :548-560 (profiles:setActive, already broadcasts profiles:activeChanged)`
- `src/main/profileStore.js:41-58 (getAll / getActiveId - the data is already there)`
- `src/main/widgetStore.js:124-207 (a new widget kind) and :368-398 (version-gated one-shot, the precedent for "do this exactly once")`
- `src/main/widgetManager.js:58-62 (isVisibleForActiveProfile) and :377 (applyProfileVisibility)`
- `src/renderer/overlay/overlay.js:623 (render), :797-801 (currentSourceBuffs), :814 (applyConfig)`
- `src/preload/preload-overlay.js`

#### #22 — Show the "All auras" master controls (Unlock all auras) only on the Overlay Auras master page, not on top of every individual aura's settings page

`qol` · `trivial` (under an hour)

Confirmed the cause: the aura settings panel lives inside the same #page-overlay section as the
master card, and selectWidget() only hides introCard and iconSetCard - so the "All auras" card
stays on screen above every individual aura's settings. One ambiguity I had to interpret: that
card also holds the two auto-hide checkboxes ("Hide auras when EverQuest isn't the focused
window" / "Also show them while this app is the focused window"). Those are master-scope too, so
I've assumed you want the whole card hidden. If you only meant the Unlock all button, it is the
same edit on a smaller wrapper - say which. Worth batching with your other unlock notes (6:
unlocking all should show each aura's name and click through to its options; 31: unlock-to-move
should show an aura even when its profile has it toggled off), since all three land in the same
two functions.

**Risk:** Almost nothing can break - it is one more display toggle on a card that already has
two. The only real failure mode is forgetting the deselectWidget half, which would leave the
card hidden after you delete or deselect an aura until the page is reloaded.

**Touches:**
- `src/renderer/main-window/index.html:169-201 - the unnamed <div class="card"> holding "All auras"; it needs an id (e.g. all-auras-card)`
- `src/renderer/main-window/main-window.js:1399-1400 selectWidget() - hide it here, alongside the existing introCard/iconSetCard hides`
- `src/renderer/main-window/main-window.js:1363-1364 deselectWidget() - show it again here`
- `src/renderer/main-window/main-window.js:933+ initWidgetsPanel() - one more getElementById`

#### #23 — Add a third display style, "Text only", alongside List and Icons - with its own text-size slider allowed to go much larger than list/icon text, and a choice of how long the text stays on screen after it triggers: always, for a set time, or until a closing text is seen

`core-feature` · `large` (several days)

This is two features with very different price tags, and it is worth knowing which half the time
goes into. Drawing big text is genuinely small - a new branch in render() plus one sizing
branch. The "how long it stays up" choice is the expensive half and the reason I've called this
large: every tile the app draws today is owned by a countdown, so "always" and "until the
closing text" are new lifetime rules in the engines, not a display setting. Two places I had to
interpret, both worth confirming before anyone starts: (1) "allowed to be much much bigger" -
I've assumed text-only gets its OWN size field. The existing text-size slider is capped at 28px
and is shared with list and icon mode, so raising that cap would also let list rows go to 200px.
(2) "after trigger" and "set closing text" are custom-timer language. I've assumed a text-only
aura can still be fed from any source (self buffs, ally buffs, custom timers) and shows the
name; if you only ever want it on custom timers, that removes a chunk of work. This one is a
dependency for other notes rather than depending on anything: note 21 (the in-game current-
profile overlay) and note 17 (the mez "RESIST" flash) both say outright that they need the text-
only aura. Building those first would mean building them twice.

**Risk:** widgetManager.setDisplayMode() forces any value that isn't 'icons' to 'list', so a
partly-wired third mode silently reverts to List with no error. Separately, the "always" option
puts entries into the engines that no tick ever removes - both engines currently assume every
active entry eventually expires, and the 5-minute session-snapshot restore filters on expiresAt,
so a never-expiring tile needs a deliberate answer there rather than falling through.

**Touches:**
- `src/renderer/overlay/overlay.js:623-786 render() - a third branch beside buildListRow/buildIconTile`
- `src/renderer/overlay/overlay.js:814-925 applyConfig() - the icons/list sizing fork has no third arm`
- `src/main/widgetManager.js:90-92 minHeightFor(), :94-99 createWidgetWindow() sizing`
- `src/main/widgetManager.js:456 setDisplayMode() - currently coerces anything that isn't 'icons' to 'list'`
- `src/main/widgetStore.js:17-122 and :124-207 (new fields), :291-347 normalizeWidget(), :237-276 SHAREABLE_FIELDS`
- `src/renderer/main-window/index.html:250-254 display-style radios, :294-348 mode-specific setting groups, :372-414 Timer text topic`
- `src/renderer/main-window/main-window.js:1370-1377 updateIconOnlyVisibility(), :1413 and :1464 selectWidget(), :1947 display-mode radio handler`
- `src/main/customTimerEngine.js:101-111 and :136-145 - a timer that never expires on its own`

#### #24 — Rework spell detection into the stated priority order - and add a new post-cast check that waits to see whether an ambiguous landing text repeats on the next song pulse, resolving buff-vs-bard-song automatically instead of asking, with the popup showing a countdown to the next check

`core-feature` · `large` (several days)  · **blocked**

**Blocked:** Needs a real log sample of an ambiguous bard-song landing text repeating - e.g.
Cassindra's Chant of Clarity's "Your mind clears." - to confirm the game re-prints the landing
text on every song pulse and that the interval really is 6 seconds. The entire new check rests
on that assumption and cannot be built on it unverified.

Three things in your order are real changes to what the code does today, not restatements of it,
and they are the valuable part: (1) "every check if not passed should continue, not end" -
correct, and it is exactly buffEngine.js:592-601, where a tier that matches on text but fails a
confidence check still consumes the line so no later tier can rescue it. (2) /outputfile spells
BEFORE memmed spells. The code currently does the opposite (memorized gems are checked first, at
:653). Your reasoning - loadout swaps never say you unmemmed anything - is right and this is a
genuine reordering, not a no-op. (3) "named as cast by a specific person" - the parser already
captures the caster's name (buffParser.js:175-180) and buffEngine.js:374 throws it away, keeping
only "someone cast this" as a veto. That half is cheap to fix. The new post-cast repeat check is
the smallest and highest-value piece here and could ship on its own, ahead of the reorder: hold
an ambiguous cast whose candidates split between a bard song and a non-song, and if the same
text arrives again within one pulse, resolve to the song. Roughly a day by itself. The popup
countdown is real but small - that renderer is 39 lines today with no per-card state. One thing
your order does not cover, and it will not be fixed by reordering: the roster is missing about
37,000 spells that have landing text, which makes 351 landing texts look unique to the app when
the game shares them. "Unique landing text" is the highest-confidence auto-confirm tier, so it
is confidently wrong in 351 ways regardless of what order the tiers run in. Either note 35 (the
new spreadsheet roster) fixes that, or the cheap interim in CLAUDE.md does - build a separate
index of every landing text that is shared in the raw game data and use it purely to veto the
unique-text tier. That interim needs no roster changes and no duration decisions.

**Risk:** This rewrites the single most fragile file in the app. Every past detection regression
came from changing these tiers, and there is currently no automated test of handleLine at all -
the new test suite only covers roster shape and the userData pin - so anything that goes wrong
will only show up in live play, as a buff that quietly stops appearing.

**Touches:**
- `src/main/buffEngine.js:303-808 handleLine() - the whole ~500-line tier chain`
- `src/main/buffEngine.js:586-601 - the knownNotMemorized branch that logs IGNORED and returns instead of demoting`
- `src/main/buffEngine.js:653-662 vs :664-674 - memorized-gem narrowing currently runs BEFORE spellbook narrowing; your order reverses that`
- `src/main/buffEngine.js:372-377 - matchOtherCastBegin's casterName is discarded here`
- `src/main/buffEngine.js:1006-1028 _queueAmbiguousCast() - needs a new deferred/pending state`
- `src/main/buffParser.js:58-62 FALLBACK_CONFIRM_WINDOW_MS / BURST_WINDOW_MS`
- `src/renderer/ambiguous-popup/ambiguous-popup.js:3-36 and src/main/ambiguousPopup.js - the "checking for auto-resolution" note and countdown`
- `src/preload/preload-ambiguous-popup.js`

#### #25 — Add a disabled "Global recovery time" entry to the premade aura list as a placeholder

`qol` · `trivial` (under an hour)

Genuinely a four-line addition; the disabled/Planned rendering already exists and needs nothing.
Worth doing as one edit with the other "add placeholder" notes in the same dump - 2 (first-aggro
checker), 14 (premade buff timer), 15 (premade cooldown timer), 16 (premade enemy debuff), 19
(damage parser), 20 (travel guide). They all land in the same array. For whenever the real thing
gets built, so the placeholder text is honest: I've read "global recovery time" as the fixed
lockout after any spell cast before the next can start, not per-spell recast. Two things are
missing for it today - the app has no signal that a cast has COMPLETED (buffParser only matches
"You begin casting X."), and nobody has the server's actual recovery number. Note that the new
spell spreadsheet will not supply it: it has a "reuse" column, but that column is empty in all
1052 rows. Also worth writing down now what the aura should look like, because a roughly
1.5-second bar is a different shape from every countdown the app currently draws.

**Risk:** None. Planned entries have no create() function and render disabled - they are pure
text in a list that already handles them.

**Touches:**
- `src/renderer/main-window/main-window.js:1814-1827 PLANNED_PREMADE_WIDGETS - one new { name, description } entry`
- `src/renderer/main-window/main-window.js:1850-1867 renderPremadeList() - already renders planned entries disabled with a Planned badge, no change needed`

#### #26 — Detect when a newly landed buff overwrites one that is already running, and drop the stale timer instead of counting it down

`feature` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** Needs one raw log sample of a real overwrite - cast a stronger version of a buff
you already have running, and send the lines. That single sample decides whether this is a few
hours of work or several days, which is why I can't size it yet.

There are two completely different builds hiding behind this note, which is why I've called it
needs-design rather than guessing: Route A - the game tells us. If EverQuest Legends prints the
overwritten buff's fade message (or an explicit "has been overwritten" line) when the overwrite
happens, the app already has the machinery: _checkForEndedBuffs matches endedText and removes
the buff. Then this is a small fix, not a feature. 9,489 of the 11,337 roster entries already
carry an endedText, so coverage is decent. Route B - the game says nothing, and we have to know
which spells overwrite which. That needs stacking-line data the app does not have anywhere
today. The good news: the new spell spreadsheet does have it - column F carries 109 categories,
and they read exactly like stacking lines ("HP Buff (Line 1)", "Strength", "Haste", "Slow",
"Damage Shield"). Your own note 35 says the same thing. So Route B depends on note 35 landing
first; there is no other source for it. I have deliberately not listed 35 as a hard dependency
here because Route A needs nothing at all, and I don't want to park a possibly-cheap fix behind
a big one. Separate real bug I found while looking at this, worth fixing either way:
buffEngine.js:815-816 removes only the FIRST active buff whose endedText matches a line, then
returns. The comment says "a line only ever reports one buff fading", which is true of the line
- but 841 ended texts are shared, so if two buffs sharing "The fury fades." are both up, one of
them is left running forever. That is its own stale-timer source, independent of stacking.

**Risk:** Anything that force-removes an active buff can remove the wrong one. Ended texts are
heavily shared: of 1,720 distinct "wore off" texts in the roster, 841 are used by more than one
spell ("Your illusion fades." alone covers 328), and _checkForEddedBuffs already stops at the
first match it finds. A stacking rule layered on top of that could silently clear a buff that is
genuinely still up - and a missing timer is much harder to notice than a wrong one.

**Touches:**
- `If it turns out to be log-driven: src/main/buffEngine.js:810-818 _checkForEndedBuffs(), and :877-891 _land()`
- `If it turns out to need stacking rules: src/shared/data/buffs.json (a new stack-line/category field on every entry), src/main/buffStore.js (a new index over it), src/main/buffEngine.js:877-891 _land(), test/roster-baseline.json (the baseline numbers will move)`

#### #27 — Promote "Buffs shown" out of Configuration into its own section, sitting between Display & size and Configuration - with buff/debuff mode toggle buttons, and gem-slot pickers where each slot opens a modal to choose a buff or debuff and then displays that spell's icon, plus a "+" slot to add another. Buffs and debuffs can never share one aura; each gem is an independently tracked icon, with no and/or logic yet

`core-feature` · `large` (several days)

The move itself is genuinely trivial - lifting one topic block out of Configuration into its own
.block is markup. Nearly all the cost is the gem-slot picker and the buff/debuff split, which is
why this is large. The honest blocker on the debuff half: the word "debuff" does not appear
anywhere in the codebase. I grepped - zero hits across src, tools and test. There is no per-
spell buff/debuff flag on any roster entry, and no engine that tracks effects on an enemy at
all. So two separate things have to exist first: - The classification. The new spreadsheet does
have it: column D tags 379 spells "buff", 327 "det", 82 "pet", with 264 untagged, across 1052
EQL spells. That is note 35's import, and it is the only source for it. - Somewhere for debuffs
to come from. Showing active debuffs needs the enemy-debuff tracking from note 16, which also
carries the known limitation that the log cannot tell two mobs with the same name apart. If you
want most of this sooner, there is a clean split: the buff-only half (move the section, add gem
slots, add the picker modal, keep the existing buff roster as the source) needs neither
dependency and is roughly a day. The debuff half then lands on top once 35 and 16 exist. I've
kept both in depends_on rather than quietly re-scoping your note to buffs only, but that split
is the fastest route to the part you can actually use now. One naming thing to settle: "Buffs
shown:" is already a row label inside Display & size, used for the "your own buffs / buffs
you've cast on allies" radios. Two sections with that name will confuse. Your "no and/or
functionality yet" matches note 39, which is parked - so nothing to do there, which is good.

**Risk:** buffNames is the join between a widget's picked list and the overlay's filter, and
widgetStore.addCustomTimer (:470) rewrites it wholesale from the timer list. Changing it from a
flat name array into ordered slots with icons, without a version-gated migration, would empty
every custom aura anyone has already set up - the same class of failure the userData pin exists
to prevent.

**Touches:**
- `src/renderer/main-window/index.html:564-622 - the "Buffs shown" topic, currently a collapsible inside the Configuration block (:351-624); moves out to its own .block between :348 and :351`
- `src/renderer/main-window/index.html:245-249 - there is ALREADY a row labelled "Buffs shown:" here for the self/ally source radios; naming collision to resolve`
- `src/renderer/main-window/main-window.js:1478-1539 renderBuffFilter(), :1546-1562 renderSelectedBuffsList(), :1717-1768 applyBuffFilterSearch/renderBuffFilterList/toggleBuffFilterName`
- `src/renderer/main-window/main-window.js:2444-2501 buildIconPicker() and :334-409 the memorized gem bar - the two things to model the new picker on`
- `src/renderer/main-window/main-window.css - .gem-slot / .gem-empty styles already exist and can be reused`
- `src/main/widgetStore.js buffNames (:37, :150, :470), normalizeWidget (:291-347), SHAREABLE_FIELDS (:237-276)`
- `src/renderer/overlay/overlay.js:490-510 visibleBuffs() - the explicit-name filter that reads buffNames`

**Needs first:** #35, #16

#### #28 — Bug: the Ally Buffs aura showed Berserker Spirit on 19 Aug at 12:15 for a buff she never cast

`bug` · `small` (a few hours)  · **blocked**

**Blocked:** Needs the detection-debug.log from userData (\AppData\Roaming\EQ Buff
Tracker\detection-debug.log) covering 2026-08-19 12:15, and ideally the raw eqlog lines around
the same timestamp. The debug log records the exact decision the engine made and would
separate the two possible causes outright - the raw log alone would leave it a guess.

I can name the most likely cause from the code, but this should be confirmed against your log
before anyone changes a line - this project's history is explicit that guessed detection fixes
cause regressions. What I found: Berserker Spirit's third-person text is " lets loose a berserk
yell.", and it is unique in the roster. buffEngine.js:482-509 will land ANY line shaped
"<Name><unique suffix>" as an ally buff whenever burstUntil is in the future - with no check
that you cast anything at all. Three things make that window much wider than it looks: -
burstUntil is set by EVERY "You activate X." line (buffParser.js:25), not just Quick Buff - any
AA, discipline or clicky opens an 8-second window. - Line 502 re-extends the window by a further
8 seconds on each ally landing, so one activation can chain well past where it started. - That
path skips the recentOtherCasts veto the self-buff tiers use (:546, :626), so even an explicit
"<Name> begins casting Berserker Spirit." from someone else would not stop it. So the most
likely story is: a groupmate received Berserker Spirit from someone or something else while you
happened to be inside an activate window, and the app credited it to you. If that is what the
log shows, the fix is small and local: apply the same recentOtherCasts veto in the ally burst
path, and stop letting ally landings re-extend the burst on their own. Both are a few lines.
What it should NOT become is a gate on group membership - that was tried and silently disabled
ally tracking completely.

**Risk:** Tightening the ally burst path can switch ally tracking back off without anyone
noticing. That path is the only thing that catches an instant multi-target ability like Quick
Buff, and before it existed ally tracking had literally never fired once - so an over-correction
here quietly reintroduces a bug that took a long time to find.

**Touches:**
- `src/main/buffEngine.js:482-509 - the burst-context ally path, the only route that can land an ally buff without a named cast`
- `src/main/buffEngine.js:354-359 - where burstUntil is set from any "You activate X." line`
- `src/main/buffEngine.js:502 - the burst re-extending itself on every ally landing`
- `src/main/buffParser.js:25 ACTIVATE_PATTERN, :62 BURST_WINDOW_MS`

#### #29 — After you answer the ambiguous-cast popup, put keyboard focus straight back on the EverQuest window

`qol` · `small` (a few hours)

Cheapest fix is prevention, not cure: the popup already opens with showInactive() so it doesn't
steal focus on appear - it only steals it when you click a candidate button. Adding `focusable:
false` to the BrowserWindow at ambiguousPopup.js:24 means EQ never loses foreground in the first
place, so there is nothing to restore. That's a one-line change but it MUST be verified live: on
Windows a non-focusable window still receives mouse clicks in practice, but the drag-bar
(-webkit-app-region: drag) needs re-checking too. If clicks stop working, the fallback is an
explicit refocus - and that's genuinely fiddly, because Windows only lets the current foreground
process call SetForegroundWindow, and a spawned powershell.exe is a different process, so a
naive copy of foregroundWatcher's probe will silently fail and just flash the taskbar button.
Also note gotcha #11: this app deliberately counts its OWN process as "still the game is
focused" for auto-hide, so making the popup non-focusable will not make auras vanish while you
answer it. I read your note as being about the ambiguity popup specifically and left the widget
windows alone - the same annoyance exists when you click a widget to drag it, but that's a
separate decision.

**Risk:** If the popup is made non-focusable and Windows then stops delivering clicks to it, the
popup becomes completely unusable and every ambiguous cast goes unanswerable until it's
reverted; the fallback win32 route can grab focus at the wrong moment or just flash the taskbar
instead.

**Touches:**
- `src/main/ambiguousPopup.js:24-43 (BrowserWindow options - add focusable:false)`
- `src/main/ambiguousPopup.js:67-80 (updateVisibility / showInactive)`
- `src/renderer/ambiguous-popup/ambiguous-popup.css:30-40 (#drag-bar app-region:drag, must survive the change)`
- `fallback path only: src/main/main.js:401-405 (buffs:resolveAmbiguous / buffs:dismissAmbiguous handlers)`
- `fallback path only: src/main/foregroundWatcher.js:39-52 (the inline PowerShell P/Invoke pattern a SetForegroundWindow helper would copy)`

#### #30 — Watch the log for aura share codes people post in chat, and offer them as a pickable list under a new "Import from log" option when adding an aura

`feature` · `large` (several days)  · **blocked**

**Blocked:** Needs the owner to confirm EverQuest's real per-chat-line character limit on this
server, and that it doesn't mangle + / = characters - because measured codes are far longer
than one chat line (see notes).

Good news: the share-code format already exists and works (widgetStore.exportCode -> 'EQBT2-' +
base64 of deflated JSON), so nothing needs inventing there, and finding one in a line is a
single regex. Bad news, and this is the real cost: I generated actual codes to measure them - a
default Self Buffs aura is 74 characters, a buff aura filtered to 12 named buffs is 290, and a
custom-timer aura with 3 timers is 426. EQ chat lines are far shorter than that, so in practice
a real aura will NOT fit in one message. That means either a chunked multi-part code format
("1/3", "2/3"...) with reassembly, or a much more compact encoding - either way that is a new
format, a new decoder, and a partial-code state machine, and it's most of why this is Large
rather than Medium. Second thing worth knowing: logWatcher deliberately never replays history
(logWatcher.js:9-12), so codes posted before you launched the app are invisible - if you want
the list to be populated when you open it, that needs a one-time backward scan of the current
log file, which is a new capability rather than a tweak. On the display side: peekCode today
returns only {name, kind}, so showing "type + the first buff's icon" needs it widened to also
return buffSource and buffNames[0] + that buff's iconId - the icon can then be drawn with the
existing eqicon:// protocol. I read "the first buff/debuff in its gem slot" as the first buff in
that aura's own tracked list (which maps to buffNames[0] today), not the EQ spell-gem bar - that
reading matches your separate gem-slot-picker note, and it works with today's data either way,
so this does not have to wait for that UI.

**Risk:** Adds a third consumer to the hot log path that runs on every single line; and because
anyone in guild/say chat can post a code, the found codes must stay a manual pick-from-a-list,
never an auto-import, or a stranger can spawn auras in someone's overlay.

**Touches:**
- `new file src/main/shareCodeScanner.js (log-line scanner + seen-codes memory)`
- `src/main/main.js:180-181 (log line dispatch - add a third consumer alongside buffEngine/customTimerEngine)`
- `src/main/main.js:460-464 (widget:peekCode / widget:import handlers, plus new list/clear handlers)`
- `src/main/widgetStore.js:282 (SHARE_CODE_PREFIX), :593-605 (exportCode), :606-628 (_decodeCode/peekCode - needs to return buffSource + first buff name + iconId, not just name/kind)`
- `src/renderer/main-window/index.html:1001-1057 (Add an aura modal - new choice button + new panel)`
- `src/renderer/main-window/main-window.js:1888-1900 (openAddWidgetModal / panel switching) and the import handlers around it`
- `src/preload/preload-main.js (new IPC bridge methods)`

#### #31 — Unlocking an aura to move it should put it on screen even when that aura is switched off for the current profile

`qol` · `small` (a few hours)

Much easier than it sounds. shouldBeOnScreen() already has exactly the right shape - it just
tests the profile first: `if (!isVisibleForActiveProfile(config)) return false; if
(isUnlocked(config.id)) return true;`. Swapping those two lines is the whole behaviour change.
The only other piece is setLocked(), which currently does nothing visible when the widget has no
window yet (an off-profile aura never got one at launch) - it needs to create the window the
same way applyVisibility already does. The empty-widget minimum-height floor (minHeightFor,
widgetManager.js:90-92) and the dashed drag box already exist, so an aura with no active buffs
will still be a grabbable target - that part is handled. One decision for you: gotcha #10 in
CLAUDE.md says profile membership IS the on/off switch, and this deliberately lets "off" be
temporarily overridden. I'd suggest per-aura Unlock forces it visible but master "Unlock all"
does not (or gives the forced ones a different-coloured outline), so unlocking everything
doesn't dump twenty hidden auras onto your screen. Re-locking hands it straight back to the
normal rules with no extra work.

**Risk:** An off-profile aura shown while unlocked runs the normal render path, so it can fire
land/expire alert sounds and can save a newly fitted size/position while it's up; and if the
master "Unlock all auras" toggle gets the same treatment, every off-profile aura appears on
screen at once, which could be a lot of windows.

**Touches:**
- `src/main/widgetManager.js:354-358 (shouldBeOnScreen - the profile check currently runs before the unlock check and returns false)`
- `src/main/widgetManager.js:401-411 (setLocked - only calls applyVisibility when a window already exists; an off-profile aura has none)`
- `src/main/widgetManager.js:360-371 (applyVisibility / createWidgetWindow-on-demand)`
- `src/main/widgetManager.js:417-425 (setAllUnlocked / areAllUnlocked)`
- `src/main/main.js:468 (widget:toggleLock), :430 (overlay:setAllUnlocked)`
- `src/renderer/overlay/overlay.js:803-805 (applyLockState) and :877-895 (the dashed drag box)`

#### #32 — Fix the alert volume slider so it loads the aura's saved volume, and re-range it so 100% sits in the middle and it runs 0-200%

`bug` · `small` (a few hours)

I found the actual cause of "starts in the middle but it's 100%", and it's a real bug separate
from the range request: selectWidget() populates every other slider from the saved config but
never touches this one, and the markup has no value attribute - so the browser parks the handle
at the track midpoint while the label text is the hardcoded "100%" from the HTML. That means the
slider has never shown the aura's real volume, and switching between auras never updates it.
Fixing that alone is about four lines and is worth doing regardless. The 0-200 half is the part
with a hidden cost: the synthesized beeps already go through a gain node (overlay.js:70) so they
scale past 100% for free, but custom sound files use `audio.volume = fraction` at overlay.js:95,
which cannot exceed 1 - so going above 100% means creating a MediaElementSource -> GainNode
chain for those. Also worth deciding: above ~150% short clips will clip/distort, so the top of
the range may be louder-but-worse rather than usefully louder.

**Risk:** HTMLMediaElement.volume throws for values above 1, so raising the max to 200 without
first routing custom sound files through a WebAudio gain node will make custom alert sounds stop
playing entirely (the built-in beeps would still work, which would make it look like a file
problem rather than a code one).

**Touches:**
- `src/renderer/main-window/index.html:500-502 (min/max/step, and it has no value attribute at all)`
- `src/renderer/main-window/main-window.js:1386-1477 (selectWidget - never assigns alertVolumeSlider.value; belongs next to the lowThresholdSlider block at :1431)`
- `src/renderer/main-window/main-window.js:2025-2035 (currentVolumeFraction + the input handler), :2074 (preview playback)`
- `src/renderer/overlay/overlay.js:88-99 (playCustomSound - audio.volume), :68-72 (beep gain), :36 (default)`
- `src/main/widgetStore.js:66, :177, :328 (alertVolume default and normalize)`

#### #33 — The name box in the "New loadout profile" dialog can't be clicked

`bug` · `trivial` (under an hour)  · **blocked**

**Blocked:** Needs one repro detail from you: does the dialog open normally? Is the box
visible but ignoring clicks, or visible and clickable but refusing typed text, or not visible
at all?

I want to be straight with you: I read the markup, the CSS and the JavaScript and could not find
anything that blocks the click. There's no drag region over it, no pointer-events rule, no
duplicate id, no other fixed-position element on top, and the field is even focused
programmatically the moment the dialog opens. So I'm not going to guess a fix - this project's
history is that guessed UI/detection fixes cause new problems. One candidate I could
substantiate is worth mentioning: the custom-timer dialog had a very similar bug where its card
being a flex column let children get squeezed to almost nothing, which is why `.modal-card-wide
> * { flex-shrink: 0 }` was added at main-window.css:1155. The profile dialog's card does not
have that guard, so on a short app window the row holding the name box can get crushed to near-
zero height and become impossible to hit. If you notice it only happens when the app window is
small or restored down (rather than maximised), that's almost certainly it, and it's a one-line
CSS fix. If it happens at any window size, it's something else and I'd want to watch it happen.

**Risk:** Very low - it's confined to one modal. The only way to break anything else is if the
fix is applied to the shared .modal-card rule, which every other dialog in the app also uses.

**Touches:**
- `src/renderer/main-window/index.html:961-984 (the create-profile modal markup)`
- `src/renderer/main-window/main-window.css:1660-1670 (.modal-card), :788-794 (.row), :1698-1707 (.modal-list), :1155-1162 (the .modal-card-wide flex-shrink guard that this modal does NOT have)`
- `src/renderer/main-window/main-window.js:221-248 (populateCreateProfileChecklist), :2756-2774 (setupModalToggle)`

#### #34 — Add "Buff" and "Debuff" premade aura templates that ask you to pick one spell (and for a buff, whether it's on you or an ally) and then build the aura for you with sensible defaults

`feature` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** The debuff half needs real log samples for detrimental spells on this server -
the land line, the resist line and the worn-off line. You've written candidate wording for
Mesmerization in FEATURES.md, but it hasn't been taken from an actual log, and this app
matches text exactly.

I'm marking this needs-design rather than giving a number because "buff or debuff" is really two
very different jobs and I don't want to quietly shrink your request to the easy half. The BUFF
half is small - roughly half a day. Everything it needs already exists: self-vs-ally is just the
buffSource field, and the spell picker can reuse the searchable filter list that's already built
(do NOT use a plain dropdown - the roster is 11,000+ entries and a <select> would be unusable).
The DEBUFF half is a subsystem the app does not have any part of: the roster is beneficial-
spells-only by design, there is no debuff buffSource, and there's no per-target tracking. Your
own earlier notes (FEATURES.md lines 144-146 and the Mesmerization example) want per-mob timers,
a resist flash, and an "has an ally already applied this" toggle - that's a feature area, not a
template. Two things to decide before anyone starts: (1) does "debuff premade" mean the full
per-mob tracker, or just a template over whatever debuff tracking exists later? (2) what should
"some default options" actually be - icon mode or list, sound on expire, warning seconds? That's
unspecified and it changes what gets built. Recommendation: ship the buff template now as its
own item, and keep the debuff template queued behind the detection rework. I've listed 35 as a
dependency because the spreadsheet is the only source of detrimental spell data anywhere in this
project - but that dependency applies ONLY to the debuff half; the buff half has none and
shouldn't wait. Also noted and accepted: the log can't tell two mobs with the same name apart,
which you already called out yourself.

**Risk:** The buff half is purely additive (a new template that calls the existing create +
setBuffFilter calls), so it's low risk. The debuff half means adding a new tier to buffEngine's
first-match-wins chain, which is exactly the structure CLAUDE.md's P0 says to stop extending -
build it after that rework, not before, or it'll be built twice.

**Touches:**
- `src/renderer/main-window/main-window.js:1801-1808 (PREMADE_WIDGETS), :1814-1826 (PLANNED_PREMADE_WIDGETS), :1829-1867 (renderPremadeList)`
- `src/renderer/main-window/main-window.js:1478-1560 (renderBuffFilter - the existing searchable buff picker to reuse for "select the first skill")`
- `src/renderer/main-window/index.html:1001-1057 (Add an aura modal - a new sub-panel for the picker + the self/ally question)`
- `src/main/widgetManager.js:174-178 (createCustomWidget)`
- `src/main/main.js:458 (widget:create), :511 (widget:setBuffFilter)`
- `debuff half only: src/main/buffEngine.js handleLine tier chain, src/shared/data/buffs.json (no detrimental spells exist in it at all), src/main/widgetStore.js:300-310 (buffSource is only self|ally|customTimer today)`

**Needs first:** #35

#### #35 — Archive the current spell roster and rebuild it from the new EQL spell spreadsheet, including its per-tier (roman numeral) scaling rules and spell categories

`data` · `needs-design` (needs a decision first)  · **blocked**

**Blocked:** The four columns detection actually runs on - "landed on you", "landed on other",
"spell faded", "reuse" - are completely empty in the sheet (header row only, zero data rows).
Only 298 of its 1,052 spells name-match the current roster, so 754 have no text available from
anywhere in this project. Filling them needs either a fresh mine of your spells_us.txt or
scraping the site the sheet was pasted from (https://amerzel.github.io/eql-info/ - every spell
name links to one page there), and that's a decision plus real work, not an estimate.

I opened the spreadsheet and measured it, so these are facts rather than guesses. It has 1,052
spells across two sheets ('spells', 'spell scaling'). Tags in column D: 379 buff, 327 det, 82
pet, 264 untagged. Columns B (Icon), I, J, K and L are empty. Excel glued the tag onto the name
for det/pet rows ("Blast of Cold det") so names need cleaning before any matching. After
cleaning, 298 match the current roster; 294 of those agree on duration and 4 disagree (Improved
Invisibility 10m vs 30m, Invisibility to Undead 5m vs 10m, Agilmente's Aria of Eagles 18s vs
5m). 73 buff-tagged spells are absent from the roster entirely - and one of them is Cassindra's
Chant of Clarity, the precise spell CLAUDE.md names as the cause of a real live misdetection. So
the sheet genuinely does fix known gaps; it just can't replace what's there. THE DESIGN
DECISION, and why I can't size this yet: does this sheet REPLACE the roster or MERGE into it?
Merge (add the 73 missing spells, correct durations, add a category field, keep all existing
text) is Large but safe. Replace is not a bigger version of that job - it's a different job that
breaks detection unless every one of the 1,052 gets its text refilled first. Decide that and the
estimate follows. Three more things worth knowing. (1) Reading the file is already solved -
tools/lib/xlsx.js exists, is tested, and parsed this workbook cleanly, so that part is free. (2)
The scaling sheet is genuinely valuable and answers an open backlog item (#13, rank-numeral
duration scaling): Buff category gets +10% duration, -4% cast and -4% mana per tier, with a
universal -2% reuse per tier. But the sheet defines only 8 scaling categories while the spells
sheet uses 109 different category names, and no mapping between them is supplied - somebody has
to write that mapping, and it's a judgement call, not a lookup. The sheet's own caveat also says
these numbers are reverse-engineered from community tooltip captures, some are marked "?", and
the tier cap is unverified past 8 - so treat it as a strong starting hypothesis, not truth. (3)
Your Promised Renewal example doesn't match what's in the file I read: the sheet lists PR at
18s, category "Delayed", and it DOES carry the buff tag in column D. Your note says 12 (or 15)
and no buff tag, and a separate note elsewhere says 15s. Since you're using PR as the worked
example of the rule for which spells scale, that needs settling before the rule is coded.
Finally, on "archived": the bundled file is safe (git has it), but the risky copy is the roster
persisted in each user's userData - buffStore's constructor is a chain of one-shot migrations
and a new one would rewrite it in place, so it should copy the existing store to a timestamped
file BEFORE writing anything. Also note the sheet's 'reuse' and 'Cast' columns have nowhere to
go: the app has no cooldown or cast-time concept at all today, and the roster has exactly six
fields (name, durationSec, landingText, endedText, iconId, othersLandingSuffix). Adding
category, cast time and reuse means new fields plus a migration - and you're right that category
is the prerequisite for stacking rules later.

**Risk:** Replacing an 11,337-entry roster with 1,052 entries would delete the landing text for
roughly 11,000 spells AND - far worse - make hundreds of landing texts that are genuinely shared
in the game start looking unique to the app. "Unique landing text" is the highest-confidence
auto-confirm tier, taken with no other evidence, so the result isn't quietly worse detection,
it's confidently wrong detection. That is the exact failure CLAUDE.md gotcha #15 documents and
test/roster.test.js was written to catch.

**Touches:**
- `src/shared/data/buffs.json (the bundled roster itself)`
- `src/main/buffStore.js:8 (STARTER_VERSION), :28-225 (the one-shot migration chain in the constructor - a new gated migration is required), :19 (MAX_TRACKABLE_DURATION_SEC), :244-300 (the landing-text uniqueness indexes that a smaller roster would poison)`
- `tools/lib/xlsx.js (already written and tested - reads this file correctly) plus a new tools/ mining script`
- `test/roster-baseline.json and test/roster.test.js (the shape baseline this change will trip, deliberately)`
- `src/main/rosterBackfill.js and src/main/bardSongTagger.js (both run over the roster at every launch)`
- `src/main/main.js:166-172 (durationMultiplierFor / setDurationMultiplierFn) and src/main/buffEngine.js:873 (noDurationScaling) - where mote-tier scaling would land`

#### #36 — Play an alert sound when someone asks to trade with you

`feature` · `small` (a few hours)

Verified in her own logs: `<Name> is interested in making a trade.` (9 occurrences). Not
blocked. GOOD NEWS - this is NOT blocked on a log sample, I confirmed the lines in her own logs
at C:/Users/Lindsey/Desktop/EQL Source/eqlog_Shara_rivervale*.txt. The trade-request line is
"<Name> is interested in making a trade." (9 occurrences). Also present: "You complete the trade
with <Name>." (48), "<Name> has cancelled the trade.", "You have cancelled the trade.", "You are
too far away from <Name> to trade." So a ping on request, completion, and cancel are all
possible. AMBIGUITY I had to interpret: "requested trade" most likely means "someone requests a
trade with me" - if she actually meant a ping when a trade COMPLETES (loot/handoff
confirmation), it is the same work on a different line, so confirm which before building. HIDDEN
COST: there is no sound-only alert in this app - every trigger creates a visible countdown tile,
because sounds are per-aura settings (soundOnLand in widgetStore.js:53) played by the overlay
renderer (overlay.js:669). Cheapest honest design is a custom-timer trigger type feeding the
existing per-aura sound plumbing; a truly global "ping with no tile" would need a new sound
surface outside the aura system and is a bigger job than the note sounds. WORKAROUND SHE CAN USE
TODAY with zero code: make a custom timer aura, trigger type "Exact log line", paste "Avenrae is
interested in making a trade.", 2 second duration, turn on the aura's land sound, set aura
opacity to 0 if she does not want to see the tile. Limitation: that only works for one named
person, since the trigger match is exact - which is precisely what the code change above fixes.

**Risk:** The only risky edit is loosening _findTriggerMatches from exact full-line equality to
pattern matching - done carelessly that makes every existing custom timer fire on partial line
matches, so the new mode must use its own matcher rather than relaxing the shared one.

**Touches:**
- `C:/Users/Lindsey/EQ tracker/src/main/buffParser.js:233 (new matchTradeRequest alongside the existing matchGroupMemberJoined/matchHealBySpell pattern helpers, + module.exports)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/main-window.js:874-899 (TRIGGER_TYPES - add a 'trade' entry with a fieldsId)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/index.html (timer modal - add the trade fields panel next to widget-new-timer-chat-fields / -raw-fields)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/main-window.js:2134-2171 (readTimerFormData - handle the new mode)`
- `C:/Users/Lindsey/EQ tracker/src/main/customTimerEngine.js:56-70 (_findTriggerMatches - today it is strict full-line equality, needs a pattern/contains path so any player name matches)`
- `C:/Users/Lindsey/EQ tracker/test/ (npm test harness - a new parser regex is exactly what it is for)`

#### #37 — Give each aura tile a coloured border by spell type (red for damage/DoTs, green for heals/HoTs), on by default, toggled from a new "Borders" sub-section under Label text

`feature` · `large` (several days)

MUCH HARDER THAN IT SOUNDS, but for one specific reason: the app has NO idea what type any spell
is. A roster entry is {name, durationSec, landingText, endedText, iconId, showOnOverlay,
isBardSong} - no category, no tier, nothing. gameSpellData.js only parses name, per-class
levels, duration ticks and icon id, and CLAUDE.md is explicit that every field position was
verified empirically because this is a custom server - so mining the effect fields to infer DoT
vs HoT means the same verification exercise again, days of work with real regression risk. THE
CHEAP PATH ALREADY EXISTS IN THE REPO: "new spell roster to be added.xlsx" at the project root
has a Category column, and its second sheet defines the exact categories she is describing -
Nuke/lifetap, DoT, Heal, Heal over time, Debuff. So this should be built AFTER that spreadsheet
becomes the roster (that is the PRIORITY FIX note sitting directly above this one in FEATURES.md
- it is not in my id range 36-39, so I could not list it as a formal dependency, but it is the
real one). Build it before, and the categories get invented twice. SPLIT IT: the Borders
section, the toggle, the per-tile colour rendering and the wiring is a few hours (a new boolean
widget field is ~8 mechanical touch points, I traced landingGlowEnabled end to end). The
category data is the whole cost. SECOND THING SHE SHOULD KNOW: today the overlay only tracks
buffs on you and buffs you put on allies. DoTs landing on you are not tracked at all (debuff
tracking is a separate unbuilt note) and DoTs you cast on mobs are not tracked either - so on
today's app, "red for damage" would colour almost nothing. Her example is really a request for
the borders AND debuff tracking, and I am not narrowing it: the border feature is worth
building, it will just look half-empty until debuffs exist. Also needs a decision on which
colours map to which categories, and what an uncategorised spell gets.

**Risk:** The tile border is ALREADY the app's expiry warning signal - overlay.css:243 and :172
turn it red when a buff is nearly gone. Painting DoTs red permanently would make "red border"
mean two opposite things, and the low-time warning must keep winning (same reserved-danger-
colour rule that timerTextColor already follows). Adding a category field to the roster also
touches saved data, so it needs the same version-gated migration care as every other buffStore
change.

**Touches:**
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/index.html:416-467 (new Borders .topic immediately after #widget-icon-label-section, exactly where she asked for it)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/main-window.js:1433-area (populate/save the new checkbox, mirroring landingGlowCheckbox)`
- `C:/Users/Lindsey/EQ tracker/src/main/widgetStore.js:48,169,255,312 (new boolean on all three widget defaults, SHAREABLE_FIELDS, normalizeWidget)`
- `C:/Users/Lindsey/EQ tracker/src/main/widgetManager.js:510-area (a setter + pushConfigChanged, mirroring setLandingGlowEnabled)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/overlay/overlay.js:26 (config default), :303-335 buildIconTile, :235-278 buildListRow, :456-483 updateRef (apply a category class per tile)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/overlay/overlay.css:207-243 (.tile border, and the .tile.low / .buff-row-icon low rules at 172 and 243 that already repaint the border red)`
- `C:/Users/Lindsey/EQ tracker/src/main/buffEngine.js:1239-1258 getActiveBuffs and :1263+ getActiveAllyBuffs (would need to emit a category field per buff, like the existing isBardSong)`
- `C:/Users/Lindsey/EQ tracker/src/main/buffStore.js (roster records would need a category field + a one-shot migration)`

#### #38 — Let an aura apply only while you are in a specific zone - either as an extra "and only in this zone" condition on a trigger, or as a per-aura zone dropdown under "when to show them"

`feature` · `needs-design` (needs a decision first)

Verified in her own logs: `You have entered <Zone>.` across 58 distinct zones. Not blocked. NOT
BLOCKED on a log sample - I checked her real logs at C:/Users/Lindsey/Desktop/EQL Source/. "You
have entered <Zone>." is there, 58 distinct zones, e.g. "You have entered The Castle of
Mistmoore 1 (Awakened)." So the signal is confirmed and free. THREE REAL DECISIONS, which is why
I marked this needs-design rather than guessing a number: (1) INSTANCES. Zone names carry
instance suffixes - "Befallen", "Befallen 1 (Awakened)", "Befallen 3 (Fused)", "Blackburrow 2
(Adaptive)" are all separate strings in her log. Does picking "Befallen" mean every Befallen
instance, or only the plain one? Almost certainly the former, which means base-name matching,
not exact. (2) THE APP DOES NOT KNOW WHERE SHE IS AT STARTUP. logWatcher never replays log
history by design, so after every app restart the current zone is unknown until she next zones.
If unknown means "hide zone-gated auras", her auras silently vanish after every restart - the
exact trap gotcha #10 warns about. Unknown should almost certainly mean "show". Reading
backwards through the log tail once at startup would fix it properly but touches the never-
replay rule. (3) WHERE THE ZONE LIST COMES FROM. A dropdown implies a known list - either ship a
static zone list, or learn zones as it sees them (which starts empty and reads as broken). ROUTE
MATTERS FOR EFFORT: the per-aura dropdown route is about a day and needs nothing from note 39 -
shouldBeOnScreen() at widgetManager.js:354 is one clean function and a zone check drops straight
in next to the profile check. The "and only in this zone" trigger-condition route is a
different, larger job that belongs inside note 39's condition system. I deliberately did NOT
make this depend on 39: the dropdown stands alone and would not be wasted work. ONE MORE THING:
hiding the aura window does not stop the timers underneath from running, so a buff tracked in a
forbidden zone is still counting and reappears on re-entry - probably what she wants, but worth
confirming. Also note her raw line in FEATURES.md ends "notes to not be executed" - she flagged
this as record-only, same as 39.

**Risk:** This adds a SECOND thing that can make an aura invisible. CLAUDE.md gotcha #10 is a
whole paragraph about the last time this app had two independent visibility gates and the user
could not tell why an aura was missing - a zone filter has exactly that failure mode, and it is
worse because the app forgets its zone on every restart (see notes).

**Touches:**
- `C:/Users/Lindsey/EQ tracker/src/main/buffParser.js:233 (new matchZoneChange + export)`
- `C:/Users/Lindsey/EQ tracker/src/main/main.js:180-181 (a zone-state module fed from the same logService.watcher 'line' event as the two engines)`
- `C:/Users/Lindsey/EQ tracker/src/main/widgetManager.js:354-358 shouldBeOnScreen (the single clean insertion point for a zone gate) and :377-379 applyProfileVisibility (a sibling applyZoneVisibility on every zone change)`
- `C:/Users/Lindsey/EQ tracker/src/main/widgetStore.js:17-120 defaults, :237-276 SHAREABLE_FIELDS, :291-336 normalizeWidget (new visibleInZones field)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/index.html:203-215 (per-aura identity block, next to the profile checkboxes that are already the aura's on/off control)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/main-window.js:874-899 TRIGGER_TYPES (the 'zone' entry already exists as a disabled Planned placeholder)`

#### #39 — New aura category for multi-trigger auras with AND/OR conditions - record it for later, do not build it now

`feature` · `needs-design` (needs a decision first)

Recorded as she asked - to-do-later, not now. Agreeing with her instinct: this really is its own
aura category, not a flag on an existing timer. The crux question nobody has answered yet is
what "AND" means in time: if trigger A fires and trigger B fires 40 seconds later, did A AND B
happen? So every condition needs a validity window, and that is the actual design work, not the
UI. WORTH FLAGGING TO HER: this is a near-sibling of the "multi-step/sequential aura type" item
already in CLAUDE.md's large bucket - both are "several triggers combine into one tile", one
ordered, one unordered. Design them together or the second one will force a rewrite of the
first. Note 38's "and only in this zone" half is the natural first customer for this system (a
zone condition is just an AND condition that happens to be about location), but 38's simpler
per-aura dropdown route does not need this and should not wait for it. Note 36 also touches the
trigger system - it is small and self-contained and should ship well before this; if this ever
lands, 36's trade trigger becomes one condition type inside it rather than being redone.

**Risk:** customTimerEngine is currently stateless between lines - a line either matches a
trigger or it does not. Conditions introduce state that persists across lines, which is the same
class of change that produced this project's history of subtle detection bugs, and it lands in
the one engine that has been reliable precisely because it is simple.

**Touches:**
- `C:/Users/Lindsey/EQ tracker/src/main/customTimerEngine.js:56-70 _findTriggerMatches and :72-110 handleLine (the whole one-line-in/one-timer-out model would be replaced by an evaluated condition set)`
- `C:/Users/Lindsey/EQ tracker/src/main/widgetStore.js:161 (per-widget customTimers shape) and :237-276 SHAREABLE_FIELDS (share codes carry customTimers verbatim, so the shape change ripples into import/export)`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/main-window.js:874-899 TRIGGER_TYPES and :2134-2171 readTimerFormData`
- `C:/Users/Lindsey/EQ tracker/src/renderer/main-window/index.html:357+ (Custom timers topic and the #custom-timer-modal-backdrop form)`
- `C:/Users/Lindsey/EQ tracker/src/main/sessionSnapshot.js + customTimerEngine.js:120-129 restoreSnapshot (partially-satisfied conditions are new state that a restart has to either restore or deliberately drop)`

### Original wording, preserved

Kept exactly as written, so nothing is lost in the rewording above.

1. PROMISEd RENEwAL DURATION IS 15S and does not scale
2. FIRsT AGGRO CHECKER, WHO GOT HIT OR HIT THE BOSS FIRST premade widget (add placeholder to add premade widget)
3. BUG FIX - REMEMBERED SPELLS GOES ABOVE 14 . if seen 14 memmed spels, start deleting from the back
4. COR QOL - hide all aura toggle on primary menu (used as an override to disable all auras for ui work) MAYBE A HOTKEY TOO
5. reset ambiguous casts should be a danger/red button like other delete choices
6. unlocking all auras should show tnhe aura name, then clicking on one should auto nav you to that aura's options
7. app text size scaling options
8. combine similar buff toggle. useful if you want to make a quick buff widget. combines spells that have the exact same duration into one icon, DISPLAYS THE LOWEST DURATION AND THE PLAYER NAME , WITH A NUMBER TO SHOW HOW MANY SIMILAR BUFFS ARE ACTIVE(THIS NUMBER SHOULD BE APPLIED TO ANY SUCTION THAT CAN HAVE COMBINED BUFFS)
9. and/or triggers for custom auras
10. triggers that have both a cooldown and a duration. cooldown should be a toggle that opens a menu to set the duration. when active, it will count down the duration of the spell, that count the cooldown
11. It's an AoE mez, so one cast lands on several mobs and some resist — timers key off the land, never the cast. Duration comes from the rank cast within the last ~4s (the land line doesn't name it): 30 / 36 / 36 / 40s for Mesmerization, II, III, V. Match names case-insensitively; the log capitalizes at sentence start.
12. Show ONE consolidated countdown — the mob breaking soonest plus a count, e.g. "12.4  x6  a greater kobold" — yellow, red at <=8s. Track mobs individually internally; per-mob rows are false precision since mobs share names.
13. resizable side bar (click and drag)
14. CORE QOL - premade buff timer (just change skill, cast on you/ally option , give a drop down for skill) add to custom widget placeholder
15. CORE QOL - premade cooldown timer (just change skill, give a drop down for skill) add to custom widget placeholder
16. CORE QOL - premade debuff on an enemy timer (like mes, malo, slow, etc). with a text alert when the target resists.  add to custom widget placeholder. debuff's should be similar to ally buffs and show every active effect. this will create problems when debuffing mobs of the same name but that is something that I do not think the combat log can tell the difference between. toggle to also check if an ally has applied this debuff. useful for boss debuffing
17. mes duration prebuilt. this is an example of an enemy debuff prebuilt functionality  Lines: You begin casting Mesmerization V.        -> remember rank, NO timer <mob> has been mesmerized.                -> starts the timer <mob> resisted your Mesmerization      -> red "RESIST" flash ~1.4s, no timer (this will require text only aura feature Your Mesmerization spell has worn off of <mob>.  /  <mob> has been slain -> clear that mob
18. for aoe debuffs, if there are mobs with the same name, it will return multiple results of success/failure and that can be used to "count" how many mobs were affected. for example if "a bat" was mesmerised twice, it proves that there are two "a bat" in the combat
19. damage parser premade  add to custom widget placeholder
20. travel guide premade (can track spellbook spells and display shortest route). add to custom widget placeholder
21. current profile overlay that shows in game, should become auto displayed in widgets when a second profile is created. but can be toggled off. this will use the new text only aura feature.
22. all aura's unlock should only be on the overlay auras master page, not all aura's
23. CORE FUNCTIONALITY - text only selection alongside list and icons. text only needs text size slider, but allowed to be much much bigger than icon/list text. should include a selection for how long that text remains on screen after trigger, options between, always, timed, or until the trigger is removed through set closing text
24. spell cast detection order (WIP) - directly named as cast in the log by a specific person - The landing text is unique to one spell (only useful to buffs, not the damage parser) - ambiguous landing text - spells noted in your /outputfile spells - ambiguous landing text - tracked as a memmed spell (not reliable, if you loadout swap it doesn't say you unmemmed anything) - Ambiguous text during a "burst" (e.g. Quick Buff). - NEW CHECK - Post cast check - if a buff like clarity/cassindra's chant of clarity is ambiguous, it can be resolved if the landed text repeats itself. this should only be used for 	  ambiguous landing text that is shared between a casted buff spell and a bard song. if one is detected, asking the user should be delayed to see if it auto resolves. with a note on 	  the popup that displays a timer counting to next 6 second interval and saying that it's checking for auto resolution - Ambiguous text with no other signal - ask the user
25. GLOBAL RECOVERY TIME PREMADE MODULE (ADD PLACEHOLDER)
26. buff stack detection to remove stale buffs that got overwritten
27. CORE FUNCTIONALITY - buffs shown should be it's own category above config and below display and size. it should have buff/debuff toggle buttons. added de/buffs should use gem slot pickers (like memmed spells and image pickers) that open a model to select buff/debuff. and then display the image for that buff. a gem slot box should also be active with a + in it to add more. buffs and debuffs cannot be in the same aura widget. spell gems here are independent tracked icons inside the widget, no and/or functionality yet.
28. berserker spirit on my ally buff was picked up at 19 8 12:15 when I did not cast it
29. CORE QOL - clicking an ambiguity should auto refocus the game
30. MAJOR QOL - import from chat function - addon reads chat for anything that is identified as a export code, then converts it to a selection when someone clicks to add an aura in a new "import from log" button. it then displays the names and types of auras that have been sent to the chat window that it has noticed, and also maybe the first buff/debuff in it's gem slot? could be more if it uses images
31. CORE QOL - when clicking unlock to move, it should display the aura to move it even if the aura is toggled off for that profile, so that it can still be moved even when not active.
32. sound slider starts in the middle but it 100%, it should start in the middle at 100% and go in either direction to 0 and 200
33. cannot click name field in add new profile
34. CORE QOL - when you pick to make a premade aura with buff or debuff, it opens a menu where you select the first skill, and it will auto build your aura for you with that skill and some default options. if you pick buff, it will ask if you are making one for yourself, on an ally.
35. PRIORITY FIX: a brand new spell spreadsheet has been prepared that shows all EQL specific spells. the old spell roster should be saved and archived. and this spreadsheet should become the basis for the new roster. this sheet contains the spell data needed, and a second sheet saying how to calculate the adjusted cooldown, cast time, and buff durations that a rank up (roman numeral) will provide it. spells have categories listed. i.e buff. and have specific benefits listed in this sheet for the type of spell it is. for example Promised renewal has a duration but does NOT have the buff tag, so it stays it's listed duration permanently. (in this case however, PR has a duration of 15, not it's listed 12) what is not listed (has columns, but no data), is the landed on you, landed on other, spell faded/finished text, and reuse/cooldown time. these can probably be found be cross referencing the current roster data, or ingame files, however, if that is not the case, each name of the buff is a link, that can be followed/navigated to that contains all the data needed. this data also has valuable information about the category that the spell falls in to. this will be required later for dealing with spell's stacking and not stacking.
36. requested trade sound ping
37. each type of spell should have it's own coloured border. for example, red for damage (dots), green for heals (hots) enabled by default but has a toggle under a new sub category  called "borders" , listed underneath label text.
38. SOME WAY TO ONLY APPLY AN AURA WHEN IN A SPECIFIC ZONE. IDEA FOR PREMADE AURA EXISTS WHEN ENTERING A ZONE EXISTS, BUT THERE NEEDS TO BE A WAY TO SAY "WHEN THIS HAPPEN, BUT ONLY IN THIS ZONE" (AND TRIGGER, OR JUST A DROP DOWN IN AURA MENU'S UNDER "WHEN TO SHOW THEM"?) notes to not be executed
39. AND/OR TRIGGERS MULTI TRIGGER AURAS SHOULD PROBABLY BE IT'S OWN CUSTOM CATAGORY? place in the to do later category but not execute now

