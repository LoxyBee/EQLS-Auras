# eqtm search aliases — zone nicknames & raid-boss shorthand

Research for QOL-BACKLOG **#30** ("community shorthand / nicknames for zones in `eqtm`, and
search by boss name"). Nothing here is wired in yet — this is the data.

## What this is for

The `eqtm` zone-picker popup (`src/renderer/zone-prompt/`) filters the zone list by
case-insensitive substring against the **display name**. So "hole" finds nothing (the zone is
"The Ruins of Old Paineel") and "inny" finds nothing.

**#30 wants an alias layer**: a table of `alias → zone(s)` that the picker also matches, but the
alias itself is **never shown as a row** — matching an alias surfaces the real zone(s) it points
to. Two alias kinds:

- **zone nicknames** — "hole", "lguk", "gfay", "PoH" …
- **raid-boss names** — "vox", "naggy", "phinny", "inny", "yael" … each resolves to the **zone
  the boss is in**, so "inny" → "The Plane of Hate".

Suggested data shape (for whoever builds #30):

```js
// { alias (lowercase), zones: [canonical display name, …], kind }
{ alias: 'hole', zones: ['The Ruins of Old Paineel'], kind: 'zone' }
{ alias: 'inny', zones: ['The Plane of Hate'], kind: 'boss' }   // Innoruuk
```

Match rule: lowercase the query, exact-equal OR word-prefix against `alias`. Do **not** substring
alias matching ("in" should not pull every boss). An alias with several `zones` lists them all,
same as an ambiguous real substring already does.

Canonical names below are **exactly** the display strings in `src/shared/data/zoneGraph.js` (the
app's EQL in-game wording), which differ from every wiki — that difference is the whole reason
this file exists.

---

## 1. Zone nicknames

### Odus / the ones from #30's examples

| Alias(es) | Zone (canonical) | Note |
|---|---|---|
| `hole`, `the hole` | The Ruins of Old Paineel | classic "The Hole" |
| `lguk`, `lower guk`, `lower`, `ruins of old guk` | The Ruins of Old Guk | the undead/dead side |
| `uguk`, `upper guk`, `upper`, `city of guk` | The City of Guk | the live/froglok side |
| `guk` | The City of Guk, The Ruins of Old Guk | ambiguous — return both |
| `paineel` | Paineel | the city, not The Hole |
| `tox`, `toxx`, `tox forest` | Toxxulia Forest | |
| `warrens` | The Warrens | |
| `sb`, `stonebrunt` | The Stonebrunt Mountains | |
| `erudin`, `toolshed` | Erudin | |
| `epalace`, `erudin palace` | Erudin Palace | |
| `eruds`, `erud's crossing`, `ecx` | Erud's Crossing | |
| `kerra`, `kerra isle`, `kerra ridge` | Kerra Isle | |

### Antonica

| Alias(es) | Zone (canonical) | Note |
|---|---|---|
| `nro` | The Northern Desert of Ro | |
| `sro` | The Southern Desert of Ro | |
| `oasis`, `oom`, `oasis of marr` | The Oasis of Marr | |
| `ec`, `ecommons`, `east commons` | East Commonlands | also collides with Erud's Crossing / East Karana — see Conflicts |
| `wc`, `commons`, `west commons` | West Commonlands | |
| `nk`, `north karana` | The Northern Plains of Karana | |
| `sk`, `south karana` | The Southern Plains of Karana | collides with South Kaladim — see Conflicts |
| `ek`, `east karana` | The Eastern Plains of Karana | |
| `wk`, `west karana` | The Western Plains of Karana | |
| `nek`, `nekulos`, `nektulos` | Nektulos Forest | |
| `lava`, `ls`, `lavastorm` | The Lavastorm Mountains | |
| `sola`, `sol a`, `soleye` | Solusek's Eye | Sol Ro dungeon A |
| `solb`, `sol b`, `nagafen's lair`, `naggy's lair` | Nagafen's Lair | Sol Ro dungeon B, Lord Nagafen |
| `soltemple`, `sol temple`, `tosr`, `temple of solusek ro` | The Temple of Solusek Ro | |
| `naj`, `najena` | Najena | |
| `feer`, `ferrot`, `feerrott` | The Feerrott | |
| `ct`, `cazic thule`, `temple of cazic-thule`, `lost temple` | Temple of Cazic-Thule | the **dungeon zone** — "cazic"/"faceless" as a *boss* = Plane of Fear, see §2 |
| `rathe`, `rm`, `rathe mtns` | The Rathe Mountains | |
| `lake`, `lake rathe`, `lake rathetear` | Lake Rathetear | |
| `oggok` | Oggok | |
| `grobb` | Grobb | |
| `innothule`, `inno`, `inno swamp` | Innothule Swamp | **not** `inny` — that's Innoruuk, see Conflicts |
| `sp`, `paw`, `splitpaw`, `lair of the splitpaw` | The Lair of the Splitpaw | |
| `befallen`, `bef` | Befallen | |
| `oot`, `ocean`, `ocean of tears` | The Ocean of Tears | |
| `arena` | The Arena | |
| `beholder`, `xorbb`, `gorge`, `king xorbb` | Gorge of King Xorbb | classic "Beholder" |
| `perma`, `pf`, `permafrost`, `permafrost keep` | Permafrost Keep | Lady Vox |
| `everfrost`, `efp`, `ef` | Everfrost Peaks | |
| `halas` | Halas | |
| `bb`, `blackburrow` | Blackburrow | collides with Butcherblock — see Conflicts |
| `qhills`, `qeynos hills` | Qeynos Hills | |
| `nq`, `north qeynos` | North Qeynos | |
| `sq`, `south qeynos` | South Qeynos | |
| `qcat`, `qeynos catacombs`, `aqueduct` | The Qeynos Aqueduct System | |
| `sfg`, `surefall`, `surefall glade` | Surefall Glade | |
| `kith`, `kithicor` | Kithicor Forest | |
| `hhk`, `highkeep`, `high keep` | High Keep | |
| `hhp`, `highpass`, `highpass hold`, `high pass` | Highpass Hold | |
| `re`, `runnyeye`, `clan runnyeye`, `goblin` | Clan RunnyEye | |
| `rv`, `rivervale`, `vale` | Rivervale | |
| `misty`, `mt`, `misty thicket` | Misty Thicket | |
| `nfp`, `north freeport` | North Freeport | |
| `efp`, `east freeport` | East Freeport | `efp` also = Everfrost — see Conflicts |
| `wfp`, `west freeport` | West Freeport | |
| `fq`, `neriak foreign`, `neriak - foreign quarter` | Neriak - Foreign Quarter | |
| `neriak commons`, `neriak - commons` | Neriak - Commons | |
| `tg`, `3rd gate`, `third gate`, `neriak 3rd gate` | Neriak - 3rd Gate | |
| `neriak` | Neriak - Foreign Quarter, Neriak - Commons, Neriak - 3rd Gate | ambiguous — return all three |

### Faydwer

| Alias(es) | Zone (canonical) | Note |
|---|---|---|
| `gfay`, `greater fay`, `greater faydark` | The Greater Faydark | |
| `lfay`, `lesser fay`, `lesser faydark` | The Lesser Faydark | |
| `bbm`, `butcher`, `butcherblock` | Butcherblock Mountains | `bb` collides with Blackburrow — see Conflicts |
| `cb`, `crushbone`, `clan crushbone`, `bone` | Clan Crushbone | Emperor Crush |
| `mm`, `mistmoore`, `castle mistmoore`, `castle` | The Castle of Mistmoore | |
| `steam`, `sf`, `steamfont` | The Steamfont Mountains | |
| `nfel`, `north felwithe`, `northern felwithe` | Northern Felwithe | |
| `sfel`, `south felwithe`, `southern felwithe` | Southern Felwithe | |
| `fel`, `felwithe` | Northern Felwithe, Southern Felwithe | ambiguous — return both |
| `kal`, `kaladim` | South Kaladim, North Kaladim | ambiguous — return both |
| `nkal`, `north kaladim` | North Kaladim | |
| `skal`, `south kaladim` | South Kaladim | |
| `ak`, `akanon`, `ak'anon`, `gnome city` | Ak'Anon | |
| `dc`, `cauldron`, `dagnor's cauldron` | Dagnor's Cauldron | |
| `unrest`, `estate`, `estate of unrest` | The Estate of Unrest | |
| `kedge`, `kk`, `kedge keep` | Kedge Keep | Phinigel Autropos |
| `cc`, `crushbone` | Clan Crushbone | |

### Planes

| Alias(es) | Zone (canonical) | Note |
|---|---|---|
| `poh`, `hate`, `plane of hate` | The Plane of Hate | |
| `pof`, `fear`, `plane of fear` | The Plane of Fear | |
| `pos`, `posky`, `sky`, `air`, `plane of sky`, `plane of air` | The Plane of Sky | |

---

## 2. Raid-boss shorthand → zone  (EQ Legends only)

EQL's raid targets are **adapted classic encounters** — no wholly-custom bosses (confirmed:
eqlforge.com/raids, "mechanics use the classic encounters as a backbone"). EQL launch content is
Antonica / Faydwer / Odus only — the Kunark & Velious bosses on eqlwiki are P99-fork carryover
and are **excluded** here per the "EQL only" instruction.

### Marquee raid bosses

| Boss — alias(es) | Zone (canonical) |
|---|---|
| Lord Nagafen — `naggy`, `nagafen`, `lord nagafen`, `red dragon` | Nagafen's Lair |
| Lady Vox — `vox`, `lady vox`, `white dragon` | Permafrost Keep |
| Innoruuk — `inny`, `innoruuk`, `prince of hate` | The Plane of Hate |
| Maestro of Rancor — `mor`, `maestro`, `maestro of rancor` | The Plane of Hate |
| Cazic-Thule (god) — `cazic`, `faceless`, `ct god`, `god of fear` | The Plane of Fear |
| Dracoliche — `draco`, `dracoliche` | The Plane of Fear |
| Dread / Fright / Terror (fear golems) — `dread`, `fright`, `terror`, `fear golems` | The Plane of Fear |
| Eye of Veeshan — `eov`, `eye of veeshan` | The Plane of Sky |
| Hand of Veeshan — `hov`, `hand of veeshan` | The Plane of Sky |
| Master Yael — `yael`, `master yael` | The Ruins of Old Paineel |
| Phinigel Autropos — `phinny`, `phin`, `phinigel`, `autropos` | Kedge Keep |

### Plane of Sky island guardians (all → The Plane of Sky)

`thunder spirit princess`, `noble dojorn`, `protector of sky`, `gorgalosk`, `keeper of souls`,
`overseer of air`, `spiroc lord`, `bazzt zzzt` / `queen bee`, `sister of the spire`,
`key master` → **The Plane of Sky**

### Plane of Hate minibosses (all → The Plane of Hate)

`ashenbone broodmaster`, `avatar of abhorrence`, `coercer t'vala`, `grandmaster r'tal`,
`high priest m'kari`, `lord of ire`, `lord of loathing`, `magi p'tasa`, `master of spite`,
`mistress of scorn`, `grandmaster h'qilm` → **The Plane of Hate**

### Classic dungeon named bosses (EQL scaling-raid targets)

| Boss — alias(es) | Zone (canonical) | Confidence |
|---|---|---|
| Emperor Crush — `emp`, `emp crush`, `emperor crush`, `crush` | Clan Crushbone | high (classic canon) |
| Ghoul Lord — `ghoul lord`, `gl` | The Ruins of Old Guk | high |
| Frenzied Ghoul — `frenzy`, `frenzied` | The Ruins of Old Guk | high |
| Najena (the lich) — `najena` | Najena | high — same as the zone name |

*Not added — could not verify an EQL-specific named for these zones:* The Castle of Mistmoore,
Temple of Cazic-Thule (dungeon), The Estate of Unrest, Befallen, Solusek's Eye. Add later if a
name is confirmed.

---

## 3. Multi-hit aliases & judgement calls

**Rule (Shara, 30 Aug): a nickname that matches several zones returns ALL of them** — the picker
shows every hit and the player chooses, exactly like an ambiguous real-substring match already
does. So the "ambiguous" aliases below are not a problem to solve, just entries that carry more
than one `zones` value.

| Alias | Returns (all hits) |
|---|---|
| `bb` | Blackburrow + Butcherblock Mountains  *(`bbm` → Butcherblock only; `blackburrow` → Blackburrow only)* |
| `sk` | The Southern Plains of Karana + South Kaladim |
| `ec` | East Commonlands + Erud's Crossing + The Eastern Plains of Karana |
| `efp` | East Freeport + Everfrost Peaks |
| `guk` | The City of Guk + The Ruins of Old Guk |
| `fel` | Northern Felwithe + Southern Felwithe |
| `kal` | South Kaladim + North Kaladim |
| `neriak` | Neriak - Foreign Quarter + Neriak - Commons + Neriak - 3rd Gate |
| `ct` | Temple of Cazic-Thule + The Plane of Fear  *(the dungeon zone and "CT" the god both count; `cazic` / `faceless` → Plane of Fear only)* |

**Genuinely one target, do not multi-hit:**

| Alias | Target | Why not the other thing |
|---|---|---|
| `inny` | The Plane of Hate (Innoruuk) | per #30's own example. The swamp is `inno` / `innothule` / `inno swamp` — `inny` is not a swamp alias at all. |
| `pos`, `posky` | The Plane of Sky | no Plane of Storms in EQL. |

**Client short names are auto-indexed (Shara, 30 Aug):** the picker ALSO matches every zone's
`shortName` (`gukbottom`, `soldungb`, `oot`, `commons`, `ecommons`, `gfaydark`, `beholder`,
`qey2hh1`, …) with the same prefix/exact rule. Zero-maintenance — any future zone is covered
automatically. `zoneGraph.js` already carries `shortName` on every entry. This is *in addition to*
the curated list in §6, which stays for the human nicknames that aren't client codes (`naggy`,
`lguk`, `inny`, `phinny`). Rationale: "people should have many different ways to find the zone
they want, however they're used to." The one junk value, `__eql_newsebilis`, still only ever
*adds* a match for New Sebilis Expedition, so it's harmless.

---

## 4. Sources

- [P99 — The Ultimate EverQuest Acronyms List](https://www.project1999.com/forums/showthread.php?t=12160)
- [RedGuides — EverQuest zone short names](https://www.redguides.com/docs/projects/everquest/general/zone-short-names/)
- [EQ Legends Wiki — Category: Raid Encounters](https://eqlwiki.com/Category:Raid_Encounters)
- [EQLForge — Raid Bosses](https://eqlforge.com/raids)
- [EQ Legends Wiki — Plane of Hate](https://eqlwiki.com/Plane_of_Hate) · [Plane of Sky](https://eqlwiki.com/Plane_of_Sky) · [Plane of Fear](https://eqlwiki.com/Plane_of_Fear)
- [EQProgression — Master Yael](https://www.eqprogression.com/npc-master-yael/) · [Phinigel Autropos](https://www.eqprogression.com/npc-phinigel-autropos/)

## 5. Open questions for Shara

1. ~~Ambiguous aliases — return all or pick one?~~ **Answered 30 Aug: return all hits.** (§3.)
2. ~~Auto-index client `shortName`s too?~~ **Answered 30 Aug: yes — do both** (auto-index + curated list). (§3.)
3. Any EQL-specific zone or boss nicknames your guild uses that aren't classic-standard?
4. Want the Mistmoore / Unrest / Befallen / Sol A dungeon bosses researched further, or skip?

---

## 6. Consolidated data (for the picker)

Every `to` value is verbatim from `src/shared/data/zoneGraph.js`. `k`: `'z'` zone nickname,
`'b'` raid-boss name. Multi-hit aliases carry >1 zone; the picker returns all.

```js
const EQTM_ALIASES = [
  // --- zone nicknames ---
  { a: 'hole', z: ['The Ruins of Old Paineel'], k: 'z' },
  { a: 'lguk', z: ['The Ruins of Old Guk'], k: 'z' },
  { a: 'lower guk', z: ['The Ruins of Old Guk'], k: 'z' },
  { a: 'uguk', z: ['The City of Guk'], k: 'z' },
  { a: 'upper guk', z: ['The City of Guk'], k: 'z' },
  { a: 'guk', z: ['The City of Guk', 'The Ruins of Old Guk'], k: 'z' },
  { a: 'tox', z: ['Toxxulia Forest'], k: 'z' },
  { a: 'toxx', z: ['Toxxulia Forest'], k: 'z' },
  { a: 'sb', z: ['The Stonebrunt Mountains'], k: 'z' },
  { a: 'stonebrunt', z: ['The Stonebrunt Mountains'], k: 'z' },
  { a: 'eruds', z: ["Erud's Crossing"], k: 'z' },
  { a: 'epalace', z: ['Erudin Palace'], k: 'z' },
  { a: 'kerra', z: ['Kerra Isle'], k: 'z' },
  { a: 'warrens', z: ['The Warrens'], k: 'z' },
  { a: 'nro', z: ['The Northern Desert of Ro'], k: 'z' },
  { a: 'sro', z: ['The Southern Desert of Ro'], k: 'z' },
  { a: 'oasis', z: ['The Oasis of Marr'], k: 'z' },
  { a: 'oom', z: ['The Oasis of Marr'], k: 'z' },
  { a: 'ec', z: ['East Commonlands', "Erud's Crossing", 'The Eastern Plains of Karana'], k: 'z' },
  { a: 'ecommons', z: ['East Commonlands'], k: 'z' },
  { a: 'wc', z: ['West Commonlands'], k: 'z' },
  { a: 'commons', z: ['West Commonlands'], k: 'z' },
  { a: 'nk', z: ['The Northern Plains of Karana'], k: 'z' },
  { a: 'sk', z: ['The Southern Plains of Karana', 'South Kaladim'], k: 'z' },
  { a: 'ek', z: ['The Eastern Plains of Karana'], k: 'z' },
  { a: 'wk', z: ['The Western Plains of Karana'], k: 'z' },
  { a: 'north karana', z: ['The Northern Plains of Karana'], k: 'z' },
  { a: 'south karana', z: ['The Southern Plains of Karana'], k: 'z' },
  { a: 'east karana', z: ['The Eastern Plains of Karana'], k: 'z' },
  { a: 'west karana', z: ['The Western Plains of Karana'], k: 'z' },
  { a: 'nek', z: ['Nektulos Forest'], k: 'z' },
  { a: 'nektulos', z: ['Nektulos Forest'], k: 'z' },
  { a: 'lava', z: ['The Lavastorm Mountains'], k: 'z' },
  { a: 'ls', z: ['The Lavastorm Mountains'], k: 'z' },
  { a: 'lavastorm', z: ['The Lavastorm Mountains'], k: 'z' },
  { a: 'sola', z: ["Solusek's Eye"], k: 'z' },
  { a: 'sol a', z: ["Solusek's Eye"], k: 'z' },
  { a: 'solb', z: ["Nagafen's Lair"], k: 'z' },
  { a: 'sol b', z: ["Nagafen's Lair"], k: 'z' },
  { a: 'soltemple', z: ['The Temple of Solusek Ro'], k: 'z' },
  { a: 'sol temple', z: ['The Temple of Solusek Ro'], k: 'z' },
  { a: 'tosr', z: ['The Temple of Solusek Ro'], k: 'z' },
  { a: 'naj', z: ['Najena'], k: 'z' },
  { a: 'feer', z: ['The Feerrott'], k: 'z' },
  { a: 'ferrot', z: ['The Feerrott'], k: 'z' },
  { a: 'ct', z: ['Temple of Cazic-Thule', 'The Plane of Fear'], k: 'z' },
  { a: 'cazic thule', z: ['Temple of Cazic-Thule'], k: 'z' },
  { a: 'lost temple', z: ['Temple of Cazic-Thule'], k: 'z' },
  { a: 'rathe', z: ['The Rathe Mountains'], k: 'z' },
  { a: 'rm', z: ['The Rathe Mountains'], k: 'z' },
  { a: 'lake', z: ['Lake Rathetear'], k: 'z' },
  { a: 'lake rathe', z: ['Lake Rathetear'], k: 'z' },
  { a: 'inno', z: ['Innothule Swamp'], k: 'z' },
  { a: 'innothule', z: ['Innothule Swamp'], k: 'z' },
  { a: 'inno swamp', z: ['Innothule Swamp'], k: 'z' },
  { a: 'sp', z: ['The Lair of the Splitpaw'], k: 'z' },
  { a: 'paw', z: ['The Lair of the Splitpaw'], k: 'z' },
  { a: 'splitpaw', z: ['The Lair of the Splitpaw'], k: 'z' },
  { a: 'bef', z: ['Befallen'], k: 'z' },
  { a: 'oot', z: ['The Ocean of Tears'], k: 'z' },
  { a: 'ocean', z: ['The Ocean of Tears'], k: 'z' },
  { a: 'beholder', z: ['Gorge of King Xorbb'], k: 'z' },
  { a: 'xorbb', z: ['Gorge of King Xorbb'], k: 'z' },
  { a: 'gorge', z: ['Gorge of King Xorbb'], k: 'z' },
  { a: 'perma', z: ['Permafrost Keep'], k: 'z' },
  { a: 'pf', z: ['Permafrost Keep'], k: 'z' },
  { a: 'permafrost', z: ['Permafrost Keep'], k: 'z' },
  { a: 'everfrost', z: ['Everfrost Peaks'], k: 'z' },
  { a: 'efp', z: ['East Freeport', 'Everfrost Peaks'], k: 'z' },
  { a: 'bb', z: ['Blackburrow', 'Butcherblock Mountains'], k: 'z' },
  { a: 'bbm', z: ['Butcherblock Mountains'], k: 'z' },
  { a: 'butcher', z: ['Butcherblock Mountains'], k: 'z' },
  { a: 'qhills', z: ['Qeynos Hills'], k: 'z' },
  { a: 'nq', z: ['North Qeynos'], k: 'z' },
  { a: 'sq', z: ['South Qeynos'], k: 'z' },
  { a: 'qcat', z: ['The Qeynos Aqueduct System'], k: 'z' },
  { a: 'qeynos catacombs', z: ['The Qeynos Aqueduct System'], k: 'z' },
  { a: 'aqueduct', z: ['The Qeynos Aqueduct System'], k: 'z' },
  { a: 'sfg', z: ['Surefall Glade'], k: 'z' },
  { a: 'surefall', z: ['Surefall Glade'], k: 'z' },
  { a: 'kith', z: ['Kithicor Forest'], k: 'z' },
  { a: 'hhk', z: ['High Keep'], k: 'z' },
  { a: 'highkeep', z: ['High Keep'], k: 'z' },
  { a: 'hhp', z: ['Highpass Hold'], k: 'z' },
  { a: 'highpass', z: ['Highpass Hold'], k: 'z' },
  { a: 'high pass', z: ['Highpass Hold'], k: 'z' },
  { a: 're', z: ['Clan RunnyEye'], k: 'z' },
  { a: 'runnyeye', z: ['Clan RunnyEye'], k: 'z' },
  { a: 'goblin', z: ['Clan RunnyEye'], k: 'z' },
  { a: 'rv', z: ['Rivervale'], k: 'z' },
  { a: 'vale', z: ['Rivervale'], k: 'z' },
  { a: 'misty', z: ['Misty Thicket'], k: 'z' },
  { a: 'mt', z: ['Misty Thicket'], k: 'z' },
  { a: 'nfp', z: ['North Freeport'], k: 'z' },
  { a: 'efreeport', z: ['East Freeport'], k: 'z' },
  { a: 'wfp', z: ['West Freeport'], k: 'z' },
  { a: 'fq', z: ['Neriak - Foreign Quarter'], k: 'z' },
  { a: 'tg', z: ['Neriak - 3rd Gate'], k: 'z' },
  { a: 'third gate', z: ['Neriak - 3rd Gate'], k: 'z' },
  { a: '3rd gate', z: ['Neriak - 3rd Gate'], k: 'z' },
  { a: 'neriak', z: ['Neriak - Foreign Quarter', 'Neriak - Commons', 'Neriak - 3rd Gate'], k: 'z' },
  { a: 'gfay', z: ['The Greater Faydark'], k: 'z' },
  { a: 'greater faydark', z: ['The Greater Faydark'], k: 'z' },
  { a: 'lfay', z: ['The Lesser Faydark'], k: 'z' },
  { a: 'lesser faydark', z: ['The Lesser Faydark'], k: 'z' },
  { a: 'cb', z: ['Clan Crushbone'], k: 'z' },
  { a: 'crushbone', z: ['Clan Crushbone'], k: 'z' },
  { a: 'mm', z: ['The Castle of Mistmoore'], k: 'z' },
  { a: 'mistmoore', z: ['The Castle of Mistmoore'], k: 'z' },
  { a: 'castle', z: ['The Castle of Mistmoore'], k: 'z' },
  { a: 'steam', z: ['The Steamfont Mountains'], k: 'z' },
  { a: 'sf', z: ['The Steamfont Mountains'], k: 'z' },
  { a: 'steamfont', z: ['The Steamfont Mountains'], k: 'z' },
  { a: 'fel', z: ['Northern Felwithe', 'Southern Felwithe'], k: 'z' },
  { a: 'felwithe', z: ['Northern Felwithe', 'Southern Felwithe'], k: 'z' },
  { a: 'kal', z: ['South Kaladim', 'North Kaladim'], k: 'z' },
  { a: 'kaladim', z: ['South Kaladim', 'North Kaladim'], k: 'z' },
  { a: 'ak', z: ["Ak'Anon"], k: 'z' },
  { a: 'akanon', z: ["Ak'Anon"], k: 'z' },
  { a: 'dc', z: ["Dagnor's Cauldron"], k: 'z' },
  { a: 'cauldron', z: ["Dagnor's Cauldron"], k: 'z' },
  { a: 'unrest', z: ['The Estate of Unrest'], k: 'z' },
  { a: 'estate', z: ['The Estate of Unrest'], k: 'z' },
  { a: 'kedge', z: ['Kedge Keep'], k: 'z' },
  { a: 'kk', z: ['Kedge Keep'], k: 'z' },
  { a: 'poh', z: ['The Plane of Hate'], k: 'z' },
  { a: 'hate', z: ['The Plane of Hate'], k: 'z' },
  { a: 'pof', z: ['The Plane of Fear'], k: 'z' },
  { a: 'fear', z: ['The Plane of Fear'], k: 'z' },
  { a: 'pos', z: ['The Plane of Sky'], k: 'z' },
  { a: 'posky', z: ['The Plane of Sky'], k: 'z' },
  { a: 'sky', z: ['The Plane of Sky'], k: 'z' },
  { a: 'air', z: ['The Plane of Sky'], k: 'z' },

  // --- raid-boss names (EQ Legends only) ---
  { a: 'naggy', z: ["Nagafen's Lair"], k: 'b' },
  { a: 'nagafen', z: ["Nagafen's Lair"], k: 'b' },
  { a: 'lord nagafen', z: ["Nagafen's Lair"], k: 'b' },
  { a: 'red dragon', z: ["Nagafen's Lair"], k: 'b' },
  { a: 'vox', z: ['Permafrost Keep'], k: 'b' },
  { a: 'lady vox', z: ['Permafrost Keep'], k: 'b' },
  { a: 'white dragon', z: ['Permafrost Keep'], k: 'b' },
  { a: 'inny', z: ['The Plane of Hate'], k: 'b' },
  { a: 'innoruuk', z: ['The Plane of Hate'], k: 'b' },
  { a: 'prince of hate', z: ['The Plane of Hate'], k: 'b' },
  { a: 'mor', z: ['The Plane of Hate'], k: 'b' },
  { a: 'maestro', z: ['The Plane of Hate'], k: 'b' },
  { a: 'maestro of rancor', z: ['The Plane of Hate'], k: 'b' },
  { a: 'cazic', z: ['The Plane of Fear'], k: 'b' },
  { a: 'faceless', z: ['The Plane of Fear'], k: 'b' },
  { a: 'god of fear', z: ['The Plane of Fear'], k: 'b' },
  { a: 'draco', z: ['The Plane of Fear'], k: 'b' },
  { a: 'dracoliche', z: ['The Plane of Fear'], k: 'b' },
  { a: 'dread', z: ['The Plane of Fear'], k: 'b' },
  { a: 'fright', z: ['The Plane of Fear'], k: 'b' },
  { a: 'terror', z: ['The Plane of Fear'], k: 'b' },
  { a: 'fear golems', z: ['The Plane of Fear'], k: 'b' },
  { a: 'eov', z: ['The Plane of Sky'], k: 'b' },
  { a: 'eye of veeshan', z: ['The Plane of Sky'], k: 'b' },
  { a: 'hov', z: ['The Plane of Sky'], k: 'b' },
  { a: 'hand of veeshan', z: ['The Plane of Sky'], k: 'b' },
  { a: 'yael', z: ['The Ruins of Old Paineel'], k: 'b' },
  { a: 'master yael', z: ['The Ruins of Old Paineel'], k: 'b' },
  { a: 'phinny', z: ['Kedge Keep'], k: 'b' },
  { a: 'phin', z: ['Kedge Keep'], k: 'b' },
  { a: 'phinigel', z: ['Kedge Keep'], k: 'b' },
  { a: 'autropos', z: ['Kedge Keep'], k: 'b' },
  { a: 'emp crush', z: ['Clan Crushbone'], k: 'b' },
  { a: 'emperor crush', z: ['Clan Crushbone'], k: 'b' },
  { a: 'ghoul lord', z: ['The Ruins of Old Guk'], k: 'b' },
  { a: 'frenzy', z: ['The Ruins of Old Guk'], k: 'b' },
  { a: 'frenzied ghoul', z: ['The Ruins of Old Guk'], k: 'b' },
  // Plane of Sky island guardians (all -> The Plane of Sky)
  { a: 'thunder spirit princess', z: ['The Plane of Sky'], k: 'b' },
  { a: 'noble dojorn', z: ['The Plane of Sky'], k: 'b' },
  { a: 'protector of sky', z: ['The Plane of Sky'], k: 'b' },
  { a: 'gorgalosk', z: ['The Plane of Sky'], k: 'b' },
  { a: 'keeper of souls', z: ['The Plane of Sky'], k: 'b' },
  { a: 'overseer of air', z: ['The Plane of Sky'], k: 'b' },
  { a: 'spiroc lord', z: ['The Plane of Sky'], k: 'b' },
  { a: 'bazzt zzzt', z: ['The Plane of Sky'], k: 'b' },
  { a: 'queen bee', z: ['The Plane of Sky'], k: 'b' },
  { a: 'sister of the spire', z: ['The Plane of Sky'], k: 'b' },
  { a: 'key master', z: ['The Plane of Sky'], k: 'b' },
  // Plane of Hate minibosses (all -> The Plane of Hate)
  { a: 'ashenbone broodmaster', z: ['The Plane of Hate'], k: 'b' },
  { a: 'avatar of abhorrence', z: ['The Plane of Hate'], k: 'b' },
  { a: "coercer t'vala", z: ['The Plane of Hate'], k: 'b' },
  { a: "grandmaster r'tal", z: ['The Plane of Hate'], k: 'b' },
  { a: "high priest m'kari", z: ['The Plane of Hate'], k: 'b' },
  { a: 'lord of ire', z: ['The Plane of Hate'], k: 'b' },
  { a: 'lord of loathing', z: ['The Plane of Hate'], k: 'b' },
  { a: "magi p'tasa", z: ['The Plane of Hate'], k: 'b' },
  { a: 'master of spite', z: ['The Plane of Hate'], k: 'b' },
  { a: 'mistress of scorn', z: ['The Plane of Hate'], k: 'b' },
];
```

**Wiring notes for whoever builds it:**
- Three match sources, unioned: (a) the existing display-name substring search, (b) this
  `EQTM_ALIASES` list, (c) **every zone's `zoneGraph.js` `shortName`** (auto-indexed, per Shara).
- Match rule for (b) and (c): lowercase the query, then `alias === q` OR `alias.startsWith(q)` OR
  `q.startsWith(alias)`. Not free substring (`'a'` must not match `air`/`ak`/`ashenbone`).
- On a hit, union the alias's `z` with whatever the normal display-name substring search already
  returned, dedupe, render as usual. The alias string itself is never a row.
- Validate every `z` value against `resolveZoneName()` in a test so a zoneGraph rename can't
  silently orphan an alias.
- `k` (`'z'`/`'b'`) is only there if you want a "· boss" hint on those rows; nothing needs it.
