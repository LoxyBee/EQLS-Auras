# Buff stacking rules — reference for the Buff Planner

**Status: wired into code (26 Aug).** The heading model in this doc is implemented as
`src/shared/data/buff-lines.json` (the data) + `src/shared/buffLines.js` (the module,
`stackDecision`). Both the Buff Planner (`buffPlanner.js`'s `resolveByHeadings`) and the Self Buffs
overlay stale-tile removal (`buffEngine.js`'s `lineStackFn` path) resolve conflicts through it,
falling back to `spellStacking.checkOverwrite` only for pairs no line covers (`'unknown'`).
`buff-lines.json` currently defines CLR / SHM / BRD / ENC / DRU lines plus the universal resist
lines; other classes still fall through to `checkOverwrite`. This doc stays the spec for filling
in the rest.

Grounded in the **EQ Legends** spell data and one of Shara's own gameplay logs, cross-checked
against classic-EQ community documentation. Corrections from Shara (27 Aug) are marked **[SHARA]**.

---

## 1. The model in one paragraph

Every buff effect belongs to a named **heading** (a.k.a. "slot" / "line"). Two buffs in the
**same heading are mutually exclusive** — the game refuses the second one ("did not take hold")
or overwrites the first, and a weaker one can permanently downgrade a stronger one. Two buffs in
**different headings stack**, adding their effects, and both sit in the 15-slot buff window at
once. A **"line"** is an upgrade ladder of spells that all share one heading (Strengthen → … →
Strength); the highest tier you can cast wins. A single spell can touch **several headings at
once** (Rage = STR + DEX + AGI + AC, on four different headings), which is why `category`-based
reasoning fails: `category` is one stat label, a spell is a set of headings.

**The planner's job:** for the chosen classes + level, take every buff, resolve each line to its
best castable tier, drop buffs whose heading is already occupied by something better, and present
one buff per occupied heading — with the total across all of them.

---

## 2. Evidence hierarchy (trust order)

| # | Source | What it gives | Reliability |
|---|--------|---------------|-------------|
| 1 | **Measured blocked-pairs** (§5) — mined from Shara's own logs: "X did not take hold, blocked by Y" | Proven same-heading conflicts | Ground truth |
| 2 | **Spell-file directives** — `spells_us.txt` effect slots carrying `Block new spell if slot N is <effect> and < <value>` / `Overwrite existing spell if slot N is <effect> and < <value>` (effects 148 / 149, already parsed by `spellStacking.js`) | Machine-readable block/overwrite rules the client itself enforces | Authoritative where present |
| 3 | **The line / heading tables** (§3, §6) — which spells are in which line, which heading each occupies, cross-class conflicts | The structural map | Classic-derived, EQL-cross-checked; ~90% |
| 4 | **Effect-slot collision heuristic** (`spellStacking.checkOverwrite`) — "same effect id in the same numbered slot → they collide" | Fallback when 1–3 are silent | Conservative; misses the heading model, e.g. thinks 4 AC buffs conflict |

Build order for the app: bake (1) and (3) in as data; keep (2) via `spellStacking`; use (4) only
as a last-resort tiebreak.

---

## 3. The heading map

Every buff resolves to one or more of these headings. **Same heading = one wins. Different
heading = stack.**

### 3.1 Armor Class — four independent headings

| Heading | Lines / spells that occupy it (classes) |
|---|---|
| **AC slot 1** | Heroism line — Courage→Center→Daring→Bravery→Valor→**Resolution**→Heroism→Fortitude (CLR/PAL) · Druid Skin line — Skin Like Wood→Rock→Steel→Diamond→Nature→Natureskin (DRU/RNG) · Druid Protection line (group) · Shaman Inner Fire |
| **AC slot 2** | Caster Shielding line — Minor→…→Arch Shielding→Shield of the Magi (ENC/MAG/NEC/WIZ) · **Yaulp I–IV** (CLR) · Armor of Protection / Armor of the Faithful (CLR) · Druid Coat line — Thistlecoat→…→Bladecoat |
| **AC slot 3** | **Shaman Frenzy line** — Fleeting Fury→Burst of Strength→Frenzy→**Fury**→**Rage**→Voice of the Berserker · Enchanter Augmentation/Augment · Ranger Call of Earth |
| **AC slot 4** | Cleric Aegis line — Holy Armor→Spirit Armor→Guard→Armor of Faith→**Shield of Words**→Aegis (CLR/PAL) · Shaman AC line — Scale Skin→Turtle Skin→Protect→Shifting Shield→Guardian→Shroud of the Spirits · Enchanter AC line — Haze→Mist→Cloud→Obscure→Shade→Shadow→Umbra · Magician Phantom Armor |
| **AC slot 1 + 4** | **Aegolism** (CLR 60) — combination buff, occupies 1 AND 4, blocks Heroism/Skin AND Aegis AND Symbol (see §4) |

→ A CLR/SHM group can run **Resolution (1) + Yaulp III (2) + Fury (3) + Shield of Words (4)**
all at once. Bard AC songs are a *separate* private layer on top (see §7).

### 3.2 Hit points — multiple stacking columns

| Column / heading | Members | Stacks with the other HP columns? |
|---|---|---|
| **HP (Primary) — "AC and HP"** | Heroism line (Resolution +250, Heroism +400…), Druid Skin/Protection line, Shaman Inner Fire, Protection of the Glades +470 | — |
| **HP (Symbol) — "HP only, requires gem"** | Symbol line — Transal→Ryltan→Pinzarn→**Naltron**→Marzin (CLR); Naltron's Mark (group) | ✅ stacks with all other HP columns |
| **HP (Shielding / Talisman)** | **Shaman Talisman line** — Talisman of Tnarg→**Altuna**→Kragg→Focus of Spirit · Caster Shielding line HP component (Arch Shielding +150, Shield of the Magi +250) · **Harnessing of Spirit** · Armor of Protection +225 | ✅ stacks with Primary + Symbol |
| **HP (Strength)** | Strength of Nature +75, Divine Glory, Divine Strength | ✅ separate |
| **HP (Combination)** | **Aegolism +1100** — blocks BOTH the Primary and Symbol columns (see §4) | replaces, doesn't stack |

→ Shara's reference loadout stacks **Resolution (Primary) + Symbol of Naltron (Symbol) +
Talisman of Altuna (Talisman)** for HP — three different columns.
→ **Armor of the Faithful conflicts with Talisman of Altuna** on the Talisman HP column. Only
one. The planner currently offers both.

### 3.3 Every attribute has multiple columns

Same structure for **STR, DEX, AGI, STA, CHA** — each stat is not one number but a sum across
independent headings:

| Stat heading | Occupied by |
|---|---|
| **`<stat>` (Primary)** | The class stat line — Shaman Strength (Strengthen→Spirit Strength→Raging Strength→Furious Strength→**Strength**→Maniacal Strength), Druid Strength (Strength of Earth→…→Storm Strength), Enchanter Rampage/Berserker Spirit. **One wins; higher class caps beat lower** (shaman +67 beats druid +42). |
| **`<stat>` (Power)** | Focus of Spirit's STR/DEX component (SHM). Stacks on Primary. |
| **`<stat>` (Short Duration)** | **Yaulp line STR** ("Strength (Short Duration: Yaulp)"), Bedlam STR ("Strength (Short Duration: Bedlam)"). Stacks on Primary + Power. |
| **`<stat>` (Avatar)** | Avatar / Primal Avatar (+100 STR/DEX/AGI/ATK). Stacks on everything. |
| **`<stat>` (Anthem)** — STR only | Bard Anthem De Arms / Chant of Battle / Niv's Melody / McVaxius'. Bard-private, stacks on caster STR. |
| **Frenzy line** | STR+DEX+AGI+AC combination — **stacks with the Primary stat lines** (it's on AC slot 3, not the stat Primary slot). So Fury/Rage add STR *on top of* the Strength buff. |

**Shaman single-target STR ceiling:** Maniacal Strength (Primary +68) + Focus of Spirit (Power
+67) + Voice of the Berserker (Short-Duration +85) + Primal Essence (Avatar +20) = **+240 STR**
from four stacking buffs.

**Group stat buffs are traps** — Talisman of the Beast / Talisman of the Rhino (+42 STR group)
occupy the **same Primary heading** as the single-target line and will **overwrite** a stronger
single-target buff (+67). The planner must never rank a group buff above the single-target line
it would downgrade.

### 3.4 Harnessing of Spirit vs Infusion of Spirit (SHM) — the key combination case

| Spell | Effects | Behaviour |
|---|---|---|
| **Harnessing of Spirit** (46) | +251 HP, +67 STR, +50 DEX | **Combination buff** — overwrites the individual STR / DEX Primary lines and sits in the Talisman HP column. Carries an explicit `Overwrite existing spell if slot 1 is Strength and < 67` directive. |
| **Infusion of Spirit** (49) | +50 STR, +55 DEX, +45 STA | Effects sit on **different numbered slots** than the individual stat lines → **stacks with** individual STR/DEX/STA buffs. |

Community-verified answer: **Infusion of Spirit + individual Strength + individual Dexterity +
individual Stamina beats Harnessing of Spirit + Stamina.** This is exactly Shara's loadout.

### 3.5 Other effect headings

| Effect | Headings | Notes |
|---|---|---|
| **Haste** | **Haste (Primary)** — one global slot: all caster haste (ENC Quickness→…→Wonderous Rapidity +70%, SHM Quickness→Alacrity→Celerity +50%), bard group + self haste, item haste. Strongest wins; ENC always beats SHM. **Haste (Ervaj/v2)** — bard Melody/Composition of Ervaj only; **additive on top of Primary** (this is how you reach +80%). | ENC and bard both memorise two haste spells for different targets. |
| **Spell haste** | **Blessing of Piety line** (CLR) — Blessing of Piety→**Blessing of Faith**, +10%. No classic slot documented; treat as its own heading. | |
| **Damage shield** | **DS slot 1** — caster DS lines (MAG, DRU Shield of Thistles, ENC Feedback, WIZ O'Keil's) · **DS slot 2** — Call of Earth, Kilva's, item procs · **DS slot 3** — Druid Coat line. | "Coat + Shield-of-X = two damage shields at once." |
| **Damage absorption / rune** | **Absorption (Primary)** — ENC Rune I–V, NEC/WIZ skins · **Absorption (Berserker)** — Berserker Spirit / Bedlam · **Absorption (Shield of Song)** — bard, private · plus more bard-private absorb lines. All the non-Primary ones stack. | Bard `Guard of Vie` is *cleric* — Ward of Vie→Guard of Vie, ~700 pool + 10% magic mitigation, slot unverified. |
| **HP regen** | **Regen slot 1 (Primary)** — DRU Regeneration→Chloroplast→Regrowth, SHM Regeneration→Chloroplast→Regrowth (one wins) · **Regen slot 4 (rider)** — Skin Like Nature +2, Natureskin +4 · **Regen slot 3/6** — Treeform/Spirit of Oak · **Bard Layer 2** — Hymn/Cantata (slot 1), Psalm/Niv's (slot 3). All layers stack. | |
| **Mana regen** | **Seven independent buckets, all additive**: Clarity line (ENC Breeze→Clarity→Clarity II +11), Gift line (ENC, separate), Bard Chorus (Cassindra's), Bard Cantata, Druid Protection of the Glades, NEC Lich, self-only, worn. | Within Clarity: group Boon of the Clear Mind over Clarity II *downgrades* to +9. |
| **Resists** (fire/cold/poison/disease/magic — each independent) | **Resist Primary** — Endure→Resist per element (CLR/DRU/SHM/RNG, one wins, higher cap beats lower: SHM/DRU +45 > CLR +40); shaman group upgrades Talisman of Jasinth (disease +45), Talisman of Shadoo (poison +45) · **Resist slot 2** — Magician fire shields · **Bard Layer 2** — Psalms (one resist each, +70/+196) and Rhythms (multi-resist, mutually exclusive with each other). | Bard Psalms **stack fully** with caster resist Primary. Classic max-resist = caster Primary + bard Psalm + flower/potion. **[SHARA]** resist buffs are situational — the planner weights them low (0.25×) in the default slot order. |
| **Magic resist — casters** | ENC/MAG/NEC/WIZ Shielding line carries MR on a **"Magic Shield" heading separate from "Magic Resistance (Primary)"** → an INT caster stacks Resist Magic + Shielding MR (+275 ceiling). | |
| **Movement speed** | **Speed (Primary)** — ONE global slot: SoW, wolf forms, Spirit of Cheetah, bard Selo's, and **snare/root debuffs write to the same slot** (casting a speed buff cures snare). Fastest wins; a shorter/weaker one that overwrites then expires leaves you unbuffed. | |
| **Attack (melee)** | **ATK slot 1 (Primary)** — Firefist, shaman Strength line ATK, ENC Rampage/Berserker Spirit, Yaulp, Grim Aura · slots 2–5 for other sources · **Layer 2** — bard Jonthan's/McVaxius', stacks with everything. | |
| **Illusions** | One illusion at a time. Illusion conflicts dominate the measured log. The planner already excludes the Illusion categories. | |
| **Pacify / lull** | One slot; pacify effects overwrite each other. Excluded from the planner. | |

---

## 4. Combination buffs — the "listed underneath" rule

> **"If a buff combines multiple lines, it does not stack with the buffs listed underneath it."**

A buff that provides several headings' effects **blocks the individual lines it subsumes**, even
though those lines are technically different headings.

| Combination buff | Subsumes / blocks | Mechanism |
|---|---|---|
| **Aegolism** (CLR 60) | Heroism line (AC 1 + HP Primary) AND Aegis line (AC 4) AND Symbol line (HP gem) | Explicit `Block new spell if slot 3 is 'Max Hitpoints' and < 1100` in the spell file |
| **Harnessing of Spirit** (SHM 46) | individual STR line + individual DEX line | `Overwrite existing spell if slot 1 is Strength and < 67` |
| **Symbol combos / Naltron's Mark** | lower Symbol tiers | line-internal |
| **Verses of Victory** (BRD) | bard haste + bard STR + bard AC simultaneously | one song, three bard headings |

**Implementation:** a combination buff needs an explicit `blocks: [<lineId>, …]` list in the
line data — the effect-slot heuristic can't see it. Prefer the best *combination* OR the best set
of *individual* lines, whichever totals higher (Infusion + individuals beats Harnessing; Protection
of the Glades + Symbol of Marzin beats Aegolism).

---

## 5. Measured conflicts (ground truth)

Every pair below is a real "your <spell> did not take hold. (Blocked by <spell>.)" line mined
from Shara's own gameplay log. `count` = how many times it fired. **This table should be
hard-coded and checked before anything else.**

| Blocked spell | Blocked by | Count | Heading it proves |
|---|---|---:|---|
| Illusion: Air Elemental | Boon of the Garou | 33 | one illusion slot |
| Spirit of the Traveler | Spirit of Wolf | 24 | Speed (Primary) |
| Boon of the Garou | Illusion: Air Elemental | 20 | one illusion slot |
| Symbol of Ryltan | Symbol of Pinzarn | 13 | Symbol line (HP gem) |
| **Arch Shielding** | **Talisman of Altuna** | 6 | caster Shielding HP ↔ Talisman HP |
| Spirit of the Traveler | Spirit of Bih`Li | 5 | Speed (Primary) |
| **Frenzy** | **Fury** | 5 | Frenzy line (AC slot 3) — internal |
| Boon of the Garou | Illusion: Human | 3 | one illusion slot |
| Center | Skin like Rock | 3 | AC slot 1 (Heroism ↔ Druid Skin) |
| Boon of the Clear Mind | Clarity | 2 | Mana regen (Clarity heading) |
| Augmentation | Celerity | 2 | Haste (Primary) |
| Antimagic Poison | Neurotoxic Poison | 2 | one applied-poison slot |
| Valor of Marr | Alacrity | 2 | Haste (Primary) |
| Paralytic Poison | Mage Bane Poison | 2 | one applied-poison slot |
| Illusion: Air Elemental | Illusion: Human | 2 | one illusion slot |
| **Riftwind's Protection** | **Fury** | 2 | Frenzy line ↔ a shielding buff |
| Illusion: Skeleton | Illusion: Dark Elf | 1 | one illusion slot |
| Clarity | Clarity | 1 | recast of same buff |
| Breeze | Clarity | 1 | Mana regen (Clarity heading) |
| Augmentation | Alacrity | 1 | Haste (Primary) |
| Illusion: Fire Elemental | Illusion: Air Elemental | 1 | one illusion slot |
| Illusion: Skeleton | Boon of the Garou | 1 | one illusion slot |
| Paralytic Poison | Neurotoxic Poison | 1 | one applied-poison slot |
| Paralytic Poison | Banishing Poison | 1 | one applied-poison slot |
| Illusion: Air Elemental | Illusion: Skeleton | 1 | one illusion slot |
| Boon of the Garou | Illusion: Skeleton | 1 | one illusion slot |
| Illusion: Air Elemental | Illusion: Dark Elf | 1 | one illusion slot |
| Boon of the Garou | Illusion: Dark Elf | 1 | one illusion slot |
| Illusion: Erudite | Illusion: Dark Elf | 1 | one illusion slot |
| Illusion: Dark Elf | Illusion: Human | 1 | one illusion slot |
| Illusion: Wood Elf | Illusion: Erudite | 1 | one illusion slot |
| Skin like Wood | Center | 1 | AC slot 1 (Druid Skin ↔ Heroism) |
| **Regeneration** | **Boil Blood** | 1 | HP regen Primary |

**What this proves for a CLR/SHM/BRD/ENC/DRU planner** (ignoring the illusion/poison noise, which
the planner already excludes):

- **Frenzy line is one heading** — Fury / Rage / Frenzy do not stack with each other (but they DO
  stack with the Strength/Dex/Agi Primary lines — see §3.3).
- **Caster Shielding HP and the Shaman Talisman HP column are the same heading** — Arch Shielding
  and Talisman of Altuna do not stack.
- **Symbol line is one heading** — one Symbol spell at a time.
- **Haste is one global slot** — the Augment/Augmentation branch shares it with Celerity/Alacrity.
- **Mana regen "Clarity" is one heading** — Breeze / Clarity / Boon of the Clear Mind mutually
  exclusive (Gift is a separate heading and stacks).
- **AC slot 1** — Heroism-line spells (Center) and Druid Skin-line spells (Skin like Rock/Wood)
  are the same heading.
- **HP regen Primary is one heading** — Regeneration ↔ Boil Blood.
- **Movement speed is one global slot** — every travel buff.

---

## 6. Per-class buff lines (CLR / SHM / BRD / ENC / DRU)

Each row: **line → members low→high → heading(s) → conflicts with**. Levels shown are approximate
classic; use the roster's own `level` field for what is castable.

### 6.1 Cleric

| Line | Members | Heading(s) | Conflicts |
|---|---|---|---|
| Heroism | Courage→Center→Daring→Bravery→Valor→**Resolution**(42)→Heroism(52)→Fortitude(55) | AC 1 + HP Primary | DRU Skin, SHM Inner Fire, Aegolism |
| Symbol | Transal→Ryltan→Pinzarn→**Naltron**(41)→Marzin(54); Naltron's Mark (group) | HP (gem) | within-line; Aegolism blocks all |
| Aegis | Holy Armor→Spirit Armor→Guard→Armor of Faith→**Shield of Words**(45)→Aegis(57); Bulwark of Faith (57, +37>+34) | AC 4 | SHM Guardian/Shroud, ENC Umbra, MAG Phantom Armor, Aegolism |
| Armor of Protection | Armor of Protection(34, +15AC/+225HP)→Armor of the Faithful(49, +6AC/+485HP) | AC 2 + HP (Shielding/Talisman) | **Yaulp** (AC 2), caster Shielding, **SHM Talisman** (HP) |
| Yaulp | Yaulp(1)→II(16)→**III**(41)→IV(53, 4-tick) | AC 2 + STR (Short-Duration) + ATK 1 | Armor of Protection, Shielding line |
| Blessing of Piety (spell haste) | Blessing of Piety(15)→**Blessing of Faith**(35), +10% | Spell haste (own heading) | none documented |
| Reckless Strength | Reckless Strength(2, +20)→Frenzied Strength(31, +40) | STR Primary (decaying) | class STR lines; "Yaulp better after ~100s" |
| Guard of Vie (absorb) | Ward of Vie(20, 460)→**Guard of Vie**(40, 700) | Damage absorption (slot unverified) | 10% magic mitigation |
| Blessing of the Page (proc heal — Legends-original) | Page(8)→Squire(16)→Knight(34)→**Lord Commander**(48), +1→+6 heal/hit | own proc heading | — |
| Ward of the Divine (50) | standalone; **effect text empty on Legends** — unknown | ? | flagged — planner can't rank it |
| Resists | Endure→Resist per element, cap +40 | Resist Primary per element | DRU/SHM +45 versions supersede |

### 6.2 Shaman

| Line | Members | Heading(s) | Conflicts |
|---|---|---|---|
| Strength (Primary) | Strengthen→Spirit Strength→Raging Strength→Furious Strength→**Strength**(46)→Maniacal Strength(57) | STR Primary | DRU/RNG/ENC STR lines; **stacks with** Focus of Spirit + Frenzy line |
| Dexterity (Primary) | Dexterous Aura→Spirit of Monkey→Deftness→**Dexterity**(48)→Mortal Deftness(58) | DEX Primary | see §10 on Mortal Deftness ordering |
| Agility (Primary) | Feet like Cat→Spirit of Cat→Nimble→**Agility**(41)→Deliriously Nimble(53) | AGI Primary | RNG Feet like Cat only |
| Stamina (Primary) | Spirit of Bear→Spirit of Ox→Health→**Stamina**(43)→Riotous Health(54) | STA Primary | Talisman of the Brute (57, +40) *downgrades* from Riotous Health (+50) |
| Charisma (Primary) | Spirit of Snake→Alluring Aura→Glamour→**Charisma**(47)→Unfailing Reverence(59) | CHA Primary | ENC CHA line — never stack |
| AC line (slot 4) | Scale Skin→Turtle Skin→Protect→Shifting Shield→Guardian(42)→Shroud of the Spirits(54) | AC 4 | CLR Aegis, ENC Umbra, MAG Phantom Armor |
| Talisman (HP) | Talisman of Tnarg(32)→**Altuna**(40)→Kragg(55)→Focus of Spirit(60) | HP (Shielding/Talisman); Focus of Spirit also carries STR/DEX **Power** | **caster Shielding**, **CLR Armor of Protection** |
| **Frenzy line** | Fleeting Fury→Burst of Strength→Frenzy→**Fury**(30)→**Rage**(45)→Voice of the Berserker(59) | AC slot 3 + STR/DEX/AGI (own short-duration headings) | line-internal only; **stacks with the Primary stat lines** |
| Haste | Quickness(26,+30%)→Alacrity(42,+40%)→Celerity(56,+50%) | Haste (Primary) | any stronger caster/bard haste |
| Harnessing of Spirit (46) | combination: +251 HP / +67 STR / +50 DEX | overwrites STR/DEX Primary; Talisman HP column | see §3.4 |
| Infusion of Spirit (49) | +50 STR / +55 DEX / +45 STA | separate slots → **stacks with** individual stat lines | see §3.4 |
| Avatar / Primal Avatar (60) | +100 STR/DEX/AGI/ATK, 6 min | `<stat>` (Avatar) headings | stacks with all stat lines |
| Regen | Regeneration(23,+5)→Chloroplast(39,+10)→Regrowth(52,+15) | Regen Primary | DRU regen, Fungi click |
| Resists | Endure→Resist (+40); + Talisman of Jasinth (disease group +45), Talisman of Shadoo (poison group +45) | Resist Primary per element | Jasinth is the **disease-resist line**, NOT the same as Talisman of Altuna (HP) |
| Movement | Spirit of Wolf(9,+55%) / Spirit of Cheetah(21) / Scale of Wolf(22, fragile) | Speed (Primary) | all movement buffs |

### 6.3 Enchanter

| Line | Members | Heading(s) | Conflicts |
|---|---|---|---|
| Haste (pure) | Quickness→Alacrity→Celerity→Swift Like the Wind(+60%)→Aanya's Quickening(+64%)→Wonderous Rapidity(+70%) | Haste (Primary) | SHM/RNG haste, bard, item — strongest wins |
| Haste (utility branch) | Augmentation(+22-28% +AGI/+AC)→Augment(+43-45%)→Visions of Grandeur(+58% +stats) | Haste (Primary) + AC slot 3 + AGI (Speed Augmentation) | **cannot coexist with the pure branch on one target** |
| AC line | Haze→Mist→Cloud→Obscure→Shade→Shadow→Umbra(+29) | AC slot 4 | CLR/SHM/MAG AC 4, Aegolism |
| Shielding (self) | Minor→Lesser→Shielding→Major→Greater→Arch Shielding(+150HP/+35AC/+20MR)→Shield of the Magi(+250) | AC slot 2 + HP (Shielding/Talisman) + **Magic Shield** MR | **SHM Talisman HP**, CLR Armor of Protection / Yaulp (AC 2) |
| Charisma | Sympathetic Aura→Radiant Visage→Adorning Grace(+40)→Overwhelming Splendor(+50) | CHA Primary | SHM CHA (Unfailing Reverence +55 tops it) |
| INT/WIS | Insight (WIS-lead) \| Brilliance (INT-lead) \| Enlightenment (both) | INT Primary + WIS (Enchanter) | Insight ↔ Brilliance can't coexist; **ENC is sole source** |
| Rune (absorb) | Rune I(55)→II(118)→III(230)→IV(394)→V(700) | Absorption (Primary) | NEC/WIZ skins; ENC Rampage overwrites |
| Clarity (mana) | Breeze(+2)→Clarity(+4-7)→Boon of the Clear Mind(group +6-9)→Clarity II(+11)→Gift of Pure Thought(group +11) | Mana regen (Clarity) | within-line; group over single *downgrades* |
| Gift (mana pool) | Gift of Magic→Gift of Insight→Gift of Brilliance (+50/+100/+150 max mana) | Mana regen (Gift) — separate from Clarity | stacks with Clarity |
| Berserker Spirit | +40 STR, +200 absorb, −20 AGI | STR Primary + Absorption (Berserker) | SHM Strength (+68) beats the STR; ENC Rampage overwrites absorb |

### 6.4 Druid (buff subset — common as the 3rd class)

| Line | Members | Heading(s) | Conflicts |
|---|---|---|---|
| Skin | Skin Like Wood→Rock→Steel→Diamond→Nature→Natureskin | AC slot 1 + HP Primary; Nature/Natureskin add Regen slot 4 | CLR Heroism, Aegolism, SHM Inner Fire, DRU Protection (group) |
| Protection (group) | Protection of Wood→…→Protection of the Glades(60, + mana regen) | AC 1 + HP Primary + Mana regen (own) + Regen 4 | Skin line, Aegolism, CLR Heroism |
| Coat | Thistlecoat→…→Bladecoat | AC slot 2 + DS slot 3 | caster self-shielding (AC 2), Yaulp |
| Shield of Thistles (DS) | Shield of Thistles→…→Shield of Blades | DS slot 1 | MAG DS, ENC Feedback, NEC/SK Banshee Aura |
| Regen | Regeneration(34,+5)→Chloroplast(42,+10-16)→Regrowth(54,+15) | Regen Primary | SHM regen, Fungi; **Chloroplast +16 > Regrowth +15 at 50 — inverted upgrade** |
| Strength | Strength of Earth→Strength of Stone→Storm Strength→Girdle of Karana(+42) | STR Primary | SHM STR overwrites (higher cap) |
| Resists | Endure→Resist per element; Circle of Winter/Summer (group, +45) | Resist Primary per element | SHM/CLR versions; Circle of Summer: `refuse if slot 1 Cold Resist < 45` |
| Movement | Spirit of Wolf(10) / Spirit of Cheetah(21) / Scale of Wolf(26) / Wolf Form line | Speed (Primary); Wolf Form also ATK slot 3 | all movement; SHM Avatar (ATK 3) |
| Firefist | Firefist(6) | ATK slot 1 | RNG Strength of Nature, NEC/SK Grim Aura, CLR Yaulp IV |

### 6.5 Bard — see §7

---

## 7. Bard specifics (EQ Legends)

**[SHARA] — corrections to classic behaviour:**

1. **No twisting on EQL.** A bard has **5 active song effects at all times, automatically** —
   EQL removed the classic "sing→stop→switch→cycle" mechanic. The planner models this as a fixed
   **5-slot song pool**. Ignore the classic "3–5 twisted, 12-second recast lockout" rules
   entirely.
2. **Instrument modifier is not the classic ×2.8.** EQL is lower — **[SHARA] ~140–150 max
   instrument, plus ~60% from AA.** Exact EQL formula and cap **NOT YET RESEARCHED** — see §10.
   Until then the planner should rank bard songs by **base magnitude only** and show a note that
   instrument choice changes the real value.

### 7.1 Bard headings — mostly private, mostly additive

| Effect | Bard heading | Interaction with caster buffs |
|---|---|---|
| **Haste (group)** | Haste (Primary) — **shared global slot** | Contends with caster haste; strongest wins. ENC beats bard. |
| **Haste (self, Jonthan's)** | Haste (Primary) | Overwrites bard *group* haste on the bard only |
| **Haste (Ervaj v2)** | Haste (Ervaj/v2) — bard-private | **Additive on top of Primary haste** |
| **Run speed (Selo's)** | Speed (Primary) — **shared global slot** | Fastest wins |
| **DEX (Chant of Battle)** | Dexterity (Power) — **shared** | One DEX-Power buff; contends with ENC Visions of Grandeur |
| **STR (Anthem)** | Strength (Anthem) — bard-private | **Stacks** with caster STR |
| **AC** (multiple songs) | Bard Layer 2, AC slots 1–4 (private) | **Fully stacks** with all caster AC |
| **HP regen** | Bard Layer 2 (Hymn/Cantata slot 1; Psalm/Niv's slot 3) | **Stacks** with caster Primary regen |
| **Mana regen (Chorus)** | separate from Clarity/Gift | **All stack**; multiple bards' pulses also stack (+56 with 4) |
| **Resists** (Psalms — one each; Rhythms — multi) | Bard Layer 2, per resist | **Fully stack** with caster resist Primary |
| **CHA / INT / WIS** (Solon's Concord / Cassindra's Elegy) | bard-private | **Stack** with caster stat buffs |
| **Damage absorb** (Shield of Song, Niv's Melody, Nillipus') | 3 separate bard-private absorb headings | **All three stack** with each other AND caster DS (+126 magic absorb max) |
| **AGI (Nillipus' March)** | bard-private | **Stacks** with caster AGI |
| **Attack (Jonthan's, McVaxius')** | Layer 2 | **Stacks** with all caster ATK |

**Key rule:** a bard is *additive* to a caster buff profile. The 5 song slots stack on top of
the 14 spell-buff slots; only **haste, run speed, DEX** are shared slots where the bard is one
option among caster options.

**Bard-vs-bard is the dense conflict zone:** one song can touch three headings (Verses of Victory
= haste + STR + AC), so two songs that share any heading → only one lands. The planner's 5-slot
pool should resolve bard-internal conflicts by heading, same as the 14.

### 7.2 Songs that need an instrument to be cast at all

Shauri's Sonorous Clouding (wind), Alenia's Disenchanting Melody (string), Agilmente's Aria of
Eagles (wind), Cantana of Soothing (string), Song: Melody of Ervaj (brass), Song: Occlusion of
Sound (percussion). Singing-skill songs (Psalms, Jonthan's line, Solon's Concord, Cassindra's
Elegy, Niv's Harmonic) need nothing held.

---

## 8. Group vs single-target — the downgrade trap

A **group** version of a stat/HP/AC line usually has a **lower magnitude** than the
single-target version and occupies the **same heading**. Casting the group version on someone who
already has the stronger single-target buff **downgrades them**.

| Group buff | Downgrades |
|---|---|
| Talisman of the Rhino / Beast (+42 STR) | Shaman Strength single-target (+67) |
| Talisman of the Brute (+40 STA) | Riotous Health (+50) |
| Heroic Bond (group) | Heroism (self) — "does not stack with Heroism itself" |
| Pack Spirit / Pack Regeneration | the single-target versions (same magnitude, not an upgrade — just noise) |

**Planner rule:** never place a group buff above the single-target buff of the same line unless
the group one is actually stronger. Prefer single-target for a self/planning context.

---

## 9. Data model for the app

A new `buff-lines.json` next to `buffs.json`, shaped like this:

```jsonc
{
  "headings": {
    "ac.slot1":     { "label": "AC (primary)" },
    "ac.slot2":     { "label": "AC (shielding/yaulp)" },
    "ac.slot3":     { "label": "AC (frenzy/augment)" },
    "ac.slot4":     { "label": "AC (aegis/umbra)" },
    "hp.primary":   { "label": "HP (primary)" },
    "hp.symbol":    { "label": "HP (symbol)" },
    "hp.talisman":  { "label": "HP (shielding/talisman)" },
    "str.primary":  { "label": "Strength" },
    "str.power":    { "label": "Strength (Focus)" },
    "str.frenzy":   { "label": "Strength (Frenzy)" },
    "haste.primary": { "label": "Haste" },
    "haste.ervaj":   { "label": "Haste (Ervaj)" },
    "speed.primary": { "label": "Run speed" },
    "manaregen.clarity": { "label": "Mana regen (Clarity)" },
    "manaregen.gift":    { "label": "Mana regen (Gift)" }
    // ... one entry per heading in §3
  },

  "lines": [
    {
      "id": "shm.strength.primary",
      "name": "Shaman Strength",
      "headings": ["str.primary"],
      "members": ["Strengthen", "Spirit Strength", "Raging Strength",
                  "Furious Strength", "Strength", "Maniacal Strength"],
      "strictUpgrade": true,
      "stacksWith": ["shm.focus-of-spirit", "shm.frenzy"],
      "conflicts": ["dru.strength", "enc.strength"]
    },
    {
      "id": "shm.frenzy",
      "name": "Frenzy line",
      "headings": ["ac.slot3", "str.frenzy", "dex.frenzy", "agi.frenzy"],
      "members": ["Fleeting Fury", "Burst of Strength", "Frenzy",
                  "Fury", "Rage", "Voice of the Berserker"],
      "strictUpgrade": true,
      "stacksWith": ["shm.strength.primary"]
    },
    {
      "id": "shm.harnessing-of-spirit",
      "name": "Harnessing of Spirit",
      "combination": true,
      "headings": ["hp.talisman", "str.primary", "dex.primary"],
      "blocks": ["shm.strength.primary", "shm.dexterity.primary"],
      "members": ["Harnessing of Spirit"]
    }
  ],

  "blockedPairs": [
    { "blocked": "Frenzy", "by": "Fury", "count": 5 },
    { "blocked": "Arch Shielding", "by": "Talisman of Altuna", "count": 6 },
    { "blocked": "Spirit of the Traveler", "by": "Spirit of Wolf", "count": 24 },
    { "blocked": "Symbol of Ryltan", "by": "Symbol of Pinzarn", "count": 13 },
    { "blocked": "Boon of the Clear Mind", "by": "Clarity", "count": 2 },
    { "blocked": "Augmentation", "by": "Celerity", "count": 2 },
    { "blocked": "Valor of Marr", "by": "Alacrity", "count": 2 },
    { "blocked": "Riftwind's Protection", "by": "Fury", "count": 2 },
    { "blocked": "Center", "by": "Skin like Rock", "count": 3 },
    { "blocked": "Regeneration", "by": "Boil Blood", "count": 1 }
    // ... the full §5 table
  ]
}
```

Every roster buff (`buffs.json`) gets an optional `lineId`. Spells with no `lineId` fall back to
today's `spellStacking.checkOverwrite` heuristic.

---

## 10. Recommended planner algorithm

1. **Candidates** — every roster buff a chosen class can cast at the character level, targetable
   on the player, not a heal / illusion / pure-utility category (as today).
2. **Resolve lines** — for each `lineId` present in candidates, keep only the highest castable
   member (`strictUpgrade`); for non-strict lines keep the highest by base magnitude but **never
   let a group member displace a stronger single-target member**.
3. **Occupy headings** — walk candidates in priority order (user drag first, then stat score with
   resists ×0.25). For each, look at every heading it occupies:
   - if a heading is already taken by a *combination buff* that `blocks` this line → skip (overflow: "blocked by X")
   - if a heading is taken by a stronger buff → skip
   - if this is a combination buff and any heading holds an individual line it `blocks` → decide by total (combination vs sum of individuals), keep the winner
   - else → place it, mark its headings occupied
4. **`blockedPairs`** — before placing, if any already-placed buff blocks this one per the §5
   table → skip.
5. **Pools** — bard songs fill their own 5 heading-resolved slots; permanent buffs (Yaulp/Fury —
   need roster flags, see note) their own uncapped section; everything else the 14.
6. **Totals** — sum per stat across every placed buff (each heading contributes once).

**Note on permanent buffs:** the roster does not currently flag Rage, and Yaulp/Fury flagging is
partial. Permanence is a `roster-overrides.json` data fix, not something to infer from a missing
duration (~50 normal buffs also lack `durationSec`).

---

## 11. Open questions — need EQ Legends verification before coding

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| 1 | **EQL instrument/singing modifier** — real cap and formula. [SHARA]: ~140–150 instrument + ~60% AA, not classic ×2.8 | Bard song ranking is wrong without it | Parse the song's instrument-mod field from `spells_us.txt`; measure a known song's landed value in-game at a known instrument level |
| 2 | **Mortal Deftness / Focus of Spirit cast-order** — classic docs say they stack only if Mortal Deftness is cast first (an effect-slot ordering quirk). [SHARA] doubts it applies to EQL. | If real, the planner can't just say "these two conflict" | The mechanism is real in classic EQ (stacking is evaluated slot-by-slot at cast time, so for a few specific pairs the order can decide whether both land). This is **not** an EQL measurement. **Do NOT hard-code this pair.** Test on EQL: cast in each order, check both land. Treat cast-order as a general *possibility* to be aware of, not a modelled rule, until measured. |
| 3 | **Ward of the Divine** (CLR 50) — empty effect text on Legends | Planner can't rank an unknown buff | Read the actual `spells_us.txt` row |
| 4 | **Armor of Protection HP column** — classic tables list it under both Heroism AND Shielding/Talisman | Determines what it blocks | Log test: cast with Resolution up, then with Talisman of Altuna up |
| 5 | **Guard of Vie / Blessing lines slot assignments** — unverified | | `spells_us.txt` block/overwrite directives |
| 6 | **Which spells are actually permanent** (Rage?) | Pool assignment | In-game: does it ever wear off? |
| 7 | **Legends re-tiers** — Legends shifted many spell levels and magnitudes vs classic. Line *membership* is stable; *levels* and *which tier is best at 50* come from the roster's own numbers. | | Use `buffs.json` levels, not classic levels |

---

## 12. What the app gets right today vs this spec

| Area | Today | This spec |
|---|---|---|
| One buff per stat "category" | ✅ but wrong — collapses independent headings | one per **heading**, many per stat |
| `spellStacking.checkOverwrite` | ✅ catches same-effect-same-slot | keep as fallback; add the heading map on top |
| Heals / illusions / utility excluded | ✅ | ✅ (keep `NON_STAT_CATEGORIES`) |
| Bard = separate 5-slot pool | ✅ roughly right | ✅ + they stack on top of the 14, resolve bard-internal by heading |
| Resist buffs low priority | ✅ (×0.25) | ✅ |
| Stat magnitude ranking | ✅ | ✅ for tie-break / display; heading occupancy decides inclusion |
| Combination buffs (Aegolism/Harnessing) | ❌ | needs `blocks: []` data |
| Frenzy line stacks with Strength line | ❌ treats both as "Strength" | headings: AC-3 vs STR-primary |
| Group-buff downgrade trap | ❌ | §8 rule |
| Measured blocked-pairs | ❌ | hard-coded §5 table, checked first |
