# Archive — kept for reference, not used by anything

**Nothing in this folder is referenced by the application, and none of it ships.**

`package.json`'s `build.files` is `["src/**/*", "package.json"]`, so this folder sits deliberately
outside `src/` and electron-builder never packages it. It is catalogue material: kept in case a
question comes up later, expected never to be needed.

If you are looking for something the app actually reads, it is not here.

---

## `buffs-legacy-11337.json`

The spell roster the app used before 2026-08-19, replaced by the EQ Legends rebuild.

11,337 entries mined from the generic EverQuest client's `spells_us.txt`. It carried the spells of
every EverQuest version, and EQ Legends runs a small subset of those — so most of it described
spells this server does not have.

That was not merely wasted space. Detection decides whether a landing line identifies a spell by
counting how many roster entries claim that line, so every absent spell still voted. Text that is
unique in practice looked ambiguous, and the app asked which of several spells had landed when only
one of them existed here.

Replaced by `src/shared/data/buffs.json` — 1,052 spells, built by `tools/build-roster.js` from the
curated EQL spreadsheet plus the game's own data files. Measured against a real play session, the
new roster recognises 83 distinct landing lines against the old one's 45, and confirms 49 of them
outright against 19.

**Do not restore this file.** If a spell is missing, add it to the spreadsheet and rebuild — that
keeps one source of truth. This copy exists so the old data can be *inspected*, not reinstated.
