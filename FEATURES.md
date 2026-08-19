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
