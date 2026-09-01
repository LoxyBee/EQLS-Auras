# Writing a module

> **This file lives with the source and is never shipped.** It is not compiled into the installer
> (`build.files` in `package.json` is `src/**` + `package.json`, and this is under `docs/`), and it
> is not written for end users — it is the reference for whoever writes drop-in modules. Keep it
> under `docs/`; do not move it into `src/`.

A **module** is a single `.js` file that adds a new custom aura to EQLS Auras without touching the
app's source, building it, or shipping a new version. You write the file, the owner drops it into a
folder, and a new aura type appears in the app.

Modules are a **trusted-collaborator** path — the file runs with full Node access in the app's main
process, no sandbox (see [Trust and limits](#trust-and-limits)). It is deliberately not a public
plugin system.

## Where the file goes

    <userData>/modules/your-module.js

`<userData>` is the app's data folder — the same place `widgets.json`, `profiles.json` and your
sounds live. On Windows: `%APPDATA%\EQ Buff Tracker\modules\` (the folder name is the app's old
name, pinned deliberately — don't rename it).

The app scans that folder on startup and **watches it while running** — drop a file in or delete
one and it re-scans within a fraction of a second, no restart. Files load in alphabetical order. A
filename starting with `.` is ignored.

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

With the default `settingsUI: 'aura'`, the module's own `page` controls render right here on this
same panel, as a *Module settings* card — there is no separate page to hunt for. (This panel still
has no buff picker and no "watching" source — the module *is* the source.)

## When a module doesn't appear

There is **no error panel, reload button, or folder link** in the app — a deliberate choice. If a
module doesn't show:

1. Turn on the debug log (**Log & Setup → Diagnostics → detection log**).
2. Re-drop the file (or restart).
3. Read the log. Load/validation failures are labelled by **filename**:
   `MODULE "my-thing.js" - apiVersion 2 - this app speaks module apiVersion 1`
   `MODULE "broken.js" - failed to load: Unexpected token )`
   Registered-then-failed is labelled by **id**:
   `MODULE "my-thing" - disabled - too slow (20+ calls over 50ms)`

A malformed file is skipped — never a crash, never affects another module.

## Trust and limits

- **No sandbox.** `require()`d into the main process, full Node access. Only accept modules from
  someone trusted.
- **Slow-call guard.** `onLine` over 50 ms on 20+ calls in a session → that module disabled for
  the session (tiles clear). Restart re-enables it.
- **No infinite-loop protection.** A genuinely hung module freezes the app — delete the file,
  restart. Keep `onLine` cheap and obviously terminating.
- **Pure observer.** Can't consume a line, can't change what the built-ins see, can't call into
  the rest of the app.

## Versioning

`apiVersion` is a hard gate. When the contract changes in a breaking way, the app's version bumps
and old modules stop loading (with a reason in the debug log) rather than misbehaving. Current
version: **1**.

## A complete example

See `docs/modules/pull-timer.js` — a maintainable, real example: it watches for a chat command,
starts a countdown of a configurable length, and clears it if the pull is called off.

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

The example module doubles as a smoke test. With the app running:

- [ ] Drop `docs/modules/pull-timer.js` into `%APPDATA%\EQ Buff Tracker\modules\` → within ~1s,
      no restart, **Add Aura → Standalone tools** lists **Pull Timer**. No sidebar button appears
      (it's `settingsUI: 'aura'`).
- [ ] Add it → an overlay aura is created. Open its settings → a **Module settings** card shows
      the Pull length / Start word / Cancel word controls.
- [ ] A group / guild / say chat line containing `pulling` starts a countdown tile on that aura;
      a line containing `hold` clears it.
- [ ] Edit the file — change the pull-length `default` from `10` to `20`, save → the module
      reloads and the next pull runs 20s.
- [ ] Change `settingsUI` to `'sidebar'`, save → a **Pull Timer** nav button + page appear
      instead, and the Module settings card on the aura panel is gone. Change it back.
- [ ] Delete the file → the Add-Aura entry disappears; an aura you already created stays but
      shows nothing.
- [ ] Break the file (introduce a syntax error) → nothing crashes. With **Diagnostics →
      detection log** on, the log shows `MODULE "pull-timer.js" - failed to load: ...`.
