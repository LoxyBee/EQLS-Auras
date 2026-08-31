const fs = require('fs');
const path = require('path');
const { stripRankSuffix } = require('./buffParser');

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

// Database of known buffs and their durations (plus, where known, the exact "landed" and "wore
// off" message text mined from the game's own spell files - see landingText/endedText).
//
// THE INSTALL IS THE SOURCE OF TRUTH FOR SPELL DATA, every launch, not something seeded once and
// then left to drift. Rebuilt from src/shared/data/buffs.json on every construction - a roster
// correction in a new build reaches every existing install the moment they update, the same way
// any other bug fix does. This replaced a version-gated one-time-upgrade design (STARTER_VERSION
// plus half a dozen boolean "have I already migrated this" flags in buffsMeta.json) that looked
// safe and was not: Alacrity's duration was fixed in the bundled roster on 24 Aug, and it changed
// nothing for an already-seeded install, because a normal roster entry ships WITH
// landingText/endedText/iconId from day one, so it never looked "untouched" to that design's
// refresh heuristic and sat wrong forever. the owner: "it should be seeded from the install not the
// person's saved files because it interrupts old installs and doesn't allow live updates."
//
// What's still genuinely userData's alone, because the install has no copy of it at all:
//   - a buff the user typed in themselves (`custom: true`) - "Add a new buff", or promoted from
//     an Unknown cast. Kept exactly as saved, every launch, forever.
//   - a manual correction to a REAL roster spell's own numbers, made through the Known Buffs
//     "Save" button (`edited: true`, set by upsert() below). The install's data for that spell is
//     never trusted again once a user has explicitly overridden it by hand.
//   - three small per-spell toggles with no install-side value to defer to: showOnOverlay,
//     isBardSong (only once isBardSongUserSet - see setBardSong), and noDurationScaling (only once
//     noDurationScalingUserSet - see setNoDurationScaling). Everything else about a non-custom,
//     non-edited entry is rebuilt from the install fresh, every time.
class BuffStore {
  constructor(store) {
    this.store = store;
    const starterPath = path.join(__dirname, '..', 'shared', 'data', 'buffs.json');
    // See MAX_TRACKABLE_DURATION_SEC's comment - excluded here rather than at the roster-build
    // step so it applies uniformly no matter how an over-long duration got into the file, and
    // every launch rather than once: under the old one-time-purge design, an entry that only
    // reached the roster AFTER a user's purge had already run (like Share Form of the Great Wolf)
    // would slip through forever, because the migration that would have caught it never runs
    // twice.
    const starter = JSON.parse(fs.readFileSync(starterPath, 'utf8')).filter(
      (e) => !(e.durationSec > MAX_TRACKABLE_DURATION_SEC)
    );
    const starterByName = new Map(starter.map((e) => [e.name.toLowerCase(), e]));

    const persisted = store.loadJson('buffs', []) || [];
    this.buffs = [];

    for (const p of persisted) {
      if (p.custom === true) {
        // Not in the install's roster at all - this saved copy is the only one that exists.
        this.buffs.push(p);
        continue;
      }
      const fresh = starterByName.get(p.name.toLowerCase());
      if (!fresh) {
        // Was a real roster spell once, but this server's current roster no longer carries it
        // (e.g. seeded from an earlier, larger roster). Dropped, same as every rebuild - nothing
        // legitimate hangs off a name the current install doesn't recognise.
        continue;
      }
      if (p.edited) {
        // The user opened Known Buffs and hit Save on this spell - respect exactly what they
        // typed, same as a fully custom entry. `edited` is only ever set by upsert() below, so
        // this can never accidentally freeze a spell nobody actually touched.
        this.buffs.push(p);
        continue;
      }
      const rebuilt = { ...fresh, custom: false };
      if (p.showOnOverlay !== undefined) rebuilt.showOnOverlay = p.showOnOverlay;
      if (p.isBardSongUserSet) {
        rebuilt.isBardSong = !!p.isBardSong;
        rebuilt.isBardSongUserSet = true;
      } else if (p.isBardSong) {
        // Automatic evidence (a "You begin singing X" cast line was actually seen for this
        // spell, or bardSongTagger.js's own pass already tagged it) - real, and worth keeping
        // even though the install's own copy carries no such field itself.
        rebuilt.isBardSong = true;
      }
      if (p.noDurationScalingUserSet) {
        rebuilt.noDurationScalingUserSet = true;
        if (p.noDurationScaling) rebuilt.noDurationScaling = true;
        else delete rebuilt.noDurationScaling;
      }
      this.buffs.push(rebuilt);
    }

    // Anything the install's roster has that this store has never seen at all yet - so Known
    // Buffs reflects the full current roster from the very first launch, not just names that
    // happened to come up in past play.
    const seenNames = new Set(this.buffs.map((b) => b.name.toLowerCase()));
    for (const s of starter) {
      if (!seenNames.has(s.name.toLowerCase())) this.buffs.push({ ...s, custom: false });
    }

    this._save();
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
    if (previous?.noDurationScalingUserSet) entry.noDurationScalingUserSet = true;
    // isBardSong is set by the tagger/markBardSong/setBardSong rather than this path, but has to
    // survive an edit here for exactly the same reason as noDurationScaling above.
    if (previous?.isBardSong) entry.isBardSong = true;
    if (previous?.isBardSongUserSet) entry.isBardSongUserSet = true;

    // Anything that didn't already exist (typed into "Add a new buff", or
    // promoted from an Unknown cast) wasn't mined from the game's own
    // spell files - flagged so the UI can list these separately from the
    // ~3300-entry starter roster, where they'd otherwise be hard to find.
    // An existing entry keeps whatever it already was, custom or not.
    entry.custom = previous ? previous.custom === true : true;

    // A genuine hand-typed correction to a REAL roster spell's own data (Known Buffs' Save
    // button, or its icon picker) - as opposed to setShowOnOverlay's call through this same
    // method, which only ever passes {showOnOverlay} and must NOT freeze the entry. Once a spell
    // has been edited it stays edited (see the constructor): a second save that happens to touch
    // fewer fields must not un-edit it.
    const editingRosterData =
      options.landingText !== undefined || options.endedText !== undefined || options.iconId !== undefined;
    if (previous?.edited || (previous && !entry.custom && editingRosterData)) entry.edited = true;

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
    // Marked so a future launch's rebuild-from-the-install (see the constructor) keeps this
    // exact choice instead of quietly falling back to whatever the install's own roster says for
    // this spell - a manual per-buff toggle here is meaningless if the next launch can silently
    // undo it.
    entry.noDurationScalingUserSet = true;
    if (noDurationScaling) entry.noDurationScaling = true;
    else delete entry.noDurationScaling;
    this._save();
    return entry;
  }

  setBardSong(name, isBardSong) {
    const entry = this.getByName(name);
    if (!entry) return null;
    // Marked for the same reason as setNoDurationScaling above - and specifically so bardSongTagger.js's
    // additive pass (which reruns every launch) knows to leave THIS spell alone even when
    // isBardSong is being set to false, not just when it happens to already be true.
    entry.isBardSongUserSet = true;
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
