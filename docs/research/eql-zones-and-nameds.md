# EverQuest Legends — zone & named-mob research

Gathered 2026-08-30 (LEGENDS server sources only: eqlsource.com primary, eqlwiki.com +
eqlforge.com secondary, plus the owner's real game log — §6a). **No P99 / Allakhazam** — thin
data is flagged, never backfilled from classic.

**Replaces the old `raid-named-respawn-data.md`** (removed in the same change). Its Kunark/Velious
sections (Kael Drakkel, Temple of Veeshan, Western Wastes, Dragon Necropolis, Sleeper's Tomb,
Chardok, Karnor's Castle, Veeshan's Peak, "Kunark overworld dragons") are **dropped as non-EQL
content** — those zones do not exist on EverQuest Legends (§1.1). Its "typical" confidence tier
(P99/Allak classic values) is **retired** — LEGENDS data only.

**This is the priority-1 pass: raid zones + surveyed dungeon zones, full named detail, plus a
log-verification pass on every board-blocking spelling flag (§6a).** A lighter pass over the
remaining ~50 open/travel zones and the unsurveyed dungeons is still outstanding (§5).

---

## 1. Structural findings (read before using any of this)

### 1.1 EQL is a classic-era server
`src/shared/data/zoneGraph.js` (104 entries) is **entirely classic Antonica / Faydwer / Odus +
the Planes**. No Kunark, no Velious. The one EQL-specific outlier: `New Sebilis Expedition`
(short `__eql_newsebilis`). **⇒ the old raid-named doc's Kael Drakkel / Temple of Veeshan /
Western Wastes / Veeshan's Peak / Sleeper's Tomb / Chardok / Karnor's Castle / Kunark-dragon
sections are not EQL content and are dropped.**

### 1.2 The match key = the zoneGraph display string, not the wiki name
Per `zoneGraph.js` and `test/zone-aliases.test.js`, the app's `"You have entered <X>."` strings
are EQL's own in-game wording and differ from every wiki:

| Wiki / common name | In-game "You have entered" string (match key) | short |
|---|---|---|
| Lower Guk | **The Ruins of Old Guk** | gukbottom |
| Upper Guk | **The City of Guk** | guktop |
| The Hole | **The Ruins of Old Paineel** | hole |
| Crushbone | **Clan Crushbone** | crushbone |
| Castle Mistmoore | **The Castle of Mistmoore** | mistmoore |
| Splitpaw | **The Lair of the Splitpaw** | paw |
| Kerra Island | **Kerra Isle** | kerraridge |
| Sol B | **Nagafen's Lair** | soldungb |
| Sol A | **Solusek's Eye** | soldunga |
| Lost Temple / CT | **Temple of Cazic-Thule** | cazicthule |

38 of the 104 zoneGraph entries carry `nameConfidence: 'inferred'` (player never visited) —
those exact strings are guesses, usually about a leading "The".

### 1.3 Instance-suffix grammar (already handled at runtime — do NOT re-derive)
An instance appends ` N (Refined)` / ` - Group N (Fused)` etc. to the base name. Per Long
Context's 30 Aug measurement, **this grammar does NOT distinguish raid from group instance** (a
PoH raid entered as `... - Group 4 (Refined)`, a group Nagafen's Lair as `Nagafen's Lair 4
(Refined)`). The board gates on the player's own `You say, 'danger'` to the Voidling instead. So
`instancedOnEQL` below is informational; a raid-vs-group call per zone is not needed.

### 1.4 EQL raid access & lockout (eqlsource /learn/raid-access, /dungeons/planeofhate; eqlforge)
- **Voidling NPC** creates the instance — the only route to a raid boss. Offers a menu of raid
  options + their lockout timers.
- Difficulties **D0–D4**, chosen at creation. "Difficulty does not raise mob levels — it changes
  what mobs *do*." eqlsource stat measurements are taken **at D4 Refined**.
- **Weekly lockout, resets Tuesday** (eqlsource: 8 AM PST; app default Tue 11:00 US Eastern,
  user-editable via `easternReset.js`). First weekly kill = full loot + sets lockout. Then
  **~18 h / once-a-day** re-clear for **one bonus loot piece per boss**.
- **Solo vs multiplayer lockout: eqlsource contradicts itself** — /learn/raid-access says
  "unsettled" (dev stream "decoupled" vs community "shared"); /dungeons/planeofhate and
  /dungeons/kedgekeep both state "solo and multiplayer instances share a lockout". `lockoutCore.js`
  models the weekly side only. **FLAG.**
- **16 June 2026 patch** removed 8 bosses from open-world → instance-only:
  *"Maestro of Rancor, Innoruuk, the Prince of Hate, Cazic Thule, Fright, Terror, Dread and a
  dracoliche."* ⚠️ Both **"Innoruuk"** and **"the Prince of Hate"** are listed — may be two
  slain-line spellings for one mob, or a separate add. **FLAG — board matches spelling exactly.**
- Confirmed **solo raid versions**: Innoruuk, Cazic-Thule, Maestro of Rancor, Lord of Loathing.

### 1.5 ⚠️ APOSTROPHE STYLE IS UNRESOLVED — blocking for board spelling
eqlsource is internally inconsistent: `Skeleton L\`rodd` / `Baron Telyx V\`Zher` (backtick) but
`High Priest M'kari` / `Rosch Val L'Vlor` (straight apostrophe). Classic EQ clients use a
backtick. **The EQL `"<name> has been slain by"` line is the only authority.** Every named below
with an apostrophe is marked `apostropheUnverified`. Long Context must confirm each against a
real EQL log before shipping it to the board.

---

## 2. Raid zones — full detail

```json
{
  "The Plane of Fear": {
    "matchKey": "The Plane of Fear", "shortName": "fearplane", "instancedOnEQL": true,
    "voidling": "The Feerrott (beside the planar portal gate)",
    "eqlsourceSurvey": "not done as of 30 Aug 2026 (nameds indexed only)",
    "lockout": "weekly Tue reset + daily bonus reclear (see §1.4)",
    "nameds": [
      { "name": "Cazic Thule", "tier": "boss", "confidence": "eql-confirmed", "notes": "Voidling raid boss. Open-world spawn removed 16 Jun 2026. eqlforge also writes 'Cazic-Thule' (hyphen) for the solo version — CONFIRM slain-line form. Has a solo version." },
      { "name": "a dracoliche", "tier": "mini", "confidence": "eql-confirmed", "notes": "lowercase 'a' per eqlsource named index. Instance-only since 16 Jun 2026." },
      { "name": "Fright", "tier": "mini", "confidence": "eql-confirmed", "notes": "one of the 3 golems. Instance-only since 16 Jun. Caps confirmed by eqlsource index." },
      { "name": "Dread", "tier": "mini", "confidence": "eql-confirmed", "notes": "golem. Instance-only since 16 Jun." },
      { "name": "Terror", "tier": "mini", "confidence": "eql-confirmed", "notes": "golem. Instance-only since 16 Jun." },
      { "name": "Wraith of a Shissir", "tier": "mini", "confidence": "eql-confirmed", "notes": "eqlsource index spelling — supersedes old doc's 'Shissar'. Paladin/epic loot." },
      { "name": "Irak Altil", "tier": "lesser", "confidence": "eql-confirmed", "notes": "Paladin epic mob; has its own eqlsource page." },
      { "name": "Phoboplasm", "tier": "lesser", "confidence": "wiki-only", "notes": "eqlwiki only — trash-tier named, not in eqlsource index. Treat as unconfirmed for EQL." }
    ]
  },
  "The Plane of Hate": {
    "matchKey": "The Plane of Hate", "shortName": "hateplane", "instancedOnEQL": true,
    "voidling": "The Oasis of Marr (2nd floor of the tower on Spectre Isle)",
    "eqlsourceSurvey": "done — measured at D4 Refined",
    "lockout": "weekly Tue reset + daily bonus reclear",
    "nameds": [
      { "name": "Innoruuk", "tier": "boss", "confidence": "eql-confirmed", "apostropheUnverified": false, "notes": "Voidling raid boss. D2 ~156k HP / D4 ~235k HP (pre-launch beta, unverified). Classic 7-day respawn n/a. Instance-only since 16 Jun 2026. Has a solo version. SEE §1.4 re 'the Prince of Hate' alias." },
      { "name": "Maestro of Rancor", "tier": "boss", "confidence": "eql-confirmed", "notes": "~16k HP recorded. Classic 3-day respawn n/a. Instance-only since 16 Jun. Has a solo version." },
      { "name": "High Priest M'kari", "tier": "mini", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "upgrades from 'a cleric of Innoruuk'. Measured D4 Refined." },
      { "name": "Master of Spite", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'a spite golem'." },
      { "name": "Coercer T'vala", "tier": "mini", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "from forsaken revenant (female)." },
      { "name": "Magi P'Tasa", "tier": "mini", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "from forsaken revenant (male)." },
      { "name": "Avatar of Abhorrence", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'an abhorrent'." },
      { "name": "Grandmaster R'Tal", "tier": "mini", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "from 'a kiraikuei'." },
      { "name": "Mistress of Scorn", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'a scorn banshee'." },
      { "name": "Ashenbone Broodmaster", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'an ashenbone drake'." },
      { "name": "Lord of Ire", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'an ire ghast'. Patch 2 Jun 2026." },
      { "name": "Lord of Loathing", "tier": "mini", "confidence": "eql-confirmed", "notes": "from 'a loathling lich'. Has a solo version. Patch 2 Jun 2026." }
    ],
    "wikiOnlyUnconfirmed": ["Grandmaster H`Qilm", "Corrupter of Life"]
  },
  "Nagafen's Lair": {
    "matchKey": "Nagafen's Lair", "shortName": "soldungb", "instancedOnEQL": "split",
    "voidling": "The Lavastorm Mountains",
    "eqlsourceSurvey": "done — updated daily",
    "note": "SPLIT ZONE: Lord Nagafen + Warlord Skarlon are raid-instance-only since 11 Jun 2026; every other named is still open-world.",
    "nameds": [
      { "name": "Lord Nagafen", "tier": "boss", "instanced": true, "confidence": "eql-confirmed", "notes": "raid-instance-only since 11 Jun 2026." },
      { "name": "Warlord Skarlon", "tier": "boss", "instanced": true, "confidence": "eql-confirmed", "notes": "raid-instance-only." },
      { "name": "King Tranix", "tier": "mini", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Magus Rokyl", "tier": "mini", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Efreeti Lord Djarn", "tier": "mini", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Fire Giant Warrior", "tier": "lesser", "instanced": false, "respawnMinutes": 480, "confidence": "eql-confirmed", "notes": "8h respawn." },
      { "name": "Fire Giant Wizard", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Solusek kobold king", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "kobold priest", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "kobold champion", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "kobold noble", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Targin the Rock", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Midghh the Dark", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed", "notes": "'extremely rare spawn'." },
      { "name": "Zordak Ragefire", "tier": "unknown", "confidence": "eql-indexed", "notes": "in eqlsource named index for this zone, not in the daily roster. 'Zordakalicus Ragefire' also indexed — likely a PH→named or difficulty upgrade pair." },
      { "name": "Zordakalicus Ragefire", "tier": "unknown", "confidence": "eql-indexed" }
    ],
    "otherIndexed": ["Imp Protector", "lava duct crawler", "lava guardian", "stone spider", "noxious spider", "death beetle", "guano harvester"]
  },
  "Permafrost": {
    "matchKey": "UNCONFIRMED — 'Permafrost' (eqlwiki /who) vs 'Permafrost Keep' (eqlforge, zoneGraph). zoneGraph also has 'The Permafrost Caverns - Group'. CONFIRM from a real log.",
    "shortName": "permafrost", "instancedOnEQL": true,
    "voidling": "location unconfirmed ('near the deep cavern routes toward the frozen lair')",
    "lockout": "raid + group instances SHARE the lockout (eqlwiki) — can't do both same week for full loot",
    "nameds": [
      { "name": "Lady Vox", "tier": "boss", "confidence": "eql-confirmed", "notes": "raid instance only. Lvl 55 dragon, ~32,000 base HP, COLD breath, self-heals as a cleric (eqlforge). eqlwiki's 'Lava Dragon' label is a copy bug." },
      { "name": "High Priest Zaharn", "tier": "mini", "instanced": false, "confidence": "wiki", "notes": "lvl 30 goblin cleric." },
      { "name": "King Thex'Ka IV", "tier": "mini", "instanced": false, "apostropheUnverified": true, "confidence": "wiki", "notes": "lvl 31 goblin warrior." },
      { "name": "Ice Giant Diplomat", "tier": "mini", "instanced": false, "confidence": "wiki", "notes": "lvl 35 giant wizard." },
      { "name": "a goblin alchemist", "tier": "lesser", "instanced": false, "confidence": "wiki" },
      { "name": "a Goblin Archeologist", "tier": "lesser", "instanced": false, "confidence": "wiki" }
    ],
    "zoneRepop": "eqlwiki 'Zone Spawn Timer: 7:05'"
  },
  "The Ruins of Old Paineel": {
    "matchKey": "The Ruins of Old Paineel", "commonName": "The Hole", "shortName": "hole",
    "instancedOnEQL": true, "voidling": "Toxxulia Forest (entrance pit path outside Paineel)",
    "eqlsourceSurvey": "done 14 Jul 2026",
    "zoneRepopNote": "zone respawn disputed — eqlwiki 11:00, altered by 28 Jul 2026 patch (Lower Guk shares this note)",
    "nameds": [
      { "name": "Master Yael", "tier": "boss", "confidence": "eql-confirmed", "notes": "raid instance, raid lockout." },
      { "name": "Nortlav the Scalekeeper", "tier": "mini", "confidence": "eql-confirmed", "notes": "'always up beside Master Yael' — part of the raid encounter / adds." },
      { "name": "Mummy of Glohnor", "tier": "mini", "confidence": "eql-confirmed", "notes": "triggered by quest turn-in." },
      { "name": "Keeper of the Tombs", "tier": "mini", "respawnMinutes": 10080, "confidence": "eql-confirmed", "notes": "1-week respawn." },
      { "name": "Caradon", "tier": "mini", "respawnMinutes": 4320, "confidence": "eql-confirmed", "notes": "3-day." },
      { "name": "Dartain the Lost", "tier": "mini", "confidence": "eql-confirmed", "notes": "100%, open-world." },
      { "name": "Slizik the Mighty", "tier": "mini", "confidence": "eql-confirmed", "notes": "100%, open-world." },
      { "name": "Schnozz the Flighty", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%, open-world." },
      { "name": "Jaeil the Wretched", "tier": "mini", "confidence": "eql-confirmed", "notes": "~6h (uncertain), 50%." },
      { "name": "Jaeil the Insane", "tier": "lesser", "confidence": "eql-confirmed", "notes": "quest-triggered, repeatable." },
      { "name": "Polzin Mrid", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Kyrenna", "tier": "mini", "confidence": "eql-confirmed", "notes": "quest-triggered." },
      { "name": "Commander Yarik", "tier": "mini", "confidence": "eql-confirmed", "notes": "revenant/wanderer pool, 50%." },
      { "name": "Ulrik the Devout", "tier": "mini", "confidence": "eql-confirmed", "notes": "revenant/wanderer pool, 50%." },
      { "name": "Kejar the Mighty", "tier": "lesser", "confidence": "eql-confirmed", "notes": "spawns/despawns on a 20-min real-time cycle." },
      { "name": "Initiate Sirlis", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "High Scale Kirn", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Niltoth the Unholy", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Irslak the Wretched", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "The Stone Caller", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Ghost of Glohnor", "tier": "lesser", "confidence": "eql-confirmed", "notes": "non-hostile." },
      { "name": "The Ghost of Kindle", "tier": "lesser", "confidence": "eql-confirmed", "notes": "indifferent, no aggro." },
      { "name": "a mimic", "tier": "lesser", "confidence": "eql-confirmed", "notes": "Secret Vault. eqlsource survey 'A mimic' vs named-index 'a mimic' — log line decides caps." }
    ],
    "otherIndexed": ["Bejeweled elemental", "Gibartik", "Muck covered elemental", "Rocksoul", "Stonegrinder Minion", "Stonesoul the Unmoving", "Caradon", "Dartain the Lost"]
  },
  "Kedge Keep": {
    "matchKey": "Kedge Keep", "shortName": "kedge", "instancedOnEQL": true,
    "voidling": "near the underwater entrance portal",
    "eqlsourceSurvey": "done",
    "nameds": [
      { "name": "Phinigel Autropos", "tier": "boss", "confidence": "eql-confirmed", "notes": "raid-instance-only since 11 Jun 2026 (classic 12h respawn no longer active). 'Solo and multiplayer instances share a lockout' (eqlsource)." },
      { "name": "Cauldronbubble", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Cauldronboil", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Coralyn Kelpmaiden", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Estrella of Gloomwater", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Ferocious Hammerhead", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Fierce Impaler", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Frenzied Bull Shark", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Frenzied Cauldron Shark", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Golden Haired Mermaid", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Seahorse Matriarch", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Seahorse Patriarch", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Shellara Ebbhunter", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" },
      { "name": "Undertow", "tier": "lesser", "instanced": false, "confidence": "eql-confirmed" }
    ]
  },
  "The Plane of Sky": {
    "matchKey": "The Plane of Sky", "shortName": "airplane", "instancedOnEQL": true,
    "note": "eqlsource: NOT a Voidling raid — a keyed gauntlet, 9 islands, each key drops only after the island below is cleared. Fall off = all carried keys destroyed. NO weekly lockout found — treat as open.",
    "islands": [
      { "island": "1 — The Landing", "nameds": [
        { "name": "Key Master", "tier": "npc", "notes": "sells the first 3 keys" },
        { "name": "Thunder Spirit Princess", "tier": "boss", "notes": "drops Key of Swords" } ] },
      { "island": "1.5 — The Spur", "nameds": [ { "name": "Noble Dojorn", "tier": "boss", "notes": "Efreeti gear, no key" } ] },
      { "island": "2 — Azarack Island", "nameds": [ { "name": "Protector of Sky", "tier": "boss", "notes": "Key of Misfortune" } ] },
      { "island": "3 — Gorgon Island", "nameds": [ { "name": "Gorgalosk", "tier": "boss", "notes": "Key of Beasts" } ] },
      { "island": "4 — Pegasus Island", "nameds": [
        { "name": "Keeper of Souls", "tier": "boss", "notes": "Avian Key" },
        { "name": "Overseer of Air", "tier": "boss", "notes": "no key; killing it spawns Hand of Veeshan on I8" } ] },
      { "island": "5 — Spiroc Island", "nameds": [
        { "name": "The Spiroc Lord", "tier": "boss", "notes": "Key of the Swarm" },
        { "name": "Spiroc Guardian", "tier": "mini" } ] },
      { "island": "6 — Bee Island", "nameds": [
        { "name": "Bazzt Zzzt", "tier": "boss", "notes": "Key of Scale; spawns with 5 named bees" },
        { "name": "Bazzzazzt", "tier": "mini", "spellingUnverified": true },
        { "name": "Bzzazzt", "tier": "mini", "spellingUnverified": true },
        { "name": "Bzzzt", "tier": "mini", "spellingUnverified": true },
        { "name": "Bizazzzt", "tier": "mini", "spellingUnverified": true },
        { "name": "Bzizzzt", "tier": "mini", "spellingUnverified": true } ] },
      { "island": "7 — The Spire", "nameds": [ { "name": "Sister of the Spire", "tier": "boss", "notes": "Veeshan's Key; corpse spawns a Sirran for the Replica of the Wyrm Queen turn-in" } ] },
      { "island": "8 — The Final Island", "nameds": [
        { "name": "Eye of Veeshan", "tier": "boss" },
        { "name": "Hand of Veeshan", "tier": "boss", "notes": "usually not up; from killing Overseer of Air" } ] }
    ]
  },
  "Temple of Cazic-Thule": {
    "matchKey": "Temple of Cazic-Thule", "commonName": "Lost Temple / CT", "shortName": "cazicthule",
    "instancedOnEQL": true, "instanceVariants": ["2 (Adaptive)", "3 (Fused)", "4 (Refined)"],
    "note": "The classic Feerrott dungeon, NOT the Plane of Fear. Not one of the 6 Voidling raids. eqlsource has not surveyed it. Named roster still TODO — see §5.",
    "nameds": []
  }
}
```

---

## 3. Dungeon zones with named rosters (eqlsource surveys)

```json
{
  "Najena": {
    "matchKey": "Najena", "shortName": "najena", "instancedOnEQL": false,
    "zoneRespawnNote": "several mobs 'substantially reduced 28 Jul 2026'",
    "nameds": [
      { "name": "Najena", "tier": "boss", "respawnMinutes": 19, "confidence": "eql-confirmed" },
      { "name": "The Widowmistress", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Akksstaff", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Rathyl", "tier": "mini", "respawnMinutes": 19, "confidence": "eql-confirmed", "notes": "33% spawn." },
      { "name": "Rathyl reincarnate", "tier": "mini", "confidence": "eql-confirmed", "notes": "instant spawn (on Rathyl death)." },
      { "name": "The Blood Artist", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Ekeros", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Drelzna", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "The guard captain", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "A Visiting Priestess", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Lost Crusader", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Unbound Flame", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "BoneCracker", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Officer Grush", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Trazdon", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "The Tenderizer", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Moosh", "tier": "lesser", "confidence": "eql-confirmed" }
    ]
  },
  "The Castle of Mistmoore": {
    "matchKey": "The Castle of Mistmoore", "shortName": "mistmoore", "instancedOnEQL": true,
    "instanceVariants": ["1 (Awakened)", "2 (Adaptive)"],
    "nameds": [
      { "name": "Ssynthi", "tier": "boss", "confidence": "eql-confirmed" },
      { "name": "Xicotl", "tier": "boss", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Princess Cherista", "tier": "boss", "confidence": "eql-confirmed" },
      { "name": "an advisor", "tier": "boss", "respawnMinutes": 240, "confidence": "eql-confirmed", "notes": "~4h, unconfirmed; on death spawns Black Dire." },
      { "name": "Black Dire", "tier": "boss", "confidence": "eql-confirmed", "notes": "spawns on 'an advisor' death." },
      { "name": "Dark Huntress", "tier": "boss", "confidence": "eql-confirmed", "notes": "roaming." },
      { "name": "an avenging caitiff", "tier": "mini", "respawnMinutes": 23, "confidence": "eql-confirmed" },
      { "name": "an undead knight", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a glyphed ghoul", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Garton Viswin", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a hemo enologist", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a dark librarian", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a dark ass't librarian", "tier": "mini", "confidence": "eql-confirmed", "notes": "'ass't' = abbreviated 'assistant' — verify literal." },
      { "name": "Lasna Cheroon", "tier": "mini", "confidence": "eql-confirmed", "notes": "rare." },
      { "name": "a cloaked dhampyre", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Mynthi Davissi", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Maid Issis", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a dark elf noble", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Butler Syncall", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "an imp familiar", "tier": "lesser", "confidence": "eql-confirmed", "notes": "rare." },
      { "name": "a Fallen Noble", "tier": "lesser", "confidence": "eql-confirmed", "notes": "rare." },
      { "name": "Enynti", "tier": "lesser", "confidence": "eql-confirmed" }
    ]
  },
  "The Ruins of Old Guk": {
    "matchKey": "The Ruins of Old Guk", "commonName": "Lower Guk", "shortName": "gukbottom",
    "instancedOnEQL": true, "instanceVariants": ["1 (Awakened)"],
    "zoneRespawnNote": "disputed — eqlwiki 11:00, altered by 28 Jul 2026 patch",
    "nameds": [
      { "name": "the froglok king", "tier": "boss", "confidence": "eql-confirmed", "notes": "live side. lvl 47 paladin." },
      { "name": "the ghoul lord", "tier": "boss", "confidence": "eql-confirmed", "notes": "dead side. lvl ~47 SK." },
      { "name": "Raster of Guk", "tier": "boss", "confidence": "eql-confirmed", "notes": "froglok monk, 'extremely rare'." },
      { "name": "the ghoul arch magi", "tier": "mini", "confidence": "eql-confirmed", "notes": "'rare'." },
      { "name": "a froglok tactician", "tier": "mini", "respawnMinutes": 28, "confidence": "eql-confirmed" },
      { "name": "a froglok herbalist", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a froglok crusader", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "A Froglok Noble", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "A Froglok Yun Priest", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a huge water elemental", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "an Evil Eye", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a minotaur patriarch", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "A Minotaur Elder", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Slaythe the Slayer", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "a ghoul sentinel", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a frenzied ghoul", "tier": "mini", "confidence": "eql-confirmed", "notes": "8% spawn." },
      { "name": "a reanimated hand", "tier": "mini", "confidence": "eql-confirmed", "notes": "100%." },
      { "name": "a ghoul sage", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a ghoul cavalier", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a ghoul supplier", "tier": "mini", "respawnMinutes": 9.45, "confidence": "eql-confirmed" },
      { "name": "a ghoul assassin", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a ghoul executioner", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a ghoul savant", "tier": "mini", "confidence": "eql-confirmed", "notes": "100%." },
      { "name": "a ghoul scribe", "tier": "mini", "confidence": "eql-confirmed", "notes": "14% spawn." },
      { "name": "a ghoul ritualist", "tier": "mini", "confidence": "eql-confirmed" }
    ]
  },
  "The Lair of the Splitpaw": {
    "matchKey": "The Lair of the Splitpaw", "commonName": "Splitpaw", "shortName": "paw",
    "instancedOnEQL": false,
    "nameds": [
      { "name": "The Ishva Mal", "tier": "boss", "respawnMinutes": 28, "confidence": "eql-confirmed", "notes": "~36h to spawn, 28-min respawn once cycling." },
      { "name": "Tesch Val Deval`Nmak", "tier": "boss", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "backtick per eqlsource. 20-min timer." },
      { "name": "Rosch Val L'Vlor", "tier": "boss", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "straight apostrophe per eqlsource — inconsistent with the line above." },
      { "name": "Nisch Val Torash Mashk", "tier": "boss", "confidence": "eql-confirmed" },
      { "name": "Tesch Val Kadvem", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "a Nisch Val Guard", "tier": "mini", "confidence": "eql-confirmed", "notes": "also 'a Tesch Val Guard' in the named index." },
      { "name": "a one eyed gnoll", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Verishe Mal Executioner", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Verishe Mal Judge", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "a Rosch Mal Gnoll", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "a gaduladian widemouth", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "a Lteth Val Scribe", "tier": "lesser", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Kurrpok Splitpaw", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Brother Hayle", "tier": "lesser", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Brother Gruff", "tier": "lesser", "confidence": "eql-confirmed", "notes": "50%." }
    ]
  },
  "Clan Crushbone": {
    "matchKey": "Clan Crushbone", "commonName": "Crushbone", "shortName": "crushbone",
    "instancedOnEQL": true, "instanceVariants": ["1 (Awakened)"],
    "zoneRespawnNote": "≤9:00 pre-patch ceiling; several substantially reduced 28 Jul 2026",
    "nameds": [
      { "name": "Emperor Crush", "tier": "boss", "confidence": "eql-confirmed", "notes": "lvl 18, 50% spawn." },
      { "name": "Ambassador DVinn", "tier": "boss", "confidence": "eql-confirmed", "notes": "lvl 20, 80% spawn. eqlsource index writes 'Ambassador DVinn' (no apostrophe) — classic is 'D`Vinn'. VERIFY." },
      { "name": "Marrowbane", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Chokehold", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Bloodgurgler", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Bonefire", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "The Prophet", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Orc Warlord", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Retlon Brenclog", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Lord Darish", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Orc Warden", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Orc Emissary", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Royal Guard", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Orc oracle", "tier": "mini", "confidence": "eql-confirmed" },
      { "name": "Orc Trainer", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Orc Taskmaster", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Rondo Dunfire", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Kelynn", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Orc Scoutsman", "tier": "lesser", "confidence": "eql-confirmed" }
    ]
  },
  "Befallen": {
    "matchKey": "Befallen", "shortName": "befallen", "instancedOnEQL": true,
    "instanceVariants": ["1 (Awakened)", "3 (Fused)", "4 (Refined)"],
    "zoneRespawnNote": "'4:30 — shortest we have recorded'",
    "nameds": [
      { "name": "Baron Telyx V`Zher", "tier": "boss", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "backtick per eqlsource. lvl 28, deepest named." },
      { "name": "Cmdr Windstream", "tier": "boss", "confidence": "eql-confirmed", "notes": "lvl 26, spawns after quest turn-in. 'Cmdr' abbreviated — verify literal." },
      { "name": "Boondin Babbinsbort", "tier": "mini", "confidence": "eql-confirmed", "notes": "lvl 25 gnome necro w/ pet." },
      { "name": "Skeleton L`rodd", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed", "notes": "100%, alcove room." },
      { "name": "a shadowknight (Troll)", "tier": "lesser", "confidence": "eql-confirmed", "notes": "drops all 3 keys. Parenthetical may be eqlsource's disambiguation, not the mob name — VERIFY." },
      { "name": "a shadowknight (DE female)", "tier": "lesser", "confidence": "eql-confirmed", "notes": "same caveat." },
      { "name": "Gynok Moltor", "tier": "lesser", "confidence": "eql-confirmed", "notes": "~3% spawn near entrance." },
      { "name": "Asaka L`Rei", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed" },
      { "name": "Arisen Thaumaturgist", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "The Thaumaturgist", "tier": "lesser", "confidence": "eql-confirmed", "notes": "9% spawn." },
      { "name": "Priest Amiaz", "tier": "lesser", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "a Necro Theurgist", "tier": "lesser", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Footman of V`Zher", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed" },
      { "name": "an Elf Skeleton", "tier": "lesser", "confidence": "eql-confirmed", "notes": "55%." },
      { "name": "Kahaptra Z`Taj", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed" },
      { "name": "Korven Nisere", "tier": "lesser", "confidence": "eql-confirmed" },
      { "name": "Soldier of V`Zher", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed" },
      { "name": "Knight V`Tal", "tier": "lesser", "apostropheUnverified": true, "confidence": "eql-confirmed" }
    ]
  },
  "Blackburrow": {
    "matchKey": "Blackburrow", "shortName": "blackburrow", "instancedOnEQL": true,
    "instanceVariants": ["1 (Awakened)", "2 (Adaptive)", "3 (Fused)"],
    "zoneRespawn": "22:00 uniform",
    "nameds": [
      { "name": "Lord Elgnub", "tier": "boss", "respawnMinutes": 22, "confidence": "eql-confirmed", "notes": "L22." },
      { "name": "Sabertooth Overseer", "tier": "mini", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Splitpaw Sharpshooter", "tier": "mini", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Master Brewer", "tier": "mini", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Refugee Splitpaw (monk)", "tier": "mini", "respawnMinutes": 22, "confidence": "eql-confirmed", "notes": "parenthetical is eqlsource disambiguation (monk vs shaman variant) — VERIFY the real line." },
      { "name": "Refugee Splitpaw (shaman)", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed", "notes": "same caveat." },
      { "name": "Splitpaw Explorer", "tier": "mini", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Mannan of the Sabertooth", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "the gnoll high shaman", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Sabertooth Clan Necromancer", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Splitpaw Commander", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "a gnoll commander", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "a Gnoll Tactician", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Socho Darkpaw", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Splitpaw Sentry", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "Tranixx Darkpaw", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" },
      { "name": "a giant plague rat", "tier": "lesser", "respawnMinutes": 22, "confidence": "eql-confirmed" }
    ]
  },
  "The Warrens": {
    "matchKey": "The Warrens", "shortName": "warrens", "instancedOnEQL": false,
    "nameds": [
      { "name": "King Gragnar", "tier": "boss", "respawnMinutes": 48, "confidence": "eql-confirmed" },
      { "name": "The Muglwump", "tier": "boss", "respawnMinutes": 35, "confidence": "eql-confirmed" },
      { "name": "Prince Bragnar", "tier": "mini", "respawnMinutes": 57, "confidence": "eql-confirmed" },
      { "name": "Lorekeeper Roggik", "tier": "mini", "respawnMinutes": 48, "confidence": "eql-confirmed" },
      { "name": "High Shaman Drogik", "tier": "mini", "respawnMinutes": 48, "confidence": "eql-confirmed" },
      { "name": "Cave Bat Lord", "tier": "mini", "respawnMinutes": 48, "confidence": "eql-confirmed" },
      { "name": "Huntmaster Furgrl", "tier": "mini", "respawnMinutes": 48, "confidence": "eql-confirmed" },
      { "name": "Smithy Rrarrgin", "tier": "mini", "respawnMinutes": 20, "confidence": "eql-confirmed" },
      { "name": "Foodmaster Rargnar", "tier": "mini", "respawnMinutes": 20, "confidence": "eql-confirmed" },
      { "name": "Packmaster Dledsh", "tier": "mini", "respawnMinutes": 16, "confidence": "eql-confirmed", "notes": "rare." },
      { "name": "Warlord Drrig", "tier": "mini", "confidence": "eql-confirmed", "notes": "25% spawn." },
      { "name": "Krode the Diviner", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Grodl Ripclaw", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "The Mighty Bear Paw", "tier": "mini", "confidence": "eql-confirmed", "notes": "50%." },
      { "name": "Trainer Daxgrr", "tier": "lesser", "respawnMinutes": 20, "confidence": "eql-confirmed" },
      { "name": "Jailer Mkrarrg", "tier": "lesser", "confidence": "eql-confirmed", "notes": "100%." },
      { "name": "An Erudite Prisoner", "tier": "lesser", "confidence": "eql-confirmed", "notes": "100%." },
      { "name": "Aderius Rhenar", "tier": "lesser", "confidence": "eql-confirmed", "notes": "100%." },
      { "name": "Koajin", "tier": "lesser", "confidence": "eql-confirmed" }
    ]
  }
}
```

Also fully in eqlsource's named index but not individually pulled here: **The City of Guk**
(Upper Guk) roster.

---

## 4. Trigger-only / special-cased (not timed)

- **Plane of Sky Islands 4 & 8** — Hand of Veeshan spawns from killing Overseer of Air (I4);
  not on a timer.
- **The Castle of Mistmoore** — Black Dire spawns on 'an advisor' death.
- **Najena** — Rathyl reincarnate spawns instantly on Rathyl's death.
- **The Ruins of Old Paineel** — Mummy of Glohnor, Kyrenna, Jaeil the Insane, Ghost of Glohnor
  all quest-triggered; Kejar the Mighty on a 20-min real-time cycle.
- **Befallen / The Ruins of Old Paineel** — Cmdr Windstream / various spawn after a quest
  turn-in.

---

## 5. Still outstanding (the "lighter second pass")

1. **Tier 3 zone table** — every remaining zoneGraph zone (~50: cities, overworld, travel hubs)
   as name + short name + instanced flag. This data is already in `zoneGraph.js` +
   `zoneAliases.js`; it just needs transcribing into this doc's format. Low value for the board
   (no nameds) — do last.
2. **Temple of Cazic-Thule** named roster — not surveyed by eqlsource; eqlwiki has it (P99-fork
   caveat). Has instance variants, so relevant.
3. **The City of Guk** (Upper Guk) roster — in eqlsource's index, page not pulled.
4. **Clan RunnyEye, The Estate of Unrest, Gorge of King Xorbb, Solusek's Eye, The Temple of
   Solusek Ro** — classic named dungeons, not in eqlsource's 13 surveys. eqlwiki only.
5. ~~Permafrost zone name~~ **RESOLVED §6a — `The Permafrost Caverns` (raid) / `Permafrost Keep`
   (open-world).**
6. **Permafrost Voidling location** — eqlforge didn't state it. Still open.
7. **`apostropheUnverified` names** — apostrophe convention is now settled as **backtick** (§6a),
   so `M\`kari` / `P\`Tasa` / `V\`Zher` etc. are very likely correct, but the specific bosses
   the owner hasn't killed yet (Fright/Dread/Terror/dracoliche, Lord Nagafen, Warlord Skarlon,
   Phinigel, M\`kari, P\`Tasa, Master of Spite, Mistress of Scorn, Lord of Loathing, Avatar of
   Abhorrence) still want a real slain-line each. `Ambassador DVinn` / `Cmdr` / `ass't` abbrevs
   also still unverified (Crushbone/Befallen — not raided this log).
8. ~~"the Prince of Hate" vs "Innoruuk"~~ **RESOLVED §6a — one mob, slain line is
   `Innoruuk, the Prince of Hate`.**
9. **Solo/multiplayer lockout sharing** — eqlsource's own pages contradict (§1.4). Still open —
   documentation-level, not board-blocking.

---

## 6. Corrections to existing files

- `docs/research/raid-named-respawn-data.md` — DROP the Velious/Kunark sections (Kael Drakkel,
  Temple of Veeshan, Western Wastes, Dragon Necropolis, Sleeper's Tomb, Chardok, Karnor's Castle,
  Veeshan's Peak, "Kunark overworld dragons"). Not EQL content.
- Same doc: "Wraith of a Shissar" → **"Wraith of a Shissir"** (eqlsource-surveyed spelling).
- Same doc: the "typical" confidence tier (P99/Allak values) should be retired per owner —
  re-mark those entries "no EQL data" or drop.
- `src/shared/data/raidZoneNameds.js` (6 zones today) — Nagafen's Lair section should split
  Lord Nagafen + Warlord Skarlon (instanced) from King Tranix / Magus Rokyl / Efreeti Lord Djarn
  (still open-world).
- `zoneGraph.js` — no connection corrections spotted. The `Permafrost Keep` display name may be
  wrong (see §5.5) but that's a name, not a connection.
- `zoneAliases.js` — apostrophe forms in the PoH boss aliases (`coercer t'vala` etc.) inherit the
  same unverified-apostrophe caveat.

---

## 6a. LOG-VERIFIED findings — from the owner's real eqlog

Grepped the live log (Sat 29 – Sun 30 Aug 2026; she raided Plane of Hate + Castle Mistmoore and
farmed a Nagafen's Lair group instance). These are **ground truth** — the exact strings the EQL
client emits — and they resolve several §5 flags:

### Apostrophe style = **BACKTICK** (`` ` ``), settled
- `Coercer T\`vala has been slain by Innoruuk\`s Chosen!`
- `Grandmaster R\`tal has been slain by <player>!` — **also note casing: `R\`tal`, lowercase "tal"**
  (not `R\`Tal` as eqlsource rendered it).
- `Innoruuk\`s Chosen` (a summoned raid ally) — backtick throughout.
⇒ Apply to every unverified apostrophe name: **`High Priest M\`kari`, `Magi P\`Tasa`,
`King Thex\`Ka IV`, `Baron Telyx V\`Zher`, `Skeleton L\`rodd`, `Asaka L\`Rei`, `Kahaptra Z\`Taj`,
`Footman of V\`Zher`, `Soldier of V\`Zher`, `Knight V\`Tal`, `Tesch Val Deval\`Nmak`.** The
`zoneAliases.js` PoH aliases currently use straight apostrophes — should move to backtick or be
matched case/punctuation-insensitively.

### "Innoruuk, the Prince of Hate" — ONE mob, settled
`Innoruuk, the Prince of Hate has been slain by Innoruuk\`s Chosen!` — the slain line is the
**full title with a comma**, not "Innoruuk" and not "the Prince of Hate" alone. The 16-Jun patch
note listing both was just naming the same mob two ways. **Board match key: `Innoruuk, the
Prince of Hate`.**

### Cazic-Thule — hyphen, settled
`You have slain Cazic-Thule!` — **`Cazic-Thule`** with a hyphen (eqlsource's index "Cazic Thule"
is wrong for the slain line).

### Permafrost raid zone name — settled
`You have entered The Permafrost Caverns - Group 1 (Awakened).` ⇒ the Lady Vox raid instance
base string is **`The Permafrost Caverns`**. zoneGraph's `The Permafrost Caverns - Group` is
correct; **`Permafrost Keep` is the separate open-world zone**, not the raid.

### Instance-suffix grammar — confirmed from real lines
`The Permafrost Caverns - Group 1 (Awakened)` · `The Ruins of Old Paineel - Group` ·
`The Plane of Fear - Group 4 (Refined)` · `The Plane of Hate - Group 4 (Refined)` ·
`The Castle of Mistmoore 4 (Refined)` · `Nagafen's Lair 4 (Refined)`.
⇒ base name = everything before `" - Group"` OR before `" N ("`. (Matches Long Context's
grammar-doesn't-distinguish-raid finding — `Nagafen's Lair 4 (Refined)` had no `- Group`.)

### Article casing in slain lines
Third-person capitalises the leading article: **`A dark librarian has been slain by …`** /
**`An imp protector has been slain by …`**. The `You have slain` object form lowercases it:
**`You have slain a dark librarian!`** / **`You have slain an imp protector!`**. eqlsource's
index caps (`Imp Protector`) are wrong — the live mob is **`an imp protector`**.

### Named exact spellings CONFIRMED from slain lines
Lady Vox · Master Yael · Cazic-Thule · Maestro of Rancor · Lord of Ire · Ashenbone Broodmaster ·
Coercer T\`vala · Grandmaster R\`tal · Efreeti Lord Djarn · Xicotl · Enynti · Butler Syncall ·
Maid Issis · Mynthi Davissi · Princess Cherista · Lasna Cheroon · a hemo enologist ·
a cloaked dhampyre · a fallen noble · an imp familiar · a glyphed ghoul.

### Still NOT log-verified (the owner hasn't killed them in this log — but apostrophe rule now known)
Fright, Dread, Terror, a dracoliche, Wraith of a Shissir; Lord Nagafen, Warlord Skarlon,
King Tranix, Magus Rokyl; Phinigel Autropos; High Priest M\`kari, Magi P\`Tasa, Master of Spite,
Mistress of Scorn, Lord of Loathing, Avatar of Abhorrence.

### New Castle-of-Mistmoore trash/mob names seen (add to that roster, `lesser`)
a dark offerer, a dark ritualist, a dark sacrificer, a deathly harbinger/herald/usher,
a flouting/jeering/leering/sneering gargoyle, a ghastish/ghoulish/vampiric/spiritish ancille,
an ancille cook, a glyphed aegis/custodian/familiar/sentry/forbidder/guard/warder, a gypsy
ambassador/dancer/musician, a shadowy sage/scribe/scrivener, a soul inveigling/seductress/
temptress, a thought corruptor/defiler/spoiler, a vampire noble/oracle, a werewolf (gypsy),
a will pillager/ravisher/sapper, a negotiator, an initiate familiar, a pledge familiar.
(These are pop/trash, not board-worthy, but useful for the damage engine's friend/enemy seeding.)

### Nagafen's Lair group-instance mobs seen (lowercase — open-world tier)
a greater kobold, a greater kobold shaman, a noxious spider, a lava beetle, a lava duct crawler,
a lava guardian, a death beetle, a sonic bat, a guano harvester, an imp protector.

---

## 6b. Supplement — unsurveyed dungeons (LOW confidence)

**Confidence: LOW throughout.** eqlsource has NOT surveyed any of these zones; the only source is
**eqlwiki.com, which is a P99 fork** (per `zoneGraph.js`'s own note). The owner's log contains
**no `You have entered` or slain lines for any of these zones** — so none of it is EQL-verified.
Treat as *classic reference pending an eqlsource survey or a real log*, not board-ready. All
tiers/timers are classic P99 values.

### Temple of Cazic-Thule — short `cazicthule`
"You have entered" name (zoneGraph, trusted): **Temple of Cazic-Thule**. (eqlwiki calls it "The
Lost Temple of Cazic-Thule" — the P99/classic long name, NOT what zoneGraph carries.) Feerrott
dungeon, NOT the Plane of Fear. Has instance variants `2 (Adaptive)` / `3 (Fused)` / `4 (Refined)`.

```json
{
  "Temple of Cazic-Thule": {
    "matchKey": "Temple of Cazic-Thule", "shortName": "cazicthule",
    "instancedOnEQL": true, "confidence": "low — eqlwiki/P99 only, no eqlsource, no log",
    "nameds": [
      { "name": "Avatar of Fear", "tier": "boss", "notes": "SK, ~lvl 38. classic primary boss." },
      { "name": "Cazic Cenobite", "tier": "mini", "notes": "cleric, lvl 35-37." },
      { "name": "Tae Ew Archon", "tier": "mini", "notes": "wizard, lvl 34." },
      { "name": "Tae Ew Templar", "tier": "mini", "notes": "cleric, lvl 30." },
      { "name": "Tae Ew Diviner", "tier": "mini", "notes": "enchanter, lvl 28." },
      { "name": "Radiant", "tier": "lesser", "notes": "rogue, lvl 21-23." }
    ],
    "golems": ["Clay Golem (22-min respawn)", "Stone Golem", "Steel Golem"],
    "caveat": "Avatar of Fear spelling/tier UNVERIFIED for EQL. Do not board this without a real slain line."
  }
}
```

### The City of Guk (Upper Guk) — short `guktop`
"You have entered" name (zoneGraph): **The City of Guk**. zoneGraph also has `The City of Guk 4
(Refined)`. Guk spawn cycle ~16m30s (eqlwiki). Named frogloks by clan: Tuk / Gaz / Ton / Shin.

```json
{
  "The City of Guk": {
    "matchKey": "The City of Guk", "commonName": "Upper Guk", "shortName": "guktop",
    "instancedOnEQL": true, "confidence": "low — eqlwiki/P99 only",
    "nameds": [
      { "name": "the froglok shin lord", "tier": "boss", "notes": "lvl 30 paladin. lowercase per eqlwiki convention — VERIFY article/caps against a slain line." },
      { "name": "a Froglok Nokta Shaman", "tier": "mini", "notes": "lvl 27." },
      { "name": "an Ancient Croc", "tier": "mini", "notes": "lvl 30. eqlwiki also 'Ancient Crocodile' — inconsistent." },
      { "name": "a Giant Heart Spider", "tier": "lesser", "notes": "lvl 15-21." }
    ],
    "caveat": "eqlsource's named index (232 nameds) did not surface a City-of-Guk roster distinct from Lower Guk. Needs an eqlsource pass."
  }
}
```

### The Estate of Unrest — short `unrest`
"You have entered" name (zoneGraph): **The Estate of Unrest**. (eqlwiki drops the leading "The";
trust zoneGraph.) Zone spawn pulse ~7m30s (eqlwiki).

```json
{
  "The Estate of Unrest": {
    "matchKey": "The Estate of Unrest", "shortName": "unrest",
    "instancedOnEQL": "unknown — zoneGraph shows no instance variants", "confidence": "low — eqlwiki/P99 only",
    "nameds": [
      { "name": "Garanel Rucksif", "tier": "boss", "respawnMinutes": 22 },
      { "name": "an undead knight of Unrest", "tier": "boss", "respawnMinutes": 22, "notes": "article/caps unverified." },
      { "name": "Khrix Fritchoff", "tier": "mini" },
      { "name": "Khrix's Abomination", "tier": "mini", "notes": "apostrophe — if EQL uses backtick (§6a) this is 'Khrix`s Abomination'." },
      { "name": "Torklar Battlemaster", "tier": "mini", "notes": "20% spawn." },
      { "name": "a priest of najena", "tier": "mini", "respawnMinutes": 22 },
      { "name": "Reclusive ghoul magus", "tier": "mini", "notes": "50% spawn." },
      { "name": "an undead barkeep", "tier": "lesser", "respawnMinutes": 22 },
      { "name": "Shadowpincer", "tier": "lesser", "notes": "rare." },
      { "name": "Lesser Blade Fiend", "tier": "lesser", "notes": "rare, 100%." },
      { "name": "a reanimated hand", "tier": "lesser", "notes": "100%. (also a Lower Guk mob — name reused.)" }
    ]
  }
}
```

### No EQL named data — do not board
- **Clan RunnyEye** (`runnyeye`) — eqlwiki has faction notes only, no roster.
- **Gorge of King Xorbb / Beholder's Maze** (`beholder`) — classic boss King Xorbb, but no EQL
  source confirms the roster or slain-line spelling.
- **Solusek's Eye / Sol A** (`soldunga`) — eqlsource's index attributes the shared lava-tube
  nameds (Efreeti Lord Djarn, the Ragefires, King Tranix, Magus Rokyl, Targin the Rock, Warlord
  Skarlon) to Nagafen's Lair, not here; Sol A's own roster is unknown. Low priority.
- **The Temple of Solusek Ro** (`soltemple`) — classic merchant/quest hub, minimal nameds, no EQL
  data. Skip unless the board wants it.

### Net recommendation (supplement)
Only **Temple of Cazic-Thule** and **The Estate of Unrest** have enough of a roster to be worth a
future board entry, and both need an eqlsource survey or a real slain-line pass first. The other
four have effectively no EQL-sourced named data — leave them out.

---

## 7. Sources
- https://eqlsource.com — /dungeons/ index + planeofhate, nagafenslair, thehole, kedgekeep,
  najena, mistmoore, lowerguk, splitpaw, crushbone, befallen, blackburrow, warrens;
  /named/ index (232 nameds); /raids/ + /raids/plane-of-sky; /learn/raid-access
- https://eqlwiki.com — Plane_of_Fear, Plane_of_Hate, Permafrost, Category:Raid_Encounters
  (⚠️ largely a P99 fork — mob names reliable, timers/levels are classic values)
- https://eqlforge.com — /voidlings, /raids, /raid/lady-vox
- `src/shared/data/zoneGraph.js`, `zoneAliases.js` (in-repo, EQL in-game strings)
