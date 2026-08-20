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

## Uncatagorised features and bugs that need sorting - when viewed, these need analysing and placing it the above categories based on time needed and bug severity. These are raw notes from the user and may be chaotic. They may be moved and reworded, but should NEVER be deleted without relocation. 

- PROMISEd RENEwAL DURATION IS 15S and does not scale
- FIRsT AGGRO CHECKER, WHO GOT HIT OR HIT THE BOSS FIRST premade widget (add placeholder to add premade widget)
- BUG FIX - REMEMBERED SPELLS GOES ABOVE 14 . if seen 14 memmed spels, start deleting from the back
- COR QOL - hide all aura toggle on primary menu (used as an override to disable all auras for ui work) MAYBE A HOTKEY TOO
- reset ambiguous casts should be a danger/red button like other delete choices
- unlocking all auras should show tnhe aura name, then clicking on one should auto nav you to that aura's options
- app text size scaling options 
- combine similar buff toggle. useful if you want to make a quick buff widget. combines spells that have the exact same duration into one icon, DISPLAYS THE LOWEST DURATION AND THE PLAYER NAME , WITH A NUMBER TO SHOW HOW MANY SIMILAR BUFFS ARE ACTIVE(THIS NUMBER SHOULD BE APPLIED TO ANY SUCTION THAT CAN HAVE COMBINED BUFFS)
- and/or triggers for custom auras 
- triggers that have both a cooldown and a duration. cooldown should be a toggle that opens a menu to set the duration. when active, it will count down the duration of the spell, that count the cooldown
- It's an AoE mez, so one cast lands on several mobs and some resist — timers key
off the land, never the cast. Duration comes from the rank cast within the last
~4s (the land line doesn't name it): 30 / 36 / 36 / 40s for Mesmerization,
II, III, V. Match names case-insensitively; the log capitalizes at sentence start.
- Show ONE consolidated countdown — the mob breaking soonest plus a count, e.g.
"12.4  x6  a greater kobold" — yellow, red at <=8s. Track mobs individually
internally; per-mob rows are false precision since mobs share names.
- resizable side bar (click and drag)
- CORE QOL - premade buff timer (just change skill, cast on you/ally option , give a drop down for skill) add to custom widget placeholder
- CORE QOL - premade cooldown timer (just change skill, give a drop down for skill) add to custom widget placeholder
- CORE QOL - premade debuff on an enemy timer (like mes, malo, slow, etc). with a text alert when the target resists.  add to custom widget placeholder. debuff's should be similar to ally buffs and show every active effect. this will create problems when debuffing mobs of the same name but that is something that I do not think the combat log can tell the difference between. toggle to also check if an ally has applied this debuff. useful for boss debuffing
- mes duration prebuilt. this is an example of an enemy debuff prebuilt functionality 
	Lines:
	  You begin casting Mesmerization V.        -> remember rank, NO timer
	  <mob> has been mesmerized.                -> starts the timer
	  <mob> resisted your Mesmerization      -> red "RESIST" flash ~1.4s, no timer (this will require text only aura feature
	  Your Mesmerization spell has worn off of <mob>.  /  <mob> has been slain
                                            -> clear that mob
- for aoe debuffs, if there are mobs with the same name, it will return multiple results of success/failure and that can be used to "count" how many mobs were affected. for example if "a bat" was mesmerised twice, it proves that there are two "a bat" in the combat
- damage parser premade  add to custom widget placeholder
- travel guide premade (can track spellbook spells and display shortest route). add to custom widget placeholder
- current profile overlay that shows in game, should become auto displayed in widgets when a second profile is created. but can be toggled off. this will use the new text only aura feature.
- all aura's unlock should only be on the overlay auras master page, not all aura's
- CORE FUNCTIONALITY - text only selection alongside list and icons. text only needs text size slider, but allowed to be much much bigger than icon/list text. should include a selection for how long that text remains on screen after trigger, options between, always, timed, or until the trigger is removed through set closing text
- spell cast detection order (WIP)
	- directly named as cast in the log by a specific person
	- The landing text is unique to one spell (only useful to buffs, not the damage parser)
	- ambiguous landing text - spells noted in your /outputfile spells
	- ambiguous landing text - tracked as a memmed spell (not reliable, if you loadout swap it doesn't say you unmemmed anything)
	- Ambiguous text during a "burst" (e.g. Quick Buff).
	- NEW CHECK - Post cast check - if a buff like clarity/cassindra's chant of clarity is ambiguous, it can be resolved if the landed text repeats itself. this should only be used for 	  ambiguous landing text that is shared between a casted buff spell and a bard song. if one is detected, asking the user should be delayed to see if it auto resolves. with a note on 	  the popup that displays a timer counting to next 6 second interval and saying that it's checking for auto resolution
	- Ambiguous text with no other signal
	- ask the user
- GLOBAL RECOVERY TIME PREMADE MODULE (ADD PLACEHOLDER)
- buff stack detection to remove stale buffs that got overwritten
- CORE FUNCTIONALITY - buffs shown should be it's own category above config and below display and size. it should have buff/debuff toggle buttons. added de/buffs should use gem slot pickers (like memmed spells and image pickers) that open a model to select buff/debuff. and then display the image for that buff. a gem slot box should also be active with a + in it to add more. buffs and debuffs cannot be in the same aura widget. spell gems here are independent tracked icons inside the widget, no and/or functionality yet.
- berserker spirit on my ally buff was picked up at 19 8 12:15 when I did not cast it
- CORE QOL - clicking an ambiguity should auto refocus the game
- MAJOR QOL - import from chat function - addon reads chat for anything that is identified as a export code, then converts it to a selection when someone clicks to add an aura in a new "import from log" button. it then displays the names and types of auras that have been sent to the chat window that it has noticed, and also maybe the first buff/debuff in it's gem slot? could be more if it uses images
- CORE QOL - when clicking unlock to move, it should display the aura to move it even if the aura is toggled off for that profile, so that it can still be moved even when not active.
- sound slider starts in the middle but it 100%, it should start in the middle at 100% and go in either direction to 0 and 200
- cannot click name field in add new profile
- CORE QOL - when you pick to make a premade aura with buff or debuff, it opens a menu where you select the first skill, and it will auto build your aura for you with that skill and some default options. if you pick buff, it will ask if you are making one for yourself, on an ally. 
- PRIORITY FIX: a brand new spell spreadsheet has been prepared that shows all EQL specific spells. the old spell roster should be saved and archived. and this spreadsheet should become the basis for the new roster. this sheet contains the spell data needed, and a second sheet saying how to calculate the adjusted cooldown, cast time, and buff durations that a rank up (roman numeral) will provide it. spells have categories listed. i.e buff. and have specific benefits listed in this sheet for the type of spell it is. for example Promised renewal has a duration but does NOT have the buff tag, so it stays it's listed duration permanently. (in this case however, PR has a duration of 15, not it's listed 12) what is not listed (has columns, but no data), is the landed on you, landed on other, spell faded/finished text, and reuse/cooldown time. these can probably be found be cross referencing the current roster data, or ingame files, however, if that is not the case, each name of the buff is a link, that can be followed/navigated to that contains all the data needed. this data also has valuable information about the category that the spell falls in to. this will be required later for dealing with spell's stacking and not stacking. 
- requested trade sound ping
- each type of spell should have it's own coloured border. for example, red for damage (dots), green for heals (hots) enabled by default but has a toggle under a new sub category  called "borders" , listed underneath label text.
- SOME WAY TO ONLY APPLY AN AURA WHEN IN A SPECIFIC ZONE. IDEA FOR PREMADE AURA EXISTS WHEN ENTERING A ZONE EXISTS, BUT THERE NEEDS TO BE A WAY TO SAY "WHEN THIS HAPPEN, BUT ONLY IN THIS ZONE" (AND TRIGGER, OR JUST A DROP DOWN IN AURA MENU'S UNDER "WHEN TO SHOW THEM"?) notes to not be executed
- AND/OR TRIGGERS MULTI TRIGGER AURAS SHOULD PROBABLY BE IT'S OWN CUSTOM CATAGORY? place in the to do later category but not execute now