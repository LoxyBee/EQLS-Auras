const crypto = require('crypto');

// Loadout profiles let the user swap which "ambiguous cast means buff X"
// memory buffEngine.js consults (see selfAmbiguousResolutionsByProfile
// there) - built for servers with a multiclass "loadout" mechanic where the
// player's actually-castable spell set can change without touching the
// spellbook file, which otherwise left stale self-cast resolutions applied
// forever after a swap (see HANDOFF.md's "unresolved bug" section for the
// full history). DEFAULT_PROFILE_ID intentionally matches buffEngine.js's
// own migration bucket name, so an upgrading user's existing remembered
// choices land in the same "Default" profile this store seeds on first run
// - no separate migration coordination needed between the two files.
const DEFAULT_PROFILE_ID = 'default';

function defaultData() {
  return {
    version: 1,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default' }],
    activeProfileId: DEFAULT_PROFILE_ID,
  };
}

class ProfileStore {
  constructor(store) {
    this.store = store;
    this.data = this._loadOrMigrate();
  }

  _loadOrMigrate() {
    const existing = this.store.loadJson('profiles', null);
    if (existing) return existing;
    const data = defaultData();
    this.store.saveJson('profiles', data);
    return data;
  }

  _save() {
    this.store.saveJson('profiles', this.data);
  }

  getAll() {
    return this.data.profiles;
  }

  getProfile(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  // The buff optimiser (see buffPlanner.js) hangs its input off the active loadout profile:
  // "tied to the active profile" was Shara's own choice, on the theory that which classes you are
  // running IS what a loadout is. `plannerClasses` is up to 3 class codes; `plannerLevel` is the
  // ONE character level they all share (it's one multiclass character, not three mains - Shara,
  // 26 Aug); `buffPlanOrder` is the buff names in the priority order she dragged them into, which
  // the planner walks to fill the 14 slots. All optional - an untouched profile has none, and the
  // planner treats that as "no plan yet".
  setPlannerClasses(id, codes) {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) return null;
    profile.plannerClasses = Array.isArray(codes) ? codes.filter((c) => typeof c === 'string').slice(0, 3) : [];
    this._save();
    return profile;
  }

  setPlannerLevel(id, level) {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) return null;
    const n = Math.round(Number(level));
    profile.plannerLevel = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 50;
    this._save();
    return profile;
  }

  setBuffPlanOrder(id, order) {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) return null;
    profile.buffPlanOrder = Array.isArray(order) ? order.filter((n) => typeof n === 'string') : [];
    this._save();
    return profile;
  }

  getActiveId() {
    return this.data.activeProfileId;
  }

  // Returns the new active id on success, null if the id doesn't belong to
  // any known profile (caller's responsibility to have offered a valid
  // choice in the first place - this just refuses to silently point at a
  // profile that doesn't exist).
  setActiveId(id) {
    if (!this.data.profiles.some((p) => p.id === id)) return null;
    this.data.activeProfileId = id;
    this._save();
    return id;
  }

  create(name) {
    const profile = { id: crypto.randomUUID(), name };
    this.data.profiles.push(profile);
    this._save();
    return profile;
  }

  rename(id, name) {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) return null;
    profile.name = name;
    this._save();
    return profile;
  }

  // Refuses to delete the LAST remaining profile - activeProfileId must
  // always point at something real, and "zero profiles" has no sane
  // meaning here anyway (there'd be nothing for a new widget or an
  // ambiguous-cast resolution to belong to). If the deleted profile was
  // the active one, falls back to whichever profile is now first in the
  // list - caller (main.js) is responsible for telling buffEngine and
  // widgetStore about both the removal and the possible active-id change.
  remove(id) {
    if (this.data.profiles.length <= 1) return false;
    const idx = this.data.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.data.profiles.splice(idx, 1);
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = this.data.profiles[0].id;
    }
    this._save();
    return true;
  }
}

module.exports = { ProfileStore, DEFAULT_PROFILE_ID };
