'use strict';

// In-app changelog (backlog #18), rendered on the About page. Newest entry first.
//
// The Documentation session owns the CONTENT: as part of the pre-PR doc pass it adds/updates the
// top entry for the work being shipped - new features first (`new`), then bug fixes (`fixes`) -
// drawing from the DONE backlog items and the `fix:` commits. `version: 'Unreleased'` holds work
// not yet in a tagged release; give it a real version string and a `date` when it ships.
//
// Shape: { version, date: 'YYYY-MM-DD' | null, new: string[], fixes: string[] }

const CHANGELOG = [
  {
    version: '1.0.0',
    date: '2026-09-02',
    new: [
      'The Damage parser is out of the lab and into Add Aura - a per-attacker readout for the current fight, biggest first, each with a coloured bar; the fight total sits at the bottom, and between fights it shows your running total since you zoned in',
      'A new Aggro Board aura - shows which player your target is actually swinging at, and who is next in line behind them, read straight from the log',
      'A .js module you drop into the app\'s folder yourself now stays off - and the Setup page shows nothing about it - until you add one, then switch it on and clear a one-time confirmation; the app\'s own built-in modules (like the Aggro Board) are unaffected',
      'Damage meter: scope it to your whole group or just yourself (shares are recalculated, not just hidden), charmed pets show as their own rows, and each row can read damage, rate (DPS), or both',
      'A depletion shade on icon-mode aura tiles - a shrinking dark overlay that shows how much time is left, since icon tiles have no countdown bar (per aura, off by default)',
      'Timer text can fade from amber down to the expiring-soon red as a buff runs out, instead of only flashing at the threshold (per aura, off by default)',
      'Icon-mode auras can hold an expired tile greyed-out for a few seconds before it clears (per aura, off by default)',
      'A "Duration looks wrong" button on each row of "Active on this aura" - copies a ready-to-send report with the spell, its timing, and the recent detection-log lines',
      'A dismissible setup checklist on the Buff Tracker page that points you at anything still unconfigured - EQ folder, spellbook file, AA, auras',
      'Precise aura positioning: each unlocked aura gets a little arrow pad centred over it - with a settings cog - plus a shared Step / Snap-to-grid panel; nudge every aura individually with "Unlock all auras"; works for action bars too',
      'The named-kill board now covers dungeons too - Mistmoore, Guk, Crushbone, Befallen, Blackburrow, Najena, Splitpaw, the Warrens - not just raid zones',
      'The Bard Songs aura is now a buff/debuff feed: turn on debuff songs (off by default), and optionally split them into their own section',
      'Balanced / Defensive / Mage Hunter / Striker stances and the Spellblade / Empowering invocations can be picked now',
      'Your active stance and invocation are remembered across a restart',
      'Drag one action-bar gem onto another to swap the two; slots you have set up get a marker dot',
      'Set the hour your per-day log split rolls over, so a late-night raid stays in one file',
      'A one-time nudge on launch to trim an oversized log, keeping the current lockout week intact',
      'Every dropdown is themed to match the app, and the long ones (spellbook file, skill, zone) are searchable',
      'The current zone is picked up from your log the moment the app starts, so zone-gated auras and the travel guide are right straight away',
      'Collapsed settings sections show their current value in the header',
      'The Loss of control aura also catches the game\'s generic "you lose control of yourself" line',
      'Raid lockout grid, weekly log rotation, and in-app log tools (change / add / trim the log)',
      '"Show example content" - fill empty auras with sample tiles to size and place them, per aura or all at once from the Overlay page; real buffs always win',
      'Per-aura sound cooldown - stop an alert firing on every refresh of something that pulses',
      'Searchable spell picker for the "Skill cast" custom-timer trigger, with bard songs listed',
      '"Only in:" zone gating is a search field now, not a long dropdown',
      'The eqtm zone picker understands nicknames, raid-boss names and client short names',
      'Sidebar badge while ambiguous casts wait; a "is it working right now?" line on the Buff Tracker page',
      '"Mute sounds" toggle in the top bar',
      'Live {spell} / {caster} / {profile} preview under the "Say:" field',
      '"Open app data folder" and "Back up now" buttons; your sounds folder now lives with the rest of your app data',
      'Export your whole setup to a folder and import it on another PC - offline, no account',
      'Type your character and server when the spellbook is not being found on its own',
      'Auras and timers stop when your character dies',
      'A heads-up on the Buff Tracker page when EQ is in exclusive full-screen (auras can\'t draw over it)',
      'The tools that write to EverQuest\'s own log files - the weekly archive and the per-day split - are off by default now; turn them on if you want them',
      'Evidence-based detection is on by default - fewer buffs get silently missed after a restart or a loadout swap. The Diagnostics section has the toggle to turn it back off',
      'The app has its own icon now - the eqlsource mark - on the window, the taskbar and the installer, instead of the default Electron one',
    ],
    fixes: [
      'The lockout grid reads just the current week from your live log, so turning the weekly archive off doesn\'t slow it down',
      'A groupmate\'s damage no longer drops to zero on the meter for the rest of the session after one stray hit lands on them',
      'A groupmate\'s own melee procs no longer show up as buffs you cast on them',
      'Bard resist songs and caster resist spells no longer knock each other off',
      '"You feel smaller" resolves to Shrink without asking - Tiny Companion only lands on a pet',
      'The weekly log archive is named for the US Eastern reset day, not your PC\'s calendar day',
      'Spellbook picker: a clearer message when a pinned file has moved, and it no longer re-scans the folder while you type',
      'The Hole travel route goes via Paineel instead of Erudin',
      'A line aura\'s coloured edge is no longer painted over by its row icon',
      'A picked alert sound keeps its name when you reopen the settings, and "Use default" is always there',
      'The stale "Not active yet." note is gone from the timer-text colour picker',
      'Mote-scaled bard song timers now land on the real 6-second boundary',
      'The damage meter missed the game\'s direct-nuke wording, so a caster often saw no row for themselves',
      'The damage meter was dropping about a dozen melee verbs (cleaves, frenzies, backstab and more) - roughly a twentieth of all melee hits went uncounted',
      'The damage meter now reads a damage shield you are wearing yourself, not just other people\'s',
      'The damage meter stopped counting on the 1st to 9th of a month, from the way the game pads the date',
      'Overlay auto-hide polls less often while you are not in EverQuest, and if Windows blocks the tool it uses to see the front window it now says so instead of retrying forever',
      'Every tooltip and hint reworded shorter and plainer',
    ],
  },
];

module.exports = { CHANGELOG };
