# EQLS Auras — Feature Highlights

A plain-English rundown of what the app actually does today, written as headline + one-liner
pairs — the kind of list you'd use to show someone else the app, not a backlog. Everything here
is *built and shipped*, not planned. For what's still coming, see `FEATURES.md`; for the
session-by-session history behind any of these, see `CLAUDE.md`.

---

## Core tracking

**Never lose track of your own buffs again.** A transparent, click-through overlay sits on top of
EverQuest and counts down every buff you have running, read straight from your live log file — no
alt-tabbing to a spellbook or guessing when something's about to drop.

**Built for a private server, not just live EQ.** Detection is tuned specifically for EverQuest
Legends' text and timings, not assumed from standard EQ data.

**Exact-text detection, not guesswork.** Every buff is recognized by its real in-game landing
text, mined from the game's own files — so what shows up on screen is what the game actually said
happened, not a pattern match that might be wrong.

**A restart doesn't wipe your timers.** Close the app or your PC hiccups mid-session, and running
buffs, ally buffs, and custom timers pick back up right where they left off (within a 5-minute
grace window, so nothing stale lingers).

## Multi-window overlay system

**As many independent auras as you want, each its own window.** Position, size, opacity, colors,
icon vs. list vs. text display — every aura is configured separately and remembered.

**Two ways to read your buffs at a glance.** Switch any aura between a compact icon grid and a
detailed list view.

**The overlay gets out of your way automatically.** Auras auto-hide when EverQuest isn't the
focused window, and come back the instant it is — no manual toggling.

**Drag, drop, done.** Unlock any aura to reposition it live over the game, with a visible
grab-box; lock it back down and it stays put.

## Loadout-aware for multiclassers

**Swapping loadouts doesn't confuse the tracker.** EQ Legends' multiclass loadout system can
change your castable spells without touching your spellbook — named profiles let you tell the app
"I just swapped," so buff detection re-learns the ambiguous cases per loadout instead of getting
them wrong.

**A profile bar right in the main window.** Switch active loadout with one click; everything the
app is currently watching for updates instantly.

## Beyond your own buffs

**Track what you're casting on your group, not just yourself.** Ally-buff tracking shows what
you've landed on each groupmate, grouped by name.

**Bard songs get their own aura, because they have to.** Self-cast vs. an ally's cast is
genuinely unrecoverable from the log for songs specifically — this dedicated aura tracks every
song active on you regardless of caster, attributing to a name whenever it honestly can and
labeling "Unknown" rather than guessing.

**A real damage meter.** Reads combat lines and works out attacker/target/direction from the
log's own grammar (no assuming "friendly-sounding name = ally"), giving you one row per attacker
for the current fight.

## Custom & premade auras

**One-click premades for the common stuff.** Buff timers, cooldown timers, resist flashes, "you
got dispelled," and a dedicated "your charm broke" alert are all ready to drop in with a couple of
clicks — no configuration from scratch.

**A cooldown timer that also tracks the buff itself.** One tile can count the buff's active
duration first, then roll straight into "ready again in X" with no reset in between.

**Build your own trigger from any log line.** Custom timers watch for arbitrary text you specify,
not just buffs the app already knows about — cast-based, zone-entry/exit, or a raw string.

**Triggers can require multiple conditions, or flip inside out.** Combine several triggers with
AND/OR logic on one aura, or invert any aura to show "not yet happened" instead of "currently
active" — handy for "this is up, go use it" reminders.

**Static text auras for anything that isn't a countdown.** Show a fixed label the instant a
trigger fires, no timer attached — for alerts where a number would be noise.

**Share your setup with a code.** Export any aura's full configuration to a compact code a
friend can paste in to recreate it exactly.

## Sound & visual alerts

**Every aura can talk, not just flash.** Independent sounds for "landed," "about to expire," and
"expired," per aura.

**Bring your own sounds.** Pick any audio file on your PC as a custom alert; a small folder of
starter sounds ships with the app so there's always something to choose from immediately.

**Real spell icon art, pulled from your own game install.** Icons are read directly out of your
EverQuest Legends texture files — genuine in-game art, not placeholder graphics — with a choice of
the game's alternate icon sets.

## Raid lockouts, without the guesswork

**Know when your lockouts actually reset.** EverQuest Legends never prints a lockout line, so the
app reads the weekly-task messages the game *does* print on a raid kill and tracks each lockout
from those.

**It reports what it's seen, not a hardcoded reset day.** Other tools bake in a reset day and
hope it's right. This one shows the reset as the window your own kill history actually supports,
and says so plainly until it's seen enough to be sure.

**Timezone-correct wherever you play.** The reset is a wall-clock time in US Eastern that shifts
with daylight saving — the app converts it to a real instant so it lines up whether your PC is on
Pacific, Eastern, or London time.

## Quality of life

**Finds your game automatically.** Point it at nothing — the app locates your EverQuest Legends
install and log folder on its own.

**Trade pings.** An optional alert sound the moment someone sends you a trade request in-game.

**The log gets organized for you.** Continuous per-day (and per-session) log splitting, an
automatic archive at each raid reset, plus a manual archive-and-truncate option — so your raw log
folder doesn't grow forever unmanaged.

**A Known Buffs library you can correct by hand.** Browse every spell the app knows about, fix
one that's wrong, or add something fully custom — your correction sticks even when the built-in
spell data updates.

**Move your whole setup to another PC.** Export every aura, profile, sound and setting to a
folder, import it on the other machine — offline, no account, no cloud.

**Preview an aura without alt-tabbing.** One button flashes a sample tile on the overlay so you
can size, position and colour it against the real game window.

**Mute everything with one click.** A top-bar toggle silences every alert sound for streaming or
a call, without touching your per-aura settings.

**Ships as a real Windows installer.** `npm run dist` produces an installer anyone can hand to a
friend — no dev environment required to run it.
