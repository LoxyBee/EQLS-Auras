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
    version: 'Unreleased',
    date: null,
    new: [
      'Raid lockout grid, weekly log rotation, and in-app log tools (change / add / trim the log)',
      '"Preview" button - flash a sample tile on an aura without alt-tabbing into the game',
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
    ],
    fixes: [
      'The Hole travel route goes via Paineel instead of Erudin',
      'A line aura\'s coloured edge is no longer painted over by its row icon',
      'A picked alert sound keeps its name when you reopen the settings, and "Use default" is always there',
      'The stale "Not active yet." note is gone from the timer-text colour picker',
    ],
  },
];

module.exports = { CHANGELOG };
