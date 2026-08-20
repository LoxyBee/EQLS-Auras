const fs = require('fs');
const path = require('path');
const { stripRankSuffix } = require('./buffParser');

// Bump this whenever src/shared/data/buffs.json gets meaningfully richer
// (not just a couple of entries) - it gates a one-time upgrade pass that
// refreshes already-seeded entries with the better data, see constructor.
const STARTER_VERSION = 6;

// Anything longer than this can safely be assumed to not need live-timer
// tracking at all (confirmed via live testing: the roster mining's ticks=0
// "unknown duration" fallback used exactly 432000s/5 days, producing
// entries like Cannibalize - a genuinely instant, no-duration ability -
// showing up as an "active buff" counting down from days. Checked against
// the whole roster: nothing legitimate needing a countdown sits above this
// threshold either - the only non-fallback entries that do are mount/vehicle
// activation toggles, beta-test placeholders, and multi-hour consumables
// nobody needs a live timer for).
const MAX_TRACKABLE_DURATION_SEC = 5 * 3600;

// Persisted database of known buffs and their durations (plus, where known,
// the exact "landed" and "wore off" message text mined from the game's own
// spell files - see landingText/endedText). Seeded once from the bundled
// starter list, then lives entirely in the user's saved config so
// edits/additions (including ones learned from "unknown buff" entries)
// stick around and bundled-file updates never clobber them.
class BuffStore {
  constructor(store) {
    this.store = store;
    const starterPath = path.join(__dirname, '..', 'shared', 'data', 'buffs.json');
    const starter = JSON.parse(fs.readFileSync(starterPath, 'utf8'));

    this.buffs = store.loadJson('buffs', null);
    const meta = store.loadJson('buffsMeta', { starterVersion: 0 });

    if (!this.buffs) {
      this.buffs = starter.map((e) => ({ ...e }));
      meta.starterVersion = STARTER_VERSION;
      meta.customMigrated = true;
      store.saveJson('buffsMeta', meta);
      this._save();
      return;
    }

    if (meta.starterVersion < STARTER_VERSION) {
      let changed = false;
      for (const starterEntry of starter) {
        const idx = this.buffs.findIndex((b) => b.name.toLowerCase() === starterEntry.name.toLowerCase());
        if (idx === -1) {
          this.buffs.push({ ...starterEntry });
          changed = true;
          continue;
        }
        const existing = this.buffs[idx];
        // Only refresh entries that look auto-seeded (no custom text/icon
        // ever set on them) - anything with landingText/endedText/iconId
        // already was either from a previous mined roster or something the
        // user deliberately typed in, so leave it alone either way.
        const looksAutoSeeded = !existing.landingText && !existing.endedText && !existing.iconId;
        if (looksAutoSeeded) {
          this.buffs[idx] = { ...starterEntry, showOnOverlay: existing.showOnOverlay !== false };
          changed = true;
        }
      }
      meta.starterVersion = STARTER_VERSION;
      store.saveJson('buffsMeta', meta);
      if (changed) this._save();
    }

    // One-time: adopt the EQ Legends roster.
    //
    // The bundled roster was rebuilt from the server's own spell list - 11,337 generic
    // EverQuest-client entries down to the 1,052 spells this server actually has. The
    // version-gated pass above cannot deliver that, because it only ever ADDS missing entries and
    // refreshes ones that look untouched. Run on an existing install it would merge the new 1,052
    // into the old 11,337 and leave roughly 12,000 - bigger, not smaller, which is the opposite
    // of the point. Roster SIZE is the thing being fixed: every spell this server does not have
    // still votes on whether a landing line is ambiguous, so carrying them made text that is
    // unique in practice look ambiguous and prompted for answers that had only one option.
    //
    // No copy of the old roster is written into userData. The retired roster is kept in the
    // repository at archive/buffs-legacy-11337.json as catalogue material - deliberately outside
    // src/ so it is never packaged - and duplicating 2.5 MB of it into every user's app data to
    // guard a migration that is reproducible from the spreadsheet would be clutter, not safety.
    //
    // What survives: anything the user made themselves (custom: true), and the per-buff
    // "show on overlay" choice for every spell that exists in both rosters. What goes: seeded
    // entries for spells this server does not have, which is the entire intent.
    if (!meta.eqlRosterV1) {
      const overlayChoice = new Map();
      for (const b of this.buffs) {
        if (b.showOnOverlay !== undefined) overlayChoice.set(b.name.toLowerCase(), b.showOnOverlay);
      }
      const starterNames = new Set(starter.map((e) => e.name.toLowerCase()));
      const keptCustom = this.buffs.filter((b) => b.custom === true && !starterNames.has(b.name.toLowerCase()));

      this.buffs = starter.map((e) => {
        const copy = { ...e, custom: false };
        const choice = overlayChoice.get(e.name.toLowerCase());
        if (choice !== undefined) copy.showOnOverlay = choice;
        return copy;
      });
      this.buffs.push(...keptCustom);

      meta.eqlRosterV1 = true;
      meta.eqlRosterV1Stats = { replaced: starter.length, keptCustom: keptCustom.length };

      // Every one-shot below this point was a fixup for the OLD mined roster - backfilling
      // third-person text, rebuilding it wholesale, purging unmatched customs, dropping
      // over-long durations. Against a roster that has just been replaced outright they have
      // nothing left to do, and left un-flagged they actively undo this migration: the custom
      // purge deletes the user's hand-made buffs, and the wholesale rebuild strips the overlay
      // choices restored just above. Found by the tests in test/roster-migration.test.js, which
      // failed on exactly that - a hand-made buff vanishing and two entries going missing.
      meta.customMigrated = true;
      meta.otherSuffixMigrated = true;
      meta.fullRosterRebuildV1 = true;
      meta.unmatchedCustomPurgedV1 = true;
      meta.longDurationPurgedV1 = true;

      store.saveJson('buffsMeta', meta);
      this._save();
    }

    // One-time: the "custom" flag (drives the Custom Buffs list) didn't
    // exist before it was added, so anything typed in or promoted from an
    // Unknown cast prior to that never got marked - retroactively flag
    // anything not found in the bundled starter roster, since that's
    // exactly what "custom" means for entries created going forward too.
    if (!meta.customMigrated) {
      const starterNames = new Set(starter.map((s) => s.name.toLowerCase()));
      let changed = false;
      for (const b of this.buffs) {
        if (b.custom === undefined && !starterNames.has(b.name.toLowerCase())) {
          b.custom = true;
          changed = true;
        }
      }
      meta.customMigrated = true;
      store.saveJson('buffsMeta', meta);
      if (changed) this._save();
    }

    // One-time: othersLandingSuffix (ally-buff detection - see buffEngine.js)
    // is a brand new field on an otherwise-already-complete roster, so the
    // starterVersion upgrade pass above skips almost every entry (its
    // looksAutoSeeded check only refreshes entries with NO landingText/
    // endedText/iconId at all, which by now is nearly none of them). Name-
    // matched backfill instead: copy the field in from the bundled starter
    // wherever an existing entry doesn't already have one, touching nothing
    // else - safe even for entries the user has customized.
    if (!meta.otherSuffixMigrated) {
      const starterByName = new Map(starter.map((s) => [s.name.toLowerCase(), s]));
      let changed = false;
      for (const b of this.buffs) {
        if (b.othersLandingSuffix) continue;
        const match = starterByName.get(b.name.toLowerCase());
        if (match && match.othersLandingSuffix) {
          b.othersLandingSuffix = match.othersLandingSuffix;
          changed = true;
        }
      }
      meta.otherSuffixMigrated = true;
      store.saveJson('buffsMeta', meta);
      if (changed) this._save();
    }

    // One-time: full roster re-audit (2026-08-17) - the bundled starter
    // roster was regenerated from scratch by mining every beneficial,
    // player-castable spell directly from the game's own data files
    // (~16,300 entries, up from ~3,300), fixing two real problems: (1) the
    // Custom Buffs list was showing hundreds of buffs the game itself
    // recognizes, just never captured as distinct roster entries before -
    // encountering one live auto-created it and wrongly tagged it "custom"
    // (custom correctly means "not a real spell", not "not in the old,
    // incomplete roster"); (2) a handful of entries (e.g. a hand-made test
    // version of a real spell) had incomplete/wrong data (missing icon,
    // etc.) that a fresh mine now supersedes with the real thing. Every
    // entry name-matching the new starter is fully replaced by the fresh
    // mined data (explicitly requested: no attempt to preserve old
    // icon/Overlay/bard-song choices on a re-classified entry, since those
    // were set against wrong/incomplete data in the first place) and
    // marked custom:false. Anything with no match in the new roster is
    // left completely untouched - still whatever it was.
    if (!meta.fullRosterRebuildV1) {
      const starterByName = new Map(starter.map((s) => [s.name.toLowerCase(), s]));
      const existingNames = new Set(this.buffs.map((b) => b.name.toLowerCase()));
      const rebuilt = this.buffs.map((b) => {
        const match = starterByName.get(b.name.toLowerCase());
        return match ? { ...match, custom: false } : b;
      });
      // Names the new roster knows about that the user's store never had at
      // all yet - added so "Known Buffs" reflects the full re-mined roster,
      // not just names that happened to come up in past play.
      for (const s of starter) {
        if (!existingNames.has(s.name.toLowerCase())) rebuilt.push({ ...s, custom: false });
      }

      // Legacy rank-suffixed duplicates: before getByName()'s stripRankSuffix
      // fallback existed, an "Adamant Stance Rk. II" cast that didn't exact-
      // match anything got auto-created as its OWN roster entry under that
      // full suffixed name, separate from the real base "Adamant Stance"
      // entry - identical landing/ended text and icon, just a duplicate.
      // Confirmed on this exact data: 2,213 of 2,223 "custom" entries were
      // this exact pattern - the real driver behind Custom Buffs showing
      // hundreds of things that were never actually custom. Removed outright
      // (not kept as custom) since the base entry alone already covers
      // detection for it via that same fallback.
      const byLowerName = new Map(rebuilt.map((b) => [b.name.toLowerCase(), b]));
      const final = rebuilt.filter((b) => {
        if (b.custom !== true) return true;
        // "Rk. II"/"Rk. III" specifically (not a bare trailing roman
        // numeral - see stripRankSuffix's own doc comment on why those two
        // cases are NOT equally safe) always means a pure power-tier of the
        // identical spell, so a base-name match alone is trusted without
        // also requiring matching text - unlike the check below, needed
        // because a legacy entry's own stored text can predate this
        // session's re-mine and no longer match verbatim.
        const rkTierMatch = /^(.*?)\s+Rk\.?\s*[IVX]+$/i.exec(b.name);
        if (rkTierMatch) {
          const baseEntry = byLowerName.get(rkTierMatch[1].trim().toLowerCase());
          if (baseEntry && baseEntry.custom === false) return false;
        }
        // Bare trailing roman numeral - can genuinely be a different spell
        // (see the class doc comment on stripRankSuffix), so only treat it
        // as a stale duplicate when the base entry's own text agrees.
        const base = stripRankSuffix(b.name);
        if (base === b.name) return true;
        const baseEntry = byLowerName.get(base.toLowerCase());
        const isLegacyDupe = baseEntry && baseEntry.landingText === b.landingText && baseEntry.endedText === b.endedText;
        return !isLegacyDupe;
      });

      this.buffs = final;
      meta.fullRosterRebuildV1 = true;
      store.saveJson('buffsMeta', meta);
      this._save();
    }

    // One-time, follow-up to the rebuild above: anything STILL custom after
    // matching against the freshly re-mined roster has no verified game
    // data behind it at all (confirmed - not even a case-insensitive
    // substring match anywhere in this install's spells_us.txt) - per
    // explicit instruction, "custom" isn't a resting place for unverified
    // entries, so these are removed outright rather than kept around.
    // Legitimate custom buffs a user adds going forward (via "Add a new
    // buff", still fully supported) are unaffected - this is a one-time
    // cleanup of this specific pre-rebuild leftover state, not a standing
    // rule against the feature itself.
    if (!meta.unmatchedCustomPurgedV1) {
      const before = this.buffs.length;
      this.buffs = this.buffs.filter((b) => b.custom !== true);
      meta.unmatchedCustomPurgedV1 = true;
      store.saveJson('buffsMeta', meta);
      if (this.buffs.length !== before) this._save();
    }

    // One-time (2026-08-17): see MAX_TRACKABLE_DURATION_SEC's comment - live
    // testing surfaced Cannibalize as a concrete case of the mining
    // fallback's 432000s placeholder duration making a genuinely instant
    // ability show up as a days-long "active buff". Applied as a blanket
    // rule rather than a per-spell fix, matching that same starterVersion
    // rebuild's bundled roster (already regenerated with these excluded) -
    // this just brings an already-upgraded user's own persisted store in
    // line with it. Also removes "Rejuvenation" specifically - confirmed via
    // the game's own string table (not a mining error) to have "You slow
    // down."/"You speed back up." as its real landing/ended text, which
    // caused a real false-positive self-buff detection.
    if (!meta.longDurationPurgedV1) {
      const before = this.buffs.length;
      this.buffs = this.buffs.filter((b) => {
        if (b.durationSec > MAX_TRACKABLE_DURATION_SEC) return false;
        if (b.name === 'Rejuvenation' && b.landingText === 'You slow down.') return false;
        return true;
      });
      meta.longDurationPurgedV1 = true;
      store.saveJson('buffsMeta', meta);
      if (this.buffs.length !== before) this._save();
    }
  }

  _save() {
    this.store.saveJson('buffs', this.buffs);
    this._landingIndex = null;
    this._groupedLandingIndex = null;
    this._groupedOthersSuffixIndex = null;
  }

  getAll() {
    return [...this.buffs].sort((a, b) => a.name.localeCompare(b.name));
  }

  getByName(name) {
    const lower = name.toLowerCase();
    const exact = this.buffs.find((b) => b.name.toLowerCase() === lower);
    if (exact) return exact;
    // Fallback: rank suffixes ("Rk. II", "IX") aren't part of a spell's
    // real identity - the roster is deduped to strip them, but this
    // catches any ranked name that reaches here anyway (e.g. a manually
    // typed one).
    const base = stripRankSuffix(name).toLowerCase();
    if (base === lower) return null;
    return this.buffs.find((b) => b.name.toLowerCase() === base) || null;
  }

  // Exact-match index from landingText -> buff, used to recognize a buff
  // landing even with no preceding "You begin casting" line (instant AAs,
  // clicky items, and abilities that grant several buffs from one action
  // all skip the cast bar/message entirely).
  //
  // EQ reuses a lot of generic flavor text across many different spells -
  // e.g. "You begin to regenerate." is shared by ~30 different HoT/regen
  // spells (it's really the game's generic "entered regen state" message,
  // not spell-unique text), and it's not the only one. Landing text shared
  // by more than one buff is deliberately EXCLUDED from this index, since
  // there'd be no way to tell which of them actually landed - matching one
  // arbitrarily produced real false positives (a buff showing up that was
  // never cast, or a real cast showing up under the wrong name). Ambiguous
  // buffs still get detected correctly via the "You begin casting X" path
  // in buffEngine, which has the spell name to disambiguate safely.
  // Rebuilt lazily and invalidated on any write.
  _getLandingIndex() {
    if (!this._landingIndex) {
      const ownerCounts = new Map();
      for (const b of this.buffs) {
        if (!b.landingText) continue;
        ownerCounts.set(b.landingText, (ownerCounts.get(b.landingText) || 0) + 1);
      }
      this._landingIndex = new Map();
      for (const b of this.buffs) {
        if (!b.landingText) continue;
        if (ownerCounts.get(b.landingText) > 1) continue; // ambiguous within the roster - skip
        // NOTE: entries also carry `landingTextSharedBy` - how many DISTINCT spell names in the
        // game's own spells_us_str.txt print this same line. It is deliberately NOT consulted
        // here, and that decision is worth recording because the opposite was tried first.
        //
        // Gating on it looked obviously right: "Your mind begins to clear." is one bard song in
        // the roster but 5 distinct names in the game, including Elixir of Clarity. But the
        // client's data files carry every spell from every EverQuest version, and this server
        // runs a small subset - which is the entire reason the roster was cut from 11,337 to
        // 1,052. Counting those absent spells as rivals reintroduced exactly the over-counting
        // the rebuild removed. Measured against real logs: it suppressed 116 entries, 32 of them
        // lines she actually sees in play, and the co-sharers were overwhelmingly other-expansion
        // content - Spirit of the Panther, Ancient: Lcea's Lament, Talisman of the Panther Rk. II.
        //
        // The field stays on the entries because it is real evidence and costs nothing. If a
        // false attribution ever does show up, re-enabling this is one line - but it should be
        // scoped to co-sharers that exist on THIS server, not to the whole client data file.
        this._landingIndex.set(b.landingText, b);
      }
    }
    return this._landingIndex;
  }

  findByLandingText(strippedLine) {
    return this._getLandingIndex().get(strippedLine) || null;
  }

  // Every buff sharing a given piece of landing text, for callers that can
  // disambiguate with extra context (spellbook membership, an activation
  // burst window, or asking the user) - see buffEngine.js.
  _getGroupedLandingIndex() {
    if (!this._groupedLandingIndex) {
      this._groupedLandingIndex = new Map();
      for (const b of this.buffs) {
        if (!b.landingText) continue;
        if (!this._groupedLandingIndex.has(b.landingText)) {
          this._groupedLandingIndex.set(b.landingText, []);
        }
        this._groupedLandingIndex.get(b.landingText).push(b);
      }
    }
    return this._groupedLandingIndex;
  }

  findAllByLandingText(strippedLine) {
    return this._getGroupedLandingIndex().get(strippedLine) || [];
  }

  // Reverse lookup for ally-buff detection: given the tail of a third-person
  // landing line (everything after the groupmate's name), which buffs could
  // it be? The existing ally path works forwards - it already knows which
  // spell the player just cast and only needs to confirm the text - but a
  // buff landed by an instant multi-target ability (Quick Buff) never
  // produces a per-spell cast line to know that from, so it has to be
  // identified from the text alone. Grouped, not flat, because 858 of the
  // 2,034 distinct suffixes are shared by more than one spell - callers must
  // decide what to do with an ambiguous result rather than getting a silent
  // first-match guess (see the "no guessing" rule in buffEngine.js).
  _getGroupedOthersSuffixIndex() {
    if (!this._groupedOthersSuffixIndex) {
      this._groupedOthersSuffixIndex = new Map();
      for (const b of this.buffs) {
        if (!b.othersLandingSuffix) continue;
        if (!this._groupedOthersSuffixIndex.has(b.othersLandingSuffix)) {
          this._groupedOthersSuffixIndex.set(b.othersLandingSuffix, []);
        }
        this._groupedOthersSuffixIndex.get(b.othersLandingSuffix).push(b);
      }
    }
    return this._groupedOthersSuffixIndex;
  }

  findAllByOthersLandingSuffix(suffix) {
    return this._getGroupedOthersSuffixIndex().get(suffix) || [];
  }

  // options: { showOnOverlay, landingText, endedText, iconId } - any field
  // left undefined keeps its previous value (or a sensible default if this
  // is a brand new entry), so e.g. editing just the duration from the UI
  // doesn't wipe out landingText/iconId that came from the mined roster.
  upsert(name, durationSec, options = {}) {
    const lower = name.toLowerCase();
    const idx = this.buffs.findIndex((b) => b.name.toLowerCase() === lower);
    const previous = idx >= 0 ? this.buffs[idx] : null;

    const entry = {
      name,
      durationSec,
      showOnOverlay:
        options.showOnOverlay !== undefined
          ? options.showOnOverlay
          : previous
          ? previous.showOnOverlay !== false
          : true,
    };

    const landingText = options.landingText !== undefined ? options.landingText : previous?.landingText;
    const endedText = options.endedText !== undefined ? options.endedText : previous?.endedText;
    const iconId = options.iconId !== undefined ? options.iconId : previous?.iconId;
    // Ally-buff detection text (see buffEngine.js) - no UI edits it directly
    // yet, but it must survive a re-save from editing duration/landing/ended
    // text via the Known Buffs UI, same as iconId already does above.
    const othersLandingSuffix =
      options.othersLandingSuffix !== undefined ? options.othersLandingSuffix : previous?.othersLandingSuffix;
    if (landingText) entry.landingText = landingText;
    if (endedText) entry.endedText = endedText;
    // !== undefined, not a truthy check - icon id 0 (the icon picker's
    // first thumbnail, a real, pickable icon) is falsy and would otherwise
    // look indistinguishable from "no icon chosen".
    if (iconId !== undefined) entry.iconId = iconId;
    if (othersLandingSuffix) entry.othersLandingSuffix = othersLandingSuffix;
    // Whether the duration-extension AAs apply to this spell - see
    // buffEngine._scaledDuration. Preserved across re-saves like the fields
    // above, and only written when actually true so the roster does not gain
    // a redundant false on ~12,000 entries.
    const noScaling =
      options.noDurationScaling !== undefined ? options.noDurationScaling : previous?.noDurationScaling;
    if (noScaling) entry.noDurationScaling = true;
    // isBardSong is set by the tagger/backfill rather than this path, but has
    // to survive an edit here for exactly the same reason.
    if (previous?.isBardSong) entry.isBardSong = true;

    // Anything that didn't already exist (typed into "Add a new buff", or
    // promoted from an Unknown cast) wasn't mined from the game's own
    // spell files - flagged so the UI can list these separately from the
    // ~3300-entry starter roster, where they'd otherwise be hard to find.
    // An existing entry keeps whatever it already was, custom or not.
    entry.custom = previous ? previous.custom === true : true;

    if (idx >= 0) this.buffs[idx] = entry;
    else this.buffs.push(entry);
    this._save();
    return entry;
  }

  setShowOnOverlay(name, showOnOverlay) {
    const entry = this.getByName(name);
    if (!entry) return null;
    return this.upsert(entry.name, entry.durationSec, { showOnOverlay });
  }

  // Persists "this spell is a bard song" on the roster entry itself, keyed
  // by name - not just the one cast instance that revealed it. Tagging only
  // the instance that happened to go through the "You begin singing X" cast
  // line meant every OTHER detection path (unique landing text, spellbook-
  // narrowed ambiguous text, burst window) reported isBardSong:false even
  // for an actual song, since those paths never see the cast verb at all -
  // in practice that made "hide bard songs" miss most songs. Persisting it
  // here instead means getActiveBuffs() picks it up from the stored roster
  // entry regardless of which path landed this particular cast, the moment
  // any cast of it has ever gone through the singing-verb path once.
  // Idempotent - a resinging bard doesn't write to disk every cast.
  markBardSong(name) {
    const entry = this.getByName(name);
    if (!entry || entry.isBardSong) return;
    entry.isBardSong = true;
    this._save();
  }

  // Manual override for the Known/Custom Buffs list, since automatic
  // detection (markBardSong above) only ever fires from a "You begin
  // singing X" cast-begin line - some servers/setups auto-renew a song
  // purely via its landing text repeating with no cast-begin line at all,
  // which automatic detection can never catch. Two-way (unlike
  // markBardSong, which only ever sets true), so a wrong auto-tag or a
  // manual mistake can be corrected either direction.
  // Per-buff opt-out from the duration-extension AAs - see
  // buffEngine._scaledDuration for why a global multiplier alone was not
  // enough. Toggled from the Known Buffs list.
  setNoDurationScaling(name, noDurationScaling) {
    const entry = this.getByName(name);
    if (!entry) return null;
    if (noDurationScaling) entry.noDurationScaling = true;
    else delete entry.noDurationScaling;
    this._save();
    return entry;
  }

  setBardSong(name, isBardSong) {
    const entry = this.getByName(name);
    if (!entry) return null;
    entry.isBardSong = !!isBardSong;
    this._save();
    return entry;
  }

  remove(name) {
    const lower = name.toLowerCase();
    this.buffs = this.buffs.filter((b) => b.name.toLowerCase() !== lower);
    this._save();
  }

  // For correcting a name that turned out wrong after the fact - e.g. a
  // resolved Unknown cast that captured a decorative tier number the game
  // doesn't actually treat as part of the spell's identity. Refuses if the
  // new name collides with a different existing entry, rather than
  // silently merging two buffs together.
  rename(oldName, newName) {
    const entry = this.getByName(oldName);
    if (!entry) return null;
    const collision = this.getByName(newName);
    if (collision && collision !== entry) return null;
    entry.name = newName;
    this._save();
    return entry;
  }
}

module.exports = { BuffStore };
