# Writing a module

> **This file lives with the source and is never shipped.** It is not compiled into the installer
> (`build.files` in `package.json` is `src/**` + `package.json`, and this is under `docs/`), and it
> is not written for end users — it is the reference for whoever writes drop-in modules. Keep it
> under `docs/`; do not move it into `src/`.

A **module** is a single `.js` file that adds a new custom aura to EQLS Auras without touching the
app's source, building it, or shipping a new version. You write the file; how it reaches a running
app depends on who is adding it:

- **The owner is vouching for your module** (shipping it to everyone). The owner adds your module's
  `id` to `CORE_MODULE_IDS` in `src/main/moduleHost.js` and cuts a build. From then on it's a
  *core* module: always on, no consent prompt, and it never appears on the Custom modules list —
  it's treated as part of the app. This is the path for the bundled `aggro-board`.
- **An end user is adding your module for themselves.** They drop the `.js` into the `modules/`
  folder, then turn it on in **Log & Setup → Custom modules** — it starts off, and each enable
  asks them to confirm. Only then does its aura type appear in Add Aura.

Modules are a **trusted-collaborator** path — a running module has full Node access in the app's
main process, no sandbox (see [Trust and limits](#trust-and-limits)). It is deliberately not a
public plugin system.

## Where the file goes

    <install folder>\modules\your-module.js

The `modules/` folder **inside the app's install directory**, next to the `.exe` — the same folder
the bundled `aggro-board.js` module ships in. The default per-user install is writable, so dropping
a `.js` in there needs no admin rights; it does get removed on an uninstall, like anything else in
the install folder. (A dev build reads the repo's own `modules/` folder instead.)

The app scans that folder on startup and **watches it while running** — drop a file in or delete
one and it re-scans within a fraction of a second, no restart (the file appears in the Custom
modules list, still off, until enabled). Files load in alphabetical order. A filename starting
with `.` is ignored.

## The contract

`module.exports` is one object:

```js
module.exports = {
  id: 'my-thing',            // required — lowercase letters, digits, dashes. unique.
  name: 'My Thing',          // required — shown as the aura's name / page title.
  apiVersion: 1,             // required — must equal the app's module API version (currently 1).
  description: '',           // optional — one line, shown next to the aura in the Add-Aura list.
  hasAura: true,             // optional (default false) — does this module put tiles on the overlay?
  settingsUI: 'aura',        // optional — where `page` renders. 'aura' (default) = on the module
                             //   aura's own settings panel, no sidebar entry. 'sidebar' = a
                             //   dedicated nav button + page. See "The settings page" below.
  page: [                    // optional — the module's own settings.
    { section: 'Detection' },
    { key: 'threshold', type: 'slider',   label: 'Alert under', min: 0, max: 60, step: 1, default: 30 },
    { key: 'loud',      type: 'checkbox', label: 'Play a sound', default: false },
    { key: 'mode',      type: 'select',   label: 'Mode', options: ['fast', 'slow'], default: 'fast' },
    { key: 'note',      type: 'text',     label: 'Label' },
  ],
  onLine(line, ctx, settings) {   // required — called for every log line, alongside the built-ins.
    // ...
  },
};
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/` — lowercase letters, digits, single dashes, no leading/trailing dash. Unique across all installed modules; a clash rejects the second file. Permanent identity — pick once, don't change (settings are stored against it). |
| `name` | yes | Any non-empty string. |
| `apiVersion` | yes | Exactly `1`. A mismatch is rejected with a reason in the debug log. |
| `description` | no | One line. Default `''`. |
| `hasAura` | no | `true` if the module renders overlay tiles from what `onLine` returns. Default `false`. A module without an aura still runs `onLine` but in v1 has no visible output — if it has no aura and no `page` it does nothing. |
| `settingsUI` | no | `'aura'` (default) or `'sidebar'`. `'aura'` renders `page` on the module aura's own settings panel — no sidebar button. `'sidebar'` gives the module a dedicated nav button + page. **Best practice is `'aura'`;** reach for `'sidebar'` only when a module has enough *global* options that an aura panel would be cramped. A module with no aura can't use `'aura'` and falls back to `'sidebar'` whatever it asks for. |
| `page` | no | Settings spec. Default `[]`. Renders where `settingsUI` says. A module with no `page` has no settings surface. |
| `onLine` | yes | Turns log lines into aura entries. Must be a function. |

## `onLine(line, ctx, settings)`

Called for **every** log line, in the same stream the built-in buff / damage / lockout engines
see. A module is a **pure observer** — it reads lines and can never stop another engine seeing
them; it should have no side effects (return entries, let the app time them).

**`line`** — the **raw** log line including the timestamp prefix:
`[Wed Aug 27 21:04:11 2026] Baxa begins to cast a spell.` Use `ctx.stripTimestamp(line)` for just
the message.

**`ctx`** (read-only):

| Property | What it is |
|---|---|
| `ctx.currentZone` | Zone the player is in now, as the game prints it, or `null` if not known yet. |
| `ctx.groupMembers` | Array of current group member names. May be empty. |
| `ctx.now` | `Date.now()` for this line. Use this, not your own clock, so replays stay deterministic. |
| `ctx.iconUrlForSpell(name)` | Icon URL for a spell by exact name, or `null`. Pass straight through as an entry's `iconUrl`. |
| `ctx.stripTimestamp(line)` | `line` with the `[...]` prefix removed. |

**`settings`** — an object of the module's current values, keyed by each `page` control's `key`.
User choices override each control's `default`; no `default` falls back by type (`checkbox`→`false`,
`slider`→`min`, `select`→first option, `text`→`''`). No `page` → `{}`.

## What `onLine` returns

`null`/`undefined` (nothing changed), **one entry**, or **an array of entries**.

```js
{
  key: 'boss-enrage',   // optional — identity. defaults to name.toLowerCase().
  name: 'Boss enrage',  // required — the label.
  durationSec: 30,      // optional — full duration, for the bar/ring.
  remainingSec: 12,     // optional — time left now. falls back to durationSec.
  iconUrl: null,        // optional.
}
```

- **Identity is `key`** — returning a matching `key` **updates** that tile, doesn't add one.
- **No duration → infinite** — stays until you clear it.
- **Timing is absolute** — the app stores expiry as a wall-clock instant; a restart within the
  snapshot window restores a running entry with the right time left.

**Clear early:** `return { key: 'boss-enrage', clear: true };` — or `remainingSec: 0` and it goes
on the next 1-second sweep.

## The settings page

`page` is an array; each item is a section heading or a control.

    { section: 'Detection' }

| `type` | Fields | `settings` value |
|---|---|---|
| `slider` | `min` (required, number), `max` (required, number), `step` (optional, default 1), `default` | number |
| `checkbox` | `default` | boolean |
| `select` | `options` (required, array of strings), `default` | string |
| `text` | `default` | string |

Every control needs a `key` and should have a `label`. Changes are saved (`moduleSettings.json`,
keyed by module `id` — **per module, not per aura**: every aura fed by one module shares the one
set of values, matching the single `onLine` that feeds them) and survive a restart.

**Where the controls appear** depends on `settingsUI`:

- **`'aura'` (default, recommended).** The controls render as a *Module settings* card on the
  module aura's own settings panel — the same panel where its position, size and alerts are set.
  No sidebar button. This is the shape almost every module wants: keep the whole thing in one
  place, inside the aura you added.
- **`'sidebar'`.** The module gets its own nav button and page, reading as an ordinary built-in
  page (no "Modules" heading). Use this only when a module genuinely has a lot of *global*
  settings — ones that aren't about any single aura — and an aura panel would be cramped.

A module with `hasAura: false` has no aura panel to use, so its `page` always renders as a
sidebar page regardless of `settingsUI`.

## Your module's aura

Set `hasAura: true` and the module shows up in **Add Aura → Standalone tools**, folded in from
the loaded modules — a dropped-in module appears there within ~1s, no restart. Adding it creates
an ordinary aura: it sits in the aura sidebar like any built-in, and its position / size /
opacity / display style / alerts are set on the normal aura settings panel. That panel has **no
buff picker and no "watching" source** — the module *is* the source.

The aura's tiles are whatever `onLine` returns, drawn through one shared channel keyed by the
module's `id` (internally a `kind: 'module-aura'` aura with `buffSource: 'module'`). Deleting the
module file removes it from the Add-Aura list and its aura goes blank — the aura itself stays
until you delete it.

With the default `settingsUI: 'aura'`, the module's own `page` controls render right here on the
same panel, as a *Module settings* card — there is no separate page to hunt for.

## Enabling a module, and when one doesn't work

**Core modules** (id in `CORE_MODULE_IDS` — `aggro-board`, and `pull-timer` if it's ever copied in)
are on the moment the app starts. They don't appear on the Custom modules list and there's no
prompt — they're vouched-for, so they're treated like built-in code.

**User-added modules** — any other `.js` in the `modules/` folder — show up on **Log & Setup →
Custom modules**, each **off until you tick Enable**. Enabling one pops a confirm dialog every time
("runs code from whoever wrote the file, with full access to your PC"). Until enabled the module is
completely inert: its `onLine` never runs, it isn't offered in Add Aura, and its aura draws
nothing. The whole Custom modules card stays hidden until at least one user-added file exists.

A file that fails to load or validate still appears in that list, with the reason shown inline
(e.g. `apiVersion 2 - this app speaks module apiVersion 1`, or `failed to load: Unexpected token )`).
A runtime error — an `onLine` throw, or a module disabled for being too slow
(`20+ calls over 50ms`) — shows there too. A malformed file is skipped; it never crashes the app
or affects another module. The debug log (**Diagnostics → detection log**) carries the same lines
with timestamps if you want a history.

## Trust and limits

- **No sandbox.** `require()`d into the main process, full Node access. Only accept modules from
  someone trusted.
- **Slow-call guard.** `onLine` over 50 ms on 20+ calls in a session → that module disabled for
  the session (tiles clear). Restart re-enables it.
- **No infinite-loop protection.** A genuinely hung module freezes the app — delete the file,
  restart. Keep `onLine` cheap and obviously terminating.
- **Pure observer.** Can't consume a line, can't change what the built-ins see, can't call into
  the rest of the app.
- **Config bundles don't carry module files.** Export/import moves `moduleSettings.json` (your
  per-module tuning) but not the `.js` itself — the module file has to be present on each machine
  (core modules come with the install; a user-added one has to be copied over).
- **Top-level code runs on scan.** The file is `require()`d when the folder is scanned, before any
  enable, so its top-level statements execute even while it's off. Keep that to declarations.

## Versioning

`apiVersion` is a hard gate. When the contract changes in a breaking way, the app's version bumps
and old modules stop loading (with a reason in the debug log) rather than misbehaving. Current
version: **1**.

## Worked examples

Two real modules to read:

- **`modules/aggro-board.js`** — ships with the app and loads automatically. A larger example:
  it tracks who a mob is swinging at, renders a `page` of settings, and documents its own
  reasoning at length.
- **`docs/modules/pull-timer.js`** — source-only (not shipped), kept small on purpose. It watches
  for a chat command, starts a countdown of a configurable length, and clears it if the pull is
  called off. Reproduced below.

```js
// docs/modules/pull-timer.js
module.exports = {
  id: 'pull-timer',
  name: 'Pull Timer',
  apiVersion: 1,
  description: 'A shared countdown started from a chat command.',
  hasAura: true,
  settingsUI: 'aura',   // its three controls sit on the aura's own settings panel
  page: [
    { section: 'Timing' },
    { key: 'seconds', type: 'slider', label: 'Pull length', min: 3, max: 30, default: 10 },
    { section: 'Trigger' },
    { key: 'startWord', type: 'text', label: 'Start on the word', default: 'pulling' },
    { key: 'cancelWord', type: 'text', label: 'Cancel on the word', default: 'hold' },
  ],

  onLine(line, ctx, settings) {
    const msg = ctx.stripTimestamp(line);
    // only react to guild / group / say chat, not combat spam
    if (!/ (tells the group|tells the guild|say|says),/.test(msg)) return null;

    if (msg.toLowerCase().includes(settings.cancelWord.toLowerCase())) {
      return { key: 'pull', clear: true };
    }
    if (msg.toLowerCase().includes(settings.startWord.toLowerCase())) {
      return { key: 'pull', name: 'Pull', durationSec: settings.seconds, remainingSec: settings.seconds };
    }
    return null;
  },
};
```

## Trying it out

The example module doubles as a smoke test. Copy `docs/modules/pull-timer.js` into the install's
`modules\` folder (next to the `.exe`, alongside `aggro-board.js`), then — because `pull-timer` is
in `CORE_MODULE_IDS` and would just load silently — **change its `id` to `pull-timer-test`** so it
goes through the user-added path. With the app running:

- [ ] Save the file → within ~1s, no restart, **Log & Setup → Custom modules** lists
      **Pull Timer**, off, with its description. It is NOT yet in Add Aura.
- [ ] Tick Enable → a consent dialog names the risk; confirm → **Add Aura → Standalone tools** now
      lists **Pull Timer** (no sidebar button — it's `settingsUI: 'aura'`).
- [ ] Add it → an overlay aura is created. Open its settings → a **Module settings** card shows
      the Pull length / Start word / Cancel word controls.
- [ ] A group / guild / say chat line containing `pulling` starts a countdown tile on that aura;
      a line containing `hold` clears it.
- [ ] Edit the file — change the pull-length `default` from `10` to `20`, save → the module
      reloads and the next pull runs 20s.
- [ ] Change `settingsUI` to `'sidebar'`, save → a **Pull Timer** nav button + page appear
      instead, and the Module settings card on the aura panel is gone. Change it back.
- [ ] Untick Enable → the Add-Aura entry disappears and the countdown stops; an aura you already
      created stays but shows nothing. Re-tick → consent is asked again (it's shown on every
      off→on). Delete the file → it drops off the Custom modules list entirely.
- [ ] Break the file (introduce a syntax error) → nothing crashes; the Custom modules list shows
      **pull-timer-test.js** with `failed to load: ...` inline.
- [ ] Set the `id` back to `pull-timer` → it stops appearing on the Custom modules list and loads
      automatically with no prompt (that's the core tier).
