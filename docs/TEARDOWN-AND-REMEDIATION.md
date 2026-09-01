# EQLS Auras — Teardown & Remediation Plan

*Adversarial code review, 2026-09-01. Part 1 is the teardown (every problem found, rated 1–10 where
10 = really bad). Part 2 is the fix plan for each finding, sequenced into phases by what unblocks
what.*

## Review notes (Long Context, 2 Sep) — read before acting on severities below

Checked a sample of findings directly against the code rather than taking them on faith. The
factual claims hold up well — most are independently verifiable or are the project's own
documented admissions, not invented. Two corrections and a set of severity disagreements:

**Corrections:**
- **#1**'s module path (`%APPDATA%\EQ Buff Tracker\modules\`) is now stale — as of 1 Sep, modules
  load from the **install folder** (`modules/` next to the `.exe`), not userData. Doesn't change
  the finding (still no sandbox, still auto-`fs.watch`-loaded), just the path.
- **#7**'s 300ms poll interval — verified correct in `foregroundWatcher.js`. It's CLAUDE.md that
  had the stale number ("every 2s"), fixed separately in this same pass. If anything this makes #7
  slightly worse than stated, not overstated.
- **New, found while checking this doc, not in it**: `test/log-rotation.test.js` has ~20 tests
  hardcoding `new Date(2026, 8, 2, ...)` ("tomorrow", when written) as a fake "now" while writing
  real files with real mtimes — the exact wall-clock fragility finding #9 describes, but as a
  **test** landmine rather than a runtime one. One (`'a week that opened with an empty log...'`)
  had already flipped and was failing; fixed by pinning that file's mtime instead of trusting real
  time to stay behind the hardcoded date. The other ~19 are still ticking and will start failing
  one at a time as real time passes each hardcoded date. Worth its own remediation item — see
  Phase 3 addendum at the bottom.

**Severity disagreements** (didn't touch the ratings below — noting where I'd weigh them
differently, so read the two together rather than either alone):
- **#8** (by-design mislabeling) — 6→7/10 feels high for how narrow and bounded this actually is
  (one burst-detection case, with an explicit "never over-land" boundary — buff count is never
  invented, only naming within an already-confirmed burst). I'd call it a 4.
- **#10 / #11** (stale memorized state, restart blindness) — both real, but framed as oversights
  when the project's own docs treat them as consciously accepted tradeoffs with built-in correction
  paths (a per-gem "forget" UI; the deliberate zone-line exception to never-replay). Worth
  softening (Phase 1's plan to do exactly that is right), not evidence nobody thought about it.
- **#17** (config import risk) — undersells that `importConfig()` already takes an automatic
  pre-import safety backup before touching anything. I'd rate it a notch lower than 6.
- **#20** (workflow as a bug) — the single-brancher model was adopted deliberately after real
  concurrent-edit conflicts, not stumbled into. Fair to call friction, not quite fair to call
  unconsidered.
- **#1**'s severity (9/10) — the core finding (no consent, no sandbox, auto-execute) is legitimate
  and worth closing given the stated goal of eventually handing this app to other people. But it's
  pitched at public-plugin-store severity for what was designed as a single-trusted-collaborator
  path. I'd keep it high (7–8), not top-of-scale.

Everything else — the detection-engine early-return chain (#2), the monolith files (#12), and the
cruft/process items (#14/#15/#19/#21/#22) — I agree with essentially as stated; most are drawn
directly from the project's own CLAUDE.md.

**#3 correction (1 Sep, owner):** the finding treated the roster as an incomplete copy of the game
file. It isn't — it is deliberately scoped to the spells EQ Legends actually has, and matching it
against `spells_us.txt` (every spell from every EQ version) would import false ambiguity from
spells nobody can cast here. Downgraded to ~4; P1-1's veto mechanism dropped and replaced with an
ongoing "add the real missing EQL spell when one surfaces" data task. See the revised #3 and P1-1.

---

# Part 1 — The Teardown

Severity scale: **9–10** catastrophic · **7–8** severe · **5–6** real problem · **3–4** cruft / process.

## Catastrophic (9–10)

### #1 — Unsandboxed module system: RCE with an `fs.watch` trigger — 9/10
`moduleHost.js` `require()`s arbitrary `.js` straight into the **main process with full Node**, and
watches `%APPDATA%\EQ Buff Tracker\modules\` so *anything that writes a file there* executes
automatically — no restart, no prompt, no user-visible module list, no error panel, no folder link
(all explicitly declined in the header comment). The entire security model is a code comment that
says "modules come from the owner or a known collaborator." Then `configTransfer` bundles modules
into the export, and `shareCodeChat` trains users to paste configuration from chat. The product
roadmap is quietly converging on "paste this bundle to set up my app," which is "paste this to run
my code."

- A genuinely hung module (`while(true)`) **freezes the whole app** — overlay, detection,
  everything. The `SLOW_CALL_MS` / 20-strikes guard is useless against a call that never returns.
  The comment admits this and calls real isolation "out of scope for v1."
- `delete require.cache` + re-`require()` on every file change leaks the old version's timers,
  closures and listeners. Editors that write-twice-on-save double every reload.

> **⚠️ Auto-execution closed on `fix/public-release-hardening`.** A dropped module is now inert
> until explicitly enabled (with a consent dialog) - see P0-1. What's NOT closed: an *enabled*
> module still `require()`s into the main process with full Node, a `while(true)` still freezes
> the app, and the require-cache leak on hot-reload of an enabled module is unchanged. That's the
> sandbox (P2-4). Severity of what remains: 6-7 (enabled = the user consented), not 9.

## Severe (7–8)

### #2 — The detection engine is a graveyard of admitted-wrong heuristics — 8/10
CLAUDE.md has **33 numbered "learned the hard way" gotchas** and a "P0 — architectural rework" that
opens with "This is one problem with several symptoms." The known root cause — `handleLine()` is a
chain of early `return`s, so a tier that matches-then-fails-confidence eats the line and the correct
tier never runs — is **still what ships**. The fix (`useEvidenceModel`) is built.

> **⚠️ Partly addressed (2 Sep, `fix/public-release-hardening`).** `useEvidenceModel` was measured
> against a real week (+241 landings, 0 lost, +6 prompts) and is now **ON by default**, with the
> Diagnostics toggle as the one-click revert. `useCastTimeFilter` and `useStackingModel` were
> measured too and deliberately left OFF (no benefit / unvalidated guess). The early-return tier
> chain itself is not yet deleted - that stays a later release.

### #3 — The roster makes wrong answers look like high-confidence right ones — 8/10 → **revised down to ~4, 1 Sep (owner)**
"Unique landing text" is the top auto-confirm tier, and "unique" is judged by counting roster
entries. The teardown framed the fix as: count against the game's `spells_us_str.txt` instead,
since that has ~37,000 more spells. **The owner rejected that framing and is right to.** The
roster (~1,067) is not an incomplete copy of the game file — it is deliberately scoped to the
spells **EQ Legends actually has**. `spells_us.txt` carries every spell from every version of EQ
ever shipped; the vast majority cannot be cast on this server. Vetoing a unique-text auto-confirm
because some 2015-expansion spell shares that text would make the app prompt "which spell was
that?" for buffs that were never ambiguous here — a permanent regression traded for a rare
mislabel that finding #8 already documents as an accepted tradeoff.

What's actually real is narrower: a spell that **is** castable on EQ Legends but was missed when
the roster was built. That has happened (Armor of Protection, confirmed from a real log; 386 bard
songs dropped by an early duration filter) and each was fixed by adding the one spell, after which
the roster's own share-counting handles it correctly. The "Brilliance" case is an instance of
this, not a structural flaw — if Cassindra's Chant of Clarity is a real EQL spell it belongs in
the roster; once it is, `"Your mind clears."` is correctly a 2-way share and prompts with the
right two candidates. This is an **ongoing data task** (report → check if the true spell is a
castable EQL spell → `tools/roster-overrides.json` `add`), not an engine change. See revised P1-1.

### #8 — By-design mislabeling — 6→7/10
"Completeness over perfect naming": the stated, written tolerance is "a possibly-mislabeled buff
showing up beats a real buff being silently dropped." For a tool people glance at to make pull /
timing decisions. The overlay will lie to you and that's a feature.

### #12 — 8,943-line `main-window.js`, 2,689-line `index.html`, 3,175-line `buffEngine.js` — 7/10
One renderer file, ~70 `innerHTML =` sites, for an app whose target user "has no coding experience."
Every parallel Claude session fights over the same four files and the merge-conflict strategy is a
doc bullet that says "check ListAgents first."

### #13 — Concept overload for a non-technical user — 7/10
auras-but-called-widgets-in-the-data; profiles that are the on/off switch except there's no on/off
switch; `activeProfileIds: []` means "show everywhere" not "show nowhere"; twelve `widgetShape()`
shapes with a `SHAPE_FIELDS` matrix; premade groups with greyed-out "Planned" entries; move HUD +
per-box nudge arrows + grid guide + snap; a Diagnostics tab full of half-finished reworks the user
is apparently expected to toggle. The Buff Planner is locked, guess-weighted, effect numbers "NOT
verified," and still shipped in the bundle.

## Real problems (5–6)

### #5 — `eqicon://` protocol writes attacker-controlled paths — 5/10
`iconSet` comes from the URL, gets only `.replace(/\s+/g,'_')`, then `path.join(cacheDir, cacheKey +
'.png')` → `fs.writeFileSync`. Encoded `..\` segments survive whitespace-stripping. Renderer-
controlled arbitrary `.png` write outside the cache dir. Sandbox limits the blast radius; it's still
an unsanitized filesystem write in an IPC-reachable handler.

> **✅ Fixed on `fix/public-release-hardening` (2 Sep).** Icon set is now whitelisted to the 3 known names, id must be plain digits, sound id must be uuid-shaped and its `fileName` must equal its own basename; a resolved-path containment assertion backs both. See P0-3.

### #6 — No CSP — 4/10
Zero `Content-Security-Policy` in any of the 8 renderer HTMLs. No `will-navigate` /
`setWindowOpenHandler` hardening. `sandbox:true` + `contextIsolation:true` are carrying the entire
defense, with 79 `innerHTML` sinks across renderers rendering spell names, zone names, and
chat-derived player names.

> **✅ Fixed on `fix/public-release-hardening` (2 Sep).** Strict CSP meta on all 8 renderer HTMLs (`script-src 'self'`, `connect-src 'none'`), one app-wide `will-navigate` + `window.open` deny. The '79 innerHTML sinks' claim was checked and is overstated - dynamic spell/zone/name content already goes through `textContent`/`createElement`; the CSP is a backstop. See P0-4.

### #7 — A resident `powershell.exe`, polled every 300ms, forever — 4/10
Every AV product on Windows will notice. The comment admits an earlier version was "a fork bomb that
IS the lag it was meant to avoid," now merely rate-limited to a 3s respawn cooldown. An `EPIPE` on
the stdin stream "crashes the whole main process" — reported live as a crash dialog — and is patched
with a listener rather than not architecting it this way.

### #9 — Wall-clock timers, no monotonic source — 5/10
Everything is `expiresAt = Date.now() + ms`. Laptop sleeps mid-raid, DST flips, NTP corrects the
clock — every active timer is now wrong. `sessionSnapshot` "refuses to restore if the system clock
moved backwards," which is the code telling you it knows.

### #10 — `currentlyMemorized` is now persisted and "can be wrong, not just empty" — 5/10
The app now confidently acts on stale gem state from a previous session. Swap loadouts while it's
closed and it silently misattributes based on a memory it believes.

### #11 — Restart = blindness — 5/10
`logWatcher` starts at EOF and never replays. Restart mid-session: every running buff invisible
until recast; any zone / death / memorize before launch never happened. The 5-minute snapshot grace
and the one `logZonePeek` back-scan are patches over a foundational choice.

### #17 — configTransfer import swaps ~all of userData and force-restarts — 6/10
Mixes export bundles and backups in one `listImportable()` list. One misclick restores a stale
config over live raid state and reboots the app. Bundle carries `customSounds/` and modules (i.e.
executable code).

### #18 — Rewriting the user's actual EQ log file, by default — 6/10
Weekly log rotation is **ON by default** and truncates / rewrites the live `eqlog_*.txt`. There's a
`skippedSpansBoundary` guard and a "verify the archive's size before rewriting" check because you
know this is dangerous. Bold default for a buff overlay.

> **✅ Fixed on `fix/public-release-hardening` (2 Sep).** Now OFF by default (opt-in). An install that had ticked it keeps its choice. The daily log-split feature is now OFF by default too, and `lockoutService.backfill()` seeks to the current reset week so the grid no longer needs the archive to have trimmed the file. See P0-2.

### #23 — Damage meter openly can't attribute a third of the log — 5/10
"22% → 65%" credited, "the remaining 35% correctly excluded." Just unlocked as a premade. A DPS
meter that misses 35% of damage is a DPS meter people will screenshot and argue with.

**Update, 2 Sep — re-measured against a real week-long log (17.8M total parsed damage points),
this is now out of date and was also conflating two different things.** The "35%" in gotcha #20
was never "missing wordings" - it was damage correctly classified as INCOMING (an enemy hitting a
friend), which a damage meter should exclude, not a coverage gap. Wording coverage itself, measured
separately: **98.6%** of lines that look like a damage event now parse (a loose independent text
scan vs. the real parser) - the remaining 1.4% is almost entirely other things that only look like
damage (a chat message, a proc-flavor line with no amount), not missed wordings. On the
friend/enemy classification gotcha #20 was actually about: **credited 85.75%**, **9.92% correctly
excluded as incoming**, **4.33% genuinely unresolved even with full-log hindsight** - so 95.67% is
classified correctly one way or the other, and the honest "we don't know" share is under 5%, not
35%. (First measurement, before a same-session fix, showed credited damage lower than this and a
further 7.64% wrongly zeroed by an over-eager collision guard - a real regression, found by this
measurement and fixed the same pass, see the damageEngine commit. The 85.75%/9.92%/4.33% numbers
above are AFTER that fix.) Still worth a coverage readout on the aura per P4-2 below so this stops
being an inferred number nobody can see without instrumenting the log by hand.

## Cruft & process rot (3–4)

### #14 — Dead code kept "to avoid a migration" — 4/10
`enabled` field persisted but read nowhere; ~~`rosterBackfill.js` present but wired out~~ (**deleted
1 Sep**, commit 756aa6d — the guard test now checks the file stays gone, not just that it isn't
called); `zoneVisibility.js` only exists because an inline copy was inverted and passed four tests.
The `enabled`-field removal still wants a proper `widgets.json` migration — see P2-3.

### #15 — Tests prove little — 6/10

> **New (3 Sep): it was worse than this - CI ran `npm test` *nowhere*.** The only workflow built
> the installer and published it on every push to master, no test gate. A `.github/workflows/
> test.yml` running `npm test` on push + PR, plus an `npm test` step before the installer build,
> is now on `fix/public-release-hardening`. Mutation testing is still manual and the suite still
> never launches Electron (`smoke-launch.js` / `smoke-render.js` exist but aren't in `npm test`).
One session found "eight tests that passed while proving nothing." Mutation testing is manual. The
suite never launches Electron, so a `globalShortcut.register('Pause')` that throws shipped past
green.

### #19 — Three product names, one hardcoded `userData` path — 3/10
`EQ Buff Tracker` path for an app now called EQLS Auras heading to "EQLsource," with a comment
forbidding anyone from fixing it. A future dev who "cleans that up" orphans every user's data.

### #20 — The development process is itself a bug — 6/10
Working on `integration` with 6 files modified-uncommitted, a model where one session is "the SOLE
brancher" and everyone else emails diffs, and "check ListAgents before touching a hot file" as the
merge-conflict prevention strategy.

### #21 — Buff Planner guesswork — 4/10
Ranks buffs by effect-slot magnitude with effect numbers "NOT verified against her file," STAT_WEIGHT
hand-tuned by eyeballing one plan, "SPA is banned from the code" as a design rule. Whole feature is
guesswork, correctly locked, but shipped in the bundle.

### #22 — Zone graph rot — 3/10
38 display names "inferred," 191 hand-curated aliases, breadth-first routing that refuses to weight
a boat, one-way sinks hand-flagged. A hand-maintained MUD map that will rot.

### Cross-cutting
- **Module load failures are invisible** to the non-coder owner — the only signal is a line in a
  debug log file that's off by default.
- **The ambiguous popup steals focus mid-fight** — `focusGameWindow` was added to shove EQ back to
  the front because clicking the popup drops you out of the game. A band-aid on a band-aid.

## Verdict — Overall 7/10 bad *(as originally written; ~4/10 after the `fix/public-release-hardening` pass — see the Phase 0 status block and the corrections above)*

The core detection engine — the entire reason the app exists — ships with a structural flaw its own
docs call P0, with the fix sitting behind an off-by-default toggle nobody has tested live. Wrapped
around that is an unsandboxed auto-executing plugin loader, a 9,000-line settings screen aimed at
someone who can't read code, and a habit of keeping known-broken code "to avoid a migration." It
clearly *works* well enough that the owner uses it daily, and the honesty in CLAUDE.md is genuinely
rare. But "we documented why it's broken" is not the same as "it's not broken."

> **Update, 1 Sep.** The detection toggle (evidence model) is now ON by default and measured
> (+241 landings / 0 lost on a real week); the plugin loader is consent-gated and the vouched tier
> is hidden; the biggest structural claim, #3, was **overstated** — see its correction. What's left
> of the detection work is a legacy-code deletion, small refinements, and an ongoing roster-data
> task. "Broken" was too strong even when written; it is not the right word now.

---

# Part 2 — The Remediation Plan

## How to use this

**Who does what.** Code changes land on session branches and are merged by the branching session
(see P2-5). Anything only checkable with the game running goes to `docs/TESTING.md` unchecked — it
is not a blocker on the code being "done". All `docs/` and backlog writing goes to the Documentation
session, never inline.

**Detection work is gated on measurement.** Every change under Phase 1 must pass
`node tools/replay-log.js` with the baseline unchanged (129 buffs · 211,546 landings · 840 ally ·
27 prompts · 91 unknown) *and* one clean live session before its default flips.

**Sequencing rule.** Phase 0 ships before anything else. Phase 1 items each flip their default only
after `replay-log.js` baseline holds *and* one clean live session. Phase 2 P2-1 (file split)
precedes P2-2 / P2-3 / P2-5. Everything in Phase 3–4 is independent.

**Not in this plan, on purpose.** The "auras vs widgets" terminology split (deliberate, scoped owner
decision) and the "completeness over naming" detection stance (P1-5 makes it visible rather than
reversing it) are working as intended.

---

## Phase 0 — Stop the bleeding (~3–5 days)

Small, self-contained, no design debate. These remove the drive-by code-execution path and the two
defaults that can damage a user's files. Ship as one branch.

> **Status, 3 Sep — branch `fix/public-release-hardening` (PR #33 merged commits 1-4; ~23 more on
> top, not yet merged).** P0-1 ✅ (reworked to two tiers - vouched core hidden, user-added
> consent-gated; documented residual), P0-2 ✅, P0-3 ✅, P0-4 ✅, P0-5 ✅.
> Beyond Phase 0 on the same branch: **evidence-based detection ON by default** (P1-2's flip half,
> measured +241 landings / 0 lost - the legacy-chain deletion stays a later release), **lockout
> backfill seeks to the current reset week** (a bounded-read cousin of P1-4), **daily log split
> OFF by default**, a **CI workflow that runs `npm test`** on every push + PR (closes the
> new-finding gap: CI never ran the tests), a **zone-graph integrity test** (P4-3, data was
> clean), **P3-7 ✅** (test-date landmines de-fanged before they could red-light CI on release
> week), and the **eqlsource app icon** wired into the build + main window.
> Still genuinely open: P1-2's rework, P1-3 (partly covered by the evidence model), P1-4's general
> catch-up scan, P1-5, P2-*, P3-1/3/4, P4-1/2. (P3-6 already-done — `test/pin.test.js` predates the
> review. P3-7 ✅. P3-2 ✅ — adaptive polling + circuit breaker. **P1-1's veto mechanism dropped**
> 1 Sep — the roster is EQL-scoped by design, not incomplete; replaced with an ongoing data task,
> #3 downgraded ~8 → ~4.)
>
> **Re-ratings (a5, 2 Sep):** #8 → ~4 (narrow, bounded, never over-lands). #17 → 5 (auto
> pre-import backup exists). #23 → ~3 (re-measured 85.75% credited / 9.92% held / 4.33% unresolved
> - the original "misses 35%" misread incoming damage as dropped).
>
> **Minimum release-blocking set now:** nothing in code. Owner actions only — merge this branch to
> master, rebuild the installer + eyeball the icon, and one live session with the evidence model on.
> (`fix/module-watcher-eperm-crash` turned out already-merged. MIT license + `LICENSE` file added
> 1 Sep after a5's pre-release pass flagged the gap — `test/license.test.js` guards it. Two hollow
> `buff-planner.test.js` try/catches and four stale `main-window.css` doc refs also fixed that pass.)

### P0-1 — Close the module drive-by execution path — finding #1a — sev 9 — ✅ DONE (`fix/public-release-hardening`)
The full sandbox is Phase 2; this phase removed the *automatic* execution and made modules visible.

> **Shipped, then reworked to two tiers (`fix/public-release-hardening`, 1 Sep):**
> - **CORE (vouched)** — an id in `CORE_MODULE_IDS` (`moduleHost.js`; `aggro-board` + `pull-timer`).
>   Folded in by a deliberate source edit + build, so trusted like app code: always enabled, no
>   consent, and **filtered out of the Setup-page list entirely** so a vouched addition doesn't sit
>   in the options taking up space. `_isEnabled` / `setModuleEnabled` short-circuit on a core id, so
>   a hand-edited allow-list can't switch one off.
> - **USER-ADDED** — any other `.js` the user drops in. Inert (`onLine` never runs, absent from Add
>   Aura, aura draws nothing) until ticked on the **Log & Setup → Custom modules** list, first enable
>   behind a consent dialog. That card stays **hidden until such a module exists**. Load/validation
>   *and* runtime errors show inline (`modules:error` broadcast).
>
> Config bundles already don't carry module files. **Residual, by design:** the scan `require()`
> still runs a module file's top-level code once, before enable - closing that means not
> `require()`ing until enable (losing the pre-enable name) and is folded into P2-4's isolated-process
> work. This tier's minimum-release bar (a5, 2 Sep): consent gate + config-bundle exclusion + the
> enable page — all shipped. Full `utilityProcess` isolation (P2-4) is post-1.x.

1. Remove the `fs.watch` auto-load. Folder scan still discovers files, but a discovered module is
   **disabled until explicitly enabled**.
2. Add a **Modules** settings page: one row per discovered file with an Enable toggle (default off),
   the module's declared name / description, and any load / validation error shown inline — not just
   in the debug log.
3. First time a module is enabled, show a one-time consent dialog: plain-language "this runs code
   from whoever wrote the file, with full access to your PC."
4. Strip `modules/` from `configTransfer.exportConfig()`; on import, if a bundle contains module
   files, list them and refuse to place them — the user copies them in by hand and enables them
   deliberately.
5. Keep the per-call slow-strike budget as-is.

*Touches:* `src/main/moduleHost.js` · `src/main/configTransfer.js` · `src/renderer/main-window`
(new page) · `preload-main.js`

### P0-2 — Weekly log rotation defaults to OFF — finding #18 — sev 6 — ✅ DONE (`fix/public-release-hardening`)
1. Flip the store default for the rotation setting to off. Add a one-time migration so existing
   installs that never touched it also go off (version-gated, same pattern as the `widgets.json`
   bumps).
2. Rewrite the Setup-page copy to state plainly that this feature rewrites the game's log file, and
   what it keeps.
3. For opt-in users: keep the last pre-rotation copy for one cycle as an undo, alongside the
   archive-size verification that already gates the rewrite.
4. "Trim log to this week" stays manual-only behind its existing danger dialog.

*Touches:* `src/main/logRotation.js` · `src/main/store.js` · Setup page copy (→ Documentation for
TESTING.md line)

### P0-3 — Validate `eqicon://` / `eqsound://` paths — finding #5 — sev 5 — ✅ DONE (`fix/public-release-hardening`; icon set whitelisted to ICON_SETS, id must be digits, sound id must be uuid-shaped + fileName must be its own basename, resolved-path containment assert on both, `test/protocol-path-safety.test.js`)
1. Reject `iconId` that is not a non-negative integer.
2. Whitelist `iconSet` against the sets `countIconSheets` actually enumerates; reject anything else
   with a 404.
3. Before any read or write, assert `path.resolve(target)` starts with
   `path.resolve(cacheDir) + path.sep`.
4. Audit `eqsound://` the same way — confirm the sound registry cannot be seeded with a `fileName`
   containing separators.
5. Add `test/` coverage feeding `..\`, encoded, and absolute-path payloads to both handlers.

*Touches:* `src/main/iconService.js` · `src/main/soundService.js` · new
`test/protocol-path-safety.test.js`

### P0-4 — Add a CSP and navigation guards to every renderer — finding #6 — sev 4 — ✅ DONE (`fix/public-release-hardening`; strict CSP meta on all 8 renderer HTMLs, one app-wide `web-contents-created` handler denying `will-navigate` + `window.open`, grid-guide's inline script extracted, `test/renderer-wiring.test.js`. Note: audited the innerHTML sites - the teardown's '~70 sinks rendering chat strings' was overstated, the only interpolation left is a formatted number)
1. Add a strict CSP `<meta>` to all 8 renderer HTMLs:
   `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' eqicon: data:; media-src eqsound:; connect-src 'none'`.
2. On every `BrowserWindow`: `contents.on('will-navigate', e => e.preventDefault())` and
   `setWindowOpenHandler(() => ({ action: 'deny' }))`.
3. Grep the `innerHTML =` sites; anywhere a spell / zone / player / chat string is interpolated,
   switch to `textContent` or `createElement`. Most are static templates — confirm and leave a note.
4. Add a renderer-wiring test asserting the CSP meta tag is present in each shipped HTML.

*Touches:* all `src/renderer/*/index.html` · `src/main/*Window.js`, `widgetManager.js`,
`ambiguousPopup.js`, `zonePromptPopup.js` · `test/renderer-wiring.test.js`

### P0-5 — Commit or stash the dirty `integration` tree — finding #20 (part) — sev 3 — ✅ DONE (`integration` shipped as 1.0.0, PR #32)
1. Review the six modified files (aggro-board.js, moduleHost.js, index.html, main-window.js, two
   tests), commit them with a real message or stash them.
2. Confirm `npm test` is green on the committed tree, and `node tools/smoke-launch.js` starts clean.

---

## Phase 1 — Fix the actual job: detection (~1–2 weeks)

The reason the app exists. The reworks are largely built and sitting behind off-by-default toggles;
this phase is mostly validation and deletion of the old path, plus two small new pieces.

### P1-1 — ~~Veto "unique landing text" using raw game data~~ → **Roster completeness as an ongoing data task** — finding #3 — sev ~4 — no engine change
**Original mechanism dropped, 1 Sep (owner).** Vetoing a unique-text confirm against the full
`spells_us.txt` would demote real, unambiguous EQ Legends buffs because a spell that doesn't exist
on this server shares the text — permanent false prompts for a rare mislabel. The roster being
EQL-scoped is the design, not the bug (see revised #3).

What to actually do:
1. When a buff resolves to a **surprising** name in a real log (owner reports it, or it shows in the
   detection log), check whether the true spell is a **castable EQL spell missing from the roster**.
   The next line in the log often names it outright (a heal proc, a wear-off message).
2. If so, add it via `tools/roster-overrides.json` `add` — the roster then knows the real share set
   and prompts with the correct candidates. If the true spell is *not* an EQL spell, there is no bug
   to fix (it can't be cast here).
3. Optional, cheap, non-behavioural: have the detection log note when an auto-confirm fired on a
   text that `gameSpellData.js` shows is shared in the raw file — purely a "worth a look" flag for
   step 1, never a veto. Skip if it adds noise.
4. No `buffEngine` logic change, no replay-log risk.

*Touches:* `tools/roster-overrides.json` (data, as spells surface) · optionally a one-line note in
the detection log

### P1-2 — Validate the evidence model, flip it on, delete the early-return chain — finding #2 — sev 8 — ⚠️ PARTIAL (`fix/public-release-hardening`: measured on a real week (+241 landings, 0 lost, +6 prompts) and flipped ON by default with the Diagnostics toggle as the one-click escape hatch. Cast-time filter + stacking model measured and deliberately left OFF - see the Diagnostics-toggle evaluation in git history. Deleting the legacy tier chain stays a later release.)
1. Force `useEvidenceModel` + `useCastTimeFilter` on in a local build; run `tools/replay-log.js`
   over the full 1.5M-line corpus; diff the five numbers. Any regression is a blocker — investigate,
   don't tune around it.
2. Owner runs one full raid session with both toggles on. Collect the debug log; compare decisions
   against the legacy path on the same lines.
3. If replay + one live session are clean: flip both defaults on. Keep the legacy path one release
   behind a new `useLegacyDetection` escape hatch.
4. Next release: delete the legacy tier chain and the three diagnostic toggles. One code path.
5. Fold the point-fixes (burst-context memorized exemption, heal-proc auto-resolve) into the scoring
   inputs or remove them.

*Touches:* `src/main/buffEngine.js` · `tools/replay-log.js` · `test/evidence-based-detection.test.js`
· → Documentation for TESTING.md session checklist

### P1-3 — Treat stale `currentlyMemorized` as weak evidence, not a veto — finding #10 — sev 5 — 1–2 days
1. Timestamp the persisted set. On load, if it is older than ~12h, or the first post-launch log line
   sits well after it, mark the whole set **unconfirmed**.
2. An unconfirmed set contributes weak positive evidence in the scoring model — never the current
   hard "not memorized ⇒ not yours" veto.
3. The first `You forget` / `finished memorizing` line after launch promotes the set back to
   confirmed.
4. Keep the per-gem "forget" and "Forget all" correction UI.

*Touches:* `src/main/buffEngine.js` · `currentlyMemorized.json` shape · `test/gem-slots.test.js`,
`memorized-*.test.js`

### P1-4 — Launch catch-up scan for zone / death / group / gems — finding #11 — sev 5 — ⚠️ RELATED WORK (`fix/public-release-hardening`: `lockoutService.backfill()` now seeks to the current reset week instead of re-parsing the whole live log - a bounded-read fix so the weekly archive can be off by default. The general zone/death/group/gem catch-up scan this item describes is still to do.)
1. On launch, one upward scan of the last N KB for the most recent zone, own-death,
   group-composition, and `finished memorizing` lines; seed state from them with **no trigger
   side-effects** (same contract as `seedZone`).
2. Do **not** replay buff landings — an old landing line proves nothing about now. This is the
   deliberate boundary.
3. Widen the `sessionSnapshot` grace: 5 min default, but if the catch-up scan finds no death or zone
   change since the snapshot, allow up to each buff's own remaining duration.
4. Documentation session notes the residual gap for the owner in plain terms.

*Touches:* `src/main/logZonePeek.js` (generalise) · `src/main/sessionSnapshot.js` · `src/main/main.js`
wiring · `test/log-zone-peek.test.js`

### P1-5 — Mark guessed attributions on the overlay — finding #8 — sev 6 — 1–2 days — owner confirms
"Completeness over perfect naming" is a deliberate owner decision — keep it. But a tile resolved by
burst-window or ambiguous-fallback guessing currently looks identical to a hard-confirmed one.

1. Thread the decision tier / confidence through to `overlay.js` alongside the buff (the engine
   already knows it).
2. Render low-confidence tiles with a distinct marker — dotted border or a small "?" — style to be
   confirmed by the owner.
3. Per-aura off switch if she finds it noisy. Do not re-open the underlying permissive rule.

*Touches:* `src/main/buffEngine.js` (emit confidence) · `src/renderer/overlay/overlay.js` ·
`SHAREABLE_FIELDS` if it becomes a toggle

---

## Phase 2 — Structural integrity (~2–4 weeks)

The work that makes every later change safer and cheaper. Mechanical, low behaviour-risk, high
leverage. Do the monolith split first so the rest has somewhere to land.

### P2-1 — Split the monolith files — finding #12 — sev 7 — 1–2 weeks — zero behaviour change
1. `main-window.js` → one module per page (`pages/buff-tracker.js`, `known-buffs.js`, `planner.js`,
   `action-bars.js`, `setup.js`) plus `add-aura-modal.js`, `settings-panel.js`, `profile-bar.js`,
   shared helpers in `ui-common.js`.
2. `buffEngine.js` → extract scoring / tier logic to `detectionScoring.js` and bard attribution to
   `bardAttribution.js`; the engine keeps the state machine + orchestration.
3. `index.html` → page markup into partials assembled at build / load, or accept it (HTML sprawl is
   lower risk than JS sprawl). Lower priority within this item.
4. One dedicated branch, **no behaviour change**. Gate: full suite green + `smoke-launch.js` + a
   manual click-through by the owner (documented in TESTING.md).
5. New rule: no file over ~1,500 lines without a written reason.

*Touches:* `src/renderer/main-window/*` · `src/main/buffEngine.js` → new modules · `test/` imports

### P2-2 — Automate mutation testing and an Electron smoke run in CI — finding #15 — sev 6 — 3–5 days
1. Wire a mutation runner (Stryker, or a small hand-rolled mutator) over `src/main/*.js` and
   `src/shared/*.js`; fail CI below a score threshold.
2. Add `tools/smoke-launch.js` to `npm test` — it already exists and clicks nothing; run it on a
   Windows CI runner or headless where possible.
3. Ban the known hollow patterns in review: no early `return` on a missing fixture (assert it
   exists), no same-millisecond timestamp comparisons, no over-wide text-search windows.
4. Once P2-1 lands, add jsdom tests for the extracted page modules.

*Touches:* `package.json` · `test/run.js` · new CI config · `tools/smoke-launch.js`

### P2-3 — Do the deferred data migrations properly — finding #14 — sev 4 — 1–2 days (was 2–3)
1. One branch, one `widgets.json` schema bump: drop `enabled` after confirming nothing reads it,
   with a one-time `_loadOrMigrate` step.
2. ~~Delete `rosterBackfill.js` and its wiring; keep or convert its guard test.~~ **✅ done 1 Sep**
   (commit 756aa6d) — the guard test was converted to "file must not exist + must not be required".
3. Remove GCD-aura remnants and any duplicated `zoneVisibility` logic (import the extracted module
   everywhere).
4. Each removal gets a migration so old installs upgrade cleanly. Hand the changelog + CLAUDE.md
   edits to Documentation.

*Touches:* `src/main/widgetStore.js` · `src/main/rosterBackfill.js` (delete) · `src/main/buffEngine.js`
· `roster.test.js`

### P2-4 — Run modules in an isolated process — finding #1 (real fix) — sev 9 — 1 week
Even with the Phase-0 perimeter, an enabled module has full main-process Node access and a
`while(true)` freezes the whole app. Isolation fixes both.

1. `utilityProcess.fork()` a module runner with no `nodeIntegration`; it loads, validates, and runs
   `onLine` there.
2. Main streams log lines over the message port; runner posts back `entriesChanged` diffs.
3. Watchdog: no heartbeat in N ms ⇒ kill and respawn the runner; the hung module is quarantined, the
   app stays live.
4. `ctx` becomes message-based RPC with a fixed allowlist (`currentZone`, `groupMembers`,
   `iconUrlForSpell`) — no ambient `fs` / `require` for module code.
5. Keep the per-module time accounting inside the runner.

*Touches:* `src/main/moduleHost.js` → host + new runner entry · `src/main/main.js` fan-out ·
`test/module-host.test.js`

### P2-5 — Branch per session, merge through one owner, CI on push — finding #20 — sev 6 — setup 1 day — owner decision
1. Each session works on its own branch / worktree and commits there. The designated session still
   owns the merge into `integration` — but now it is a real git merge with real conflict markers.
2. Stand up CI (test + smoke) on every branch push.
3. After P2-1 shrinks the hot files, most contention disappears; a short `LOCKS.md` convention covers
   whatever's left.
4. This is a workflow change — put it to the owner before adopting.

---

## Phase 3 — Robustness & polish (ongoing)

Individually small, none blocking. Pick them up between larger work.

### P3-1 — Monotonic timer base + resume / clock-change handling — finding #9 — sev 5 — 2–3 days
1. Store each active timer as a monotonic-relative remaining plus a wall-clock anchor captured at
   the same instant.
2. Tick from the monotonic value; use wall-clock only for cross-restart restore (already the case).
3. On `powerMonitor` `resume` and on detected clock jumps, re-anchor and drop anything now absurd.
4. Document: a buff that ran while the PC slept 20 min correctly shows 20 min less — the game kept
   counting.

*Touches:* `src/main/buffEngine.js` · `customTimerEngine.js` · `sessionSnapshot.js` · `main.js`
(powerMonitor)

### P3-2 — Adaptive foreground polling + circuit breaker — finding #7 — sev 4 — ✅ DONE (`fix/public-release-hardening`, 1 Sep, commit 2826973)
1. ✅ Adaptive interval — `IDLE_BACKOFF_AFTER` (25) consecutive "neither focused" polls → 1200 ms;
   the first relevant poll snaps back to 300 ms. `_nextInterval()` is its own method so the
   threshold is directly testable.
2. ✅ Circuit breaker — `MAX_CONSECUTIVE_FAILURES` (20) failed polls → emit `unavailable`, stop the
   loop, `start()` becomes a no-op for the session. `main.js` broadcasts `overlay:autoHideUnavailable`
   + a new `overlay:autoHideAvailable` IPC for the on-load read; the Buff Tracker page shows a plain
   "auto-hide isn't working, the auras still work" line next to the fullscreen warning.
3. ⬜ AV-allowlist doc note — handed to Documentation (a `docs/TESTING.md` / known-issues line).
4. ⬜ Stretch (`SetWinEventHook` helper `.exe`) — not done, still optional.

Both mechanisms mutation-checked in `test/foreground-watcher.test.js`.

*Touches:* `src/main/foregroundWatcher.js` · `src/main/main.js` · `preload-main.js` · Buff Tracker page

### P3-3 — Rework the config import UI — finding #17 — sev 6 — 2 days
1. Split the picker into two clearly labelled groups — never one merged list.
2. Import preview: a plain summary of what will be replaced ("14 auras, 3 profiles, all sounds"),
   with typed confirmation.
3. Exclude modules from bundles (shared with P0-1).
4. Surface the pre-import backup's location in the success dialog.
5. Require an extra confirm if there is live timer state younger than a few minutes.

*Touches:* `src/main/configTransfer.js` · import modal in main-window · `test/config-transfer.test.js`

### P3-4 — Make the ambiguous-cast popup non-activating — cross-cutting — sev 4 — half day
1. Give the popup `BrowserWindow` `focusable:false` and the `WS_EX_NOACTIVATE` style so clicking a
   candidate button never steals foreground from the game.
2. Verify the buttons still receive clicks in that mode (they should — same as the click-through
   overlay accepting drags in move mode).
3. Keep `focusGameWindow()` as a fallback only.

*Touches:* `src/main/ambiguousPopup.js` · `foregroundWatcher.js` (focusGameWindow call site)

### P3-5 — Concept & copy pass; hide Diagnostics behind "Advanced" — finding #13 — sev 7 — 3–5 days — wording → Documentation
1. Every aura panel gets a plain "Shown on: [all profiles ▾]" line that states the current
   `activeProfileIds` meaning in words ("Shown on every profile" when empty). Copy change, not a
   model change.
2. Move the Diagnostics tab behind an "Advanced" reveal. Once P1-2 ships defaults-on, delete its
   toggles entirely.
3. One-time in-app glossary / tooltip pass for "aura", "profile", "premade" — no code renames.
4. Badge the Buff Planner "experimental" or pull it from the bundle until P4-1 (it is already
   locked).
5. Longer term (separate scope): a first-run wizard — pick EQ folder → confirm character → make
   first aura.

*Touches:* settings-panel copy · `index.html` Diagnostics section · all wording → Documentation
session

### P3-6 — Consolidate the userData-pin explanation into one guarded constant — finding #19 — sev 3 — ✅ ALREADY DONE (pre-existing `test/pin.test.js`)
The CI guard this asked for already exists and is more thorough than the proposal: `test/pin.test.js`
is the project's **first** test — 7 cases. It extracts the folder-name literal straight out of the
`setPath` call and asserts it equals `"EQ Buff Tracker"`, asserts no local `require()` sits above the
pin (with a comment-stripping pass so the warning block's own example doesn't false-alarm), asserts
nothing else in `src/` repoints userData, and has two behavioural cases with a stubbed Electron
(old-folder data still loads after a rename; a decoy folder named after the current product doesn't
win). A `LEGACY_USERDATA_DIR` constant was tried (1 Sep) and reverted — it broke the literal the
guard reads for near-zero benefit, since the string only appears once anyway. Added a short "DO NOT
edit / needs a real migration / pin.test.js guards this" note to the comment block; that's the whole
residual.

*Touches:* `src/main/main.js` (comment only) · `test/pin.test.js` (already present)

### P3-7 — De-fang the hardcoded-future-date tests in `log-rotation.test.js` — finding #9's test-side twin — sev 5 — ✅ DONE (`fix/public-release-hardening`, 1 Sep, commit 748d828)
Took option 2: `tempLogs()` back-dates every fixture file to 2000-01-01 by default (optional `mtime`
override), so any hardcoded "now" sits comfortably in the file's future. Tests needing a recent file
still override (`aged()`, explicit `fs.utimesSync`). Landmine-warning comment added at the helper.
Proven: swapping any rotation test's `now` to `new Date()` fails without the change, passes with it.

Found 2 Sep, not in the original review: ~20 tests hardcode `new Date(2026, 8, 2, ...)` as a fake
"now" while writing real files with real (current wall-clock) mtimes via `tempLogs()`. The rotation
code's `QUIET_MS` check compares that fake "now" against the file's real mtime — fine while the
hardcoded date sits safely in the future, silently wrong once real time catches up to it. One test
had already flipped and was failing; fixed narrowly (pin that one file's mtime with
`fs.utimesSync` to a date safely before the fake boundary, rather than trusting real time to stay
behind it). The other ~19 are not failing yet only because real time hasn't reached their
hardcoded dates.

1. Same fix, applied file-wide: every `tempLogs()`-created file that a test's assertions depend on
   being "quiet" should get an explicit, safely-past `fs.utimesSync` rather than relying on the gap
   between real-now and a hardcoded fake-now.
2. Alternative worth considering: make `tempLogs()` take an optional mtime and default it to
   something far in the past (e.g. 2000-01-01) so every future test in this file is immune by
   default, not just the ones someone remembers to pin.
3. Either way, add a one-line comment at the top of the file warning that a hardcoded calendar date
   used as "now" is a landmine, not a convenience - pick a date and it works until it doesn't.

*Touches:* `test/log-rotation.test.js`

---

## Phase 4 — Feature-specific debt (as each feature is wanted)

Tied to features that are currently locked or not pitchable. Do the work when the feature is next on
the table, not before.

### P4-1 — Verify Buff Planner effect numbers against the real spell file — finding #21 — sev 4 — 2–3 days
1. One pass: for each stat, verify the effect-slot number against known spells in the owner's file
   (same fixture method `spell-stacking.test.js` already uses).
2. Get the owner to rank stat priority once, explicitly, instead of inferring weights.
3. Keep the page locked / "experimental"-badged until both are done.

*Touches:* `src/main/spellEffects.js` · `test/spell-effects.test.js` · → Documentation for
TESTING.md checklist

### P4-2 — Improve damage-meter coverage and make it honest about it — finding #23 — sev 5 — 3–4 days
1. Add heal-proc / damage-shield / rune lines as extra direction seeds (note 18 already spotted
   these for ally buffs — same lines help here).
2. Show a "credited X% of damage this fight" readout on the aura so coverage is visible, not hidden.
3. Keep it flagged not-pitchable until coverage is consistently > 85% on real logs.
4. The "never guess direction from name shape" rule stays.

*Touches:* `src/main/damageEngine.js` · `src/shared/damageLines.js` · `overlay.js` ·
`test/damage-parser.test.js`

### P4-3 — Zone-graph integrity test + inferred-name markers — finding #22 — sev 3 — 1–2 days
1. Add a test: every `connections` target resolves to a real node, every travel spell references a
   real zone. Catches typos the moment someone edits the file.
2. Mark `inferred` zone names in the travel UI with a subtle indicator so the owner can correct them
   as she visits those zones.
3. Documentation session writes the "how to add / fix a zone + alias" note.

*Touches:* `src/shared/data/zoneGraph.js` (no logic change) · new `test/zone-graph-integrity.test.js`
· zone-prompt renderer

---

## Effort roll-up

| Phase | Calendar | Character |
|---|---|---|
| 0 — Stop the bleeding | ~3–5 days | one branch, no design debate |
| 1 — Detection | ~1–2 weeks | mostly validation of built reworks |
| 2 — Structural | ~2–4 weeks | mechanical, low behaviour-risk |
| 3 — Robustness & polish | ongoing | small, independent, non-blocking |
| 4 — Feature debt | as-needed | gated on the feature being wanted |
