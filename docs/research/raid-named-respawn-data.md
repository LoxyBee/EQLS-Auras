# Raid-named respawn / lockout data — research for backlog #33

Gathered 2026-08-30 by a research agent. **Not yet wired into code.** Read the caveat first.

## CRITICAL FINDING — the 2026 EQL raid revamp

EverQuest Legends **overhauled its raid system in 2026** (dev stream 2026-05-06). Open-world raid
spawns were removed. Every raid target below is now entered through a **"Voidling" NPC** that opens
a **private scaled instance** (difficulties D0–D4). Instances carry a **weekly lockout that resets
Tuesday** (first kill = full loot + sets the lockout) with an **18-hour re-clear** for single loot
pieces afterward. `src/main/lockoutCore.js` already models the weekly side of this.

**So on the current server a per-named "respawn timer" is largely replaced by instance lockout.**
A #33 board is really: *cleared this instance this week? / is my 18h re-clear window up?* — not a
spawn countdown. The `respawnMinutes` values below are best read as **classic-era / pre-revamp
reference values** (the EQL wiki's own `Respawn_Timers` page still publishes them; base pattern is
3 days ± 12h).

## Confidence tiers

- `measured` — from eqlwiki.com/Respawn_Timers (EQL-specific)
- `typical` — no EQL number published; the consistent classic / P99 / Allakhazam value
- `inferred` — even the classic value is disputed, or the mob is trigger-gated

## Data

```json
{
  "Nagafen's Lair": { "shortName": "soldungb", "instancedOnEQL": true, "nameds": [
    { "name": "Lord Nagafen", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d +12h var (eqlwiki). Voidling in Lavastorm." },
    { "name": "Zordak Ragefire", "respawnMinutes": 1440, "confidence": "inferred", "notes": "eqlwiki 24h, uncertain." },
    { "name": "Fire Giants (named)", "respawnMinutes": 720, "confidence": "measured", "notes": "12h (eqlwiki)." } ] },
  "Permafrost": { "shortName": "permafrost", "instancedOnEQL": true, "nameds": [
    { "name": "Lady Vox", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d +12h var. Voidling in Everfrost." } ] },
  "Plane of Fear": { "shortName": "fearplane", "instancedOnEQL": true, "nameds": [
    { "name": "Cazic Thule", "respawnMinutes": 4680, "confidence": "measured", "notes": "eqlwiki '3 to 3.5 days'." },
    { "name": "A dracoliche", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d +12h var." },
    { "name": "Fright", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d, no variance." },
    { "name": "Dread", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d, no variance." },
    { "name": "Terror", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d, no variance." },
    { "name": "A broken golem", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d, no variance." },
    { "name": "Wraith of a Shissar", "respawnMinutes": 10080, "confidence": "measured", "notes": "7d, OR 24h after Cazic Thule killed." } ] },
  "Plane of Hate": { "shortName": "hateplane", "instancedOnEQL": true, "nameds": [
    { "name": "Innoruuk", "respawnMinutes": 4320, "confidence": "measured", "notes": "3d +12h var." },
    { "name": "Hand of the Maestro", "respawnMinutes": 720, "confidence": "measured", "notes": "12h." },
    { "name": "Maestro of Rancor", "respawnMinutes": 4320, "confidence": "inferred", "notes": "not in eqlwiki table." } ] },
  "Plane of Sky": { "shortName": "airplane", "instancedOnEQL": true, "nameds": [
    { "name": "Noble Dojorn", "respawnMinutes": 7200, "confidence": "inferred", "notes": "eqlwiki ~5d, flagged uncertain." },
    { "name": "Overlord Mraaka", "respawnMinutes": 4320, "confidence": "inferred", "notes": "Island 7; key-gated." },
    { "name": "Eye of Veeshan", "respawnMinutes": 4320, "confidence": "inferred", "notes": "final island; trigger/key gated." } ] },
  "Plane of Growth": { "shortName": "growthplane", "instancedOnEQL": true, "nameds": [
    { "name": "Tunare", "respawnMinutes": 10080, "confidence": "typical", "notes": "P99 7d." },
    { "name": "Keeper of the Glades", "respawnMinutes": 4320, "confidence": "inferred" },
    { "name": "A protector of growth", "respawnMinutes": 23, "confidence": "typical", "notes": "P99 23min, trash-tier named." } ] },
  "Kael Drakkel": { "shortName": "kael", "instancedOnEQL": true, "nameds": [
    { "name": "King Tormax", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Derakor the Vindicator", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "The Statue of Rallos Zek", "respawnMinutes": 4320, "confidence": "typical", "notes": "on death -> Idol -> triggers Avatar of War." },
    { "name": "The Avatar of War", "respawnMinutes": null, "confidence": "typical", "notes": "TRIGGER-ONLY: killing the Statue; despawns 1h after trigger." },
    { "name": "Keeper of Tofte", "respawnMinutes": 4320, "confidence": "inferred" },
    { "name": "Vkjen", "respawnMinutes": 4320, "confidence": "inferred" } ] },
  "Temple of Veeshan": { "shortName": "templeveeshan", "instancedOnEQL": true, "nameds": [
    { "name": "Aaryonar", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lord Feshlak", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lord Kreizenn", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lord Vyemm", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lord Koi Doken", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lady Mirenilla", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Lady Nevederia", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Gozzrem", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Dagarn the Destroyer", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Sevalak", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Zlexak", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Ikatiar the Venom", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Jorlleag", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Dozekar the Cursed", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Vulak Aerr", "respawnMinutes": null, "confidence": "typical", "notes": "TRIGGER-ONLY: all NToV Lords/Ladies killed -> Thylex despawns -> Vulak." } ] },
  "Sleeper's Tomb": { "shortName": "sleeper", "instancedOnEQL": true, "nameds": [
    { "name": "Hraashna the Warder", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Tukaarak the Warder", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Nanzata the Warder", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Ventani the Warder", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Kerafyrm the Sleeper", "respawnMinutes": null, "confidence": "inferred", "notes": "event/lockout-gated, not a timer." } ] },
  "Western Wastes": { "shortName": "westwastes", "instancedOnEQL": true, "nameds": [
    { "name": "Lord Yelinak", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Kelorek Dar", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Sontalak", "respawnMinutes": 4320, "confidence": "typical" } ] },
  "Dragon Necropolis": { "shortName": "necropolis", "instancedOnEQL": true, "nameds": [
    { "name": "Zlandicar", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Klandicar", "respawnMinutes": 4320, "confidence": "typical" } ] },
  "Veeshan's Peak": { "shortName": "veeshan", "instancedOnEQL": true, "nameds": [
    { "name": "Silverwing", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Druushk", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Hoshkar", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Nexona", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Phara Dar", "respawnMinutes": 4320, "confidence": "typical" },
    { "name": "Xygoz", "respawnMinutes": 4320, "confidence": "typical" } ] },
  "Chardok": { "shortName": "chardok", "instancedOnEQL": true, "nameds": [
    { "name": "Overking Bathezid", "respawnMinutes": 4320, "confidence": "inferred", "notes": "throne event; likely lockout-gated on EQL." },
    { "name": "Queen Velazul Dizok", "respawnMinutes": 4320, "confidence": "inferred" },
    { "name": "Prince Selrach Dizok", "respawnMinutes": 4320, "confidence": "inferred" } ] },
  "Karnor's Castle": { "shortName": "karnor", "instancedOnEQL": true, "nameds": [
    { "name": "Venril Sathir", "respawnMinutes": 7200, "confidence": "typical", "notes": "5d +12h var." } ] },
  "Kunark overworld dragons": { "nameds": [
    { "name": "Gorenaire", "respawnMinutes": 4320, "confidence": "typical", "notes": "Dreadlands." },
    { "name": "Talendor", "respawnMinutes": 4320, "confidence": "typical", "notes": "Skyfire." },
    { "name": "Severilous", "respawnMinutes": 4320, "confidence": "typical", "notes": "Emerald Jungle." },
    { "name": "Trakanon", "respawnMinutes": 3240, "confidence": "typical", "notes": "Old Sebilis, ~2.25d." } ] }
}
```

## Trigger-only encounters (not timed — special-case in the widget)

- **The Avatar of War** — spawned by killing The Statue of Rallos Zek; despawns 1h after trigger.
- **Vulak Aerr** — spawns when all NToV Lords/Ladies are dead (Thylex despawns).
- **Kerafyrm / The Sleeper** — event or lockout-gated, never a respawn timer.

## Zones with NO findable raid-named data (not invented)

Eastern Wastes, Cobalt Scar, Skyshrine, Siren's Grotto — not open-world raid-target zones in
classic EQ.

## Sources

- https://eqlwiki.com/Respawn_Timers
- https://eqlwiki.com/Category:Raid_Encounters  (lockout system: weekly Tue reset, 18h reclear, Voidling entry)
- https://eqlwiki.com/Veeshan's_Peak
- https://eqlforge.com/raids , https://eqlforge.com/voidlings
- https://itemlevel.net/how-to-start-raiding-in-everquest-legends-every-voidling-location/
- https://everquest.allakhazam.com/wiki/eq:Respawn_Timers
- wiki.project1999.com (Phara Dar, Kael Drakkel, Statue of Rallos Zek, Avatar of War, Plane of Growth, Venril Sathir)
