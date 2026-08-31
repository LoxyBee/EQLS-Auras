# EQLS Auras — Feature Highlights

A plain-English rundown of what the app does today, plus a short pitch and the shot-list
for promo material. Everything here is *built and shipped*, not planned. For what's still
coming, see `docs/QOL-BACKLOG.md`; for the reasoning and history behind any of it, see
`CLAUDE.md`.

---

## The pitch

**One line.** Stop alt-tabbing to check your buffs. EQLS Auras reads your EverQuest
Legends log live and shows a clean countdown overlay on top of the game.

**Thirty seconds.** You never have to wonder what's about to drop again. EQLS Auras
watches your log file as you play and puts a transparent, click-through overlay on your
screen with a timer for every buff you have running. Build as many overlays as you want,
put them wherever you like, make them flash or play a sound, and fire an aura off any line
in your log — not just the buffs the app already knows. It hides itself when you tab out
of EQ and snaps back when you return, and it even tracks your weekly raid lockouts, which
EverQuest never prints. No account, no cloud, no subscription.

---

## Core tracking

**Never lose track of your own buffs again.** A transparent, click-through overlay sits on
top of EverQuest and counts down every buff you have running, read straight from your live
log file — no alt-tabbing to a spellbook or guessing when something's about to drop.

## Multi-window overlay system

**As many independent auras as you want, each its own window.** Position, size, opacity,
colors and text options — configured separately and remembered per aura.

**Two ways to read your buffs at a glance.** Switch any aura between a compact icon grid
and a detailed list view.

**The overlay stays out of your way.** Click-through, so it never eats a mouse click — and
it hides itself when EverQuest isn't your focused window, then comes straight back.

## Beyond your own buffs

**Track what you're casting on your group, not just yourself.** Ally-buff tracking shows
what you've landed on each groupmate, grouped by name.

## Custom & premade auras

**One-click premades for the common stuff.** Buff timers, cooldown timers, resist flashes,
"you got dispelled," and a dedicated "your charm broke" alert are all ready to drop in with
a couple of clicks — no configuration from scratch.

**A cooldown timer that also tracks the buff itself.** One tile can count the buff's active
duration first, then roll straight into "ready again in X" with no reset in between.

**Build your own trigger from any log line.** Custom timers watch for arbitrary text you
specify, not just buffs the app already knows about — cast-based, zone-entry/exit, or a raw
string.

**Triggers can require multiple conditions, or flip inside out.** Combine several triggers
with AND/OR logic on one aura, or invert any aura to show "not yet happened" instead of
"currently active" — handy for "this is up, go use it" reminders.

**Static text auras for anything that isn't a countdown.** Show a fixed label the instant a
trigger fires, no timer attached.

**Share your setup with a code.** Export any aura's full configuration to a compact code a
friend can paste in to recreate it exactly.

## Sound & visual alerts

**Every aura can talk, not just flash.** Independent sounds for "landed," "about to
expire," and "expired," per aura.

**Bring your own sounds.** Pick any audio file on your PC as a custom alert; a small folder
of starter sounds ships with the app so there's always something to choose from
immediately.

**Real in-game spell icons, your choice of art set.**

## Raid lockouts, without the guesswork

**Know when your lockouts actually reset.** EverQuest Legends never prints a lockout line,
so the app reads the weekly-task messages the game *does* print on a raid kill and tracks
each lockout from those.

## Getting around

**Zone-by-zone travel routes.** Pick where you're headed and get the route across the
game's 100+ zones, with the travel spells to use at each step.

## Quality of life

**Trade pings.** An optional alert sound the moment someone sends you a trade request
in-game.

**The log gets organized for you.** Continuous per-day (and per-session) log splitting, an
automatic archive at each raid reset, plus a manual archive-and-truncate option — so your
raw log folder doesn't grow forever unmanaged.

**A Known Buffs library you can correct by hand.** Browse every spell the app knows about,
fix one that's wrong, or add something fully custom — your correction sticks even when the
built-in spell data updates.

**Move your whole setup to another PC.** Export every aura, profile, sound and setting to a
folder, import it on the other machine — offline, no account, no cloud.

---

## Writing copy: tone rules

For anyone writing marketing copy from this file.

- Say what it does **for the player**, never the mechanism. "Real in-game icons," not
  "reads field 75 of `spells_us.txt`."
- Short sentences. Second person. "You never touch it," not "the system operates
  autonomously."
- Every line answers **"so what?"** — the benefit.
- No internal jargon: no "IPC," "detection engine," "roster," "burst window."

---

## Screenshot shot-list

Shots 1–5 carry most of the weight.

1. **Hero.** EQ running, 2–3 auras overlaid (icon grid + a list), buffs mid-countdown.
   Top of everything.
2. **Icon-grid aura close-up.** Real spell art, timers visible — shows it looks good, not
   like a debug tool.
3. **List-view aura close-up.** The other display style.
4. **Aura settings panel open.** Lots of control without looking overwhelming.
5. **"+ Add aura" premade list.** Makes the "couple of clicks" claim visible.
6. **Custom trigger being set up** — the "fire off any log line" story.
7. **Share code dialog.** The viral feature.
8. **Travel guide** with a route displayed — distinctive, nothing else does this.
9. **Raid lockout page** — for the raiding audience.
10. **Sound picker / alert settings** — "bring your own sounds."

## Video shot-list

Video 1 plus screenshots 1–5 carry about 90%.

1. **Trailer / overview (45–60s).** A log line appears in game → a buff pops onto the
   overlay → counts down → flashes and beeps near expiry. Then a fast montage: adding an
   aura, dragging it, switching display mode, muting. End on the hero shot.
2. **Make an aura from scratch (20–30s).** Add aura → pick premade → pick spell → it's
   live. Real time, no cuts.
3. **A custom trigger (15–20s).** Point an aura at a line of chat text, show it firing in
   game.
4. **Share a setup (15s).** Copy a code on one PC, paste on another, the identical aura
   appears.
