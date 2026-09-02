# QoL & Feature Backlog

**This is the live backlog — what's still to do.** Shipped and dropped work is not kept here;
git history and `src/shared/data/changelog.js` hold the record of what changed. The item numbers
run to 51 from earlier batches and are kept so cross-references (CLAUDE.md, `docs/TESTING.md`)
don't dangle — the gaps are completed or dropped items removed 31 Aug onward.

The owner's original 40-note list is complete except original-note #2, the first-aggro premade,
which the owner is supplying herself.

Tags: **NEW** (capability the app lacks) / **CHANGE** (works, but not the way you want) /
**DATA** (a spell / stance / zone entry wrong or missing) / **FIX** (visibly broken or
misleading) / **CLARIFY** (needs one more sentence before it can be scoped).

---

## Still open

### 6. Profile switching without alt-tab — NEW — parked, low priority
A profile-cycle hotkey and/or an in-game command (`/tell eqprofile2`-style), same pattern as the
master-hide hotkey and `/tell eqtm`. Loadout swaps stay manual (deliberate) but shouldn't require
alt-tab → click chip → alt-back. Loadout swaps already generate log noise to hang a trigger off.

### 35. First-hit tracker: also flag invis dropping before the boss aggros — NEW — parked, low priority
An invis / IVU wearing off *before* a mob aggros is itself a body-pull tell, same as a first
melee/spell hit. The first-hit tracker should treat "invis faded → then aggro" as a body pull.
Hangs off the owner's own first-aggro premade (original-note #2).
*Needs:* the exact invis-fade lines from the log; and what "before the boss aggros" is measured
against (an aggro line vs. first damage).

### 42. Chat-read command and/or hotkey for macro-driven profile swap — folds into #6
A profile-cycle hotkey, and/or an in-game `/tell` command word your macros can fire (same pattern
as `/tell eqtm`). Still needs the owner's call: hotkey, chat command, or both.

---

## Considered and declined — don't re-propose

- **Manual pull / countdown timer** — already achievable with a chat macro line + a `contains`
  custom-timer trigger.
- **Auto-read AA ranks from `/outputfile`** — there is no AA export path in this client.
- **"Which aura shows this spell?" reverse lookup** — declined.
- **Aura positions per profile / saved layout sets** — low-priority *maybe*, not planned.
- **Buff-uptime recap per fight** — DPS-meter-adjacent, out of scope.

---

## Where the owner's input is still needed

- **#6 / #42** — profile swap: hotkey, in-game `/tell` command word, or both?
- **#35** — the exact invis-fade log wordings; and "before aggro" measured against what line?

---

## Working notes

- Several Claude sessions edit this tree in parallel — check `ListAgents` before touching a hot
  file (`index.html`, `main-window.js`, `overlay.js`, `buffEngine.js` are the usual ones), and
  route doc / backlog edits through the **Documentation** session (see `CLAUDE.md`).
- The roster spreadsheet is retired. `src/shared/data/buffs.json` is the roster of record;
  `tools/roster-overrides.json` is the one place it is edited — `set` corrects an existing entry,
  `add` adds a new one — and `node tools/build-roster.js --write` rebuilds. A missing or wrong
  spell is a `set` / `add` block, not a code change.
- The larger architectural roadmap (P0 detection rework, Add-Aura modal rework, multi-step aura
  type, unified aura-scale control, action-bar cover images) lives in `CLAUDE.md`'s "Remaining
  backlog" section, not here.
