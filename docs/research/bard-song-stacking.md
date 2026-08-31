# Bard-song stacking study — findings

Research 31 Aug 2026, for the stacking-model fix (Fix 3 in that sequence). Read-only.
Sources: the owner's raw game log (Aug 29–31), app detection logs `detection-2026-08-2[4-9].log`
+ `-30/-31.log`, `src/shared/data/buff-lines.json`, `src/shared/data/buffs.json`.
**LEGENDS behaviour only** — observed, not classic-assumed. This is the evidence/reference, not a
spec.

## TL;DR

The **heading model in `buff-lines.json` is correct** for the real song conflicts (haste,
movement). The **effect-slot fallback heuristic (`spellStacking.checkOverwrite`) is the entire
bug**, and it is wrong in **both directions** across the song boundary — song→spell *and*
spell→song, *and* song→song for the resist songs. Every cross-boundary `ENDED … overwritten by …`
in the detection logs is a false positive; the raw game log shows the buffs coexisting the whole
time.

Recommended rule: **`checkOverwrite` must return `coexist` whenever the two buffs are not both
governed by the same heading in `buff-lines.json` AND at least one is a bard song.** The heading
model already encodes the only real exclusions.

---

## 1. Song ↔ song — REAL exclusions (already modelled, log-confirmed, do NOT touch)

| Heading | Members | Evidence |
|---|---|---|
| `haste.primary` | bard group-haste (Anthem de Arms, Vilia's Verses of Celerity, Verses of Victory, McVaxius' Rousing Rondo), bard self-haste (Jonthan's line) — **and caster Alacrity/Celerity** | detection log 30 Aug 17:57: `Vilia's Verses of Celerity` ⇄ `Alacrity` ⇄ `Verses of Victory` all "replaced by … (same buff line / known conflict)" in sequence. One melee-haste effect, period. |
| `haste.ervaj` (separate slot) | Melody of Ervaj, Composition of Ervaj | Overhaste — stacks *on top of* `haste.primary`. Model already separates it; no counter-evidence. |
| `speed.primary` | Selo's Accelerando / Selo's Accelerating Chorus / Selo's Song of Travel — and Spirit of Wolf | raw log 30 Aug 23:12 & 31 Aug 00:41: `Your Selo's Accelerating Chorus spell did not take hold on <player>` (recipient already had a movement buff). One movement-speed slot. |

## 2. Song ↔ song — CONFIRMED STACK (heuristic currently breaks these)

| Pair | Evidence they coexist |
|---|---|
| **Elemental Rhythms + Guardian Rhythms** | raw log 30 Aug **18:48:12 → 18:51:11+**: `"aura of elemental protection"` and `"aura of mystic protection"` pulse together every ~6 s, continuously, neither ending the other. They are **NOT an upgrade line on EQL.** |
| **Elemental Rhythms + Psalm of Warmth / Cooling / Purity / Vitality** | raw log 30 Aug 18:49:50 the four single-element Psalms land (`protected from cold/fire/poison/disease`); Elemental + Guardian Rhythms keep pulsing at 18:49:53, :59, 18:50:11… uninterrupted. |
| regen songs / mana-regen songs / `ac.bard` songs / Chant of Battle | private bard headings in the model already; stack with everything. No counter-evidence. |

**False positive the heuristic logged for these:**
`[18:49:50] ENDED "Elemental Rhythms" - overwritten by "Psalm of Warmth" (slot 2 SPA 47 60 vs 30, slot 4 SPA 1 5 vs 5)` — raw log shows Elemental Rhythms pulsing 3 s later. Wrong.

## 3. Song ↔ spell — CONFIRMED STACK (this is the reported bug, and it's bidirectional)

Raw log 30 Aug 18:48–18:51, one continuous window:
- Elemental Rhythms + Guardian Rhythms pulsing every ~6 s.
- 18:49:15 Quick Buff lands `"You feel protected from magic."` (Endure Magic / Psalm of Mystic
  Shielding) — **both Rhythms keep pulsing at :15, :17, :23, :29 …**
- 18:49:50 `"You feel resistant to fire."` (Resist Fire) + the four Psalms land — **Rhythms keep
  pulsing at :53, :59, 18:50:11 …**
- ⇒ **bard resist songs and caster resist spells coexist on EQL, in every combination observed.**

**Every cross-boundary decision the heuristic logged in this window (and across 26–31 Aug) is a
false positive:**

| Detection-log line (representative) | Count seen | Verdict |
|---|---|---|
| `ENDED "Endure Magic" - overwritten by "Elemental Rhythms" (slot 1 SPA 50 30 vs 20)` | 3× (18:49, 20:02, 20:36) | WRONG — song killing spell |
| `ENDED "Elemental Rhythms" - overwritten by "Resist Magic" (slot 1 SPA 50 40 vs 30)` | 4× | WRONG — spell killing song |
| `ENDED "Elemental Rhythms" - overwritten by "Shield of Words" (slot 4 SPA 1 105 vs 5)` | 6× | WRONG — a **cleric AC line** killing a resist song via a 5-point AC component |
| `ENDED "Guardian Rhythms" - overwritten by "Resolution" / "Bravery" / "Protection of Steel" / "Protection of Nature" (slot 1 SPA 1 …)` | ~8× | WRONG — cleric Heroism/AC line killing a resist song via its small AC component |
| `ENDED "Guardian Rhythms" - overwritten by "Resist Magic"` | 2× | WRONG |
| `ENDED "Resist Poison" - overwritten by "Psalm of Purity" (slot 2 SPA 48 60 vs 40)` | 3× (19:04, 20:25 …) | WRONG — song killing spell |

The `~6 s` bard-song re-pulse then re-triggers the heuristic and re-kills the buff each cycle —
exactly the "pop up then disappear" the owner reported.

## 4. Song ↔ spell — REAL exclusion (keep)

**Bard haste songs vs caster haste (Alacrity / Celerity)** — genuine `haste.primary` conflict,
log-confirmed (§1). This is the one case where a song legitimately blocks / is blocked by a
spell, and the heading model already handles it. **The boundary rule must not disable this** —
which is why the rule is keyed on "same heading in the model" rather than a blanket
song-vs-spell skip.

---

## 5. Proposed `buff-lines.json` / `checkOverwrite` changes

### 5a. The rule (for `spellStacking.checkOverwrite`, or a wrapper in the engine)
```
if incoming and active are NOT both members of the same heading in buff-lines.json:
    if either is a bard song (isBardSong):  return "coexist"   # never rule across the boundary
```
The heading model keeps deciding haste / movement (the only real song exclusions). Everything
else with a song on either side: coexist.

### 5b. Optional explicit headings (documentation value; not required for correctness once 5a is in)
The bard resist songs each need their **own private heading** (they stack with each other too):
```
"headings": {
  "resist.bard.elemental":  "Resist (bard - Elemental Rhythms line)",
  "resist.bard.guardian":   "Resist (bard - Guardian Rhythms line)",
  "resist.bard.psalm.fire": "Resist (bard - Psalm of Cooling)",
  "resist.bard.psalm.cold": "Resist (bard - Psalm of Warmth)",
  "resist.bard.psalm.pois": "Resist (bard - Psalm of Purity)",
  "resist.bard.psalm.dis":  "Resist (bard - Psalm of Vitality)",
  "resist.bard.psalm.magic":"Resist (bard - Psalm of Mystic Shielding)"
},
"lines": [
  { "id": "bard.elemental-rhythms", "classes": ["BRD"], "headings": ["resist.bard.elemental"],
    "members": ["Elemental Rhythms"] },
  { "id": "bard.guardian-rhythms",  "classes": ["BRD"], "headings": ["resist.bard.guardian"],
    "members": ["Guardian Rhythms"] },
  { "id": "bard.psalms", "classes": ["BRD"],
    "headings": [],  "members": ["Psalm of Warmth","Psalm of Cooling","Psalm of Purity",
                 "Psalm of Vitality","Psalm of Mystic Shielding"],
    "_note": "each Psalm is its own private slot - they all coexist (log 30 Aug 18:49:50). Listed as one line only for grouping; give each its own heading above if the model needs strict slots." }
],
"blockedPairs": []   // none to add - no bard resist song blocked anything in any log
```
**No new `blockedPairs`.** Nothing in three days of logs shows a bard song blocking or being
blocked by anything outside haste/movement.

### 5c. Pairs with POSITIVE coexist evidence (so the default is known safe)
- Elemental Rhythms + Guardian Rhythms
- Elemental Rhythms + Psalm of Warmth / Cooling / Purity / Vitality
- Elemental Rhythms + Endure Magic / Resist Magic / Resist Fire
- Guardian Rhythms + Endure Magic / Resist Magic
- Guardian Rhythms + Resolution / Bravery / Daring (cleric Heroism line — AC)
- Elemental Rhythms + Shield of Words (cleric Aegis line — AC)
- Resist Poison (spell) + Psalm of Purity (song)
- All of the above + "You feel much faster" (haste) simultaneously

---

## 6. Side findings (bug-finder domain, not stacking)

1. **Landing-text collision:** `Endure Magic` and `Psalm of Mystic Shielding` share the exact
   landing text `"You feel protected from magic."` (roster confirmed). Detection can't tell them
   apart from the land line alone — relevant to the ambiguous-cast queue, not stacking.
2. **Roster gap:** `Resistance to Magic` is a real in-game buff (raw log: `"Your Endure Magic
   spell did not take hold on <groupmate>. (Blocked by Resistance to Magic.)"` ×5) but is **not
   in `buffs.json`**. Likely the Rk.II / group / ally-cast form of Resist Magic. Same pattern may
   exist for other resist lines.
3. **Roster mislabel:** `Psalm of Warmth / Cooling / Purity / Vitality` are `category: "Damage
   Shield"` in `buffs.json` but their landing text is `"You feel protected from <element>"` and
   they behave as resist songs. Minor; doesn't affect the fix.
4. The `spellStacking.checkOverwrite` heuristic keying off **SPA 1 (AC)** collides any
   incidental-AC buff with the cleric/shaman AC ladder. **Checked: across all detection logs
   (26–31 Aug), every single AC-SPA-1 `overwritten by` decision is a bard song being killed** —
   `Elemental Rhythms` ← Shield of Words (8×) / Guard (2×) / Spirit Armor / Shade;
   `Guardian Rhythms` ← Resolution (3×) / Protection of Steel / Protection of Nature / Bravery.
   **Zero non-song AC-SPA-1 false positives in the logs.** ⇒ the bard-boundary rule subsumes
   this entirely; no separate non-song AC fix is needed on current evidence. Non-song
   `ENDED … SPA 1` decisions seen were all legitimate upgrade lines.
