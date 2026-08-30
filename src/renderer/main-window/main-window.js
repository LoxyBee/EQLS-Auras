async function init() {
  const statusEl = document.getElementById('status');
  const versionEl = document.getElementById('version-info');

  try {
    const info = await window.eqTracker.getVersionInfo();
    statusEl.textContent = 'App, main process, and IPC are all working.';
    versionEl.innerHTML = `
      <dt>App version</dt><dd>${info.appVersion}</dd>
      <dt>Electron version</dt><dd>${info.electronVersion}</dd>
      <dt>Node version</dt><dd>${info.nodeVersion}</dd>
    `;
  } catch (err) {
    statusEl.textContent = 'Something is wrong: ' + err.message;
  }

  initTitleBar();
  initNavigation();
  initTopicToggles();
  initProfileBar();
  initLogPanel();
  initFirstRunLanding();
  initDetectionSettingsPanel();
  initBuffPanels();
  initTrackerBadge();
  initWidgetsPanel();
  initKnownBuffsPanel();
  initCharacterSettingsPanel();
  initUiScale();
  initSidebarResize();
  initMergeRule();
  initTradePing();
  initSoundsFolderLink();
  initConfigFolderLink();
  initLogActivityLine();
  initBugReport();
  initActionBarsPage();
  initBuffPlanner();
  initLoggingWatch();
  initChangelog();
}

// Backlog #18 - the "What's changed" list on the About page, from src/shared/data/changelog.js
// (Documentation maintains the content; this just renders it).
function initChangelog() {
  const el = document.getElementById('changelog-body');
  if (!el) return;
  window.eqTracker.getChangelog().then((entries) => {
    el.textContent = '';
    if (!Array.isArray(entries) || !entries.length) {
      el.textContent = 'Nothing recorded yet.';
      return;
    }
    for (const entry of entries) {
      const h = document.createElement('h4');
      h.className = 'changelog-version';
      h.textContent = entry.date ? `${entry.version} — ${entry.date}` : entry.version;
      el.appendChild(h);
      for (const [label, items] of [['New', entry.new], ['Fixes', entry.fixes]]) {
        if (!Array.isArray(items) || !items.length) continue;
        const lbl = document.createElement('p');
        lbl.className = 'changelog-label';
        lbl.textContent = label;
        el.appendChild(lbl);
        const ul = document.createElement('ul');
        ul.className = 'changelog-list';
        for (const it of items) {
          const li = document.createElement('li');
          li.textContent = it;
          ul.appendChild(li);
        }
        el.appendChild(ul);
      }
    }
  }).catch(() => { el.textContent = 'Could not load the changelog.'; });
}

// "EverQuest is running but not writing to its log" - main decides, this shows the in-app modal.
function initLoggingWatch() {
  let open = false;
  let autoClosed = false;
  // Logging started working while the prompt was up (false alarm, or the user fixed it) - drop it.
  window.eqTracker.onLoggingOk(() => { if (open) { autoClosed = true; closeAppConfirm(false); } });
  window.eqTracker.onLoggingOff(async () => {
    if (open) return;
    open = true;
    autoClosed = false;
    const done = await appConfirm({
      title: 'EverQuest logging looks off',
      message: 'EverQuest is running, but nothing is being written to its log — the tracker can’t see buffs, lockouts or anything else without it.',
      detail: 'In game, type  /log on  then click "I’ve done it".',
      okLabel: "I’ve done it",
      cancelLabel: 'Dismiss',
    });
    open = false;
    if (autoClosed) return;                         // it started working on its own
    if (!done) { window.eqTracker.acknowledgeLogging(); return; }
    const r = await window.eqTracker.recheckLogging();
    if (r.seemsOff) {
      await appConfirm({
        title: 'Still nothing',
        message: 'Still no log activity. Give it a few seconds after /log on, or check the log-folder path on the Setup page.',
        okLabel: 'OK',
        hideCancel: true,
      });
    }
  });
}

// Custom title bar (the frameless-window follow-up) -
// the window itself has no native minimize/maximize/close any more, so
// these three buttons are the only way to reach them. Double-clicking the
// drag region toggles maximize too, since that's standard title-bar
// behavior every user already expects and -webkit-app-region:drag doesn't
// provide it for free on Windows the way a native frame would.
function initTitleBar() {
  const dragRegion = document.getElementById('title-bar-drag');
  const minimizeBtn = document.getElementById('title-bar-minimize-btn');
  const maximizeBtn = document.getElementById('title-bar-maximize-btn');
  const closeBtn = document.getElementById('title-bar-close-btn');

  minimizeBtn.addEventListener('click', () => window.eqTracker.minimizeWindow());
  maximizeBtn.addEventListener('click', () => window.eqTracker.toggleMaximizeWindow());
  closeBtn.addEventListener('click', () => window.eqTracker.closeWindow());
  dragRegion.addEventListener('dblclick', () => window.eqTracker.toggleMaximizeWindow());

  function setMaximized(isMaximized) {
    maximizeBtn.classList.toggle('is-maximized', isMaximized);
    const label = isMaximized ? 'Restore' : 'Maximize';
    maximizeBtn.title = label;
    maximizeBtn.setAttribute('aria-label', label);
  }

  window.eqTracker.isWindowMaximized().then(setMaximized);
  window.eqTracker.onWindowMaximizedChange(setMaximized);
}

// Topic disclosures - global, not scoped to any one
// page, since every topic on every page is static markup already present
// in the DOM at load time (shown/hidden and repopulated per selection, but
// never created/destroyed), so wiring this once here covers all of them.
// Deliberately no reset-on-switch anywhere: which topics are open/closed
// persists as you navigate around, since nothing about switching pages or
// widgets destroys these DOM nodes.
function initTopicToggles() {
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.topic').classList.toggle('open');
    });
  });
}

// The "default landing page" rule: with no EQ folder
// configured yet, land on Setup (promoted EQ-log-file card) instead of
// Buff Tracker, so a fresh install's first screen is "let's find your
// log" rather than an empty Buff Tracker page with no context for why
// nothing's happening. Reverts to normal permanently once a folder is
// actually confirmed - if auto-detection just works (the common case for
// a standard install), the user may never see this state at all.
function initFirstRunLanding() {
  const eyebrowEl = document.getElementById('eq-log-eyebrow');
  const headingEl = document.getElementById('eq-log-heading');
  const subEl = document.getElementById('eq-log-promoted-sub');
  const cardEl = document.getElementById('eq-log-card');
  let promoted = false;
  let hasLandedOnce = false;

  function setPromoted(on) {
    if (on === promoted) return;
    promoted = on;
    cardEl.classList.toggle('promoted', on);
    eyebrowEl.style.display = on ? '' : 'none';
    subEl.style.display = on ? '' : 'none';
    headingEl.textContent = on ? "Let's find your EverQuest log" : 'EverQuest log file';
  }

  window.eqTracker.getLogState().then((state) => {
    if (state.eqFolder) {
      setPromoted(false);
    } else {
      setPromoted(true);
      // Only the very first landing decision navigates - once the app has
      // landed once, later status updates (below) only ever clear the
      // promoted state, never re-navigate out from under the user.
      const setupBtn = document.querySelector('.nav-btn[data-page="page-settings"]');
      if (setupBtn) activateNavButton(setupBtn);
    }
    hasLandedOnce = true;
  });

  window.eqTracker.onLogStatus((state) => {
    if (hasLandedOnce && state.eqFolder) setPromoted(false);
  });
}

// Persistent chip bar living above the sidebar/page-container split (see
// index.html/.profile-bar) - present on every tab since it's outside
// .page-container, the part that actually swaps per nav-btn. Switches
// which loadout profile's ambiguous-cast memory is active (see
// buffEngine.js's selfAmbiguousResolutionsByProfile) - purely a memory
// swap, never touches widget visibility.
function initProfileBar() {
  const chipListEl = document.getElementById('profile-chip-list');
  const nameInput = document.getElementById('new-profile-name-input');
  const checklistEl = document.getElementById('new-profile-widget-checklist');
  const submitBtn = document.getElementById('create-profile-submit-btn');
  const manageListEl = document.getElementById('manage-profiles-list');

  let profiles = [];
  let activeId = null;

  // Switch-only - rename and delete both live in the Manage profiles modal
  // (see renderManageProfilesList below) instead of on the chip itself.
  // An earlier version put a small delete X directly on each chip, but
  // that sat right where a normal profile-switch click lands and was easy
  // to misclick - a dedicated modal you have to deliberately open is safer
  // for something that permanently discards real accumulated data.
  function render() {
    chipListEl.innerHTML = '';
    profiles.forEach((profile) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'profile-chip' + (profile.id === activeId ? ' active' : '');
      chip.textContent = profile.name;
      chip.title = 'Switch to this loadout profile';
      chip.addEventListener('click', () => {
        if (profile.id === activeId) return;
        window.eqTracker.setActiveProfile(profile.id).then((result) => {
          if (result) {
            activeId = result;
            render();
          }
        });
      });
      chipListEl.appendChild(chip);
    });
  }

  // Each row's name is a live text input (committed on change/blur) rather
  // than a separate "Edit" button + inline swap, since this modal's whole
  // reason to exist is being a deliberate, low-risk place to manage
  // profiles - an always-editable field here doesn't carry the same
  // misclick risk a chip-embedded control did.
  function renderManageProfilesList() {
    manageListEl.innerHTML = '';
    if (profiles.length === 0) {
      manageListEl.innerHTML = '<li class="empty">No profiles yet.</li>';
      return;
    }
    profiles.forEach((profile) => {
      const li = document.createElement('li');
      li.className = 'manage-profile-row';

      const nameField = document.createElement('input');
      nameField.type = 'text';
      nameField.className = 'text-input';
      nameField.value = profile.name;
      nameField.addEventListener('change', () => {
        const newName = nameField.value.trim();
        if (newName && newName !== profile.name) {
          window.eqTracker.renameProfile(profile.id, newName).then(refresh);
        } else {
          nameField.value = profile.name;
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      // Disabled rather than hidden here (unlike the old chip X) - this
      // modal is a deliberate destination, not a click-dense bar, so
      // showing WHY it can't be deleted (via title) is more useful than
      // just making the control disappear.
      deleteBtn.disabled = profiles.length <= 1;
      deleteBtn.title = profiles.length <= 1 ? "Can't delete the only remaining profile" : `Delete "${profile.name}"`;
      deleteBtn.addEventListener('click', () => {
        const confirmed = window.confirm(
          `Delete the loadout profile "${profile.name}"? This permanently discards its remembered ambiguous-cast answers. Auras aren't deleted or hidden - they just stop listing this profile as one they belong to.`
        );
        if (!confirmed) return;
        window.eqTracker.deleteProfile(profile.id).then((removed) => {
          if (removed) refresh().then(renderManageProfilesList);
        });
      });

      li.append(nameField, deleteBtn);
      manageListEl.appendChild(li);
    });
  }

  setupModalToggle('manage-profiles-modal-backdrop', 'profile-manage-btn', 'close-manage-profiles-modal', renderManageProfilesList);

  function refresh() {
    return Promise.all([window.eqTracker.getProfiles(), window.eqTracker.getActiveProfileId()]).then(([list, id]) => {
      profiles = list;
      activeId = id;
      render();
    });
  }

  function populateCreateProfileChecklist() {
    nameInput.value = '';
    checklistEl.innerHTML = '';
    // Disabled until the checklist actually finishes populating (listWidgets
    // is an async IPC round-trip, so there's a real window right after the
    // modal appears where it's visible but empty) - closes off any chance of
    // submitting before a checkbox the user meant to check even exists yet.
    submitBtn.disabled = true;
    window.eqTracker.listWidgets().then((widgets) => {
      if (widgets.length === 0) {
        checklistEl.innerHTML = '<li class="empty">No auras yet.</li>';
        submitBtn.disabled = false;
        return;
      }
      widgets.forEach((widget) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = widget.id;
        label.append(checkbox, ' ' + widget.name);
        li.appendChild(label);
        checklistEl.appendChild(li);
      });
      submitBtn.disabled = false;
    });
    nameInput.focus();
  }

  // The add flow is now reached from inside the Loadouts modal rather than from its own button on
  // the bar. Its modal is untouched - only the way in changed.
  setupModalToggle('create-profile-modal-backdrop', 'manage-profiles-add-btn', 'close-create-profile-modal', populateCreateProfileChecklist);

  submitBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const widgetIdsToMigrate = [...checklistEl.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
    window.eqTracker.createProfile(name, widgetIdsToMigrate).then(() => {
      document.getElementById('create-profile-modal-backdrop').style.display = 'none';
      return refresh();
    });
  });

  window.eqTracker.onProfilesChanged((list) => {
    profiles = list;
    render();
  });
  window.eqTracker.onActiveProfileChanged((id) => {
    activeId = id;
    render();
  });

  refresh();
}

// Keep in sync with AA_REINFORCEMENT_PERCENTS / EXALTATION_PERCENTS in
// src/main/main.js - this copy is display-only (the total shown here), the
// main process is the source of truth for the actual duration multiplier.
const AA_REINFORCEMENT_PERCENTS = [0, 5, 15, 30, 50];
const EXALTATION_PERCENTS = [0, 5, 10, 15];

function initCharacterSettingsPanel() {
  const aaSelect = document.getElementById('aa-reinforcement-select');
  const exaltSelect = document.getElementById('exaltation-select');
  const totalEl = document.getElementById('character-bonus-total');
  // Spell Casting Deftness - same ranked-dropdown shape as the two selects above, now that all
  // three ranks (10/25/50%) have actually been seen on the AA tooltip, not just one.
  const deftnessSelect = document.getElementById('deftness-select');

  function updateTotal() {
    const aaPct = AA_REINFORCEMENT_PERCENTS[Number(aaSelect.value)] || 0;
    const exaltPct = EXALTATION_PERCENTS[Number(exaltSelect.value)] || 0;
    totalEl.textContent = `+${aaPct + exaltPct}%`;
  }

  function save() {
    window.eqTracker.setCharacterSettings({
      aaLevel: Number(aaSelect.value),
      exaltationLevel: Number(exaltSelect.value),
      deftnessLevel: Number(deftnessSelect.value),
    });
    updateTotal();
  }

  window.eqTracker.getCharacterSettings().then((settings) => {
    aaSelect.value = String(settings.aaLevel || 0);
    exaltSelect.value = String(settings.exaltationLevel || 0);
    deftnessSelect.value = String(settings.deftnessLevel || 0);
    updateTotal();
  });

  aaSelect.addEventListener('change', save);
  exaltSelect.addEventListener('change', save);
  deftnessSelect.addEventListener('change', save);
}

function initDetectionSettingsPanel() {
  const spellbookStatusEl = document.getElementById('spellbook-status');
  const spellbookMissingHintEl = document.getElementById('spellbook-missing-hint');
  const spellbookMissingWhereEl = document.getElementById('spellbook-missing-where');
  const spellbookCommandEl = document.getElementById('spellbook-command');
  const copySpellbookCommandBtn = document.getElementById('copy-spellbook-command-btn');

  // Copied from the element rather than from a second copy of the string in here - one source for
  // the command, so the button can never quietly offer something different from what is displayed.
  copySpellbookCommandBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(spellbookCommandEl.textContent.trim()).catch(() => {});
    copySpellbookCommandBtn.textContent = 'Copied!';
    setTimeout(() => {
      copySpellbookCommandBtn.textContent = 'Copy';
    }, 1500);
  });
  const memorizedStatusEl = document.getElementById('memorized-spells-status');
  const spellbookCharNameEl = document.getElementById('spellbook-char-name');
  const spellbookCharServerEl = document.getElementById('spellbook-char-server');
  const spellbookCharHintEl = document.getElementById('spellbook-char-hint');

  const spellbookFileRowEl = document.getElementById('spellbook-file-row');
  const spellbookFileSelectEl = document.getElementById('spellbook-file-select');
  const spellbookFileResetEl = document.getElementById('spellbook-file-reset');

  // The class shown to the user: the class(es) actually loaded when we have a file, else nothing.
  // The old text put a literal "<class>" in front of them, which reads as a placeholder they are
  // meant to fill in - they cannot, the app does not care which class file it reads (it unions
  // every one), and a multiclass character has several. Owner flagged it: "won't know their class".
  function loadedClasses(state) {
    const files = state.files || [];
    return [...new Set(files.map((f) => f.className).filter((c) => c && c !== '?'))];
  }

  function renderSpellbookState(state) {
    renderSpellbookFilePicker(state);
    if (state.filePath) {
      const classes = loadedClasses(state);
      const cls = classes.length ? ` [${classes.join(', ')}]` : '';
      const many = (state.files || []).length > 1 ? ` across ${state.files.length} files` : '';
      spellbookStatusEl.textContent = `Found - ${state.spellCount} spells${many}${cls} (${state.filePath})`;
      spellbookStatusEl.classList.remove('warn');
      spellbookMissingHintEl.style.display = 'none';
    } else {
      // The old message here said it would "pick it up automatically once detected", which is not
      // true and is expensive to believe: the game does not write this file on its own, so nothing
      // was ever going to detect anything, and meanwhile every buff message shared between several
      // spells was being thrown away for want of it. Say what is missing, where, and that it takes
      // a command in game to create.
      spellbookStatusEl.textContent = 'Not found - see below';
      spellbookStatusEl.classList.add('warn');
      spellbookMissingHintEl.style.display = '';
      const where = state.folder ? `in ${state.folder}` : 'in your EQ install folder';
      const named = state.fileNamePattern ? `named "${state.fileNamePattern}"` : 'ending in "-Spellbook.txt"';
      spellbookMissingWhereEl.textContent = `Looking for a file ${named} ${where}.`;
    }
    // QOL #14 - show what the typed-in character resolves to, and where the pattern is coming from.
    // fileNamePattern from the main process is "<base>-<class>-Spellbook.txt"; the "<class>" half
    // is a wildcard, so soften it to "-(any class)-" here rather than showing what looks like a
    // blank the user has to fill in.
    if (spellbookCharHintEl) {
      const pattern = (state.fileNamePattern || '').replace('-<class>-', '-(any class)-');
      if (state.mode === 'file') {
        spellbookCharHintEl.textContent = 'Using the file picked below. Clear it to go back to auto-detection.';
      } else if (pattern) {
        spellbookCharHintEl.textContent =
          (state.mode === 'manual' ? 'Using the character above. ' : 'Detected from your log. ') +
          `Looking for a file ${pattern} - any class file works.`;
      } else {
        spellbookCharHintEl.textContent =
          'No character detected yet - type your name and server above, or pick a file below.';
      }
    }
  }

  // The "Change spellbook file..." safety valve (P3). Shown whenever the install folder has at
  // least one *-Spellbook.txt at all - a single-character machine never needs it but seeing the
  // one file listed is reassuring rather than noisy. Hidden entirely when there are none (the
  // missing-file hint block covers that case).
  function renderSpellbookFilePicker(state) {
    if (!spellbookFileSelectEl) return;
    window.eqTracker.listSpellbookCandidates().then((candidates) => {
      if (!candidates.length) {
        spellbookFileRowEl.style.display = 'none';
        return;
      }
      spellbookFileRowEl.style.display = '';
      const pinned = state.mode === 'file' ? state.filePath : '';
      spellbookFileSelectEl.innerHTML = '';
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'Auto-detect (from newest log)';
      spellbookFileSelectEl.appendChild(auto);
      for (const c of candidates) {
        const opt = document.createElement('option');
        opt.value = c.path;
        opt.textContent = `${c.character} - ${c.className} (${c.count} spells)`;
        if (c.path === pinned) opt.selected = true;
        spellbookFileSelectEl.appendChild(opt);
      }
      spellbookFileResetEl.style.display = pinned ? '' : 'none';
    });
  }

  window.eqTracker.getSpellbookState().then(renderSpellbookState);
  if (spellbookCharNameEl && spellbookCharServerEl) {
    window.eqTracker.getSpellbookCharacter().then((c) => {
      spellbookCharNameEl.value = c.name || '';
      spellbookCharServerEl.value = c.server || '';
    });
    let spellbookCharTimer = null;
    const pushSpellbookChar = () => {
      clearTimeout(spellbookCharTimer);
      spellbookCharTimer = setTimeout(() => {
        window.eqTracker
          .setSpellbookCharacter(spellbookCharNameEl.value, spellbookCharServerEl.value)
          .then(renderSpellbookState);
      }, 400);
    };
    spellbookCharNameEl.addEventListener('input', pushSpellbookChar);
    spellbookCharServerEl.addEventListener('input', pushSpellbookChar);
  }

  if (spellbookFileSelectEl) {
    spellbookFileSelectEl.addEventListener('change', () => {
      window.eqTracker.setSpellbookFileOverride(spellbookFileSelectEl.value).then(renderSpellbookState);
    });
    spellbookFileResetEl.addEventListener('click', () => {
      window.eqTracker.setSpellbookFileOverride('').then(renderSpellbookState);
    });
  }

  // The empty state is the important one and is styled as a warning, not a
  // neutral "nothing here": an empty memorized list is the single most common
  // cause of a real buff being wrongly ignored (the app never replays log
  // history, so it starts empty every launch), and until now that was
  // completely invisible from the UI.
  const memorizedCardEl = document.getElementById('memorized-card');
  const memorizedGemBarEl = document.getElementById('memorized-gem-bar');
  const clearMemorizedBtn = document.getElementById('clear-memorized-btn');
  // Fixed-size gem bar rather than a list that grows: an empty slot is
  // meaningful information here ("the app doesn't know about this one yet"),
  // so the unfilled slots have to stay visible. 14 is the game's own gem
  // limit. Anything beyond 14 still gets counted in the summary line below
  // rather than silently dropped - the app can genuinely observe more than
  // 14 names in a session if gems were swapped without a matching "forget".
  const GEM_SLOTS = 14;
  function renderMemorized(spells) {
    const empty = spells.length === 0;
    memorizedCardEl.classList.toggle('unknown', empty);
    memorizedStatusEl.classList.toggle('empty-state', empty);

    // Regular spells fill from the left, bard songs from the right, mirroring
    // how a bard actually arranges their gem bar. The two runs grow toward
    // each other and stop rather than overwrite, so a drifted picture (more
    // than GEM_SLOTS names observed, which happens if a gem was swapped
    // without a matching "You forget X." line) loses the overflow from the
    // middle instead of silently clobbering a slot - the summary line below
    // still reports the true count either way.
    const slots = new Array(GEM_SLOTS).fill(null);
    let left = 0;
    let right = GEM_SLOTS - 1;
    for (const spell of spells) {
      if (spell.isBardSong) continue;
      if (left > right) break;
      slots[left++] = spell;
    }
    for (const spell of spells) {
      if (!spell.isBardSong) continue;
      if (right < left) break;
      slots[right--] = spell;
    }

    memorizedGemBarEl.innerHTML = '';
    for (let i = 0; i < GEM_SLOTS; i++) {
      const spell = slots[i];
      const slot = document.createElement('div');
      slot.className =
        'gem-slot' +
        (spell ? '' : ' gem-empty') +
        (spell && spell.isBardSong ? ' gem-song' : '') +
        // Greyed out rather than hidden: a memorized nuke/heal genuinely
        // occupies a gem, it just isn't something this app tracks, and
        // showing it desaturated says that without needing a legend.
        (spell && !spell.isKnownBuff ? ' gem-nonbuff' : '');
      if (spell) {
        // Native title attribute rather than a custom bubble - it survives
        // the slot being near the window edge with no positioning logic, and
        // this is a diagnostic readout, not a primary interaction.
        slot.title =
          (spell.isKnownBuff ? spell.name : `${spell.name} (not a tracked buff)`) +
          '\nClick to forget - use this when the app is remembering a gem you no longer have loaded.';
        // Clicking forgets it. The memory persists across restarts now, so it
        // can be actively wrong (gems swapped while the app was closed) rather
        // than merely incomplete - and a wrong entry is worse than a missing
        // one, since the detection tiers treat "not memorized" as evidence.
        slot.addEventListener('click', () => {
          window.eqTracker.forgetMemorizedSpell(spell.name);
        });
        if (spell.iconUrl) {
          const img = document.createElement('img');
          img.src = spell.iconUrl;
          img.alt = '';
          slot.appendChild(img);
        } else {
          // Only reached when the spell is in neither the roster nor the
          // game's spell data (or the EQ folder isn't configured yet), so
          // there's genuinely no art to show - an initial at least keeps the
          // slot reading as occupied rather than empty.
          const initial = document.createElement('span');
          initial.className = 'gem-initial';
          initial.textContent = spell.name.charAt(0).toUpperCase();
          slot.appendChild(initial);
        }
      }
      memorizedGemBarEl.appendChild(slot);
    }

    clearMemorizedBtn.style.display = empty ? 'none' : '';
    memorizedStatusEl.textContent = empty
      ? "Nothing remembered - the app doesn't know what you have memorized."
      : `${spells.length} spell${spells.length === 1 ? '' : 's'} remembered - click a gem to forget it.`;
  }
  clearMemorizedBtn.addEventListener('click', () => {
    window.eqTracker.clearMemorizedSpells();
  });
  window.eqTracker.getMemorizedSpells().then(renderMemorized);
  window.eqTracker.onMemorizedSpellsChanged(renderMemorized);

  const autoHideCheckbox = document.getElementById('auto-hide-overlay-checkbox');
  const showAurasAppFocusedCheckbox = document.getElementById('show-auras-app-focused-checkbox');
  const showAurasAppFocusedRowEl = document.getElementById('show-auras-app-focused-row');
  // "Also show them while this app is focused" means nothing while auto-hide itself is off -
  // nothing is ever hidden in the first place for it to carve an exception into.
  function syncAutoHideDisclosure() {
    showAurasAppFocusedRowEl.style.display = autoHideCheckbox.checked ? '' : 'none';
  }

  // The detection log used to be a loose file in the app's data folder, next to Chromium's caches,
  // and note 28 stayed blocked for days because nobody could find it. The path is shown as well as
  // the button, so it can be reached without this app running at all.
  const openDebugLogFolderBtn = document.getElementById('open-debug-log-folder-btn');
  openDebugLogFolderBtn.addEventListener('click', () => window.eqTracker.openDebugLogFolder());
  window.eqTracker.getDebugLogFolder().then((dir) => {
    document.getElementById('debug-log-folder-path').textContent = dir;
  });

  // Off by default, manually enabled - reported live 25 Aug. Reads back on every launch so this
  // page always shows what's actually running, not just what was last clicked.
  const debugLogEnabledCheckbox = document.getElementById('debug-log-enabled-checkbox');
  window.eqTracker.getDebugLogEnabled().then((enabled) => {
    debugLogEnabledCheckbox.checked = !!enabled;
  });
  debugLogEnabledCheckbox.addEventListener('change', () => {
    window.eqTracker.setDebugLogEnabled(debugLogEnabledCheckbox.checked);
  });

  // Off by default - see buffEngine.js's constructor comment on useEvidenceModel. Reads back on
  // every launch, same reasoning as the debug log checkbox just above.
  const useEvidenceModelCheckbox = document.getElementById('use-evidence-model-checkbox');
  window.eqTracker.getUseEvidenceModel().then((enabled) => {
    useEvidenceModelCheckbox.checked = !!enabled;
  });
  useEvidenceModelCheckbox.addEventListener('change', () => {
    window.eqTracker.setUseEvidenceModel(useEvidenceModelCheckbox.checked);
  });

  // Off by default - see buffEngine.js's constructor comment on useCastTimeFilter. Independent
  // toggle from useEvidenceModel just above, so either can be reverted without the other.
  const useCastTimeFilterCheckbox = document.getElementById('use-cast-time-filter-checkbox');
  window.eqTracker.getUseCastTimeFilter().then((enabled) => {
    useCastTimeFilterCheckbox.checked = !!enabled;
  });
  useCastTimeFilterCheckbox.addEventListener('change', () => {
    window.eqTracker.setUseCastTimeFilter(useCastTimeFilterCheckbox.checked);
  });

  // Off by default - see buffEngine.js's constructor comment on useStackingModel. Independent
  // toggle from the two above, so any of the three can be reverted without touching the others.
  const useStackingModelCheckbox = document.getElementById('use-stacking-model-checkbox');
  window.eqTracker.getUseStackingModel().then((enabled) => {
    useStackingModelCheckbox.checked = !!enabled;
  });
  useStackingModelCheckbox.addEventListener('change', () => {
    window.eqTracker.setUseStackingModel(useStackingModelCheckbox.checked);
  });

  const loadoutLabelCheckbox = document.getElementById('loadout-label-checkbox');
  const loadoutLabelPositionRow = document.getElementById('loadout-label-position-row');
  const loadoutLabelUnlockBtn = document.getElementById('loadout-label-unlock-btn');
  const loadoutLabelResetPositionBtn = document.getElementById('loadout-label-reset-position-btn');

  // The label is deliberately never in the sidebar aura list or Add Aura (Shara: "it should be a
  // permanent option that is not tied to creating an aura") - but it's still a real widget with a
  // real draggable position underneath, and with nowhere else showing it, "drag it wherever you
  // want it" had no button to start from. Reported live: "this label cannot be moved." These two
  // buttons reuse the exact same widget lock/reset IPC every other aura's own Unlock to move /
  // Reset position pair already calls, just targeting this one widget's id directly rather than
  // whatever selectedId happens to be.
  function findLoadoutLabelId() {
    return window.eqTracker.listWidgets().then((list) => {
      const w = list.find((x) => x.kind === 'loadout-label-builtin');
      return w ? w.id : null;
    });
  }
  function syncLoadoutLabelPositionRow(enabled) {
    loadoutLabelPositionRow.style.display = enabled ? '' : 'none';
    if (!enabled) return;
    findLoadoutLabelId().then((id) => {
      if (!id) return;
      window.eqTracker.isWidgetLocked(id).then((locked) => {
        loadoutLabelUnlockBtn.textContent = locked ? 'Unlock to move' : 'Lock label';
        loadoutLabelUnlockBtn.classList.toggle('unlocked', !locked);
      });
    });
  }
  loadoutLabelUnlockBtn.addEventListener('click', async () => {
    const id = await findLoadoutLabelId();
    if (!id) return;
    const locked = await window.eqTracker.toggleWidgetLock(id);
    refreshMasterButtons();
    loadoutLabelUnlockBtn.textContent = locked ? 'Unlock to move' : 'Lock label';
    loadoutLabelUnlockBtn.classList.toggle('unlocked', !locked);
  });
  loadoutLabelResetPositionBtn.addEventListener('click', async () => {
    const id = await findLoadoutLabelId();
    if (id) window.eqTracker.resetWidgetPosition(id);
  });

  window.eqTracker.getLoadoutLabel().then((enabled) => {
    loadoutLabelCheckbox.checked = !!enabled;
    syncLoadoutLabelPositionRow(!!enabled);
  });
  // It can now switch itself on, so the box has to hear about it - otherwise she opens the modal
  // and finds an unticked box next to a label that is plainly on screen.
  window.eqTracker.onLoadoutLabelChanged((enabled) => {
    loadoutLabelCheckbox.checked = !!enabled;
    syncLoadoutLabelPositionRow(!!enabled);
    refreshWidgets();
  });
  loadoutLabelCheckbox.addEventListener('change', () => {
    // refreshWidgets, because turning it on creates the label the first time and it should appear
    // in the aura list straight away rather than after the next unrelated refresh.
    window.eqTracker.setLoadoutLabel(loadoutLabelCheckbox.checked).then(() => {
      syncLoadoutLabelPositionRow(loadoutLabelCheckbox.checked);
      refreshWidgets();
    });
  });

  window.eqTracker.getShowAurasWhenAppFocused().then((enabled) => {
    showAurasAppFocusedCheckbox.checked = enabled;
  });
  showAurasAppFocusedCheckbox.addEventListener('change', () => {
    window.eqTracker.setShowAurasWhenAppFocused(showAurasAppFocusedCheckbox.checked);
  });
  window.eqTracker.getAutoHideOverlayEnabled().then((enabled) => {
    autoHideCheckbox.checked = enabled;
    syncAutoHideDisclosure();
  });
  autoHideCheckbox.addEventListener('change', () => {
    window.eqTracker.setAutoHideOverlayEnabled(autoHideCheckbox.checked);
    syncAutoHideDisclosure();
  });
}

// Shared by both the static sidebar buttons and the dynamically-created
// widget submenu buttons (added/removed as widgets are created/deleted),
// so it can't just be a one-time querySelectorAll like a static nav could.
function activateNavButton(btn) {
  document.querySelectorAll('.nav-btn, .nav-sub-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const pageId = btn.dataset.page;
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === pageId));
}

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateNavButton(btn));
  });

  // Plain in-page links to another page (e.g. the trimmed Widgets intro
  // card's "full explanation on the About page") - not .nav-btn elements
  // themselves, so this finds and activates the REAL sidebar button for
  // that page instead, keeping the sidebar's own active state correct.
  document.querySelectorAll('a[data-page]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(`.nav-btn[data-page="${link.dataset.page}"]`);
      if (target) activateNavButton(target);
    });
  });
}

const MAX_FEED_LINES = 200;
const ARCHIVE_THRESHOLD_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initLogPanel() {
  const folderEl = document.getElementById('eq-folder');
  const fileEl = document.getElementById('log-file');
  const errorEl = document.getElementById('log-error');
  const browseBtn = document.getElementById('browse-btn');
  const openFolderBtn = document.getElementById('open-folder-btn');
  const feedEl = document.getElementById('line-feed');
  const debugFeedEl = document.getElementById('debug-line-feed');
  const memorizedFeedEl = document.getElementById('memorized-line-feed');

  const splitEnabledCheckbox = document.getElementById('split-enabled-checkbox');
  const splitOutputFolderEl = document.getElementById('split-output-folder');
  const splitChooseFolderBtn = document.getElementById('split-choose-folder-btn');
  const splitResetFolderBtn = document.getElementById('split-reset-folder-btn');
  const splitSubOptionsEl = document.getElementById('split-sub-options');

  const fileSizeEl = document.getElementById('log-file-size');
  const archivePromptEl = document.getElementById('archive-prompt');
  const archiveNowBtn = document.getElementById('archive-now-btn');

  function renderState(state) {
    folderEl.textContent = state.eqFolder || 'Not detected - click Browse';
    fileEl.textContent = state.currentFile || (state.watching ? 'Waiting for a log file...' : '-');
    errorEl.textContent = state.lastError || '';

    if (state.split) {
      // The splitter files a line it cannot read under the day of the line before it. That is right
      // for a wrapped server broadcast and wrong for everything else, so when it starts happening
      // in bulk the only honest thing is to say so rather than carry on filing.
      const warnEl = document.getElementById('split-format-warning');
      if (warnEl) {
        const alarm = state.split.formatAlarm;
        if (alarm) {
          warnEl.style.display = '';
          warnEl.textContent =
            `Heads up: ${(alarm.ratio * 100).toFixed(0)}% of the last ${alarm.total} lines had no ` +
            `readable timestamp, so they were filed under ${alarm.lastDateKeySeen} rather than their ` +
            `own day. Normally this is almost never. EverQuest's log format may have changed - the ` +
            `split files may be wrong until it is looked at.`;
        } else {
          warnEl.style.display = 'none';
          warnEl.textContent = '';
        }
      }
      splitEnabledCheckbox.checked = state.split.enabled;
      splitOutputFolderEl.textContent = state.split.outputDir || '-';
      splitSubOptionsEl.style.display = state.split.enabled ? '' : 'none';
    }

    fileSizeEl.textContent = formatBytes(state.fileSizeBytes);
    archivePromptEl.style.display = state.shouldPromptArchive ? 'block' : 'none';
  }

  // Only auto-follow new lines if the user was already at (or very near)
  // the bottom before this one arrived - otherwise a line streaming in
  // mid-read yanks them back down and makes the feed unreadable. Checked
  // BEFORE appending, since scrollHeight grows the moment the new line is
  // added and would always read as "not at the bottom yet" if checked after.
  const NEAR_BOTTOM_PX = 4;
  function isNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }

  function appendToFeed(feedEl, line) {
    const shouldStick = isNearBottom(feedEl);
    const div = document.createElement('div');
    div.textContent = line;
    feedEl.appendChild(div);
    while (feedEl.children.length > MAX_FEED_LINES) {
      feedEl.removeChild(feedEl.firstChild);
    }
    if (shouldStick) feedEl.scrollTop = feedEl.scrollHeight;
  }

  function appendLine(line) {
    appendToFeed(feedEl, line);
  }

  function appendDebugLine(line) {
    appendToFeed(debugFeedEl, line);
  }

  function appendMemorizedLine(line) {
    appendToFeed(memorizedFeedEl, line);
  }

  window.eqTracker.getLogState().then(renderState);
  window.eqTracker.onLogStatus(renderState);
  window.eqTracker.onLogLine(appendLine);
  window.eqTracker.onDebugLine(appendDebugLine);
  window.eqTracker.onMemorizedLine(appendMemorizedLine);
  window.eqTracker.onLogError((message) => {
    errorEl.textContent = message;
  });

  // File size only changes as new lines arrive, which doesn't push a
  // log:status update on its own - poll it periodically instead.
  setInterval(() => window.eqTracker.getLogState().then(renderState), 5000);

  browseBtn.addEventListener('click', async () => {
    const state = await window.eqTracker.chooseLogFolder();
    renderState(state);
  });

  openFolderBtn.addEventListener('click', () => window.eqTracker.openLogFolder());

  splitEnabledCheckbox.addEventListener('change', async () => {
    renderState(await window.eqTracker.setSplitEnabled(splitEnabledCheckbox.checked));
  });
  splitChooseFolderBtn.addEventListener('click', async () => {
    renderState(await window.eqTracker.chooseSplitFolder());
  });
  splitResetFolderBtn.addEventListener('click', async () => {
    renderState(await window.eqTracker.resetSplitFolder());
  });

  archiveNowBtn.addEventListener('click', async () => {
    const holdsWeek = await window.eqTracker.archiveHoldsCurrentWeek();
    const go = await appConfirm({
      title: 'Archive log now',
      message: 'Archive the current log and empty the live log file?',
      detail: holdsWeek
        ? 'Your log currently holds this lockout week. Archiving it whole takes this week’s raid kills out of the file the Lockouts tab reads — the grid will show "not looked" until you play again. If you use the Lockouts tab, use "Trim log to this week" there instead.'
        : 'Copies the current log to a timestamped file, then empties the live log. Best done right after /log off.',
      okLabel: holdsWeek ? 'Archive anyway' : 'Archive',
      danger: holdsWeek,
    });
    if (!go) return;
    const result = await window.eqTracker.archiveLogNow();
    if (!result.ok && result.error !== 'cancelled') {
      await appConfirm({ title: 'Archive failed', message: result.error || 'unknown', okLabel: 'OK', hideCancel: true });
    }
    renderState(await window.eqTracker.getLogState());
  });

  // Archives go into an "Archive" folder beside the log, which is not somewhere anyone would
  // think to look. The main process creates it if the first archive has not been made yet, so
  // this never silently does nothing.
  const openArchiveFolderBtn = document.getElementById('open-archive-folder-btn');
  const archiveFolderStatusEl = document.getElementById('archive-folder-status');
  if (openArchiveFolderBtn) {
    openArchiveFolderBtn.addEventListener('click', async () => {
      const result = await window.eqTracker.openArchiveFolder();
      if (archiveFolderStatusEl) {
        archiveFolderStatusEl.textContent = result.ok ? result.folder : result.error;
      }
    });
  }
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Shared minutes+seconds input pair, used anywhere a buff duration is
// entered or edited.
function buildDurationInputs(initialSec) {
  const wrap = document.createElement('span');
  wrap.className = 'duration-pair';

  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.min = '0';
  minInput.step = '1';
  minInput.className = 'duration-input';
  minInput.value = Math.floor((initialSec || 0) / 60);

  const minLabel = document.createElement('span');
  minLabel.className = 'duration-unit';
  minLabel.textContent = 'm';

  const secInput = document.createElement('input');
  secInput.type = 'number';
  secInput.min = '0';
  secInput.max = '59';
  secInput.step = '1';
  secInput.className = 'duration-input';
  secInput.value = (initialSec || 0) % 60;

  const secLabel = document.createElement('span');
  secLabel.className = 'duration-unit';
  secLabel.textContent = 's';

  wrap.append(minInput, minLabel, secInput, secLabel);

  return {
    element: wrap,
    getSeconds() {
      const m = parseInt(minInput.value, 10) || 0;
      const s = parseInt(secInput.value, 10) || 0;
      return m * 60 + s;
    },
    focus() {
      minInput.focus();
    },
  };
}

function buildIconThumb(iconUrl) {
  if (!iconUrl) return null;
  const img = document.createElement('img');
  img.className = 'buff-icon-thumb';
  img.src = iconUrl;
  img.alt = '';
  return img;
}

// Turns a channel + who + message into the exact log line customTimerEngine
// actually matches against (still a plain literal-string comparison there -
// this is purely a convenience so the user doesn't need to know or type the
// game's own wording/punctuation for each channel). Every pattern here is
// confirmed against this server's real log, not guessed - "guild" uses "say
// to your guild" for your own line but "tells the guild" for someone
// else's, an asymmetry that's easy to get wrong by hand. "tell" only ever
// means someone messaging you (there's no "self" case - you can't tell
// yourself), so isSelf is ignored for it.
function buildChatTriggerLine(channel, isSelf, name, message) {
  const trimmedMessage = message.trim();
  const trimmedName = (name || '').trim();
  if (channel === 'say') {
    return isSelf ? `You say, '${trimmedMessage}'` : `${trimmedName} says, '${trimmedMessage}'`;
  }
  if (channel === 'group') {
    return isSelf ? `You tell your party, '${trimmedMessage}'` : `${trimmedName} tells the group, '${trimmedMessage}'`;
  }
  if (channel === 'guild') {
    return isSelf ? `You say to your guild, '${trimmedMessage}'` : `${trimmedName} tells the guild, '${trimmedMessage}'`;
  }
  if (channel === 'tell') {
    return `${trimmedName} tells you, '${trimmedMessage}'`;
  }
  return '';
}

// QOL #4 - a count badge on the "Buff Tracker" nav button while ambiguous or unknown casts are
// waiting to be resolved. They only surface on the Buff Tracker page itself or a popup, so
// nothing in the app chrome tells you while you are on another page in game.
function initTrackerBadge() {
  const btn = document.querySelector('.nav-btn[data-page="page-tracker"]');
  if (!btn) return;
  const badge = document.createElement('span');
  badge.className = 'nav-badge';
  badge.style.display = 'none';
  btn.appendChild(badge);
  let ambiguous = 0;
  let unknown = 0;
  const paint = () => {
    const n = ambiguous + unknown;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? '' : 'none';
    badge.title =
      `${ambiguous} ambiguous cast${ambiguous === 1 ? '' : 's'} and ${unknown} unknown ` +
      `- open Buff Tracker to sort them out`;
  };
  window.eqTracker.getAmbiguousCasts().then((c) => { ambiguous = c.length; paint(); });
  window.eqTracker.onAmbiguousCastsChanged((c) => { ambiguous = c.length; paint(); });
  window.eqTracker.getUnknownBuffs().then((b) => { unknown = b.length; paint(); });
  window.eqTracker.onUnknownBuffsChanged((b) => { unknown = b.length; paint(); });
}

function initBuffPanels() {
  const unknownListEl = document.getElementById('unknown-buffs');

  function renderUnknown(buffs) {
    unknownListEl.innerHTML = '';
    if (buffs.length === 0) {
      unknownListEl.innerHTML = '<li class="empty">None right now.</li>';
      return;
    }
    for (const buff of buffs) {
      const li = document.createElement('li');
      li.className = 'unknown-buff-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'buff-name';
      nameSpan.textContent = buff.name;

      const duration = buildDurationInputs(0);

      const landingInput = document.createElement('input');
      landingInput.type = 'text';
      landingInput.placeholder = 'Landing text (optional)';
      landingInput.className = 'text-input';

      const endedInput = document.createElement('input');
      endedInput.type = 'text';
      endedInput.placeholder = 'Ended text (optional)';
      endedInput.className = 'text-input';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        const totalSec = duration.getSeconds();
        if (totalSec <= 0) {
          duration.focus();
          return;
        }
        window.eqTracker.resolveUnknownBuff(buff.name, totalSec, {
          landingText: landingInput.value.trim() || undefined,
          endedText: endedInput.value.trim() || undefined,
        });
      });

      const dismissBtn = document.createElement('button');
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', () => window.eqTracker.dismissUnknownBuff(buff.name));

      const topRow = document.createElement('div');
      topRow.className = 'row';
      topRow.append(nameSpan, duration.element, saveBtn, dismissBtn);

      const textRow = document.createElement('div');
      textRow.className = 'row';
      textRow.append(landingInput, endedInput);

      li.append(topRow, textRow);
      unknownListEl.appendChild(li);
    }
  }

  window.eqTracker.getUnknownBuffs().then(renderUnknown);
  window.eqTracker.onUnknownBuffsChanged(renderUnknown);

  initAmbiguousPanel();
}

function initAmbiguousPanel() {
  const listEl = document.getElementById('ambiguous-buffs');

  function render(casts) {
    listEl.innerHTML = '';
    if (casts.length === 0) {
      listEl.innerHTML = '<li class="empty">None right now.</li>';
      return;
    }
    for (const cast of casts) {
      const li = document.createElement('li');
      li.className = 'unknown-buff-row';

      const textSpan = document.createElement('span');
      textSpan.className = 'buff-name';
      textSpan.textContent = `"${cast.text}"`;

      const dismissBtn = document.createElement('button');
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', () => window.eqTracker.dismissAmbiguousCast(cast.text));

      const topRow = document.createElement('div');
      topRow.className = 'row';
      topRow.append(textSpan, dismissBtn);

      const candidateRow = document.createElement('div');
      candidateRow.className = 'row ambiguous-candidates';
      for (const candidateName of cast.candidateNames) {
        const btn = document.createElement('button');
        btn.textContent = candidateName;
        btn.addEventListener('click', () => window.eqTracker.resolveAmbiguousCast(cast.text, candidateName));
        candidateRow.appendChild(btn);
      }

      li.append(topRow, candidateRow);
      listEl.appendChild(li);
    }
  }

  window.eqTracker.getAmbiguousCasts().then(render);
  window.eqTracker.onAmbiguousCastsChanged(render);

  const resolutionsBackdrop = document.getElementById('ambiguous-resolutions-modal-backdrop');
  const resolutionsSearch = document.getElementById('ambiguous-resolutions-search');
  const resolutionsList = document.getElementById('ambiguous-resolutions-list');
  const closeResolutionsModalBtn = document.getElementById('close-ambiguous-resolutions-modal');
  let allResolutions = [];

  function modalIsOpen() {
    return resolutionsBackdrop.style.display !== 'none';
  }

  const resetBtn = document.getElementById('reset-ambiguous-btn');
  resetBtn.addEventListener('click', () => {
    const confirmed = window.confirm(
      'Clear every remembered "this text means buff X" choice? Anything ambiguous will prompt you again from scratch.'
    );
    if (confirmed) {
      window.eqTracker.resetAmbiguousResolutions();
      if (modalIsOpen()) window.eqTracker.getAmbiguousResolutions().then((rows) => {
        allResolutions = rows;
        applyResolutionsSearch();
      });
    }
  });

  const viewBtn = document.getElementById('view-ambiguous-resolutions-btn');

  function renderResolutionsList(rows) {
    resolutionsList.innerHTML = '';
    if (rows.length === 0) {
      resolutionsList.innerHTML = '<li class="empty">No remembered choices.</li>';
      return;
    }
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = 'unknown-buff-row';

      const label = document.createElement('span');
      label.className = 'buff-name';
      label.textContent = `"${r.text}" -> ${r.buffName} (${r.isSelf ? 'your cast' : "others' cast"})`;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        window.eqTracker.removeAmbiguousResolution(r.text, r.isSelf).then(() => {
          allResolutions = allResolutions.filter((x) => !(x.text === r.text && x.isSelf === r.isSelf));
          applyResolutionsSearch();
        });
      });

      const row = document.createElement('div');
      row.className = 'row';
      row.append(label, removeBtn);
      li.append(row);
      resolutionsList.appendChild(li);
    }
  }

  function applyResolutionsSearch() {
    const query = resolutionsSearch.value.trim().toLowerCase();
    const filtered = query
      ? allResolutions.filter((r) => r.text.toLowerCase().includes(query) || r.buffName.toLowerCase().includes(query))
      : allResolutions;
    renderResolutionsList(filtered);
  }

  resolutionsSearch.addEventListener('input', applyResolutionsSearch);

  function openResolutionsModal() {
    window.eqTracker.getAmbiguousResolutions().then((rows) => {
      allResolutions = rows;
      resolutionsSearch.value = '';
      resolutionsBackdrop.style.display = 'flex';
      applyResolutionsSearch();
    });
  }

  function closeResolutionsModal() {
    resolutionsBackdrop.style.display = 'none';
  }

  viewBtn.addEventListener('click', openResolutionsModal);
  closeResolutionsModalBtn.addEventListener('click', closeResolutionsModal);
  resolutionsBackdrop.addEventListener('click', (e) => {
    if (e.target === resolutionsBackdrop) closeResolutionsModal();
  });
}

// Every kind of thing that can start a custom timer. Built entries carry a
// fieldsId pointing at their own settings panel in index.html; `planned`
// entries render disabled with a Planned badge, same approach as
// PLANNED_PREMADE_WIDGETS - the roadmap stays visible in the app itself
// rather than only in project docs, and shipping a new trigger type means
// adding fieldsId + markup, not restructuring the picker.
//
// Deliberately ordered easiest-first: "Chat message" needs no knowledge of
// the game's log wording at all, so it's the right default for someone
// setting up their first timer.
//
// Module scope, not inside initWidgetsPanel: renderTriggerTypeChoices() has
// to run before the mode radios are queried (they don't exist until it does),
// and a `const` declared later in that same function would be in its temporal
// dead zone at that point.
const TRIGGER_TYPES = [
  {
    value: 'chat',
    label: 'Chat message',
    description: 'Something you or someone else says in a channel. No need to know the exact log wording.',
    fieldsId: 'widget-new-timer-chat-fields',
  },
  {
    value: 'raw',
    label: 'Exact log line',
    description: 'Any line at all, matched literally - an emote, an achievement, a spell message.',
    fieldsId: 'widget-new-timer-raw-fields',
  },
  {
    value: 'skill',
    label: 'Skill cast',
    description: 'Starts the moment you begin casting a spell you pick from the list, by name rather than by log wording.',
    fieldsId: 'widget-new-timer-skill-fields',
  },
  {
    value: 'zone',
    label: 'Zone change',
    description: 'Starts the instant you enter or leave a particular zone, picked from a list.',
    fieldsId: 'widget-new-timer-zone-fields',
  },
  {
    value: 'combat',
    label: 'Combat state',
    description: 'Starts when you enter or leave combat.',
    planned: true,
  },
];

// Generalized so the action-bar-cooldown modal can render the same trigger-type list (minus zone/
// combat, which don't apply to a single gem - see initActionBarsPage) rather than duplicating this
// markup-building logic for a second, differently-scoped picker.
function renderTriggerTypeChoices(containerId = 'widget-new-timer-trigger-types', radioName = 'widget-new-timer-trigger-mode', types = TRIGGER_TYPES) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (const type of types) {
    const label = document.createElement('label');
    label.className = 'trigger-type-choice' + (type.planned ? ' planned' : '');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = type.value;
    if (type.planned) radio.disabled = true;

    const text = document.createElement('span');
    text.className = 'trigger-type-text';
    const strong = document.createElement('strong');
    strong.textContent = type.label;
    if (type.planned) {
      const badge = document.createElement('span');
      badge.className = 'planned-badge';
      badge.textContent = 'Planned';
      strong.appendChild(badge);
    }
    const desc = document.createElement('span');
    desc.textContent = type.description;
    text.append(strong, desc);

    label.append(radio, text);
    container.appendChild(label);
  }
}

function initWidgetsPanel() {
  const submenuEl = document.getElementById('widgets-submenu');
  const addRow = submenuEl.querySelector('.nav-add-widget-row');
  const widgetsNavBtn = document.getElementById('widgets-nav-btn');
  const introCard = document.getElementById('widgets-intro-card');
  const iconSetCard = document.getElementById('icon-set-card');
  // "Unlock all auras" and the two auto-hide checkboxes act on EVERY aura at once, so they belong
  // on the Overlay Auras overview and nowhere else. Left always-visible they sat at the top of
  // each individual aura's settings, directly above that aura's own "Unlock to move" - two
  // controls a few centimetres apart, one scoped to everything and one to the thing you are
  // looking at, which is exactly the arrangement that gets the wrong one pressed.
  const allAurasCard = document.getElementById('all-auras-card');

  const pageOverlayTitleEl = document.getElementById('page-overlay-title');
  const settingsPanel = document.getElementById('widget-settings-panel');
  const settingsTitle = document.getElementById('widget-settings-title');
  const nameInput = document.getElementById('widget-name-input');
  const lockBtn = document.getElementById('widget-lock-btn');
  const resetPositionBtn = document.getElementById('widget-reset-position-btn');
  const buffSourceRow = document.getElementById('widget-buff-source-row');
  const buffSourceRadios = document.querySelectorAll('input[name="widget-buff-source"]');
  const displayModeRadios = document.querySelectorAll('input[name="widget-display-mode"]');
  const timerFormatRadios = document.querySelectorAll('input[name="widget-timer-format"]');
  const sortOrderRadios = document.querySelectorAll('input[name="widget-sort-order"]');
  // The countdown / row text size (the "Timer text" topic), capped at 28px - see widgetStore's
  // own comment on the shared `textSize` field. Its slider used to share the id
  // widget-text-size-slider with the text-aura MESSAGE slider below, so getElementById returned
  // whichever came first in the document (the message one) and this control did nothing at all.
  const textSizeSlider = document.getElementById('widget-timer-text-size-slider');
  const textSizeValueEl = document.getElementById('widget-timer-text-size-value');
  const iconSizeSlider = document.getElementById('widget-icon-size-slider');
  const iconSizeValueEl = document.getElementById('widget-icon-size-value');
  const iconsPerRowSlider = document.getElementById('widget-icons-per-row-slider');
  const iconsPerRowValueEl = document.getElementById('widget-icons-per-row-value');
  const rowSizeSlider = document.getElementById('widget-row-size-slider');
  const rowSizeValueEl = document.getElementById('widget-row-size-value');
  const listWidthSlider = document.getElementById('widget-list-width-slider');
  const listWidthValueEl = document.getElementById('widget-list-width-value');
  const showRowIconCheckbox = document.getElementById('widget-show-row-icon-checkbox');
  const mirrorRowCheckbox = document.getElementById('widget-mirror-row-checkbox');
  const opacitySlider = document.getElementById('widget-opacity-slider');
  const lowThresholdSlider = document.getElementById('widget-low-threshold-slider');
  const lowThresholdValueEl = document.getElementById('widget-low-threshold-value');
  const landingGlowCheckbox = document.getElementById('widget-landing-glow-checkbox');
  const landingGlowLabelEl = document.getElementById('widget-landing-glow-label');
  const soundLandCheckbox = document.getElementById('widget-sound-land-checkbox');
  const soundLandLabelEl = document.getElementById('widget-sound-land-label');
  const soundExpireCheckbox = document.getElementById('widget-sound-expire-checkbox');
  const soundExpireLabelEl = document.getElementById('widget-sound-expire-label');
  const soundWarningSlider = document.getElementById('widget-sound-warning-slider');
  const soundWarningCheckbox = document.getElementById('widget-sound-warning-checkbox');
  const soundWarningLabelEl = document.getElementById('widget-sound-warning-label');
  const soundWarningGroupEl = document.getElementById('widget-sound-warning-group');
  const soundLandRowEl = document.getElementById('widget-sound-land-row');
  const soundExpireRowEl = document.getElementById('widget-sound-expire-row');
  const alertVolumeRowEl = document.getElementById('widget-alert-volume-row');
  const soundWarningValueEl = document.getElementById('widget-sound-warning-value');
  const alertVolumeSlider = document.getElementById('widget-alert-volume-slider');
  const alertVolumeValueEl = document.getElementById('widget-alert-volume-value');
  const soundCooldownRowEl = document.getElementById('widget-sound-cooldown-row');
  const soundCooldownSlider = document.getElementById('widget-sound-cooldown-slider');
  const soundCooldownValueEl = document.getElementById('widget-sound-cooldown-value');
  const soundWarningLoopSlider = document.getElementById('widget-sound-loop-slider');
  const soundWarningLoopValueEl = document.getElementById('widget-sound-loop-value');
  // Scoped per grid, not a bare '.anchor-cell' query - the label position
  // grid reuses the same cell markup/class, and a global query would mix
  // the two grids' buttons together (wrong "active" cell, wrong grid
  // cleared on click).
  const anchorButtons = document.querySelectorAll('#widget-anchor-grid .anchor-cell');
  const iconOnlySettings = document.getElementById('widget-icon-only-settings');
  const iconPositionSettings = document.getElementById('widget-icon-position-settings');
  const textMessageInput = document.getElementById('widget-text-message-input');
  const textMessageRowEl = document.getElementById('widget-text-message-row');
  // textAura*, not text* - there is already a textSizeSlider (above) for the shared countdown /
  // row text size, and this is the separate, much larger one a text aura gets to itself.
  const textAuraSizeSlider = document.getElementById('widget-text-size-slider');
  const textAuraSizeValueEl = document.getElementById('widget-text-size-value');
  const textAuraSizeRowEl = document.getElementById('widget-text-size-row');
  const textJustifyRadios = document.querySelectorAll('input[name="widget-text-justify"]');
  const textJustifyRowEl = document.getElementById('widget-text-justify-row');
  const textHintEl = document.getElementById('widget-text-hint');
  const textInstantSlider = document.getElementById('widget-text-instant-slider');
  const textInstantValueEl = document.getElementById('widget-text-instant-value');
  const textInstantRowEl = document.getElementById('widget-text-instant-row');
  const textInstantHintEl = document.getElementById('widget-text-instant-hint');
  const textStackCheckbox = document.getElementById('widget-text-stack-checkbox');
  const textStackRowEl = document.getElementById('widget-text-stack-row');
  const textStackMaxSlider = document.getElementById('widget-text-stack-max-slider');
  const textStackMaxValueEl = document.getElementById('widget-text-stack-max-value');
  const textStackMaxRowEl = document.getElementById('widget-text-stack-max-row');
  const displayModeRowEl = document.getElementById('widget-display-mode-row');
  const buffSourceTimerLabelEl = document.getElementById('widget-buff-source-timer-label');
  const categoryBordersCheckbox = document.getElementById('widget-category-borders-checkbox');
  const allyAlertCheckbox = document.getElementById('widget-ally-alert-checkbox');
  const alwaysOnCheckbox = document.getElementById('widget-always-on-checkbox');
  const alwaysOnRowEl = document.getElementById('widget-always-on-row');
  const alwaysOnHintEl = document.getElementById('widget-always-on-hint');
  const allyAlertRowEl = document.getElementById('widget-ally-alert-row');
  const allyAlertHintEl = document.getElementById('widget-ally-alert-hint');
  const debuffCastByRowEl = document.getElementById('widget-debuff-cast-by-row');
  const debuffCastByRadios = document.querySelectorAll('input[name="widget-debuff-cast-by"]');
  const travelSettingsEl = document.getElementById('widget-travel-settings');
  const travelDestinationCurrentEl = document.getElementById('widget-travel-destination-current');
  const travelCommandInputEl = document.getElementById('widget-travel-command-input');
  const damageSettingsEl = document.getElementById('widget-damage-settings');
  const fightTimeoutSlider = document.getElementById('widget-fight-timeout-slider');
  const fightTimeoutValueEl = document.getElementById('widget-fight-timeout-value');
  const mineOnlyCheckbox = document.getElementById('widget-mine-only-checkbox');
  const totalRowCheckbox = document.getElementById('widget-total-row-checkbox');
  const bordersRowEl = document.getElementById('widget-borders-row');
  const bordersHintEl = document.getElementById('widget-borders-hint');
  const mergeCheckbox = document.getElementById('widget-merge-checkbox');
  const mergeRowEl = document.getElementById('widget-merge-row');
  const mergeHintEl = document.getElementById('widget-merge-hint');
  const sortOrderRowEl = document.getElementById('widget-sort-order-row');
  const opacityRowEl = document.getElementById('widget-opacity-row');
  const positionRowEl = document.getElementById('widget-position-row');
  const positionHintEl = document.getElementById('widget-position-hint');
  const timerTextTopicEl = document.getElementById('topic-timer-text');
  const alertsTopicEl = document.getElementById('topic-alerts');
  // Cleanup workstream B - the "Display & size" block's accordion topics. applySettingsPanelShape
  // toggles the rows inside them as before; hideEmptyTopics (called at the end) then hides a whole
  // topic when every row it holds is hidden for the current shape. Position is always populated,
  // so it is not in the map.
  const panelTopicMembers = {
    'topic-watching': ['widget-buff-source-row', 'widget-debuff-cast-by-row'],
    'topic-panel-this-aura': [
      'widget-text-message-row', 'widget-always-on-row', 'widget-ally-alert-row',
      'widget-text-instant-row', 'widget-text-stack-row', 'widget-travel-settings',
      'widget-damage-settings',
    ],
    'topic-panel-size': ['widget-list-only-settings', 'widget-icon-only-settings'],
    'topic-panel-text': ['widget-text-size-row', 'widget-text-justify-row'],
    'topic-panel-layout': [
      'widget-display-mode-row', 'widget-sort-order-row', 'widget-merge-row', 'widget-borders-row',
      'widget-display-list-only-settings', 'widget-display-icon-only-settings',
      'widget-ally-grouping-settings',
    ],
  };
  function hideEmptyPanelTopics() {
    for (const [topicId, memberIds] of Object.entries(panelTopicMembers)) {
      const topic = document.getElementById(topicId);
      if (!topic) continue;
      const anyVisible = memberIds.some((id) => {
        const el = document.getElementById(id);
        return el && el.style.display !== 'none';
      });
      // The class - never the topic-body's display - so a collapsed topic still collapses and the
      // child-of-display:none trap (a row hidden because an ancestor is, not because of its own
      // rule) is never sprung. See the CSS comment on .topic-empty.
      topic.classList.toggle('topic-empty', !anyVisible);
    }
  }
  const iconLabelSectionEl = document.getElementById('widget-icon-label-section');
  const showIconLabelCheckbox = document.getElementById('widget-show-icon-label-checkbox');
  const iconLabelOptionsEl = document.getElementById('widget-icon-label-options');
  const iconLabelSizeSlider = document.getElementById('widget-icon-label-size-slider');
  const timerTextColorPicker = document.getElementById('widget-timer-text-color-picker');
  const labelTextColorPicker = document.getElementById('widget-label-text-color-picker');
  const marginWidthSlider = document.getElementById('widget-margin-width-slider');
  const allyGroupingSettingsEl = document.getElementById('widget-ally-grouping-settings');
  const groupAllyCheckbox = document.getElementById('widget-group-ally-checkbox');
  const allyDirectionRadios = document.querySelectorAll('input[name="widget-ally-direction"]');
  const allyDirectionRow = document.getElementById('widget-ally-direction-row');
  const hideAllyNameCheckbox = document.getElementById('widget-hide-ally-name-checkbox');
  const marginWidthValueEl = document.getElementById('widget-margin-width-value');
  const borderWidthRowEl = document.getElementById('widget-border-width-row');
  const borderWidthSlider = document.getElementById('widget-border-width-slider');
  const borderWidthValueEl = document.getElementById('widget-border-width-value');
  const iconLabelSizeValueEl = document.getElementById('widget-icon-label-size-value');
  const iconLabelAnchorButtons = document.querySelectorAll('#widget-icon-label-anchor-grid .anchor-cell');
  const wrapTextCheckbox = document.getElementById('widget-wrap-text-checkbox');
  const listOnlySettings = document.getElementById('widget-list-only-settings');
  const displayIconOnlySettings = document.getElementById('widget-display-icon-only-settings');
  const displayListOnlySettings = document.getElementById('widget-display-list-only-settings');
  const iconJustifyRadios = document.querySelectorAll('input[name="widget-icon-justify"]');
  const deleteBtn = document.getElementById('delete-widget-btn');
  const duplicateWidgetBtn = document.getElementById('duplicate-widget-btn');
  const exportBtn = document.getElementById('export-widget-btn');
  const exportCodeRow = document.getElementById('export-widget-code-row');
  const exportCodeOutput = document.getElementById('export-widget-code-output');
  const copyCodeBtn = document.getElementById('copy-widget-code-btn');
  const exportSoundWarningEl = document.getElementById('export-sound-warning');
  const openAddWidgetBtn = document.getElementById('open-add-widget-modal-btn');
  const addWidgetModalBackdrop = document.getElementById('add-widget-modal-backdrop');
  const closeAddWidgetModalBtn = document.getElementById('close-add-widget-modal');
  const addWidgetChoicesEl = document.getElementById('add-widget-choices');
  const addWidgetPanels = document.querySelectorAll('.add-widget-panel');
  const addWidgetBackBtns = document.querySelectorAll('.add-widget-back');
  const importCodeInput = document.getElementById('modal-import-widget-code-input');
  const importBtn = document.getElementById('modal-import-widget-btn');
  const importStatus = document.getElementById('modal-import-widget-status');
  const premadeListEl = document.getElementById('add-widget-premade-list');
  const modalAddTextWidgetBtn = document.getElementById('modal-add-text-widget-btn');
  const modalNewWidgetNameInput = document.getElementById('modal-new-widget-name');
  const modalAddBuffWidgetBtn = document.getElementById('modal-add-buff-widget-btn');
  const modalAddTimerWidgetBtn = document.getElementById('modal-add-timer-widget-btn');

  const activeBuffsCardEl = document.getElementById('widget-active-buffs-card');
  const manageCardEl = document.getElementById('widget-manage-card');
  const resetWidgetRowEl = document.getElementById('reset-widget-row');
  const resetWidgetBtn = document.getElementById('reset-widget-btn');
  const widgetProfilesTogglesEl = document.getElementById('widget-profiles-toggles');
  const activeBuffsListEl = document.getElementById('widget-active-buffs-list');
  const excludedBuffsSectionEl = document.getElementById('widget-excluded-buffs-section');
  const excludedBuffsListEl = document.getElementById('widget-excluded-buffs-list');
  const toggleExcludedBtn = document.getElementById('widget-toggle-excluded-btn');
  let excludedListExpanded = false;

  const filterCard = document.getElementById('widget-buff-filter-card');
  const filterTitleEl = document.getElementById('widget-buff-filter-title');
  const filterHint = document.getElementById('widget-buff-filter-hint');
  const filterSearch = document.getElementById('widget-buff-filter-search');
  const filterListEl = document.getElementById('widget-buff-filter-list');
  const selectedBuffsSectionEl = document.getElementById('widget-selected-buffs-section');
  const selectedBuffsListEl = document.getElementById('widget-selected-buffs-list');
  const buffPickerModalBackdrop = document.getElementById('buff-picker-modal-backdrop');
  const buffPickerModalTitleEl = document.getElementById('buff-picker-modal-title');
  const closeBuffPickerModalBtn = document.getElementById('close-buff-picker-modal');
  const trackOthersRowEl = document.getElementById('widget-track-others-row');
  const trackOthersCheckbox = document.getElementById('widget-track-others-checkbox');
  const customTimersCardEl = document.getElementById('widget-custom-timers-card');
  const customTimersListEl = document.getElementById('widget-custom-timers-list');
  const triggerDurationSlider = document.getElementById('widget-trigger-duration-slider');
  const triggerDurationValueEl = document.getElementById('widget-trigger-duration-value');
  const andWindowRowEl = document.getElementById('widget-and-window-row');
  const andWindowHintEl = document.getElementById('widget-and-window-hint');
  const andWindowSlider = document.getElementById('widget-and-window-slider');
  const andWindowValueEl = document.getElementById('widget-and-window-value');
  const reverseDetectionCheckbox = document.getElementById('widget-reverse-detection-checkbox');
  const newTimerNameInput = document.getElementById('widget-new-timer-name');
  const newTimerCooldownInput = document.getElementById('widget-new-timer-cooldown');
  const newTimerMatchRadios = document.querySelectorAll('input[name="widget-new-timer-match"]');

  // The Cooldown section is collapsed unless the timer being edited has one. Its summary says the
  // value when closed, so a set cooldown is never invisible just because the section is shut -
  // which is the one way a collapsible section can actively mislead.
  function setTimerCooldownOpen(open) {
    const topic = document.getElementById('topic-timer-cooldown');
    const summary = document.getElementById('timer-cooldown-summary');
    topic.classList.toggle('open', open);
    const secs = Number(newTimerCooldownInput.value) || 0;
    summary.textContent = secs > 0 ? `${secs}s` : '';
  }
  newTimerCooldownInput.addEventListener('input', () => {
    const secs = Number(newTimerCooldownInput.value) || 0;
    document.getElementById('timer-cooldown-summary').textContent = secs > 0 ? `${secs}s` : '';
  });
  const newTimerTriggerInput = document.getElementById('widget-new-timer-trigger');
  const newTimerEndedInput = document.getElementById('widget-new-timer-ended');
  renderTriggerTypeChoices();
  const newTimerModeRadios = document.querySelectorAll('input[name="widget-new-timer-trigger-mode"]');
  const newTimerChatFieldsEl = document.getElementById('widget-new-timer-chat-fields');
  const newTimerRawFieldsEl = document.getElementById('widget-new-timer-raw-fields');
  const newTimerSkillSelect = document.getElementById('widget-new-timer-skill-select'); // hidden input - holds the value
  const newTimerSkillSearch = document.getElementById('widget-new-timer-skill-search');
  const newTimerSkillOptions = document.getElementById('widget-new-timer-skill-options');
  const newTimerZoneSelect = document.getElementById('widget-new-timer-zone-select');
  const newTimerZoneDirectionRadios = document.querySelectorAll('input[name="widget-new-timer-zone-direction"]');
  const newTimerChannelSelect = document.getElementById('widget-new-timer-channel-select');
  const newTimerWhoRadios = document.querySelectorAll('input[name="widget-new-timer-who"]');
  const newTimerWhoNameInput = document.getElementById('widget-new-timer-who-name');
  const newTimerChatMessageInput = document.getElementById('widget-new-timer-chat-message');
  const newTimerChatEndedMessageInput = document.getElementById('widget-new-timer-chat-ended-message');
  const newTimerAddBtn = document.getElementById('widget-new-timer-add-btn');
  const newTimerSaveAsNewBtn = document.getElementById('widget-new-timer-save-as-new-btn');
  const newTimerCancelBtn = document.getElementById('widget-new-timer-cancel-btn');
  const addTimerBtn = document.getElementById('widget-add-timer-btn');
  const customTimerModalBackdrop = document.getElementById('custom-timer-modal-backdrop');
  const customTimerModalTitle = document.getElementById('custom-timer-modal-title');
  const closeCustomTimerModalBtn = document.getElementById('close-custom-timer-modal');
  const newTimerIconPreview = document.getElementById('widget-new-timer-icon-preview');
  const newTimerIconPlaceholder = document.getElementById('widget-new-timer-icon-placeholder');

  // Single place that knows the icon box shows EITHER the chosen art or the
  // "+" placeholder, never both - three separate call sites used to toggle
  // only the img, which would have left the "+" showing through once the box
  // replaced the old plain "Choose icon..." button.
  function setTimerIconPreview(iconUrl) {
    const has = !!iconUrl;
    if (has) newTimerIconPreview.src = iconUrl;
    newTimerIconPreview.style.display = has ? '' : 'none';
    newTimerIconPlaceholder.style.display = has ? 'none' : '';
  }
  const newTimerChooseIconBtn = document.getElementById('widget-new-timer-choose-icon-btn');
  const newTimerIconPicker = document.getElementById('widget-new-timer-icon-picker');
  let editingTimerId = null;
  let newTimerIconId;
  const selfBuffsFiltersEl = document.getElementById('widget-self-buffs-filters');
  const maxDurationSlider = document.getElementById('widget-max-duration-slider');
  const maxDurationValueEl = document.getElementById('widget-max-duration-value');

  let widgets = [];
  let selectedId = null;
  let allKnownBuffs = [];
  // For the sidebar's per-widget profile-scope dot (see renderWidgetSubmenu)
  // - only needs to know the full profile list, not which is active, so a
  // simple cache refreshed on profiles:changed is enough. Not populated by
  // that broadcast alone since it only fires on an actual create/rename/
  // delete, not on startup - refreshProfilesCache() below covers that.
  let latestProfiles = [];
  function refreshProfilesCache() {
    return window.eqTracker.getProfiles().then((list) => {
      latestProfiles = list;
    });
  }

  // Independent of initProfileBar's own `activeId` (a different function's local variable) -
  // the sidebar dot needs to know which profile is active too, and duplicating one IPC call
  // here is simpler than threading a value across two unrelated closures.
  let currentActiveProfileId = null;
  function refreshActiveProfileCache() {
    return window.eqTracker.getActiveProfileId().then((id) => {
      currentActiveProfileId = id;
    });
  }

  // Live snapshots of each engine's active list, kept up to date regardless
  // of which widget (if any) is currently selected - so whichever one gets
  // selected next has fresh data immediately instead of waiting on the next
  // broadcast.
  let latestSelfBuffs = [];
  let latestAllyBuffs = [];
  let latestActiveCustomTimers = [];

  function findWidget(id) {
    return widgets.find((w) => w.id === id) || null;
  }

  // Reported live 24 Aug, root-caused precisely: "i update field. move to another aura, come
  // back, text is reverted. have to ctrl R to get the updated text." The edit really was saved -
  // the FILE on disk had it - but findWidget() above only ever reads this renderer's own cached
  // `widgets` array, and that array is only refreshed by a full refreshWidgets() round-trip.
  // Nothing about a plain setWidgetXyz(...) IPC call - which is how a slider, checkbox or this
  // debounced text field all save - ever touched that cache, so switching away and back re-read
  // the SAME stale pre-edit snapshot findWidget already had, no matter how correct the actual
  // store was. ipcMain.handle's return value is the fresh widget object either way (every setter
  // in widgetManager.js already returns it) - this just writes that straight into the local copy
  // so the very next findWidget() sees it, without waiting on a full list re-fetch.
  //
  // Applied here for the Say field specifically, where it was actually reported - every other
  // setter in this file has the exact same latent gap and would benefit from the same one-line
  // fix, but that's real, deliberate follow-up work, not something to change wholesale on a
  // single bug report.
  function updateLocalWidgetCache(config) {
    if (!config) return;
    const index = widgets.findIndex((w) => w.id === config.id);
    if (index !== -1) widgets[index] = config;
  }

  function activeSourceForWidget(widget) {
    if (widget.buffSource === 'ally') return latestAllyBuffs;
    if (widget.buffSource === 'customTimer') return latestActiveCustomTimers;
    return latestSelfBuffs;
  }

  // Mirrors overlay.js's visibleBuffs() filtering exactly (including the
  // excludedBuffNames step - see widgetStore.js's field comment) so this
  // list always shows precisely what's actually rendering on the real
  // overlay widget right now, not a second opinion that could quietly
  // drift out of sync with it.
  function filterActiveBuffsForWidget(widget) {
    const source = activeSourceForWidget(widget);
    if (widget.buffFilterMode === 'all') {
      let filtered = source.filter((b) => b.showOnOverlay !== false);
      if (widget.hideBardSongs) filtered = filtered.filter((b) => !b.isBardSong);
      if (widget.maxDurationFilterSec > 0) {
        filtered = filtered.filter((b) => b.durationSec <= widget.maxDurationFilterSec);
      }
      const excludeSet = new Set((widget.excludedBuffNames || []).map((n) => n.toLowerCase()));
      return filtered.filter((b) => !excludeSet.has(b.name.toLowerCase()));
    }
    const nameSet = new Set((widget.buffNames || []).map((n) => n.toLowerCase()));
    return source.filter((b) => nameSet.has(b.name.toLowerCase()));
  }

  function renderActiveBuffsForWidget(widget) {
    activeBuffsCardEl.style.display = '';
    manageCardEl.style.display = '';
    resetWidgetRowEl.style.display = widget.premadeOrigin ? '' : 'none';
    const buffs = filterActiveBuffsForWidget(widget);
    activeBuffsListEl.innerHTML = '';
    if (buffs.length === 0) {
      activeBuffsListEl.innerHTML = '<li class="empty">Nothing active on this aura right now.</li>';
      renderExcludedBuffsList(widget);
      return;
    }
    for (const buff of buffs) {
      const li = document.createElement('li');
      const icon = buildIconThumb(buff.iconUrl);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'buff-name';
      // Ally entries carry who it's on (see buffEngine.js's
      // getActiveAllyBuffs) - same buff name can be active on more than one
      // groupmate at once, so the name alone wouldn't tell them apart.
      nameSpan.textContent = buff.allyName ? `${buff.name} (${buff.allyName})` : buff.name;

      const timerSpan = document.createElement('span');
      timerSpan.className = 'buff-timer' + (buff.remainingSec <= 30 ? ' low' : '');
      timerSpan.textContent = formatTime(buff.remainingSec);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        if (widget.buffSource === 'ally') window.eqTracker.removeActiveAllyBuff(buff.allyName, buff.name);
        else if (widget.buffSource === 'customTimer') window.eqTracker.removeActiveCustomTimer(buff.id);
        else window.eqTracker.removeActiveBuff(buff.name);
      });

      li.append(...(icon ? [icon] : []), nameSpan, timerSpan, removeBtn);

      // Only meaningful in 'all' mode - see filterActiveBuffsForWidget and
      // widgetStore.js's excludedBuffNames comment. An 'explicit' mode
      // widget's equivalent action is just unchecking the buff in the Buff
      // Filter card right below, so a second control here would just be a
      // confusing second way to do the same thing.
      if (widget.buffFilterMode === 'all') {
        const excludeBtn = document.createElement('button');
        excludeBtn.textContent = "Don't track here";
        excludeBtn.title = 'Hide this buff from this aura only - other auras are unaffected';
        excludeBtn.addEventListener('click', () => {
          window.eqTracker.excludeWidgetBuff(widget.id, buff.name).then(() =>
            refreshWidgets().then(() => {
              const fresh = findWidget(widget.id);
              if (fresh && selectedId === widget.id) renderActiveBuffsForWidget(fresh);
            })
          );
        });
        li.append(excludeBtn);
      }

      activeBuffsListEl.appendChild(li);
    }
    renderExcludedBuffsList(widget);
  }

  // The reverse of "Don't track here" above - without this, excluding a
  // buff was a one-way door: once hidden, it can never show up on the
  // Active list again (that's the whole point of excluding it), so there
  // was no way back to find and un-exclude it. Only meaningful in 'all'
  // mode, same as the exclude action itself.
  function renderExcludedBuffsList(widget) {
    const names = widget.buffFilterMode === 'all' ? widget.excludedBuffNames || [] : [];
    excludedBuffsSectionEl.style.display = names.length > 0 ? '' : 'none';
    toggleExcludedBtn.textContent = excludedListExpanded
      ? 'Hide excluded buffs'
      : `Show excluded buffs (${names.length})`;
    excludedBuffsListEl.style.display = excludedListExpanded ? '' : 'none';
    excludedBuffsListEl.innerHTML = '';
    for (const name of names) {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'buff-name';
      nameSpan.textContent = name;
      const trackBtn = document.createElement('button');
      trackBtn.textContent = 'Track here again';
      trackBtn.addEventListener('click', () => {
        window.eqTracker.unexcludeWidgetBuff(widget.id, name).then(() =>
          refreshWidgets().then(() => {
            const fresh = findWidget(widget.id);
            if (fresh && selectedId === widget.id) renderActiveBuffsForWidget(fresh);
          })
        );
      });
      li.append(nameSpan, trackBtn);
      excludedBuffsListEl.appendChild(li);
    }
  }

  toggleExcludedBtn.addEventListener('click', () => {
    excludedListExpanded = !excludedListExpanded;
    const widget = findWidget(selectedId);
    if (widget) renderExcludedBuffsList(widget);
  });

  function refreshActiveBuffsCardIfSelected() {
    if (!selectedId) return;
    const widget = findWidget(selectedId);
    if (widget) renderActiveBuffsForWidget(widget);
  }

  // Only called on an actual selection change (see selectWidget), not on
  // every live buffs tick like renderActiveBuffsForWidget - this fetches
  // the profile list over IPC and would otherwise spam that every second
  // and blow away an in-progress checkbox click.
  // Always-visible toggle chips rather than a checklist behind a button:
  // this is the aura's on/off control (unticking every profile hides it
  // entirely - see isVisibleForActiveProfile), so it has to be readable at a
  // glance. Rendered even when only one profile exists, because with one
  // profile it IS the plain enable/disable switch.
  // Note 38. Where the player is, kept current from the same broadcast that re-evaluates
  // visibility in the main process, so the "hidden here" warning below cannot drift from reality.
  //
  // Reported live 25 Aug as "Rename just navigates you to the aura, and doesn't actually let you
  // rename" - root-caused via temporary console logging to a completely different symptom of the
  // same bug: this whole block used to live inside initDetectionSettingsPanel(), a different
  // top-level init function from the one selectedId/findWidget/renderWidgetZones/populateZoneSelect
  // actually live in (initWidgetsPanel, this one). Every reference to currentZone/knownZones from
  // populateZoneSelect/renderWidgetZones was therefore a ReferenceError waiting to happen the
  // moment either function ran with anything to render - which selectWidget always does, near the
  // end of its own body. That threw, which rejected focusWidget's promise chain, which meant
  // Rename's own trailing `.then(() => nameInput.focus())` simply never ran - the aura still
  // opened correctly (everything selectWidget does before reaching renderWidgetZones had already
  // completed), but nothing after the throw ever did. Moved here, into the function that actually
  // uses it, rather than left split across two.
  let currentZone = null;
  window.eqTracker.getCurrentZone().then((z) => {
    currentZone = z;
    if (selectedId) renderWidgetZones(findWidget(selectedId));
  });
  window.eqTracker.onZoneChanged((z) => {
    currentZone = z;
    if (selectedId) renderWidgetZones(findWidget(selectedId));
  });
  let knownZones = [];
  window.eqTracker.getKnownZones().then((zones) => {
    knownZones = zones;
    if (selectedId) renderZoneAddOptions(findWidget(selectedId));
  });

  // Filled in from whichever hotkey actually registered, rather than hard-coded. The markup used
  // to say "or press Pause" while Electron was refusing that key outright, so the one readout of
  // the feature was also the thing telling everyone it worked. Moved here for the same reason as
  // currentZone/knownZones above - HOTKEY_LABELS lives in this function, not the one this used to
  // sit in.
  const masterHideHintEl = document.getElementById('master-hide-hint');
  function refreshHideHotkeyHint() {
    window.eqTracker.getHideHotkey().then((key) => {
      masterHideHintEl.textContent = key ? `or press ${HOTKEY_LABELS[key] || key}` : '';
    });
  }
  refreshHideHotkeyHint();

  // Reported directly: the hotkey was described as "Pause" everywhere in the app, but Electron
  // refuses to register that accelerator at all (see main.js's registerHideHotkey), so it was
  // always actually bound to Scroll Lock - and on some keyboards, a driver/layout quirk swaps
  // which physical key sends which of those two anyway. There's no way to detect "the real Pause
  // key" through that, so the key itself is a choice now rather than a guess. Lives in this
  // function (not initDetectionSettingsPanel, where the Setup page's other checkboxes sit) for the
  // same reason HOTKEY_LABELS does - it reads that constant, and reading it from a scope away is
  // exactly the ReferenceError this file already has a documented incident for.
  const hideHotkeySelect = document.getElementById('hide-hotkey-select');
  const hideHotkeyHintEl = document.getElementById('hide-hotkey-hint');
  function refreshHideHotkeyHelp(choice) {
    if (choice === 'none') {
      hideHotkeyHintEl.textContent = 'The top-bar button still works either way.';
      return;
    }
    window.eqTracker.getHideHotkey().then((bound) => {
      hideHotkeyHintEl.textContent =
        bound === choice
          ? ''
          : 'Could not register that key (another app may already own it) - falling back to Alt+Shift+H.';
    });
  }
  window.eqTracker.getHideHotkeyChoice().then((choice) => {
    hideHotkeySelect.value = choice || 'ScrollLock';
    refreshHideHotkeyHelp(hideHotkeySelect.value);
  });
  hideHotkeySelect.addEventListener('change', () => {
    window.eqTracker.setHideHotkeyChoice(hideHotkeySelect.value).then(() => {
      refreshHideHotkeyHelp(hideHotkeySelect.value);
      refreshHideHotkeyHint();
    });
  });

  // The zones an aura is limited to, as removable chips.
  //
  // The warning underneath is the part that matters. A zone rule is a NEW way for an aura to be
  // missing with no explanation, which is the failure this project keeps having - so when the rule
  // is what is hiding it, the panel says so and names the zone you are actually in.
  // The "Only in:" zone adder (QOL #2). Type in #widget-zone-search to filter; every match is a
  // button carrying a real zone name, and clicking one adds that name verbatim - the value added
  // is never parsed from what was typed, so there is no typo/case path (the reason a plain <select>
  // replaced a free-text box on 2026-08-24). Already-picked zones are excluded, so there is no dupe
  // check left to get wrong. Called every time renderWidgetZones is, and when knownZones loads.
  function renderZoneAddOptions(widget) {
    const searchEl = document.getElementById('widget-zone-search');
    const optionsEl = document.getElementById('widget-zone-options');
    if (!searchEl || !optionsEl) return;
    const picked = new Set((widget?.visibleInZones || []).map((z) => z.toLowerCase()));
    const query = searchEl.value.trim().toLowerCase();
    // An always-open ~100-row list would bury the chips and the warning under it, so the results
    // only show while the field has focus or a query.
    const show = document.activeElement === searchEl || query.length > 0;
    optionsEl.style.display = show ? '' : 'none';
    optionsEl.innerHTML = '';
    if (!show) return;
    // No cap - every real-zone match is listed (same call as QOL #31's picker); ~104 max renders
    // fine inside the scroll box.
    const matches = knownZones.filter(
      (z) => !picked.has(z.toLowerCase()) && (!query || z.toLowerCase().includes(query))
    );
    for (const zone of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zone-add-option';
      btn.textContent = zone;
      // mousedown, not click: the field blurs (hiding this list) before a click would land, so the
      // button would vanish out from under the pointer. preventDefault keeps focus on the field so
      // several zones can be added in a row.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!selectedId) return;
        const current = findWidget(selectedId)?.visibleInZones || [];
        window.eqTracker.setWidgetVisibleInZones(selectedId, [...current, zone]).then(() => {
          searchEl.value = '';
          // refreshWidgets alone only rebuilds the sidebar - re-render this panel from the freshly
          // reloaded widget so the new chip appears and the zone drops out of the results.
          refreshWidgets().then(() => renderWidgetZones(findWidget(selectedId)));
        });
      });
      optionsEl.appendChild(btn);
    }
    if (!matches.length) {
      const none = document.createElement('div');
      none.className = 'zone-add-none';
      none.textContent = query ? 'No zone matches that' : 'Every known zone is already on the list';
      optionsEl.appendChild(none);
    }
  }

  function renderWidgetZones(widget) {
    if (!widget) return;
    const zones = widget.visibleInZones || [];
    const listEl = document.getElementById('widget-zone-list');
    const warnEl = document.getElementById('widget-zone-warning');
    listEl.innerHTML = '';
    renderZoneAddOptions(widget);
    for (const zone of zones) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'profile-toggle on';
      chip.title = 'Stop limiting this aura to ' + zone;
      chip.textContent = zone + '  x';
      chip.addEventListener('click', () => {
        const next = (findWidget(widget.id)?.visibleInZones || []).filter((z) => z !== zone);
        // refreshWidgets alone only rebuilds the sidebar - it never re-rendered THIS list, so a
        // removed chip stayed on screen until you navigated away and back. Re-render this list
        // explicitly, from the freshly reloaded widget, once refreshWidgets has actually updated it.
        window.eqTracker.setWidgetVisibleInZones(widget.id, next).then(() =>
          refreshWidgets().then(() => renderWidgetZones(findWidget(widget.id)))
        );
      });
      listEl.appendChild(chip);
    }

    if (!zones.length) {
      warnEl.style.display = 'none';
    } else if (!currentZone) {
      warnEl.textContent =
        'This aura is limited to ' + zones.length + ' zone' + (zones.length === 1 ? '' : 's') +
        ", but the app does not know where you are yet - it only finds out when you change zone. " +
        'Until then the aura shows anyway, which is deliberate: a missing aura you cannot explain ' +
        'is worse than one showing where you did not ask for it.';
      warnEl.style.display = '';
    } else if (!zones.includes(currentZone)) {
      warnEl.textContent =
        'Hidden right now: you are in "' + currentZone + '", which is not on its list.';
      warnEl.style.display = '';
    } else {
      warnEl.style.display = 'none';
    }
  }

  function renderWidgetProfilesChecklist(widget) {
    widgetProfilesTogglesEl.innerHTML = '';
    window.eqTracker.getProfiles().then((profiles) => {
      const activeIds = new Set(widget.activeProfileIds || []);
      // showOnAllProfiles means every checkbox is effectively ON (see widgetManager's
      // isVisibleForActiveProfile) even though activeIds itself is empty - rendering unchecked
      // here made a genuinely-visible-everywhere aura look off, so the first click just rewrote
      // "all profiles" into "only this one" instead of actually turning it off, and it took a
      // second click to get the effect the user expected from the first.
      const allOn = !!widget.showOnAllProfiles;
      profiles.forEach((profile) => {
        const checked = allOn || activeIds.has(profile.id);
        const label = document.createElement('label');
        label.className = 'profile-toggle' + (checked ? ' on' : '');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.addEventListener('change', () => {
          const fresh = findWidget(widget.id);
          // Seed from "every profile" (not the stored, possibly-empty activeProfileIds) when
          // showOnAllProfiles is what's actually making everything read as checked - otherwise
          // unchecking one profile out of several starts from an empty set and wrongly clears
          // every other profile's membership along with it.
          const current = fresh?.showOnAllProfiles
            ? new Set(profiles.map((p) => p.id))
            : new Set(fresh?.activeProfileIds || []);
          if (checkbox.checked) current.add(profile.id);
          else current.delete(profile.id);
          label.classList.toggle('on', checkbox.checked);
          window.eqTracker.setWidgetActiveProfileIds(widget.id, [...current]).then(refreshWidgets);
        });
        label.append(checkbox, document.createTextNode(profile.name));
        widgetProfilesTogglesEl.appendChild(label);
      });
      if (profiles.length === 0) {
        widgetProfilesTogglesEl.innerHTML = '<span class="hint">No profiles exist.</span>';
      }
    });
  }

  function refreshWidgets() {
    return window.eqTracker.listWidgets().then((list) => {
      widgets = list;
      renderWidgetSubmenu();
    });
  }

  // Widgets live as buttons in the sidebar submenu (under "Overlay
  // Widgets"), not as page content - clicking one both navigates to the
  // Overlay Widgets page and opens that widget's settings panel there.
  // Delete lives inside the settings panel itself, not here.
  function renderWidgetSubmenu() {
    submenuEl.querySelectorAll('.nav-sub-row').forEach((row) => row.remove());
    widgets.forEach((widget) => {
      const row = document.createElement('div');
      row.className = 'nav-sub-row';

      const btn = document.createElement('button');
      btn.className = 'nav-btn nav-sub-btn' + (widget.id === selectedId ? ' active' : '');
      btn.dataset.page = 'page-overlay';
      btn.dataset.widgetId = widget.id;
      btn.addEventListener('click', () => {
        activateNavButton(btn);
        selectWidget(widget.id);
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'nav-sub-name';
      nameSpan.textContent = widget.name;
      btn.appendChild(nameSpan);

      // Always shown now, on every widget - reported live as liked but backwards: green means
      // "this is actually on right now" (the current profile, not just scoped to some profile
      // list), grey means it isn't. The old version only appeared for a widget scoped to fewer
      // profiles than exist, and used a single colour regardless of whether that scoping
      // actually included the CURRENT profile - so a widget correctly, deliberately disabled
      // everywhere (like the reported case) showed the exact same dot as one merely restricted
      // to two profiles out of three. latestProfiles.length === 0 before the initial fetch
      // resolves means "unknown yet," not "zero profiles exist" (there's always at least the
      // default one) - the dot itself only needs currentActiveProfileId/showOnAllProfiles/
      // activeProfileIds, all already on the widget or fetched independently, so it renders
      // regardless; only the tooltip's profile-name list waits on latestProfiles.
      const activeProfileIds = widget.activeProfileIds || [];
      const isActiveNow = !!widget.showOnAllProfiles || activeProfileIds.includes(currentActiveProfileId);
      const dotWrap = document.createElement('span');
      dotWrap.className = 'profile-dot-wrap';
      const dot = document.createElement('span');
      dot.className = 'profile-dot' + (isActiveNow ? ' profile-dot-on' : ' profile-dot-off');
      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip-bubble';
      if (widget.showOnAllProfiles) {
        tooltip.textContent = 'Active now (every profile)';
      } else {
        const names = latestProfiles.filter((p) => activeProfileIds.includes(p.id)).map((p) => p.name);
        const scopeText = names.length > 0 ? `scoped to: ${names.join(', ')}` : 'not scoped to any profile';
        tooltip.textContent = isActiveNow ? `Active now (${scopeText})` : `Not active on the current profile (${scopeText})`;
      }
      dotWrap.append(dot, tooltip);
      btn.appendChild(dotWrap);

      row.dataset.widgetId = widget.id;
      row.draggable = true;
      row.addEventListener('dragstart', onSubRowDragStart);
      row.addEventListener('dragover', onSubRowDragOver);
      row.addEventListener('dragleave', onSubRowDragLeave);
      row.addEventListener('drop', onSubRowDrop);
      row.addEventListener('dragend', onSubRowDragEnd);
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openSidebarContextMenu(widget.id, e.clientX, e.clientY);
      });

      row.appendChild(btn);
      submenuEl.insertBefore(row, addRow);
    });
  }

  // Drag-to-reorder, replacing the up/down arrows at the owner's instruction. Native HTML5 drag
  // and drop rather than a pointer-tracking implementation, because the sidebar is a plain
  // vertical list and that is exactly the case the browser's own drag events already handle -
  // dragging state, drop targets, auto-scroll near an edge - without this app tracking any of it
  // by hand.
  //
  // The list reorders itself in the DOM live as you drag over each row (so the gap you would drop
  // into is visible before you let go), and the actual save happens once, on drop - not on every
  // dragover, which fires continuously and would otherwise mean an IPC round trip per pixel of
  // mouse movement.
  let draggedWidgetId = null;

  function onSubRowDragStart(e) {
    draggedWidgetId = this.dataset.widgetId;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for a drag to start at all; Electron's Chromium does not
    // strictly need it, but setting it costs nothing and keeps this correct if that ever changes.
    e.dataTransfer.setData('text/plain', draggedWidgetId);
  }

  function onSubRowDragOver(e) {
    e.preventDefault();
    if (!draggedWidgetId || this.dataset.widgetId === draggedWidgetId) return;
    e.dataTransfer.dropEffect = 'move';
    const dragging = submenuEl.querySelector('.nav-sub-row.dragging');
    if (!dragging) return;
    // Which side of the hovered row to insert before/after, from where the pointer is within it -
    // the upper half means "I want to land above this row," the lower half "below it." Without
    // this a drag could only ever reorder by whole-row swaps, never past a single neighbor per
    // dragover, because the target would always resolve to the same row regardless of intent.
    const rect = this.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    this.parentElement.insertBefore(dragging, before ? this : this.nextSibling);
  }

  function onSubRowDragLeave() {
    // Nothing to clean up on leave - the row only moves in the DOM on dragover of a NEW target,
    // so a leave with no corresponding drop just means the drag continued over something else.
  }

  function onSubRowDrop(e) {
    e.preventDefault();
  }

  function onSubRowDragEnd() {
    this.classList.remove('dragging');
    if (draggedWidgetId) {
      const orderedIds = [...submenuEl.querySelectorAll('.nav-sub-row')].map((r) => r.dataset.widgetId);
      window.eqTracker.reorderWidgets(orderedIds).then(refreshWidgets);
    }
    draggedWidgetId = null;
  }

  // Right-click on a sidebar aura: Rename / Delete, at the owner's request. A DOM menu rather than
  // Electron's native Menu module - the sidebar already does everything else in the renderer, and
  // two items do not need a round trip through the main process (build the template there, send
  // it over, wait for the click) to draw a box with two buttons in it.
  const sidebarContextMenuEl = document.getElementById('sidebar-context-menu');
  const sidebarContextRenameBtn = document.getElementById('sidebar-context-rename');
  const sidebarContextDuplicateBtn = document.getElementById('sidebar-context-duplicate');
  const sidebarContextExportBtn = document.getElementById('sidebar-context-export');
  const sidebarContextResetBtn = document.getElementById('sidebar-context-reset');
  const sidebarContextDeleteBtn = document.getElementById('sidebar-context-delete');
  let sidebarContextMenuWidgetId = null;

  function openSidebarContextMenu(widgetId, x, y) {
    sidebarContextMenuWidgetId = widgetId;
    // Self Buffs cannot be deleted (see deleteBtn's own visibility rule above) - hidden here for
    // the same reason, rather than left to show a confirm dialog that then silently does nothing.
    const widget = findWidget(widgetId);
    sidebarContextDeleteBtn.style.display = widget && widget.deletable === false ? 'none' : '';
    // Same rule duplicateWidgetBtn already uses on the settings page - Self Buffs is a fixed
    // singleton, not something a second copy of makes sense for.
    sidebarContextDuplicateBtn.style.display = widget && widget.kind === 'self-buffs-builtin' ? 'none' : '';
    // Same rule resetWidgetBtn already uses on the settings page - only an aura built from a
    // premade has a recipe to reset back to.
    sidebarContextResetBtn.style.display = widget && widget.premadeOrigin ? '' : 'none';
    sidebarContextMenuEl.style.display = 'block';
    // Positioned, then clamped - a menu opened by right-clicking a row near the bottom of the
    // window would otherwise draw itself partly off-screen, which on a frameless borderless window
    // is not just ugly but unreachable (there is no OS chrome to push it back on screen for you).
    const menuRect = sidebarContextMenuEl.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 4;
    const maxY = window.innerHeight - menuRect.height - 4;
    sidebarContextMenuEl.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    sidebarContextMenuEl.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
  }

  function closeSidebarContextMenu() {
    sidebarContextMenuEl.style.display = 'none';
    sidebarContextMenuWidgetId = null;
  }

  // Closes on a click anywhere else, or Escape - the two ways any other menu in this app (or in
  // Windows generally) is expected to dismiss. Listening on the window rather than only outside
  // the menu, because the menu's own buttons already act and close themselves before this would
  // matter.
  window.addEventListener('click', (e) => {
    if (sidebarContextMenuEl.style.display !== 'none' && !sidebarContextMenuEl.contains(e.target)) {
      closeSidebarContextMenu();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebarContextMenu();
  });
  // A second right-click elsewhere should move the menu, not need a first click to dismiss it.
  window.addEventListener('contextmenu', (e) => {
    if (sidebarContextMenuEl.style.display !== 'none' && !e.defaultPrevented) closeSidebarContextMenu();
  });

  // Used to call the browser's built-in text-prompt dialog here, which Electron's renderer never
  // actually implements - it silently did nothing, with no error to notice. Reported live as
  // "rename does nothing". The next fix (opening the aura's own settings page and focusing its
  // Name field there) worked, but tripped over an unrelated cross-function scope bug elsewhere in
  // this file that made EVERY selectWidget() call throw partway through, silently skipping
  // anything chained after it - Rename's focus()/select() included. Simplified 25 Aug rather than
  // re-litigating that fragility: "just amke them both popups that do not nav inside their aura,
  // it's probably easier" - a plain popup, no navigation, no dependency on the settings panel
  // having rendered correctly first.
  const renameModalBackdrop = document.getElementById('rename-widget-modal-backdrop');
  const renameWidgetInput = document.getElementById('rename-widget-input');
  const renameWidgetSaveBtn = document.getElementById('rename-widget-save-btn');
  const renameWidgetCancelBtn = document.getElementById('rename-widget-cancel-btn');
  const closeRenameWidgetModalBtn = document.getElementById('close-rename-widget-modal');
  let renameWidgetId = null;

  function openRenameModal(id) {
    const widget = findWidget(id);
    if (!widget) return;
    renameWidgetId = id;
    renameWidgetInput.value = widget.name;
    renameModalBackdrop.style.display = 'flex';
    renameWidgetInput.focus();
    renameWidgetInput.select();
  }
  function closeRenameModal() {
    renameModalBackdrop.style.display = 'none';
    renameWidgetId = null;
  }
  function saveRename() {
    if (!renameWidgetId) return;
    window.eqTracker.setWidgetName(renameWidgetId, renameWidgetInput.value.trim() || 'Aura').then(() => {
      refreshWidgets();
      closeRenameModal();
    });
  }
  renameWidgetSaveBtn.addEventListener('click', saveRename);
  renameWidgetCancelBtn.addEventListener('click', closeRenameModal);
  closeRenameWidgetModalBtn.addEventListener('click', closeRenameModal);
  renameModalBackdrop.addEventListener('click', (e) => {
    if (e.target === renameModalBackdrop) closeRenameModal();
  });
  renameWidgetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRename();
    else if (e.key === 'Escape') closeRenameModal();
  });

  sidebarContextRenameBtn.addEventListener('click', () => {
    const id = sidebarContextMenuWidgetId;
    closeSidebarContextMenu();
    if (id) openRenameModal(id);
  });

  sidebarContextDuplicateBtn.addEventListener('click', () => {
    // Reuses duplicateWidgetBtn's exact same call (see below) - a second, subtly different
    // duplicate path here would be the same kind of drift that made Rename's old window.prompt()
    // path silently different from the working one right next to it.
    const id = sidebarContextMenuWidgetId;
    closeSidebarContextMenu();
    if (!id) return;
    window.eqTracker.duplicateWidget(id).then((config) => {
      if (config) focusWidget(config.id);
    });
  });

  // Same reasoning as Rename's popup above - a plain popup, no navigation into the aura's own
  // settings page first. Reuses exportWidget/soundWarningFor exactly as handleExport() (the
  // Manage-aura-card version, defined further down) does - only where the result gets drawn
  // differs.
  const exportModalBackdrop = document.getElementById('export-widget-modal-backdrop');
  const exportWidgetModalOutput = document.getElementById('export-widget-modal-output');
  const exportWidgetModalCopyBtn = document.getElementById('export-widget-modal-copy-btn');
  const exportWidgetModalSoundWarningEl = document.getElementById('export-widget-modal-sound-warning');
  const closeExportWidgetModalBtn = document.getElementById('close-export-widget-modal');

  function openExportModal(id) {
    window.eqTracker.exportWidget(id).then((code) => {
      if (!code) return;
      exportWidgetModalOutput.value = code;
      const warning = soundWarningFor(findWidget(id));
      exportWidgetModalSoundWarningEl.textContent = warning;
      exportWidgetModalSoundWarningEl.style.display = warning ? '' : 'none';
      exportModalBackdrop.style.display = 'flex';
      exportWidgetModalOutput.select();
    });
  }
  function closeExportModal() {
    exportModalBackdrop.style.display = 'none';
  }
  closeExportWidgetModalBtn.addEventListener('click', closeExportModal);
  exportModalBackdrop.addEventListener('click', (e) => {
    if (e.target === exportModalBackdrop) closeExportModal();
  });
  exportWidgetModalCopyBtn.addEventListener('click', () => {
    exportWidgetModalOutput.select();
    navigator.clipboard?.writeText(exportWidgetModalOutput.value).catch(() => {});
    exportWidgetModalCopyBtn.textContent = 'Copied!';
    setTimeout(() => {
      exportWidgetModalCopyBtn.textContent = 'Copy';
    }, 1500);
  });

  sidebarContextExportBtn.addEventListener('click', () => {
    const id = sidebarContextMenuWidgetId;
    closeSidebarContextMenu();
    if (id) openExportModal(id);
  });

  sidebarContextResetBtn.addEventListener('click', () => {
    const id = sidebarContextMenuWidgetId;
    closeSidebarContextMenu();
    if (id) handleReset(id);
  });

  sidebarContextDeleteBtn.addEventListener('click', () => {
    const id = sidebarContextMenuWidgetId;
    closeSidebarContextMenu();
    if (id) handleDelete(id);
  });

  // What the page title above the settings panel shows in place of "Overlay Auras" while one is
  // selected - the owner's request, so the page says what KIND of aura you are looking at rather
  // than a generic section label that never changes no matter which one you have open.
  //
  // Same signature checks used everywhere else in this file that already has to tell these apart
  // (createDebuff sets buffSource:'ally' + trackOnEnemies:true; a "Custom buff aura" covers both
  // self and ally under one type, matching the single "Custom buff aura" button that creates both
  // - see the Add Aura modal) - not a new classification invented for this label alone.
  function widgetTypeLabel(widget) {
    if (widget.kind === 'self-buffs-builtin') return 'Self Buffs';
    if (widget.kind === 'ally-buffs-builtin') return 'Ally Buffs';
    if (widget.kind === 'bard-songs-builtin') return 'Bard Songs';
    if (widget.kind === 'raid-named-builtin') return 'Raid named';
    if (widget.buffSource === 'damage') return 'Damage parser';
    if (widget.buffSource === 'travel') return 'Travel guide';
    if (widget.displayMode === 'text') return 'Custom text';
    if (widget.buffSource === 'customTimer') return 'Custom timer';
    if (widget.buffSource === 'ally' && widget.trackOnEnemies) return 'Custom debuff';
    return 'Custom buff';
  }

  function deselectWidget() {
    selectedId = null;
    pageOverlayTitleEl.textContent = 'Overlay Auras';
    settingsPanel.style.display = 'none';
    filterCard.style.display = 'none';
    customTimersCardEl.style.display = 'none';
    activeBuffsCardEl.style.display = 'none';
    manageCardEl.style.display = 'none';
    trackOthersRowEl.style.display = 'none';
    selectedBuffsSectionEl.style.display = 'none';
    introCard.style.display = '';
    iconSetCard.style.display = '';
    allAurasCard.style.display = '';
  }

  // The additive settings-panel model (25 Aug rework). Reported live: "it is not a shortcut, it's
  // a custom, and needs to be recatagorised" (about Ally Buffs in the Add Aura list) led into a
  // wider conversation about the settings PANEL itself, and "wire everything in to make sure it
  // does NOT break anything" is the actual ask this answers.
  //
  // Before this, three separate places each computed their own isTextAura/announcer
  // booleans and hid fields that didn't apply to the current aura - updateDisplayModeVisibility
  // (now gone), a few lines inline in selectWidget (buffSourceRow/debuffCastByRow, also gone), and
  // half of renderBuffFilter. That's SUBTRACTIVE: build the whole buff-aura panel, then hide what
  // doesn't apply - which is exactly the shape of bug CLAUDE.md already documents twice (the old
  // "Extra conditions" section buried where nobody would look; Damage parser/Travel guide still
  // showing a "Buffs shown" picker and a "Watching:" row that mean nothing for either, flagged
  // there as still-open work). Every new aura type meant re-auditing every existing hide-check.
  //
  // This is ADDITIVE instead: each aura SHAPE (widgetShape() below) lists exactly which optional
  // rows/cards it gets (SHAPE_FIELDS), computed ONCE per render (applySettingsPanelShape), and
  // renderBuffFilter reads the same Set rather than re-deriving a second copy that could drift out
  // of sync - which is literally what happened before: ally-grouping visibility had to be set
  // AFTER updateDisplayModeVisibility ran or a later call would silently put it back, because the
  // two functions never shared their computation.
  //
  // Two accidental leaks from the old code are fixed here rather than carried forward: Damage
  // parser and Travel guide no longer get the buff-source "Watching:" row or the buff-picker
  // "Buffs shown" card - nobody had decided to show either on purpose, there simply was no branch
  // that said otherwise. Confirmed by testing every hide/show outcome for every existing shape
  // against what selectWidget already did before this rework - see the mutation-tested table below.
  function widgetShape(widget) {
    if (widget.kind === 'self-buffs-builtin') return 'self-buffs';
    if (widget.kind === 'ally-buffs-builtin') return 'ally-buffs';
    if (widget.kind === 'bard-songs-builtin') return 'bard-songs';
    if (widget.kind === 'raid-named-builtin') return 'raid-named';
    if (widget.buffSource === 'damage') return 'damage';
    if (widget.buffSource === 'travel') return 'travel';
    if (widget.displayMode === 'text') {
      if (widget.allyDebuffAlert) return 'ally-alert';
      return widget.buffSource === 'customTimer' ? 'text-customTimer' : 'text';
    }
    if (widget.buffSource === 'customTimer') return 'custom-timer';
    if (widget.trackOnEnemies) return 'custom-debuff';
    return 'custom-buff';
  }

  const SHAPE_FIELDS = {
    'self-buffs': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'track-others', 'self-buffs-filter'],
    'ally-buffs': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'self-buffs-filter', 'ally-grouping'],
    // Backlog #15. Deliberately no 'self-buffs-filter' (no buff picker, no hide-bard-songs/
    // max-duration controls - this aura's whole content already is bard songs, unconditionally)
    // and no 'track-others' (that toggle is global engine state, not per-widget, and already has a
    // home on Self Buffs' own panel) - see widgetStore.js's defaultBardSongsWidget for the same
    // reasoning on the data side.
    'bard-songs': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'ally-grouping'],
    // Backlog #33. No picker or source (content is the current zone's named list), no 'sort' (the
    // board is fixed boss-then-mini order, like the travel route), no 'merge'/'borders' (no
    // duration, no spell category). Just how it looks and where it sits, plus the list sizing
    // controls that matter for a checklist ('list-format', same as travel).
    'raid-named': ['list-format', 'timer-text', 'opacity', 'position', 'alerts'],
    'custom-buff': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'buff-source', 'buff-picker', 'ally-grouping'],
    'custom-debuff': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'debuff-cast-by', 'buff-picker', 'ally-grouping'],
    'ally-alert': ['text-fields', 'text-instant', 'text-stack', 'ally-alert-toggle', 'always-on', 'opacity', 'position', 'alerts', 'buff-picker'],
    'text': ['text-fields', 'text-instant', 'text-stack', 'ally-alert-toggle', 'always-on', 'opacity', 'position', 'alerts', 'buff-source', 'buff-source-timer-label', 'buff-picker'],
    'text-customTimer': ['text-fields', 'text-stack', 'ally-alert-toggle', 'always-on', 'opacity', 'position', 'alerts', 'buff-source', 'buff-source-timer-label', 'custom-timers'],
    'custom-timer': ['display-choice', 'sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'custom-timers'],
    'damage': ['sort', 'merge', 'borders', 'timer-text', 'opacity', 'position', 'alerts', 'damage-settings'],
    // No 'sort' - the legs are fixed walking order and widgetStore.createTravelGuide hardcodes
    // sortOrder:'default' for exactly that reason; offering "Alphabetical"/"Time remaining" here
    // would let someone scramble their own directions. No 'merge' either - every leg carries the
    // same infinite/no-duration shape, so "merge buffs sharing a duration" would collapse the
    // whole route into one tile showing only the soonest, which for a route is all of them. No
    // 'borders' - a route leg has no spell category to colour. 'list-format' (not tied to
    // 'display-choice', since a travel aura never offers icon mode at all) gives the two controls
    // that actually shape how a multi-line route reads: list width and row size.
    'travel': ['list-format', 'timer-text', 'opacity', 'position', 'alerts', 'travel-settings'],
  };

  // Applies one shape's field set to every optional row/card, and returns the Set so
  // renderBuffFilter (and the two radio-change listeners below it) make their own content
  // decisions from the exact same computation instead of a second copy that could disagree.
  function applySettingsPanelShape(widget) {
    const shape = widgetShape(widget);
    const fields = new Set(SHAPE_FIELDS[shape] || []);
    const has = (key) => fields.has(key);

    // Reported directly: "on text auras, this text is ambiguous, it should be 'play a sound when
    // text appears' because it's not always a buff trigger" - a text aura's "landing"/"expiry" can
    // be a custom timer event, a resist flash, anything, not necessarily a buff. Every other shape
    // keeps the original buff-worded default from the markup untouched.
    const alertWording = has('text-fields')
      ? {
          glow: [' Glow when text appears', 'Flashes the tile briefly the moment this text appears.'],
          land: [' Play a sound when text appears', 'Plays a sound the moment this text appears.'],
          expire: [' Play a sound when text disappears', 'Plays a sound the moment this text disappears.'],
          warn: [' Warn me before text disappears', 'Plays a sound a set time before this text disappears.'],
        }
      : {
          glow: [' Glow when a buff lands', 'Flashes the tile briefly when the buff is first applied.'],
          land: [' Play a sound when a buff lands', 'Plays a sound the moment the buff is applied.'],
          expire: [' Play a sound when a buff expires', 'Plays a sound the moment the buff runs out.'],
          warn: [
            ' Warn me before a buff expires',
            'Plays a sound a set time before the buff runs out, while there is still time to recast.',
          ],
        };
    [
      [landingGlowLabelEl, alertWording.glow],
      [soundLandLabelEl, alertWording.land],
      [soundExpireLabelEl, alertWording.expire],
      [soundWarningLabelEl, alertWording.warn],
    ].forEach(([label, [text, title]]) => {
      label.lastChild.textContent = text;
      label.title = title;
    });

    textMessageRowEl.style.display = has('text-fields') ? '' : 'none';
    textAuraSizeRowEl.style.display = has('text-fields') ? '' : 'none';
    textJustifyRowEl.style.display = has('text-fields') ? '' : 'none';
    textHintEl.style.display = has('text-fields') ? '' : 'none';
    // "Show events for" only ever matters for an INSTANT buff (a nuke/heal with no real duration)
    // on a self/ally-sourced text aura - customTimerEngine's output carries no `instant` flag at
    // all, so this filter always lets a custom-timer buff straight through regardless of what the
    // slider says. Reported live 24 Aug: "custom text timers have two settings for duration...
    // there should never be two sources for this to ease confusion" - there was never really a
    // second source, this slider was just dead weight sitting next to the one that actually does
    // something (each trigger's own duration, in the Custom timers list below).
    // Also hidden once "Always on screen, with nothing to wait for" is on: that setting's own
    // label is a direct contradiction of a still-active "how long to show the event after it
    // fires" slider sitting right above it. text-customTimer already has no 'text-instant' field
    // at all for the same underlying reason (see its own comment above) - this is 'text'/
    // 'ally-alert' catching up to the same rule for the one case they didn't already cover.
    const showsTextInstant = has('text-instant') && !widget.alwaysOn;
    textInstantRowEl.style.display = showsTextInstant ? '' : 'none';
    textInstantHintEl.style.display = showsTextInstant ? '' : 'none';
    // The "Lines visible" slider is an expanding sub-option: only shown once "Stack multiple
    // lines" is actually on. Hidden entirely on "Always on screen" for the same reason
    // "Show events for" is - there is no incoming event to stack.
    const showsTextStack = has('text-stack') && !widget.alwaysOn;
    textStackRowEl.style.display = showsTextStack ? '' : 'none';
    textStackMaxRowEl.style.display = showsTextStack && widget.stackTextLines ? '' : 'none';
    // Her wording: "a toggle under text only custom creation". It belongs to this aura type and
    // nowhere else - the warning has no duration, so there is nothing for a tile aura to draw.
    allyAlertRowEl.style.display = has('ally-alert-toggle') ? '' : 'none';
    allyAlertHintEl.style.display = has('ally-alert-toggle') ? '' : 'none';
    // An aura with nothing to wait for only makes sense where there is something to say without
    // an event behind it, which is the text mode and nothing else.
    alwaysOnRowEl.style.display = has('always-on') ? '' : 'none';
    alwaysOnHintEl.style.display = has('always-on') ? '' : 'none';
    // Text is a TYPE now, chosen once in the add-aura flow beside Custom buff aura and Custom
    // timer aura - so it does not offer Display style at all.
    displayModeRowEl.style.display = has('display-choice') ? '' : 'none';
    buffSourceTimerLabelEl.style.display = has('buff-source-timer-label') ? '' : 'none';
    // Icon vs list is a real choice WITHIN a shape that offers Display style at all - not a shape
    // of its own - so it's gated on 'display-choice' being present, then split by the widget's own
    // current mode. A shape that excludes 'display-choice' entirely (text, sound, and their
    // customTimer siblings) therefore shows neither group with no extra re-hide needed - the old
    // code needed a manual re-hide patch (a bare isTextAura check re-forcing them back to 'none')
    // for exactly this, because its per-mode groups defaulted to shown and had to be subtracted
    // back out for text.
    const showsIconOnly = has('display-choice') && widget.displayMode === 'icons';
    const listModeWithChoice = has('display-choice') && widget.displayMode !== 'icons';
    // 'list-format' is for a shape that is list-mode ALWAYS and never offers the icon/list choice
    // at all (Travel guide) - it still wants the list-width/row-size sizing controls, just not the
    // "show icon on each row"/"mirror direction" pair, which mean nothing for a row with no icon.
    const showsListOnly = listModeWithChoice || has('list-format');
    iconOnlySettings.style.display = showsIconOnly ? '' : 'none';
    iconPositionSettings.style.display = showsIconOnly ? '' : 'none';
    iconLabelSectionEl.style.display = showsIconOnly ? '' : 'none';
    displayIconOnlySettings.style.display = showsIconOnly ? '' : 'none';
    // Icon tiles only, and only once "Colour each tile's edge by spell type" is actually on -
    // offering a width for an edge that isn't drawn would be a control that does nothing.
    borderWidthRowEl.style.display = showsIconOnly && widget.categoryBordersEnabled !== false ? '' : 'none';
    listOnlySettings.style.display = showsListOnly ? '' : 'none';
    displayListOnlySettings.style.display = listModeWithChoice ? '' : 'none';
    // Reported live 24 Aug, overriding the earlier reasoning: "text aura's do not need a sort by
    // toggle, they are one and done only." Sort order still exists and is still read internally
    // (it decides which one wins on the rare occasion more than one of the things a text aura
    // watches is active at once - see overlay.js's visibleBuffs) - only the control is hidden, at
    // whatever value the aura already has (the default, cast order, unless changed before this).
    sortOrderRowEl.style.display = has('sort') ? '' : 'none';
    // Merging is about how tiles are drawn. A text aura draws exactly one tile whatever happens,
    // so there is never anything to merge.
    mergeRowEl.style.display = has('merge') ? '' : 'none';
    mergeHintEl.style.display = has('merge') ? '' : 'none';
    // A sound aura draws no tile to put an edge on. A text aura draws one, but it is a plate of
    // words rather than a spell tile, and giving it a spell-type edge would be the first thing on
    // screen the mode promised never to draw.
    bordersRowEl.style.display = has('borders') ? '' : 'none';
    bordersHintEl.style.display = has('borders') ? '' : 'none';
    // The countdown's own styling, which a text aura has no countdown for.
    timerTextTopicEl.style.display = has('timer-text') ? '' : 'none';
    opacityRowEl.style.display = has('opacity') ? '' : 'none';
    positionRowEl.style.display = has('position') ? '' : 'none';
    positionHintEl.style.display = has('position') ? '' : 'none';
    alertsTopicEl.style.display = has('alerts') ? '' : 'none';

    // Self-vs-ally is a togglable choice on a self/ally custom widget, but a "custom timer widget"
    // fixes its source at creation time and never offers this toggle - same reasoning as the two
    // builtin kinds having a fixed, implied source. An announcer type keeps its source row even
    // once it is on text triggers, because that is the one choice it is allowed to change its mind
    // about. allyDebuffAlert and trackOnEnemies are each an exception even among announcers - see
    // widgetShape()'s own comment history in git blame for the full reasoning kept from the old
    // inline block this replaced - buffSource:'ally' on either is plumbing, not a real choice.
    buffSourceRow.style.display = has('buff-source') ? '' : 'none';
    // Note 40. A different "Watching:" choice from the one above - not WHO the aura's own source is
    // (that stays fixed plumbing on a debuff aura), but whether a watched debuff needs evidence the
    // player cast it herself, or lands the moment its third-person text appears regardless of
    // caster. Only a Custom debuff aura has this, since it's the only kind trackOnEnemies is ever
    // true on.
    debuffCastByRowEl.style.display = has('debuff-cast-by') ? '' : 'none';
    // The "Watching" topic (inside Configuration) wraps the two rows above - hideEmptyPanelTopics
    // adds .topic-empty to it when neither applies, so it never shows an empty collapsed header.
    // Custom timers are a wholly separate concept from buff-picking (own card, own heading) - not
    // a "buffs shown" filter mode at all, since there's no shared pool to pick from.
    customTimersCardEl.style.display = has('custom-timers') ? '' : 'none';
    // Note 19. Nothing in this group means anything to an aura that is not a damage meter, and a
    // fight timeout on a buff aura would be a live control that changes nothing.
    damageSettingsEl.style.display = has('damage-settings') ? '' : 'none';
    travelSettingsEl.style.display = has('travel-settings') ? '' : 'none';
    // Grouping is per-person, so it needs tiles that actually carry a person - shown for the Ally
    // Buffs builtin and any custom aura set to the ally source, hidden everywhere else rather than
    // offering a setting that could never do anything. A text aura draws no per-person tiles at
    // all, hence excluded from every text shape above.
    allyGroupingSettingsEl.style.display = has('ally-grouping') ? '' : 'none';
    // Only self-buffs-builtin, not ally - "track buffs cast on me by others" is about buffs
    // landing on the player, unrelated to the Ally Buffs widget's own concern (buffs the player
    // casts on others).
    trackOthersRowEl.style.display = has('track-others') ? '' : 'none';

    // Workstream B - after every individual row's display is set, collapse away any Display & size
    // topic that ended up with nothing in it for this shape.
    hideEmptyPanelTopics();

    return fields;
  }

  // The label's own size/position controls stay hidden until "Show label"
  // is actually checked - no point showing options for a feature that's
  // currently off.
  function updateIconLabelOptionsVisibility() {
    iconLabelOptionsEl.style.display = showIconLabelCheckbox.checked ? '' : 'none';
  }

  function selectWidget(id) {
    // A picker left open while switching to a different aura would go on editing the wrong one.
    closeBuffPickerModal();
    selectedId = id;
    const widget = findWidget(id);
    if (!widget) {
      pageOverlayTitleEl.textContent = 'Overlay Auras';
      settingsPanel.style.display = 'none';
      filterCard.style.display = 'none';
      customTimersCardEl.style.display = 'none';
      activeBuffsCardEl.style.display = 'none';
      manageCardEl.style.display = 'none';
      trackOthersRowEl.style.display = 'none';
      selectedBuffsSectionEl.style.display = 'none';
      return;
    }
    introCard.style.display = 'none';
    iconSetCard.style.display = 'none';
    allAurasCard.style.display = 'none';
    settingsPanel.style.display = '';
    pageOverlayTitleEl.textContent = widgetTypeLabel(widget);
    exportCodeRow.style.display = 'none';
    exportSoundWarningEl.style.display = 'none';
    exportCodeOutput.value = '';
    // Not the aura's name - the row above it (the name input) already says that, and repeating
    // it here was the second thing on screen with the same information a click apart.
    settingsTitle.textContent = 'Settings';
    nameInput.value = widget.name;
    // buffSourceRow/debuffCastByRowEl visibility now comes from applySettingsPanelShape() below,
    // via widgetShape()/SHAPE_FIELDS - see that function's own comment for the full reasoning on
    // when each is shown (announcer vs plumbing-only ally source, debuff-cast-by only ever
    // meaning anything on a Custom debuff aura).
    debuffCastByRadios.forEach((r) => (r.checked = r.value === (widget.debuffCastBy || 'self')));
    buffSourceRadios.forEach((r) => (r.checked = r.value === (widget.buffSource || 'self')));
    displayModeRadios.forEach((r) => (r.checked = r.value === widget.displayMode));
    timerFormatRadios.forEach((r) => (r.checked = r.value === widget.timerFormat));
    sortOrderRadios.forEach((r) => (r.checked = r.value === (widget.sortOrder || 'default')));
    textSizeSlider.value = widget.textSize;
    textSizeValueEl.textContent = `${widget.textSize}px`;
    iconSizeSlider.value = widget.iconSize;
    iconSizeValueEl.textContent = `${widget.iconSize}px`;
    iconsPerRowSlider.value = widget.iconsPerRow;
    iconsPerRowValueEl.textContent = String(widget.iconsPerRow);
    rowSizeSlider.value = widget.rowSize;
    rowSizeValueEl.textContent = `${widget.rowSize}px`;
    listWidthSlider.value = widget.listWidth;
    listWidthValueEl.textContent = `${widget.listWidth}px`;
    showRowIconCheckbox.checked = !!widget.showRowIcon;
    mirrorRowCheckbox.checked = !!widget.mirrorRowDirection;
    iconJustifyRadios.forEach((r) => (r.checked = r.value === (widget.iconJustify || 'left')));
    opacitySlider.value = widget.opacity;
    const lowThreshold = typeof widget.lowTimeThresholdSec === 'number' ? widget.lowTimeThresholdSec : 30;
    lowThresholdSlider.value = lowThreshold;
    lowThresholdValueEl.textContent = lowThreshold === 0 ? 'off' : `${lowThreshold}s`;
    landingGlowCheckbox.checked = widget.landingGlowEnabled !== false;
    mergeCheckbox.checked = !!widget.mergeSameDuration;
    categoryBordersCheckbox.checked = widget.categoryBordersEnabled !== false;
    const borderWidth = typeof widget.categoryBorderWidthPx === 'number' ? widget.categoryBorderWidthPx : 1;
    borderWidthSlider.value = String(borderWidth);
    borderWidthValueEl.textContent = `${borderWidth}px`;
    const fightTimeout = typeof widget.fightTimeoutSec === 'number' ? widget.fightTimeoutSec : 10;
    fightTimeoutSlider.value = String(fightTimeout);
    fightTimeoutValueEl.textContent = `${fightTimeout}s`;
    mineOnlyCheckbox.checked = !!widget.mineOnly;
    // Defaulted ON, so the check is against false rather than for true - an aura saved before this
    // setting existed has no value at all, and treating that as "off" would silently remove the
    // total line from a meter that has always shown one.
    totalRowCheckbox.checked = widget.showTotalRow !== false;
    allyAlertCheckbox.checked = !!widget.allyDebuffAlert;
    alwaysOnCheckbox.checked = !!widget.alwaysOn;
    // Reported live 24 Aug, and confirmed by directly comparing what was on screen against what
    // was actually saved: a later edit ("...was resisted by mob") never reached the file, and the
    // file instead still held an EARLIER one (".../resisted :(") - not lost on save, lost on the
    // NEXT re-render. This whole panel is rebuilt from scratch by selectWidget, and that runs on
    // more than just "you clicked a different aura" - right-clicking this SAME aura's own move
    // box on the overlay (onOpenWidgetSettings, note 6) calls it again on the widget already open.
    // Every other field here is a fresh idempotent snapshot each time, so a stray extra call to
    // this function was invisible - except this ONE field, which the debounced save (see the
    // 'input' listener below) had not necessarily finished writing back yet, so a re-render mid-
    // debounce stamped the box with the older, still-current-as-far-as-the-store-knew value right
    // over whatever was actively being typed. Skipped while the box has focus - if you're in it,
    // what you typed wins over what selectWidget thinks is there, full stop.
    if (document.activeElement !== textMessageInput) textMessageInput.value = widget.textAuraMessage || '';
    renderTextMessagePreview();
    const textAuraSize = widget.textAuraSize || 32;
    textAuraSizeSlider.value = String(textAuraSize);
    textAuraSizeValueEl.textContent = `${textAuraSize}px`;
    textJustifyRadios.forEach((r) => (r.checked = r.value === (widget.textJustify || 'left')));
    const instantSec = widget.textAuraInstantSec || 6;
    textInstantSlider.value = String(instantSec);
    textInstantValueEl.textContent = `${instantSec}s`;
    textStackCheckbox.checked = !!widget.stackTextLines;
    const maxStackLines = widget.maxStackTextLines || 2;
    textStackMaxSlider.value = String(maxStackLines);
    textStackMaxValueEl.textContent = String(maxStackLines);
    soundLandCheckbox.checked = !!widget.soundOnLand;
    soundExpireCheckbox.checked = !!widget.soundOnExpire;
    const warningSec = widget.soundWarningSec || 0;
    soundWarningSlider.value = warningSec;
    soundWarningValueEl.textContent = warningSec === 0 ? 'off' : `${warningSec}s`;
    const warningLoopSec = widget.soundWarningLoopSec || 0;
    soundWarningLoopSlider.value = warningLoopSec;
    soundWarningLoopValueEl.textContent = warningLoopSec === 0 ? 'off' : `${warningLoopSec}s`;
    syncSoundDisclosure();
    // The volume slider was the one control in this panel never populated from the widget, so it
    // always showed the markup default rather than the aura's saved value. And because the input
    // carried no `value` attribute at all, an HTML range falls back to the midpoint of its own
    // range - 50 on a 0-100 track - so the handle sat halfway along while the sound played at
    // the real default of 100%. That is the whole of the reported "slider starts in the middle
    // but it's 100%": not a scale problem, a control that never loaded its value.
    const alertVolume = typeof widget.alertVolume === 'number' ? widget.alertVolume : 100;
    alertVolumeSlider.value = alertVolume;
    alertVolumeValueEl.textContent = `${alertVolume}%`;
    const soundCooldown = typeof widget.soundCooldownSec === 'number' ? widget.soundCooldownSec : 0;
    if (soundCooldownSlider) {
      soundCooldownSlider.value = soundCooldown;
      soundCooldownValueEl.textContent = soundCooldown ? `${soundCooldown}s` : 'off';
    }
    renderLandSoundPicker(widget.landSoundId);
    renderExpireSoundPicker(widget.expireSoundId);
    renderWarningSoundPicker(widget.warningSoundId);
    anchorButtons.forEach((b) => b.classList.toggle('active', b.dataset.anchor === (widget.contentAnchor || 'bottom-center')));
    wrapTextCheckbox.checked = !!widget.wrapText;
    showIconLabelCheckbox.checked = !!widget.showIconLabel;
    groupAllyCheckbox.checked = !!widget.groupAllyBuffs;
    allyDirectionRadios.forEach((r) => (r.checked = r.value === (widget.groupAllyDirection || 'vertical')));
    hideAllyNameCheckbox.checked = !!widget.hideAllyNameOnTile;
    allyDirectionRow.style.display = widget.groupAllyBuffs ? '' : 'none';
    timerTextColorPicker.value = widget.timerTextColor || '#f0f1f5';
    labelTextColorPicker.value = widget.labelTextColor || '#f0f1f5';
    const iconMargin = typeof widget.iconMarginPx === 'number' ? widget.iconMarginPx : 5;
    marginWidthSlider.value = iconMargin;
    marginWidthValueEl.textContent = iconMargin + 'px';
    const labelSize = typeof widget.iconLabelSize === 'number' ? widget.iconLabelSize : 11;
    iconLabelSizeSlider.value = labelSize;
    iconLabelSizeValueEl.textContent = `${labelSize}px`;
    iconLabelAnchorButtons.forEach((b) =>
      b.classList.toggle('active', b.dataset.anchor === (widget.iconLabelAnchor || 'top-center'))
    );
    updateIconLabelOptionsVisibility();
    const shapeFields = applySettingsPanelShape(widget);
    deleteBtn.style.display = widget.deletable ? '' : 'none';
    duplicateWidgetBtn.style.display = widget.kind === 'self-buffs-builtin' ? 'none' : '';

    window.eqTracker.isWidgetLocked(id).then((locked) => {
      lockBtn.textContent = locked ? 'Unlock to move' : 'Lock aura';
      lockBtn.classList.toggle('unlocked', !locked);
    });

    renderBuffFilter(widget, shapeFields);
    renderActiveBuffsForWidget(widget);
    renderWidgetProfilesChecklist(widget);
    renderWidgetZones(widget);
  }

  // One line under the gem row for the one thing that can be refused. Cleared on the next
  // successful change, so it never lingers as a complaint about something already fixed.
  function setBuffFilterNotice(text) {
    const el = document.getElementById('widget-buff-filter-notice');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
  }

  // `fields` is applySettingsPanelShape(widget)'s return value - the same computation that already
  // set customTimersCardEl/allyGroupingSettingsEl/damageSettingsEl/travelSettingsEl/
  // trackOthersRowEl/filterCard's siblings, so this function only ever POPULATES content
  // (title/hint text, the custom-timer list, the damage/travel readouts, the self-buffs sliders)
  // for whichever of those cards ended up visible - it never has to re-derive or disagree with the
  // visibility decision. That shared computation is what closed the old ordering bug: ally-grouping
  // used to have to be set AFTER updateDisplayModeVisibility ran, in THIS function, specifically
  // because the two functions never shared one answer - now there's only one answer, computed once.
  function renderBuffFilter(widget, fields) {
    if (fields.has('travel-settings')) {
      showTravelDestination(widget.travelDestination);
      showTravelPickerCommand();
    }

    if (fields.has('custom-timers')) {
      resetTimerForm();
      renderCustomTimersList(widget);
      const seconds = typeof widget.triggerDurationSec === 'number' ? widget.triggerDurationSec : 5;
      triggerDurationSlider.value = seconds;
      triggerDurationValueEl.textContent = `${seconds}s`;
      // Only means anything in AND mode - Independent/OR have no "still counts as true" window at
      // all, so the row stays hidden rather than offering a number that does nothing for them.
      const isAnd = widget.triggerCombineMode === 'and';
      andWindowRowEl.style.display = isAnd ? '' : 'none';
      andWindowHintEl.style.display = isAnd ? '' : 'none';
      const andWindowSec = typeof widget.andWindowSec === 'number' ? widget.andWindowSec : 30;
      andWindowSlider.value = andWindowSec;
      andWindowValueEl.textContent = `${andWindowSec}s`;
      reverseDetectionCheckbox.checked = !!widget.reverseDetection;
    }

    if (fields.has('track-others')) {
      window.eqTracker.getTrackOthersEnabled().then((enabled) => {
        trackOthersCheckbox.checked = enabled;
      });
    }

    filterCard.style.display = fields.has('self-buffs-filter') || fields.has('buff-picker') ? '' : 'none';

    if (fields.has('self-buffs-filter')) {
      // Neither builtin can ever be a text aura, but the title element is shared across every
      // widget's panel - without resetting it here, switching here straight from a text aura would
      // leave last widget's "Triggers" heading showing on a plain icon/list one.
      filterTitleEl.textContent = 'Buffs shown';
      filterHint.textContent =
        widget.kind === 'ally-buffs-builtin'
          ? 'This aura shows every buff you\'ve cast on a current group member, marked "Overlay" ' +
            'the same way self buffs are - uncheck "Overlay" for a buff on the Known Buffs page to ' +
            'hide it here too.'
          : 'This aura shows every buff marked "Overlay" on the Known Buffs page. To hide a ' +
            'specific buff from it, uncheck "Overlay" for that buff there instead.';
      filterSearch.style.display = 'none';
      filterListEl.innerHTML = '';
      selectedBuffsSectionEl.style.display = 'none';
      selfBuffsFiltersEl.style.display = '';
      const maxDurationMin = Math.round((widget.maxDurationFilterSec || 0) / 60);
      maxDurationSlider.value = maxDurationMin;
      maxDurationValueEl.textContent = maxDurationMin === 0 ? 'off' : `${maxDurationMin}m`;
      return;
    }
    if (!fields.has('buff-picker')) {
      // No pool of spells to pick from at all for this shape (custom timer, damage, travel) -
      // hidden entirely rather than shown empty. filterCard itself is already 'none' above.
      selectedBuffsSectionEl.style.display = 'none';
      return;
    }
    // "Buffs shown" describes an icon/list aura's whole reason to exist - a grid of the things
    // it's tracking. A text aura shows none of that: it draws one line of words when ONE of the
    // picked spells fires, so "shown" is the wrong verb entirely. Reported live as part of the
    // text-aura settings panel being "built on top of icon aura creation" - this is one concrete
    // piece of that: the heading (here and on the picker modal it opens) now says what a text
    // aura's picked list actually is - what fires it, not what it displays. Renamed from "Buff to
    // trigger" to plain "Triggers" 25 Aug, reported live as clearer.
    const filterTitle = widget.displayMode === 'text' ? 'Triggers' : 'Buffs shown';
    filterTitleEl.textContent = filterTitle;
    buffPickerModalTitleEl.textContent = filterTitle;
    // allyDebuffAlert and trackOnEnemies each get their own wording, for the same reason: neither
    // is really "buffs shown on this aura." An alert aura watches somebody ELSE's cast; a debuff
    // aura watches something the owner cast AT a target, not a buff at all.
    filterHint.textContent = widget.allyDebuffAlert
      ? 'Pick which spells to warn about when someone else casts them.'
      : widget.trackOnEnemies
        ? 'Pick which known debuffs this aura tracks on the things you cast them at.'
        : 'Pick which known buffs should show on this aura.';
    filterSearch.style.display = '';
    selfBuffsFiltersEl.style.display = 'none';
    renderSelectedBuffsList(widget);
    applyBuffFilterSearch();
  }

  // Always shows every currently-picked buff for this widget, regardless of
  // the search box below - with thousands of known buffs, a checked one can
  // easily scroll off past the search-capped list (KNOWN_BUFF_RENDER_CAP)
  // or never appear at all unless searched for by its exact name, making it
  // effectively impossible to find and uncheck otherwise.
  // Note 27's second half. What this aura watches, as a row of spell icons rather than a list of
  // ticked names - "the gem slot look will be better than a raw list", and it is: eight ticked
  // rows is a wall of text, eight icons is something you read at a glance.
  //
  // NOTHING ABOUT THE STORED DATA CHANGES. The note's Risk warned that turning buffNames into
  // ordered slots with icons, without a migration, would empty every aura anyone had set up. That
  // turned out to be avoidable rather than worth risking: the slot order IS the array order, and
  // the icon belongs to the spell rather than to the slot, so buffNames stays the flat array of
  // names it has always been and the gems are purely how it is drawn. No migration, nothing to
  // convert, and a share code from before this still imports.
  function renderSelectedBuffsList(widget) {
    const names = widget.buffNames || [];
    // The section stays up even when empty, unlike the old list - the "+" slot is how you add the
    // first spell, so hiding the row until something is in it hid the only way in.
    selectedBuffsSectionEl.style.display = '';
    selectedBuffsListEl.innerHTML = '';

    for (const name of names) {
      selectedBuffsListEl.appendChild(buildGemSlot(widget, name));
    }

    // The "+" slot. Note 27 asks for it by name, and it is what makes the row self-explanatory:
    // an empty picker with a plus in it reads as "put something here" without a caption.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gem-slot gem-add';
    add.title = 'Add a spell to this aura';
    add.textContent = '+';
    add.addEventListener('click', () => openBuffPickerModal(''));
    selectedBuffsListEl.appendChild(add);
  }

  function buildGemSlot(widget, name) {
    const known = allKnownBuffs.find((b) => b.name === name);
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'gem-slot';
    // The name in a tooltip rather than under the icon. EQ icons are not distinctive enough to
    // identify a spell from alone, and a caption under each one turns the row back into the list
    // this replaced.
    slot.title = `${name} - click to edit`;
    if (known && known.iconUrl) {
      const img = document.createElement('img');
      img.src = known.iconUrl;
      img.alt = '';
      slot.appendChild(img);
    } else {
      // A spell with no icon still needs to be removable, so it gets its initial rather than an
      // empty square that looks like a rendering fault.
      const initial = document.createElement('span');
      initial.className = 'gem-initial';
      initial.textContent = name.charAt(0).toUpperCase();
      slot.appendChild(initial);
    }
    // Opens the picker with this spell searched up, rather than removing it outright. Removal
    // still happens - by unchecking it in the picker, same as any other spell - but a single
    // click can no longer delete a pick with no way back. See the modal note above.
    slot.addEventListener('click', () => openBuffPickerModal(name));
    return slot;
  }

  function openBuffPickerModal(searchTerm) {
    if (!buffPickerModalBackdrop) return;
    filterSearch.value = searchTerm;
    applyBuffFilterSearch();
    buffPickerModalBackdrop.style.display = 'flex';
    filterSearch.focus();
    filterSearch.select();
  }

  function closeBuffPickerModal() {
    if (buffPickerModalBackdrop) buffPickerModalBackdrop.style.display = 'none';
  }

  if (closeBuffPickerModalBtn) closeBuffPickerModalBtn.addEventListener('click', closeBuffPickerModal);
  if (buffPickerModalBackdrop) {
    buffPickerModalBackdrop.addEventListener('click', (e) => {
      if (e.target === buffPickerModalBackdrop) closeBuffPickerModal();
    });
  }

  trackOthersCheckbox.addEventListener('change', () => {
    window.eqTracker.setTrackOthersEnabled(trackOthersCheckbox.checked);
  });

  // Leaves edit mode and clears the add-timer form - called whenever the
  // selected widget changes, so switching widgets never leaves a half-
  // filled-in edit from a different widget's timer lying around.
  // Only meaningful for the "tell" channel - there's no such thing as a
  // self-sent tell you'd trigger off of, so "Yourself" is disabled and
  // forced over to "Specific person" whenever tell is selected.
  function updateTimerChannelVisibility() {
    const isTell = newTimerChannelSelect.value === 'tell';
    const selfRadio = [...newTimerWhoRadios].find((r) => r.value === 'self');
    const nameRadio = [...newTimerWhoRadios].find((r) => r.value === 'name');
    selfRadio.disabled = isTell;
    if (isTell && selfRadio.checked) nameRadio.checked = true;
    updateTimerWhoVisibility();
  }

  function updateTimerWhoVisibility() {
    const whoValue = [...newTimerWhoRadios].find((r) => r.checked)?.value || 'self';
    newTimerWhoNameInput.style.display = whoValue === 'name' ? '' : 'none';
  }

  function updateTimerModeVisibility() {
    const mode = [...newTimerModeRadios].find((r) => r.checked)?.value || 'chat';
    for (const type of TRIGGER_TYPES) {
      if (!type.fieldsId) continue;
      const el = document.getElementById(type.fieldsId);
      if (el) el.style.display = type.value === mode ? '' : 'none';
    }
  }

  function resetTimerForm() {
    editingTimerId = null;
    newTimerIconId = undefined;
    newTimerNameInput.value = '';
    newTimerCooldownInput.value = '';
    setTimerCooldownOpen(false);
    newTimerMatchRadios.forEach((r) => (r.checked = r.value === 'exact'));
    newTimerTriggerInput.value = '';
    newTimerEndedInput.value = '';
    setSkillTrigger('');
    newTimerZoneSelect.value = '';
    newTimerZoneDirectionRadios.forEach((r) => (r.checked = r.value === 'enter'));
    newTimerModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
    newTimerChannelSelect.value = 'say';
    newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
    newTimerWhoNameInput.value = '';
    newTimerChatMessageInput.value = '';
    newTimerChatEndedMessageInput.value = '';
    updateTimerChannelVisibility();
    updateTimerModeVisibility();
    newTimerAddBtn.textContent = 'Add trigger';
    newTimerSaveAsNewBtn.style.display = 'none';
    setTimerIconPreview(null);
    newTimerIconPicker.style.display = 'none';
    newTimerIconPicker.innerHTML = '';
  }

  // Loads an existing timer's values into the form. Split out of the list's
  // Edit button so adding and editing go through the same modal with the same
  // fields visible - the old flow had the form sitting inline on the page and
  // Edit reaching across to populate it, which is what made "add" and "edit"
  // feel like two different screens.
  function populateTimerForm(timer, iconUrl) {
    editingTimerId = timer.id;
    newTimerNameInput.value = timer.name;
    // Duration is not part of this form any more - it lives on the aura itself, one number
    // shared by every trigger (see widget-trigger-duration-slider). timer.durationSec always
    // already matches it (setTriggerDurationSec keeps every trigger in sync), so there is
    // nothing here to restore.
    // Blank, not "0", when there is no cooldown - a zero in the box reads as a cooldown of no
    // length rather than as no cooldown at all.
    newTimerCooldownInput.value = timer.cooldownSec ? String(timer.cooldownSec) : '';
    // Open it if this timer actually uses one, so editing does not hide the setting behind a
    // closed section the person cannot see they have already set.
    setTimerCooldownOpen(!!timer.cooldownSec);
    newTimerMatchRadios.forEach((r) => (r.checked = r.value === (timer.triggerMatch === 'contains' ? 'contains' : 'exact')));
    // Restores whichever mode this timer was actually built in - triggerChat only exists on a
    // timer set up via the chat-message builder, triggerMatch:'castOf' only on one built from a
    // picked spell (the cooldown premade, or this form's own Skill cast mode); anything else
    // (including every timer that predates either feature) only ever had a raw triggerText/
    // endedText, so it lands back in raw mode with the exact line it already has, unchanged.
    //
    // This matters beyond cosmetics: updateCustomTimer fully recomputes triggerMatch from
    // whatever mode the form claims to be in (see its own comment - fixed 24 Aug after a real
    // stuck-mode bug), so misreading a castOf timer as "raw, exact" and saving would have
    // silently rewritten it to match its bare spell name as a literal log line - a trigger that
    // could never fire again.
    if (timer.triggerChat) {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
      newTimerChannelSelect.value = timer.triggerChat.channel;
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === (timer.triggerChat.isSelf ? 'self' : 'name')));
      newTimerWhoNameInput.value = timer.triggerChat.name || '';
      newTimerChatMessageInput.value = timer.triggerChat.message || '';
      newTimerChatEndedMessageInput.value = timer.endedChat?.message || '';
      newTimerTriggerInput.value = '';
      newTimerEndedInput.value = '';
      setSkillTrigger('');
      newTimerZoneSelect.value = '';
    } else if (timer.triggerMatch === 'castOf') {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'skill'));
      setSkillTrigger(timer.triggerText);
      newTimerTriggerInput.value = '';
      newTimerEndedInput.value = '';
      newTimerChannelSelect.value = 'say';
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
      newTimerWhoNameInput.value = '';
      newTimerChatMessageInput.value = '';
      newTimerChatEndedMessageInput.value = '';
      newTimerZoneSelect.value = '';
    } else if (timer.triggerMatch === 'zoneEnter' || timer.triggerMatch === 'zoneLeave') {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'zone'));
      newTimerZoneSelect.value = timer.triggerText;
      newTimerZoneDirectionRadios.forEach((r) => (r.checked = r.value === (timer.triggerMatch === 'zoneLeave' ? 'leave' : 'enter')));
      newTimerTriggerInput.value = '';
      newTimerEndedInput.value = '';
      newTimerChannelSelect.value = 'say';
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
      newTimerWhoNameInput.value = '';
      newTimerChatMessageInput.value = '';
      newTimerChatEndedMessageInput.value = '';
      setSkillTrigger('');
    } else {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'raw'));
      newTimerTriggerInput.value = timer.triggerText;
      newTimerEndedInput.value = timer.endedText || '';
      newTimerChannelSelect.value = 'say';
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
      newTimerWhoNameInput.value = '';
      newTimerChatMessageInput.value = '';
      newTimerChatEndedMessageInput.value = '';
      setSkillTrigger('');
      newTimerZoneSelect.value = '';
    }
    updateTimerChannelVisibility();
    updateTimerModeVisibility();
    newTimerIconId = timer.iconId;
    setTimerIconPreview(iconUrl);
    newTimerAddBtn.textContent = 'Save changes';
    // Only meaningful while editing - "save as new" from a blank form would
    // just be a second Add button.
    newTimerSaveAsNewBtn.style.display = '';
  }

  // timer omitted = add mode.
  //
  // The skill-cast picker needs a fresh spell list before either resetTimerForm or
  // populateTimerForm can set the select's value - setting an <select>.value to something with no
  // matching <option> yet just silently fails, and a later option added afterward does not
  // retroactively become selected. So the fetch runs FIRST and the two form functions after it,
  // rather than the other way around (which is otherwise the natural order everywhere else in
  // this modal). The list is refetched every open, not cached from whenever the Add Aura modal
  // last populated it, since this modal can open (editing an existing widget's own timers)
  // without the Add Aura modal ever having been opened this session at all.
  function openTimerModal(timer, iconUrl) {
    Promise.all([window.eqTracker.getCastableBuffs(), window.eqTracker.getAllBuffNames()]).then(([castable, allNames]) => {
      castableBuffs = castable;
      allSkillNames = allNames;
      populateZoneTriggerSelect();
      resetTimerForm();
      if (timer) populateTimerForm(timer, iconUrl);
    });
    customTimerModalTitle.textContent = timer ? 'Edit trigger' : 'Add trigger';
    customTimerModalBackdrop.style.display = 'flex';
    newTimerNameInput.focus();
  }

  // The Skill-cast trigger's spell picker (reported live 30 Aug: needs a real filter bar, and bard
  // songs were missing). Filters the WHOLE roster - allSkillNames comes from buffs:allNames, not
  // the recast-time-filtered buffs:castable that fed the old <select>. Type to filter, click a real
  // name to pick it; the hidden #widget-new-timer-skill-select input holds the value so every
  // get/set of .value elsewhere in this modal is unchanged.
  let allSkillNames = []; // [{ name, iconId, isBardSong }]

  function setSkillTrigger(name) {
    newTimerSkillSelect.value = name || '';
    newTimerSkillSearch.value = name || '';
    if (newTimerSkillOptions) newTimerSkillOptions.style.display = 'none';
  }

  function renderSkillTriggerOptions() {
    if (!newTimerSkillOptions) return;
    const q = newTimerSkillSearch.value.trim().toLowerCase();
    // Only while the field is focused or has text - an always-open 1,000-row list would bury the
    // hint below it. When the field holds the already-picked name, that is not a query to filter on.
    const typing = document.activeElement === newTimerSkillSearch && q !== newTimerSkillSelect.value.toLowerCase();
    if (!typing || !q) {
      newTimerSkillOptions.style.display = 'none';
      return;
    }
    const matches = allSkillNames.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 200);
    newTimerSkillOptions.innerHTML = '';
    newTimerSkillOptions.style.display = '';
    for (const s of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skill-search-option' + (s.isBardSong ? ' is-song' : '');
      btn.textContent = s.name;
      // mousedown, not click - the field blur (which hides this list) fires first otherwise.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setSkillTrigger(s.name);
        newTimerSkillSearch.blur();
      });
      newTimerSkillOptions.appendChild(btn);
    }
    if (!matches.length) {
      const none = document.createElement('div');
      none.className = 'skill-search-none';
      none.textContent = 'No spell or song matches that';
      newTimerSkillOptions.appendChild(none);
    }
  }

  newTimerSkillSearch.addEventListener('input', () => {
    // Typing invalidates a previous pick until a new row is clicked.
    newTimerSkillSelect.value = '';
    renderSkillTriggerOptions();
  });
  newTimerSkillSearch.addEventListener('focus', renderSkillTriggerOptions);
  newTimerSkillSearch.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== newTimerSkillSearch) {
      newTimerSkillOptions.style.display = 'none';
      // Nothing valid was picked - snap the field back to whatever the hidden value holds (the
      // last real pick, or empty).
      newTimerSkillSearch.value = newTimerSkillSelect.value;
    }
  }, 120));

  // A plain <select> is still fine here - there are ~104 zones and every one is a real place, so
  // there is no typo path and no "hundreds of rows" problem the skill search above had to solve.
  // Reads the same knownZones list the zone-gating picker already fetched once at startup.
  function populateZoneTriggerSelect() {
    const sorted = [...knownZones].sort((a, b) => a.localeCompare(b));
    newTimerZoneSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '- choose a zone -';
    newTimerZoneSelect.appendChild(placeholder);
    for (const zone of sorted) {
      const opt = document.createElement('option');
      opt.value = zone;
      opt.textContent = zone;
      newTimerZoneSelect.appendChild(opt);
    }
    newTimerZoneSelect.value = '';
  }

  function closeTimerModal() {
    customTimerModalBackdrop.style.display = 'none';
    resetTimerForm();
  }

  // Cycles the whole widget's triggerCombineMode - Independent -> AND -> OR -> Independent. One
  // setting for the whole set of triggers, not a per-row one (AND in particular is meaningless
  // about any single trigger on its own), but the button that changes it sits on every row - see
  // TRIGGER_COMBINE_LABELS below.
  const TRIGGER_COMBINE_ORDER = ['independent', 'and', 'or'];
  const TRIGGER_COMBINE_LABELS = { independent: 'Independent', and: 'AND', or: 'OR' };
  function nextTriggerCombineMode(mode) {
    const i = TRIGGER_COMBINE_ORDER.indexOf(mode);
    return TRIGGER_COMBINE_ORDER[(i + 1) % TRIGGER_COMBINE_ORDER.length];
  }

  function renderCustomTimersList(widget) {
    customTimersListEl.innerHTML = '';
    const timers = widget.customTimers || [];
    if (timers.length === 0) {
      customTimersListEl.innerHTML = '<li class="empty">None yet - use + Add trigger.</li>';
      return;
    }
    window.eqTracker.getIconSet().then((iconSet) => {
      for (const timer of timers) {
        const li = document.createElement('li');
        const iconUrl = timer.iconId != null ? `eqicon://icon/${encodeURIComponent(iconSet)}/${timer.iconId}` : null;
        const icon = buildIconThumb(iconUrl);
        const name = document.createElement('span');
        name.className = 'buff-name';
        name.textContent = timer.name;
        // No per-row duration any more - it's the one slider above the list now, shared by
        // every trigger, so showing it again here would just be the exact "two sources for the
        // same number" confusion that slider was added to end.
        // Reported live 25 Aug: "have a button to the left of edit, that toggles between AND and
        // OR" - a third mode (today's original behaviour, kept as the default) got added during
        // that same conversation, so this is a 3-way cycle rather than a 2-way toggle. It reflects
        // and changes the WIDGET's mode, not this one row's - every row always shows the same
        // label, and clicking any of them moves them all together.
        const combineBtn = document.createElement('button');
        combineBtn.type = 'button';
        combineBtn.className = 'trigger-combine-btn';
        combineBtn.title = 'How this aura\'s triggers combine - click to change';
        combineBtn.textContent = TRIGGER_COMBINE_LABELS[widget.triggerCombineMode] || TRIGGER_COMBINE_LABELS.independent;
        combineBtn.addEventListener('click', () => {
          const next = nextTriggerCombineMode(widget.triggerCombineMode);
          window.eqTracker.setWidgetTriggerCombineMode(widget.id, next).then((config) => {
            updateLocalWidgetCache(config);
            renderCustomTimersList(config || widget);
            // The AND-window row's visibility depends on the mode that just changed - not just its
            // value, which renderBuffFilter already keeps current whenever the widget is selected.
            const isAnd = config && config.triggerCombineMode === 'and';
            andWindowRowEl.style.display = isAnd ? '' : 'none';
            andWindowHintEl.style.display = isAnd ? '' : 'none';
            if (isAnd) {
              const andWindowSec = typeof config.andWindowSec === 'number' ? config.andWindowSec : 30;
              andWindowSlider.value = andWindowSec;
              andWindowValueEl.textContent = `${andWindowSec}s`;
            }
          });
        });
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openTimerModal(timer, iconUrl));
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          if (!window.confirm(`Delete trigger "${timer.name}"? This can't be undone.`)) return;
          if (editingTimerId === timer.id) closeTimerModal();
          window.eqTracker.removeWidgetCustomTimer(widget.id, timer.id).then(() => {
            refreshWidgets().then(() => renderCustomTimersList(findWidget(widget.id)));
          });
        });
        if (icon) li.append(icon);
        li.append(name, combineBtn, editBtn, deleteBtn);
        customTimersListEl.appendChild(li);
      }
    });
  }

  // Whether the roster considers this a debuff (or charm), rather than an ordinary buff. The one
  // rule the picker, the conflict check, and the no-match message all have to agree on - defined
  // once here rather than three times, after the picker used to disagree with the rule that
  // blocked adding what it had just offered.
  function isDetBuff(b) {
    return !!(b && (b.kind === 'det' || b.scaleCategory === 'debuff' || b.scaleCategory === 'charm'));
  }

  function applyBuffFilterSearch() {
    const widget = findWidget(selectedId);
    if (!widget || widget.kind === 'self-buffs-builtin' || widget.kind === 'ally-buffs-builtin' || widget.kind === 'bard-songs-builtin') return;
    if (widget.buffSource === 'customTimer') return;
    const query = filterSearch.value.trim().toLowerCase();
    // Filtered to the aura's own category BEFORE the search box even runs. Debuffs and buffs can
    // never share an aura (note 27), so a debuff aura's picker showing buffs - or a buff aura's
    // picker showing debuffs - was always going to end in the same "cannot share an aura" alert
    // the moment it was ticked. Reported as exactly that: "if they cannot be added, they should
    // not be in the list at all." Which category an aura wants is trackOnEnemies, not whatever
    // happens to be picked already - that stays true even on a fresh aura with nothing picked yet,
    // which buffNames alone could not answer.
    //
    // allyDebuffAlert counts as wanting debuffs too, even though trackOnEnemies is false on it -
    // mez and charm are debuffs regardless of who they are cast on, and an ally-cast-alert aura
    // (see the buffSourceRow comment above) exists specifically to watch that family.
    const wantsDebuffs = !!(widget.trackOnEnemies || widget.allyDebuffAlert);
    const inCategory = allKnownBuffs.filter((b) => isDetBuff(b) === wantsDebuffs);
    const filtered = query ? inCategory.filter((b) => b.name.toLowerCase().includes(query)) : inCategory;
    const shown = filtered.slice(0, KNOWN_BUFF_RENDER_CAP);
    renderBuffFilterList(shown, filtered.length - shown.length, widget);
  }

  function renderBuffFilterList(buffs, truncatedCount, widget) {
    filterListEl.innerHTML = '';
    if (buffs.length === 0) {
      filterListEl.innerHTML = widget.trackOnEnemies || widget.allyDebuffAlert
        ? '<li class="empty">No matching debuffs.</li>'
        : '<li class="empty">No matching buffs.</li>';
      return;
    }
    const selectedNames = new Set((widget.buffNames || []).map((n) => n.toLowerCase()));
    for (const buff of buffs) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'overlay-toggle-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedNames.has(buff.name.toLowerCase());
      cb.addEventListener('change', () => toggleBuffFilterName(widget, buff.name, cb.checked));
      label.append(cb, document.createTextNode(buff.name));
      li.appendChild(label);
      filterListEl.appendChild(li);
    }
    if (truncatedCount) {
      const notice = document.createElement('li');
      notice.className = 'empty';
      notice.textContent = `+${truncatedCount} more - narrow your search to see them.`;
      filterListEl.appendChild(notice);
    }
  }

  // Note 27: "Buffs and debuffs can never share one aura." The picker itself now only ever offers
  // one category (see applyBuffFilterSearch), so this should be unreachable through the UI - kept
  // as a second layer rather than deleted, for anything that can still add a name outside the
  // picker's own checkbox list (an imported share code, for one).
  function conflictsWithPicked(widget, name) {
    const picked = widget.buffNames || [];
    if (!picked.length) return null;
    const known = allKnownBuffs.find((b) => b.name === name);
    if (!known) return null;
    const incoming = isDetBuff(known);
    for (const other of picked) {
      const existing = allKnownBuffs.find((b) => b.name === other);
      if (!existing) continue;
      if (isDetBuff(existing) !== incoming) return other;
    }
    return null;
  }

  function toggleBuffFilterName(widget, name, checked) {
    if (checked) {
      const clash = conflictsWithPicked(widget, name);
      if (clash) {
        setBuffFilterNotice(
          `"${name}" and "${clash}" cannot share an aura - one is a buff and the other is a debuff. ` +
            'Make a second aura for it.'
        );
        applyBuffFilterSearch();
        return;
      }
    }
    setBuffFilterNotice('');
    const current = new Set(widget.buffNames || []);
    if (checked) current.add(name);
    else current.delete(name);
    widget.buffNames = [...current];
    window.eqTracker.setWidgetBuffFilter(widget.id, 'explicit', widget.buffNames);
    // Whichever of the two lists the checkbox was clicked in, the other one
    // just went stale (a newly-checked name needs to appear in "Currently
    // selected", or an unchecked one needs to disappear from it) -
    // re-rendering both here keeps them in sync regardless of which
    // triggered the change, rather than each call site remembering to.
    renderSelectedBuffsList(widget);
    applyBuffFilterSearch();
  }

  function handleDelete(id) {
    const widget = findWidget(id);
    const confirmed = window.confirm(
      `Delete aura "${widget ? widget.name : ''}"? This closes its overlay window and can't be undone.`
    );
    if (!confirmed) return;
    window.eqTracker.deleteWidget(id).then(() => {
      if (selectedId === id) {
        deselectWidget();
        activateNavButton(widgetsNavBtn);
      }
      refreshWidgets();
    });
  }

  // "Reset to default" - only offered on an aura built from a premade (see premadeOrigin), which
  // is what makes "default" a real, specific thing to reset back to rather than a guess. Confirmed
  // the same way Delete is, because it is just as hard to undo - every setting changed since it
  // was created is gone, not just the ones that happen to differ from the premade.
  function handleReset(id) {
    const widget = findWidget(id);
    if (!widget) return;
    const confirmed = window.confirm(
      `Reset "${widget.name}" to how it was when it was first built? Every setting changed since ` +
        "then is lost - its position and which profiles/zones it's limited to are the only things kept."
    );
    if (!confirmed) return;
    window.eqTracker.resetWidgetToDefault(id).then(() => {
      // Full reselect rather than patching individual fields - a reset can touch nearly
      // everything (buff list, sounds, thresholds), and selectWidget already knows how to render
      // all of it consistently from a fresh widget object.
      refreshWidgets().then(() => selectWidget(id));
    });
  }

  resetWidgetBtn.addEventListener('click', () => handleReset(selectedId));

  widgetsNavBtn.addEventListener('click', deselectWidget);

  // Note 30. A guildmate pasted an aura code into chat.
  //
  // The strip only ever OFFERS. "Look at it" opens the ordinary import screen with the code
  // already typed in, so the Self Buffs overwrite warning and every other check on that path still
  // happen - importing text another player typed has to stay a decision somebody makes, not
  // something that happens because they were in guild chat at the time.
  const shareCodeOfferEl = document.getElementById('share-code-offer');
  const shareCodeOfferTextEl = document.getElementById('share-code-offer-text');
  const shareCodeOfferOpenBtn = document.getElementById('share-code-offer-open');
  const shareCodeOfferDismissBtn = document.getElementById('share-code-offer-dismiss');
  let offeredShareCode = null;

  function hideShareCodeOffer() {
    shareCodeOfferEl.style.display = 'none';
    offeredShareCode = null;
  }
  shareCodeOfferDismissBtn.addEventListener('click', hideShareCodeOffer);
  shareCodeOfferOpenBtn.addEventListener('click', () => {
    const code = offeredShareCode;
    hideShareCodeOffer();
    if (!code) return;
    openAddWidgetModal();
    addWidgetChoicesEl.style.display = 'none';
    addWidgetPanels.forEach((panel) => {
      panel.style.display = panel.id === 'add-widget-import-panel' ? '' : 'none';
    });
    importCodeInput.value = code;
    importCodeInput.focus();
  });

  window.eqTracker.onShareCodeOffered((offer) => {
    // A code that will not decode still gets said out loud, with the likeliest reason. Silence
    // here would look like the feature is broken to the person who just pasted it.
    if (!offer.aura) {
      shareCodeOfferTextEl.textContent = `${offer.sender} sent an aura code, but it could not be read. ${offer.problem}`;
      shareCodeOfferOpenBtn.style.display = 'none';
      offeredShareCode = null;
    } else {
      shareCodeOfferTextEl.textContent = `${offer.sender} shared an aura: "${offer.aura.name}".`;
      shareCodeOfferOpenBtn.style.display = '';
      offeredShareCode = offer.code;
    }
    shareCodeOfferEl.style.display = 'flex';
  });

  // Note 6 - an aura's name was clicked in its move box out on the overlay. Registered in here
  // rather than alongside the other IPC listeners because focusWidget lives in this closure.
  window.eqTracker.onOpenWidgetSettings((id) => focusWidget(id));

  // Refreshes the widget list, then selects+focuses a specific one - shared
  // by every path that ends with a brand-new (or overwritten) widget:
  // custom creation, premade creation, and both import outcomes below.
  function focusWidget(id) {
    return refreshWidgets().then(() => {
      // Must be button.nav-sub-btn specifically, not the bare attribute selector. Both the row
      // (added for drag-to-reorder) and the button inside it carry data-widget-id, and the row -
      // being the ancestor - comes first in document order, so a bare `[data-widget-id="..."]`
      // matched IT. The row has no data-page, so activateNavButton(row) read pageId as undefined
      // and toggled every .page's "active" class off - nothing whatsoever left visible. Reported
      // as "adding a new aura takes you to a blank menu rather than into the new aura directly",
      // which is exactly what a page with no active section looks like.
      const btn = submenuEl.querySelector(`button.nav-sub-btn[data-widget-id="${id}"]`);
      if (btn) activateNavButton(btn);
      selectWidget(id);
    });
  }

  // Ready-made widget templates offered by the "Premade widget" choice -
  // just a name/description plus a creator function, so adding another one
  // later (per the user's request to keep this extensible) is a one-line
  // addition here, not new UI plumbing.
  const PREMADE_WIDGETS = [
    {
      id: 'buff-timer',
      name: 'Buff timer',
      group: 'timers',
      description:
        'Pick one spell and whether you are watching it on yourself, on someone you cast it on, ' +
        'or on something you cast it at, and the aura is built for you.',
      // No create() - this one opens a panel instead. See renderPremadeList.
      panel: 'buff-timer',
    },
    {
      id: 'cooldown-timer',
      name: 'Cooldown timer',
      group: 'timers',
      description:
        'Pick a spell and get a countdown to when you can cast it again, rather than how long it ' +
        'lasts. The recast time is filled in for you, and you can correct it.',
      panel: 'buff-timer',
      mode: 'cooldown',
    },
    {
      id: 'skill-ready-reminder',
      name: 'Skill ready reminder (example)',
      group: 'timers',
      description:
        'A worked example, not a separate feature: the same picker as Cooldown timer, but instead ' +
        'of counting the cooldown down, this shows a reminder tile the moment the skill IS ready ' +
        'and hides it the instant you cast it - "go use this" rather than "wait this long". Shows ' +
        'what Reverse detection (on any aura\'s Custom triggers card) can do.',
      panel: 'buff-timer',
      mode: 'cooldown',
      reverseExample: true,
    },
    {
      id: 'enemy-debuff',
      name: 'Debuff on an enemy',
      group: 'timers',
      description:
        'A timer for a mez, charm, snare or slow on the thing you cast it at, showing its name ' +
        'and clearing when it dies, wears off, or the mez is broken. Same picker as Buff timer, ' +
        'opened with the enemy option already chosen.',
      panel: 'buff-timer',
      // Which of the three "On:" options the panel should start on. The picker is identical; the
      // only difference between this premade and Buff timer is what it assumes you came for.
      defaultSource: 'enemy',
    },
    {
      id: 'dispelled',
      name: 'You Have Been Dispelled',
      group: 'event-alerts',
      description:
        'Flashes DISPELLED in large letters when something strips your buffs, then clears itself ' +
        'after eight seconds. A text aura - it draws no icon and no countdown. Listens for all ' +
        'three strengths of the message.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'dispelled'),
    },
    {
      id: 'resisted',
      name: 'Resist flash',
      group: 'event-alerts',
      description:
        'Flashes RESISTED for a second and a half whenever a spell you cast is resisted. Covers ' +
        'every spell at once, not one you have to pick - useful for mez and charm, where a resist ' +
        'is the difference between a mob standing still and a mob hitting you.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'resisted'),
    },
    {
      id: 'charm-broke',
      name: 'Charm Broke',
      group: 'event-alerts',
      description:
        'Flashes "[target] has broken free!" the instant your charm wears off, so you know to ' +
        're-charm or back off before it turns on you. Covers every charm spell in the roster at ' +
        'once, not one you have to pick.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'charmBroke'),
    },
    {
      id: 'loss-of-control',
      name: 'Loss of control',
      group: 'event-alerts',
      description:
        'Shows STUNNED / MESMERIZED / CHARMED / AFRAID / ROOTED / SNARED while one of those is on ' +
        'you, and clears the instant it lifts. One tile, whichever applies. Watches the charm, ' +
        'fear, root, snare, mez and stun wordings at once - the trigger list is editable to add more.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'lossOfControl'),
    },
    {
      id: 'pet-status',
      name: 'Pet status',
      group: 'event-alerts',
      description:
        'For a charmed pet (bard or enchanter). Shows PET ENGAGED while it is fighting, PET IDLE ' +
        'when it backs off, and PET GONE the moment your charm breaks. Reads the pet’s own ' +
        '"Attacking ... Master" / "calming down" lines, so it works no matter which mob you have charmed.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'petStatus'),
    },
    {
      id: 'ally-buffs',
      name: 'Ally Buffs',
      group: 'standalone',
      description: 'Shows every buff you’ve cast on your current group members, with the same filter options (hide bard songs, hide long buffs, sound alerts, etc.) as Self Buffs.',
      create: (name) => window.eqTracker.createAllyBuffsWidget(name),
    },
    {
      id: 'bard-songs',
      name: 'Bard Songs',
      group: 'standalone',
      description: 'Every bard song currently on you, no matter who cast it. Grouped by caster when that’s knowable (including your own casts) - everything else lands in an "Unknown" group instead of guessing.',
      create: (name) => window.eqTracker.createBardSongsWidget(name),
    },
    {
      id: 'raid-named',
      name: 'Raid named',
      group: 'standalone',
      description:
        'A checklist of the named mobs in the raid zone you are in - all shown when you enter, ' +
        'greyed out as they die, reset to a full list when you re-enter (a fresh instance). ' +
        'Covers Plane of Sky / Hate / Fear, Nagafen and Vox for now; add more as you visit them.',
      create: (name) => window.eqTracker.createRaidNamedWidget(name),
    },
    {
      id: 'travel-guide',
      name: 'Travel guide',
      group: 'standalone',
      description:
        'The shortest way from where you are to wherever you are going, one leg per line, with the ' +
        'current zone shown at the top. In game, type /tell eqtm to pick a destination ' +
        'from a searchable list (typing it again closes the list); it\'ll also ask where you ' +
        'currently are the first time, and clears itself the moment you arrive.',
      create: (name) => window.eqTracker.createTravelGuideWidget(name, ''),
    },
  ];

  // Not-yet-built/locked premade ideas - shown inline in their eventual category as
  // visible-but-disabled entries (see .premade-widget-choice.planned in the CSS) so the roadmap is
  // discoverable in the app itself, not just a note buried in project docs. No create() - clicking
  // these does nothing. Each needs its own `group` for the same reason PREMADE_WIDGETS entries do -
  // reported live, 25 Aug: a separate "Not built yet" bucket at the bottom meant a planned Buff
  // timer/Debuff-on-enemy entry never read as belonging with the timers it was a preview of.
  const PLANNED_PREMADE_WIDGETS = [
    // Locked at the owner's instruction, 2026-08-24: a "standalone tool" aura (a route, a fight
    // readout) was given the same settings-panel shape as an ordinary buff aura - a "Buffs shown"
    // card offering a source and a spell picker that mean nothing for either of them. Travel guide
    // got its own shape (see SHAPE_FIELDS.travel above) and moved back into PREMADE_WIDGETS once
    // that landed. Damage parser is still waiting on the same treatment.
    {
      name: 'Damage parser',
      group: 'standalone',
      description:
        'A live damage readout for the fight you are in. Built, but its settings page still looks ' +
        'like a buff aura\'s - offering a "Buffs shown" picker that does nothing for a damage row. ' +
        'Locked until it gets its own layout.',
    },
    // The rest of the roadmap, shown in the app rather than only in docs/QOL-BACKLOG.md. Listing something
    // as "not built yet" turns "this seems broken" into "that's coming", which is worth more than
    // it looks to anyone using the app who did not write it.
    {
      name: 'First aggro',
      group: 'standalone',
      description:
        'Shows who hit the boss first, or who the boss hit first. Not built yet - and it can only ' +
        'ever be as complete as your own log, which does not see everything across a raid.',
    },
  ];

  // ---- The buff-timer premade (note 14) --------------------------------------------------
  //
  // The first premade that asks something before it builds. Kept generic on purpose: the planned
  // cooldown and enemy-debuff premades are the same shape - pick one spell, answer one question -
  // and should reuse this rather than each growing their own picker.
  const buffTimerSelect = document.getElementById('buff-timer-select');
  const buffTimerSourceRow = document.getElementById('buff-timer-source-row');
  const buffTimerAllyLabel = document.getElementById('buff-timer-ally-label');
  const buffTimerAllyWarning = document.getElementById('buff-timer-ally-warning');
  const buffTimerEnemyLabel = document.getElementById('buff-timer-enemy-label');
  const buffTimerEnemyWarning = document.getElementById('buff-timer-enemy-warning');
  const buffTimerCreateRow = document.getElementById('buff-timer-create-row');
  const buffTimerCooldownRow = document.getElementById('buff-timer-cooldown-row');
  const buffTimerCooldownInput = document.getElementById('buff-timer-cooldown-input');
  const buffTimerCooldownHint = document.getElementById('buff-timer-cooldown-hint');
  const buffTimerCreateBtn = document.getElementById('buff-timer-create-btn');
  const buffTimerAlsoCooldownRow = document.getElementById('buff-timer-also-cooldown-row');
  const buffTimerAlsoCooldownCheckbox = document.getElementById('buff-timer-also-cooldown-checkbox');

  let trackableBuffs = [];
  let castableBuffs = [];
  let buffTimerChoice = null;
  let buffTimerPreferredSource = 'self';
  // The castableBuffs entry for whichever spell buffTimerChoice currently is, or null if that
  // spell has no known recast time at all - "Also track when it's ready to cast again" (25 Aug)
  // only ever makes sense when both halves (a real duration AND a real recast time) exist for the
  // same spell.
  let buffTimerCooldownMatch = null;
  // 'buff' or 'cooldown'. The picker is the same either way; what differs is which list it shows,
  // which question it asks underneath, and what it builds. Note 15 said the cooldown premade
  // should reuse note 14's panel rather than growing a second one over the same spells.
  let buffTimerMode = 'buff';
  // "Example library" ask (25 Aug): a worked example demonstrating reverse detection - built the
  // same way as an ordinary Cooldown timer (same picker, same list, same fields; deliberately NOT
  // a fourth buffTimerMode, so none of the existing `=== 'cooldown'` checks above needed touching)
  // except the finished widget gets reverseDetection flipped on right after creation. The result
  // shows a reminder tile UNTIL the picked skill is cast, then goes quiet the moment it is - "this
  // is ready, go use it" - rather than counting the cooldown down, which is what a plain Cooldown
  // timer already does and why this needed to be a genuinely different worked example, not the
  // same feature under a second name.
  let buffTimerReverseExample = false;

  // Only shown in buff mode, only for a spell with known recast data, and only for "Yourself" -
  // what this actually builds when checked is a customTimer castOf trigger (see the create-button
  // handler below), which has no concept of "on an ally"/"on an enemy" at all, so offering it for
  // either of those sources would be a checkbox that silently does nothing.
  function syncBuffTimerAlsoCooldownRow() {
    const source = buffTimerSourceRow.querySelector('input[name="buff-timer-source"]:checked')?.value;
    const canShow = buffTimerMode === 'buff' && !!buffTimerCooldownMatch && source === 'self';
    buffTimerAlsoCooldownRow.style.display = canShow ? '' : 'none';
    if (!canShow) buffTimerAlsoCooldownCheckbox.checked = false;
  }

  function buffTimerPool() {
    return buffTimerMode === 'cooldown' ? castableBuffs : trackableBuffs;
  }

  function buffTimerOptionLabel(buff) {
    if (buffTimerMode === 'cooldown') {
      return `${buff.name} - ${buff.reuseSec}s recast + ${buff.castSec}s cast = ${buff.cooldownSec}s`;
    }
    const howLong = buff.infinite ? 'lasts until dispelled' : buff.durationSec ? `${buff.durationSec}s` : 'no duration';
    const where = buff.enemy
      ? 'on you, an ally, or something you cast it at'
      : buff.ally
        ? 'on you or on an ally'
        : 'on you only';
    return `${buff.name} - ${howLong} - ${where}`;
  }

  // A real dropdown, not a search box over a capped list that told you to keep typing. Native
  // <select> already does what that was trying to build by hand - type a letter to jump, scroll,
  // or use arrow keys - and does it without a length limit or a "...and N more" dead end.
  function populateBuffTimerSelect() {
    const pool = buffTimerPool();
    buffTimerSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent =
      buffTimerMode === 'cooldown' ? '- choose a spell with a recast time -' : '- choose a spell -';
    buffTimerSelect.appendChild(placeholder);
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    for (const buff of sorted) {
      const opt = document.createElement('option');
      opt.value = buff.name;
      opt.textContent = buffTimerOptionLabel(buff);
      buffTimerSelect.appendChild(opt);
    }
    buffTimerSelect.value = '';
  }

  buffTimerSelect.addEventListener('change', () => {
    const buff = buffTimerPool().find((b) => b.name === buffTimerSelect.value);
    if (buff) chooseBuffTimerSpell(buff);
  });

  function chooseBuffTimerSpell(buff) {
    buffTimerChoice = buff;
    buffTimerCreateRow.style.display = '';

    if (buffTimerMode === 'cooldown') {
      // No "on:" question - a cooldown is always your own. The one thing worth asking is the
      // number, pre-filled and editable, because recast times are mined rather than measured and
      // of the two checked in game one was wrong. Presenting it as a fact would be overclaiming.
      buffTimerSourceRow.style.display = 'none';
      buffTimerAllyWarning.style.display = 'none';
      buffTimerEnemyWarning.style.display = 'none';
      buffTimerCooldownRow.style.display = '';
      buffTimerCooldownHint.style.display = '';
      buffTimerCooldownInput.value = String(buff.cooldownSec);
      buffTimerCooldownHint.textContent =
        `${buff.reuseSec}s recast plus ${buff.castSec}s casting time. The recast starts when the ` +
        'cast finishes and this timer starts when it begins, which is why the two are added. ' +
        'Recast times come from the game data and are usually right but not always - change it ' +
        'here if the game disagrees, and the aura keeps whatever you set.';
      buffTimerCooldownMatch = null;
      syncBuffTimerAlsoCooldownRow();
      return;
    }

    buffTimerCooldownRow.style.display = 'none';
    buffTimerCooldownHint.style.display = 'none';
    buffTimerSourceRow.style.display = '';
    // Cross-referenced by name against the recast-time list fetched alongside this one - see
    // syncBuffTimerAlsoCooldownRow for what this actually gates.
    buffTimerCooldownMatch = castableBuffs.find((b) => b.name === buff.name) || null;

    // The risk note 14 names: offering "on an ally" for a spell whose roster entry has no
    // third-person landing text builds an aura that silently never lights up. Disabled rather
    // than hidden, with the reason, so it reads as "not possible for this spell" instead of the
    // option having mysteriously moved.
    // Note 16. Same reasoning as the ally option below: disabled with a reason rather than hidden,
    // so it reads as "not possible for this spell" instead of the choice having moved. A heal has
    // third-person landing text and so passes the ally test, but watching it "on an enemy" would
    // build an aura that never lights up.
    const enemyRadio = buffTimerEnemyLabel.querySelector('input');
    enemyRadio.disabled = !buff.enemy;
    buffTimerEnemyLabel.classList.toggle('disabled', !buff.enemy);
    if (!buff.enemy) {
      if (enemyRadio.checked) {
        enemyRadio.checked = false;
        buffTimerSourceRow.querySelector('input[value="self"]').checked = true;
      }
      buffTimerEnemyWarning.textContent =
        `"${buff.name}" is not something you cast at an enemy, so it can only be watched on you ` +
        'or on someone in your group.';
      buffTimerEnemyWarning.style.display = '';
    } else {
      buffTimerEnemyWarning.style.display = 'none';
    }

    const allyRadio = buffTimerAllyLabel.querySelector('input');
    allyRadio.disabled = !buff.ally;
    buffTimerAllyLabel.classList.toggle('disabled', !buff.ally);
    if (!buff.ally) {
      if (allyRadio.checked) {
        allyRadio.checked = false;
        buffTimerSourceRow.querySelector('input[value="self"]').checked = true;
      }
      buffTimerAllyWarning.textContent =
        `The app has no message for "${buff.name}" landing on someone else, so it can only be ` +
        'watched on you. An aura set to watch it on an ally would never light up.';
      buffTimerAllyWarning.style.display = '';
    } else {
      buffTimerAllyWarning.style.display = 'none';
    }

    // Applied after both options know whether they are available, so a premade asking for the
    // enemy option on a spell that cannot use it falls back to a working choice rather than
    // leaving a disabled radio selected.
    const preferred = buffTimerSourceRow.querySelector(`input[value="${buffTimerPreferredSource}"]`);
    if (preferred && !preferred.disabled) preferred.checked = true;
    // After the source radio has its final value for this spell, so the row's visibility matches
    // what's actually selected rather than whatever was left over from the previous spell.
    syncBuffTimerAlsoCooldownRow();
  }

  // preferredSource is what the premade that opened this panel came for - the radios still show
  // all three, so the choice is visible rather than hidden, it just starts on the likely one.
  function resetBuffTimerPanel(preferredSource, mode, reverseExample) {
    buffTimerMode = mode === 'cooldown' ? 'cooldown' : 'buff';
    buffTimerReverseExample = !!reverseExample;
    buffTimerPreferredSource = preferredSource === 'enemy' || preferredSource === 'ally' ? preferredSource : 'self';
    buffTimerChoice = null;
    buffTimerCooldownMatch = null;
    buffTimerSourceRow.style.display = 'none';
    buffTimerCreateRow.style.display = 'none';
    buffTimerAllyWarning.style.display = 'none';
    buffTimerEnemyWarning.style.display = 'none';
    buffTimerCooldownRow.style.display = 'none';
    buffTimerCooldownHint.style.display = 'none';
    buffTimerSourceRow.querySelector('input[value="self"]').checked = true;
    syncBuffTimerAlsoCooldownRow();
    populateBuffTimerSelect();
  }
  buffTimerCreateBtn.addEventListener('click', () => {
    if (!buffTimerChoice) return;
    if (buffTimerMode === 'cooldown') {
      const typed = Number(buffTimerCooldownInput.value);
      // Falls back to the mined figure rather than refusing, so an empty or nonsense box still
      // builds something useful instead of doing nothing and explaining nothing.
      const cooldownSec = Number.isFinite(typed) && typed > 0 ? typed : buffTimerChoice.cooldownSec;
      window.eqTracker
        .createCooldownTimerWidget(buffTimerChoice.name, buffTimerChoice.name, cooldownSec, buffTimerChoice.iconId)
        .then((config) => {
          const finish = () => {
            closeAddWidgetModal();
            focusWidget(config.id);
          };
          // The reverse-example variant of this same premade (see buffTimerReverseExample's own
          // comment) - everything about creation is identical up to here, then one extra flip.
          if (buffTimerReverseExample) {
            window.eqTracker.setWidgetReverseDetection(config.id, true).then(finish);
          } else {
            finish();
          }
        });
      return;
    }
    const source = buffTimerSourceRow.querySelector('input[name="buff-timer-source"]:checked').value;
    // "Also track when it's ready to cast again" (25 Aug) - only reachable when the row is
    // actually showing (source 'self' plus real recast data - see syncBuffTimerAlsoCooldownRow),
    // so this check alone is enough; no need to re-verify source/buffTimerCooldownMatch here.
    if (source === 'self' && buffTimerCooldownMatch && buffTimerAlsoCooldownCheckbox.checked) {
      window.eqTracker
        .createCooldownTimerWidget(
          buffTimerChoice.name,
          buffTimerChoice.name,
          buffTimerCooldownMatch.cooldownSec,
          buffTimerCooldownMatch.iconId,
          buffTimerChoice.durationSec
        )
        .then((config) => {
          closeAddWidgetModal();
          focusWidget(config.id);
        });
      return;
    }
    // Named after the spell, because that is what the user just picked and searched for - having
    // to name it as well would be a second question for no information.
    window.eqTracker
      .createBuffTimerWidget(buffTimerChoice.name, buffTimerChoice.name, source)
      .then((config) => {
        closeAddWidgetModal();
        focusWidget(config.id);
      });
  });
  buffTimerSourceRow.querySelectorAll('input[name="buff-timer-source"]').forEach((radio) => {
    radio.addEventListener('change', syncBuffTimerAlsoCooldownRow);
  });

  // Electron's accelerator spelling is not how anyone reads a key off their keyboard.
  const HOTKEY_LABELS = {
    ScrollLock: 'Scroll Lock',
    'Alt+Shift+H': 'Alt+Shift+H',
  };

  // The two groups the list is split into, and what decides which a premade belongs to.
  //
  // Replaced 25 Aug - the previous split ("Shortcuts": could you have built this yourself, vs
  // "Standalone tools") answered a question about the SETTINGS PANEL, but nearly everything was a
  // Shortcut under it (only Ally Buffs/Bard Songs/the two locked tools ever qualified as
  // Standalone), so the heading did little sorting work in practice. This one answers what the
  // owner actually scans the list for: "does this watch one specific thing I pick, or is it a
  // fixed alert/its own kind of tool with nothing to pick at all." Standalone tools kept as its own
  // group and deliberately last - the owner's own words, "standalone's still at the bottom."
  const PREMADE_GROUPS = [
    { id: 'timers', title: 'Timers', hint: 'Pick a spell (or a target) and get a countdown for it.' },
    { id: 'event-alerts', title: 'Event alerts', hint: 'Watches for a fixed game message and flashes when it happens - nothing to pick.' },
    { id: 'standalone', title: 'Standalone tools', hint: 'Their own kind of aura, with behaviour the custom settings cannot produce.' },
  ];

  function renderPremadeGroupHeading(group) {
    const li = document.createElement('li');
    li.className = 'premade-group-heading';
    const title = document.createElement('strong');
    title.textContent = group.title;
    const hint = document.createElement('span');
    hint.textContent = group.hint;
    li.append(title, hint);
    premadeListEl.appendChild(li);
  }

  function renderPremadeList() {
    premadeListEl.innerHTML = '';
    // A premade that has been BUILT must not still be offered as planned too, or the Add Aura list
    // shows it twice - once working, once greyed out as "Not built yet". That happened to both
    // Buff timer and Debuff on an enemy historically, because building one means adding an entry
    // to PREMADE_WIDGETS and it was easy to forget to remove the matching PLANNED one. Filtered
    // rather than merely tested, so the app is right even if someone adds a premade without
    // reading the test.
    const builtNames = new Set(PREMADE_WIDGETS.map((p) => p.name));
    const stillPlanned = PLANNED_PREMADE_WIDGETS.filter((p) => !builtNames.has(p.name));
    for (const group of PREMADE_GROUPS) {
      const built = PREMADE_WIDGETS.filter((p) => p.group === group.id);
      const planned = stillPlanned.filter((p) => p.group === group.id);
      if (!built.length && !planned.length) continue;
      renderPremadeGroupHeading(group);
      for (const premade of built) renderPremadeChoice(premade);
      for (const premade of planned) renderPremadeChoice(premade, true);
    }
  }

  function renderPremadeChoice(premade, planned = false) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = planned ? 'premade-widget-choice planned' : 'premade-widget-choice';
    btn.disabled = planned;
    const strong = document.createElement('strong');
    strong.textContent = premade.name;
    if (planned) {
      const badge = document.createElement('span');
      badge.className = 'planned-badge';
      badge.textContent = 'Planned';
      strong.appendChild(badge);
    }
    const span = document.createElement('span');
    span.textContent = premade.description;
    btn.append(strong, span);
    if (!planned) {
      btn.addEventListener('click', () => {
        // A premade with a panel asks something first; the rest build immediately.
        if (premade.panel) {
          addWidgetPanels.forEach((panel) => {
            panel.style.display = panel.id === `add-widget-${premade.panel}-panel` ? '' : 'none';
          });
          if (premade.panel === 'buff-timer') {
            resetBuffTimerPanel(premade.defaultSource, premade.mode, premade.reverseExample);
            buffTimerSelect.focus();
          }
          return;
        }
        premade.create(premade.name).then((config) => {
          closeAddWidgetModal();
          focusWidget(config.id);
        });
      });
    }
    li.appendChild(btn);
    premadeListEl.appendChild(li);
  }

  function showAddWidgetChoices() {
    addWidgetChoicesEl.style.display = '';
    addWidgetPanels.forEach((panel) => (panel.style.display = 'none'));
  }

  // Reported live 25 Aug: "when on this menu and hitting back, it sends you two screens back
  // instead of 1." Root cause - every .add-widget-back button, no matter which panel it lives in,
  // called the SAME showAddWidgetChoices() above. That's correct for a panel reached directly from
  // Choices (import/chat/premade-list/custom), but the buff-timer panel (Buff timer/Cooldown
  // timer/Debuff on an enemy - reached by clicking one of THOSE from the premade list, one screen
  // further in) has its own back button too, and it was skipping the premade list entirely and
  // jumping straight to Choices. This is that panel's real "one step back."
  function showAddWidgetPremadePanel() {
    addWidgetChoicesEl.style.display = 'none';
    addWidgetPanels.forEach((panel) => {
      panel.style.display = panel.id === 'add-widget-premade-panel' ? '' : 'none';
    });
  }

  // Codes seen in chat this session. Read-only by construction: the only thing picking one does is
  // put its text in the import box on the Import-from-code panel, where the ordinary confirmations
  // still apply. See gotcha #24 - nothing may import a chat code on sight.
  function renderChatShareCodeList() {
    const listEl = document.getElementById('add-widget-chat-list');
    if (!listEl) return;
    listEl.innerHTML = '<li class="empty">Looking...</li>';
    window.eqTracker.getRecentShareCodes().then((codes) => {
      listEl.innerHTML = '';
      if (!codes.length) {
        listEl.innerHTML =
          '<li class="empty">Nobody has pasted an aura code in chat since the app started.</li>';
        return;
      }
      for (const entry of codes) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'premade-widget-choice';
        const strong = document.createElement('strong');
        // A code that would not decode is still listed, saying so, rather than hidden - a code
        // arriving cut off is a length problem worth seeing, not a reason to pretend it never came.
        strong.textContent = entry.auraName || 'Could not be read';
        const span = document.createElement('span');
        const when = new Date(entry.at).toLocaleTimeString();
        span.textContent = `from ${entry.sender} in ${entry.channel}, ${when}`;
        btn.append(strong, span);
        btn.addEventListener('click', () => {
          importCodeInput.value = entry.code;
          addWidgetPanels.forEach((panel) => {
            panel.style.display = panel.id === 'add-widget-import-panel' ? '' : 'none';
          });
          importCodeInput.focus();
        });
        li.appendChild(btn);
        listEl.appendChild(li);
      }
    });
  }

  function openAddWidgetModal() {
    // Fetched once, when the modal opens, rather than held for the session: the roster changes
    // when someone edits a buff on the Known Buffs page, and a stale list would offer a spell
    // that can no longer be tracked.
    window.eqTracker.getTrackableBuffs().then((buffs) => {
      trackableBuffs = buffs;
      populateBuffTimerSelect();
    });
    window.eqTracker.getCastableBuffs().then((buffs) => {
      castableBuffs = buffs;
      populateBuffTimerSelect();
    });
    showAddWidgetChoices();
    importCodeInput.value = '';
    importStatus.textContent = '';
    modalNewWidgetNameInput.value = '';
    renderPremadeList();
    addWidgetModalBackdrop.style.display = 'flex';
  }

  function closeAddWidgetModal() {
    addWidgetModalBackdrop.style.display = 'none';
  }

  openAddWidgetBtn.addEventListener('click', openAddWidgetModal);
  closeAddWidgetModalBtn.addEventListener('click', closeAddWidgetModal);
  addWidgetModalBackdrop.addEventListener('click', (e) => {
    if (e.target === addWidgetModalBackdrop) closeAddWidgetModal();
  });
  // The buff-timer panel's own back button goes to the premade list it was opened from, not all
  // the way to Choices - see showAddWidgetPremadePanel's own comment. Every other panel (import,
  // chat, premade list, custom) was reached directly from Choices, so Choices is correctly their
  // one step back.
  const buffTimerBackBtn = document.querySelector('#add-widget-buff-timer-panel .add-widget-back');
  addWidgetBackBtns.forEach((btn) => {
    btn.addEventListener('click', () => (btn === buffTimerBackBtn ? showAddWidgetPremadePanel() : showAddWidgetChoices()));
  });

  addWidgetChoicesEl.querySelectorAll('.add-widget-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      addWidgetChoicesEl.style.display = 'none';
      addWidgetPanels.forEach((panel) => {
        panel.style.display = panel.id === `add-widget-${btn.dataset.choice}-panel` ? '' : 'none';
      });
      if (btn.dataset.choice === 'custom') modalNewWidgetNameInput.focus();
      else if (btn.dataset.choice === 'import') importCodeInput.focus();
      else if (btn.dataset.choice === 'chat') renderChatShareCodeList();
    });
  });

  // The name box is optional, and that is a fix rather than a relaxation.
  //
  // Every one of these buttons used to begin `if (!name) return;`, so clicking any aura type
  // without first typing a name did nothing at all - no aura, no error, no hint that the empty
  // box above was the reason. Reported as "cannot select any custom debuff; clicking a menu icon
  // does not create an aura", which is exactly what it looked like from outside. The type is
  // already a perfectly good name, and every aura can be renamed afterwards.
  function widgetName(fallback) {
    return modalNewWidgetNameInput.value.trim() || fallback;
  }

  // buffSource is undefined here for a plain buff widget (backend defaults
  // to 'self'; togglable to 'ally' afterward in settings) - 'customTimer'
  // for a timer widget locks that in permanently, never offered as a
  // settings toggle (see buffSourceRow visibility above).
  function addWidget(buffSource, fallback) {
    window.eqTracker.createWidget(widgetName(fallback), buffSource).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  }
  modalAddBuffWidgetBtn.addEventListener('click', () => addWidget(undefined, 'Custom buff aura'));
  // Not addWidget('ally') - a debuff aura needs the enemy switch on as well, and doing that from
  // here would be two IPC round trips with the aura visibly reconfiguring itself between them.
  document.getElementById('modal-add-debuff-widget-btn').addEventListener('click', () => {
    window.eqTracker.createDebuffWidget(widgetName('Custom debuff aura')).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  });
  modalAddTimerWidgetBtn.addEventListener('click', () => addWidget('customTimer', 'Custom timer aura'));
  modalAddTextWidgetBtn.addEventListener('click', () => {
    // Its own creator rather than createWidget with a flag: a text aura is a type, and it starts
    // with settings of its own that a plain custom aura has no use for.
    window.eqTracker.createTextAuraWidget(widgetName('Custom text aura')).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  });
  modalNewWidgetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWidget(undefined, 'Custom buff aura');
  });

  nameInput.addEventListener('change', () => {
    window.eqTracker.setWidgetName(selectedId, nameInput.value.trim() || 'Aura').then(refreshWidgets);
  });
  lockBtn.addEventListener('click', async () => {
    const locked = await window.eqTracker.toggleWidgetLock(selectedId);
    // Unlocking one aura can complete (or break) "all unlocked", so the
    // master toggle has to re-read rather than drift out of sync.
    refreshMasterButtons();
    lockBtn.textContent = locked ? 'Unlock to move' : 'Lock aura';
    lockBtn.classList.toggle('unlocked', !locked);
  });
  resetPositionBtn.addEventListener('click', () => {
    window.eqTracker.resetWidgetPosition(selectedId);
  });
  const previewBtn = document.getElementById('widget-preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (!selectedId) return;
      previewBtn.disabled = true;
      window.eqTracker.previewWidget(selectedId).finally(() => {
        setTimeout(() => { previewBtn.disabled = false; }, 6500);
      });
    });
  }
  buffSourceRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      window.eqTracker.setWidgetBuffSource(selectedId, radio.value).then((widget) => {
        refreshWidgets();
        // buffSource can move a widget between shapes (e.g. custom-buff <-> custom-debuff is
        // driven by trackOnEnemies, but ally-grouping visibility depends on buffSource directly),
        // so the shape has to be recomputed here too, not just the buff-filter content.
        if (widget) renderBuffFilter(widget, applySettingsPanelShape(widget));
      });
    });
  });
  displayModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      // Reads the widget's OTHER fields from the local cache and only overlays the new
      // displayMode, so the shape is computed from real data rather than a bare guess - the old
      // code called this with only the new displayMode and no buffSource at all, which happened
      // to be harmless only because these radios are unreachable on any shape where buffSource
      // would have mattered to the outcome. Computed synchronously (not awaiting the IPC
      // round-trip below) so the panel updates the instant you click, same as before.
      const current = findWidget(selectedId);
      applySettingsPanelShape(current ? { ...current, displayMode: radio.value } : { displayMode: radio.value });
      window.eqTracker.setWidgetDisplayMode(selectedId, radio.value).then((widget) => {
        if (widget) updateLocalWidgetCache(widget);
      });
    });
  });
  timerFormatRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      window.eqTracker.setWidgetTimerFormat(selectedId, radio.value);
    });
  });
  sortOrderRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      window.eqTracker.setWidgetSortOrder(selectedId, radio.value);
    });
  });
  textSizeSlider.addEventListener('input', () => {
    const size = Number(textSizeSlider.value);
    textSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetTextSize(selectedId, size);
  });
  iconSizeSlider.addEventListener('input', () => {
    const size = Number(iconSizeSlider.value);
    iconSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetIconSize(selectedId, size);
  });
  iconsPerRowSlider.addEventListener('input', () => {
    const count = Number(iconsPerRowSlider.value);
    iconsPerRowValueEl.textContent = String(count);
    window.eqTracker.setWidgetIconsPerRow(selectedId, count);
  });
  rowSizeSlider.addEventListener('input', () => {
    const size = Number(rowSizeSlider.value);
    rowSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetRowSize(selectedId, size);
  });
  listWidthSlider.addEventListener('input', () => {
    const width = Number(listWidthSlider.value);
    listWidthValueEl.textContent = `${width}px`;
    window.eqTracker.setWidgetListWidth(selectedId, width);
  });
  showRowIconCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetShowRowIcon(selectedId, showRowIconCheckbox.checked);
  });
  mirrorRowCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetMirrorRowDirection(selectedId, mirrorRowCheckbox.checked);
  });
  opacitySlider.addEventListener('input', () => {
    window.eqTracker.setWidgetOpacity(selectedId, parseFloat(opacitySlider.value));
  });
  lowThresholdSlider.addEventListener('input', () => {
    const seconds = Number(lowThresholdSlider.value);
    lowThresholdValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    window.eqTracker.setWidgetLowTimeThreshold(selectedId, seconds);
  });
  landingGlowCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetLandingGlowEnabled(selectedId, landingGlowCheckbox.checked);
  });
  // Reported live 24 Aug: "the say text field doesn't update all the time when i try to edit it,
  // it should be freely editable and stay with whatever has been put in it." 'change' only fires
  // on blur/Enter, so anything typed and then left alone (cursor still in the box, no click
  // elsewhere) was never actually saved - the box LOOKED editable the whole time, but the store
  // still held whatever was there before, and anything that re-read the widget while that gap was
  // open would show the old text winning back over what was actually typed. 'input' saves on
  // every keystroke instead, debounced so normal typing speed doesn't fire an IPC round-trip
  // per character - the box itself is always the source of truth for what's ON SCREEN either way,
  // this only controls how quickly the STORED copy catches up to it.
  // QOL #8 - live preview of the {spell}/{caster}/{mob}/{profile} tokens, so you see the resolved
  // line as you type instead of finding out in game. Sample values for the cast-time tokens;
  // {profile} uses the real active loadout name.
  const textMessagePreviewEl = document.getElementById('widget-text-message-preview');
  let previewProfileName = 'Default';
  function loadPreviewProfileName() {
    Promise.all([window.eqTracker.getProfiles(), window.eqTracker.getActiveProfileId()])
      .then(([list, id]) => {
        previewProfileName = (list.find((p) => p.id === id) || {}).name || 'Default';
        renderTextMessagePreview();
      })
      .catch(() => {});
  }
  function renderTextMessagePreview() {
    if (!textMessagePreviewEl) return;
    const raw = textMessageInput.value || '';
    if (!raw.trim() || !/\{(spell|caster|mob|profile)\}/.test(raw)) {
      textMessagePreviewEl.style.display = 'none';
      return;
    }
    const resolved = raw
      .replace(/\{spell\}/g, 'Spirit of Wolf')
      .replace(/\{caster\}/g, 'Graznthok')
      .replace(/\{mob\}/g, 'Graznthok')
      .replace(/\{profile\}/g, previewProfileName || 'Default')
      .replace(/\s{2,}/g, ' ')
      .trim();
    textMessagePreviewEl.textContent = `Shows as:  ${resolved}`;
    textMessagePreviewEl.style.display = '';
  }
  loadPreviewProfileName();
  window.eqTracker.onActiveProfileChanged(() => loadPreviewProfileName());

  let textMessageSaveTimer = null;
  textMessageInput.addEventListener('input', () => {
    renderTextMessagePreview();
    clearTimeout(textMessageSaveTimer);
    textMessageSaveTimer = setTimeout(() => {
      window.eqTracker.setWidgetTextAuraMessage(selectedId, textMessageInput.value).then(updateLocalWidgetCache);
    }, 300);
  });
  textMessageInput.addEventListener('change', () => {
    clearTimeout(textMessageSaveTimer);
    window.eqTracker.setWidgetTextAuraMessage(selectedId, textMessageInput.value).then(updateLocalWidgetCache);
  });
  textInstantSlider.addEventListener('input', () => {
    const seconds = Number(textInstantSlider.value);
    textInstantValueEl.textContent = `${seconds}s`;
    window.eqTracker.setWidgetTextAuraInstantSec(selectedId, seconds);
  });
  textStackCheckbox.addEventListener('change', () => {
    // The "Lines visible" slider only means anything while stacking is on, so it expands and
    // collapses with the checkbox rather than sitting there inert.
    textStackMaxRowEl.style.display = textStackCheckbox.checked ? '' : 'none';
    window.eqTracker.setWidgetStackTextLines(selectedId, textStackCheckbox.checked).then(updateLocalWidgetCache);
  });
  textStackMaxSlider.addEventListener('input', () => {
    const n = Number(textStackMaxSlider.value);
    textStackMaxValueEl.textContent = String(n);
    window.eqTracker.setWidgetMaxStackTextLines(selectedId, n);
  });
  textAuraSizeSlider.addEventListener('input', () => {
    const size = Number(textAuraSizeSlider.value);
    textAuraSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetTextAuraSize(selectedId, size);
  });
  categoryBordersCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetCategoryBorders(selectedId, categoryBordersCheckbox.checked);
    // Live, not just on the next full re-select - a width control for an edge that was just
    // switched off would be offering to resize something no longer on screen.
    const widget = findWidget(selectedId);
    const showsIconOnly = widget && widget.displayMode === 'icons';
    borderWidthRowEl.style.display = showsIconOnly && categoryBordersCheckbox.checked ? '' : 'none';
  });
  borderWidthSlider.addEventListener('input', () => {
    const px = Number(borderWidthSlider.value);
    borderWidthValueEl.textContent = `${px}px`;
    window.eqTracker.setWidgetCategoryBorderWidth(selectedId, px);
  });
  // Note 20. The destination is set with /tell in game, never from here.
  //
  // Both in-app pickers - the dropdown that was on this settings card, and the searchable zone
  // list in the create panel - have been removed at the owner's instruction. Setting a travel
  // destination meant alt-tabbing out of the game you were trying to travel in, which is backwards
  // for the one aura whose whole job happens while you are moving. What is left is a read-out, so
  // the aura can still be identified without guessing which one is pointing where.
  // Cached rather than re-fetched every render - it's one global value (not per-widget, same as
  // the destination itself), and re-fetching on every selectWidget call would be one more IPC
  // round-trip for a value that only ever changes when the input below is actually edited.
  let currentTravelPickerCommand = 'eqtm';
  window.eqTracker.getTravelPickerCommand().then((cmd) => {
    currentTravelPickerCommand = cmd;
    if (document.activeElement !== travelCommandInputEl) travelCommandInputEl.value = cmd;
    showTravelDestination(findWidget(selectedId)?.travelDestination);
  });

  function showTravelDestination(destination) {
    if (!travelDestinationCurrentEl) return;
    travelDestinationCurrentEl.textContent =
      destination || `Nowhere yet - type /tell ${currentTravelPickerCommand} in game to pick one`;
  }

  // Populates the command-word input from the cached value - skipped while it has focus, same
  // reasoning as textMessageInput above (a re-render mid-edit shouldn't stomp what's being typed).
  function showTravelPickerCommand() {
    if (!travelCommandInputEl || document.activeElement === travelCommandInputEl) return;
    travelCommandInputEl.value = currentTravelPickerCommand;
  }

  travelCommandInputEl.addEventListener('change', () => {
    window.eqTracker.setTravelPickerCommand(travelCommandInputEl.value).then((cmd) => {
      currentTravelPickerCommand = cmd;
      travelCommandInputEl.value = cmd;
      showTravelDestination(findWidget(selectedId)?.travelDestination);
    });
  });

  fightTimeoutSlider.addEventListener('input', () => {
    const sec = Number(fightTimeoutSlider.value);
    fightTimeoutValueEl.textContent = `${sec}s`;
    window.eqTracker.setWidgetDamageOptions(selectedId, { fightTimeoutSec: sec });
  });
  mineOnlyCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetDamageOptions(selectedId, { mineOnly: mineOnlyCheckbox.checked });
  });
  totalRowCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetDamageOptions(selectedId, { showTotalRow: totalRowCheckbox.checked });
  });

  debuffCastByRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      window.eqTracker.setWidgetDebuffCastBy(selectedId, radio.value);
    });
  });

  allyAlertCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetAllyDebuffAlert(selectedId, allyAlertCheckbox.checked);
  });
  alwaysOnCheckbox.addEventListener('change', () => {
    // Same optimistic-recompute pattern as the displayMode radios above - "Show events for"
    // needs to hide/show the instant the checkbox is clicked, not just after the next reselect.
    const current = findWidget(selectedId);
    applySettingsPanelShape(current ? { ...current, alwaysOn: alwaysOnCheckbox.checked } : { alwaysOn: alwaysOnCheckbox.checked });
    window.eqTracker.setWidgetAlwaysOn(selectedId, alwaysOnCheckbox.checked).then((widget) => {
      if (widget) updateLocalWidgetCache(widget);
    });
  });
  // The "Only in:" zone search (QOL #2). renderZoneAddOptions filters knownZones live and each
  // result button adds its zone on mousedown; these just keep the results list in sync and hidden
  // when the field is not in use.
  const zoneSearch = document.getElementById('widget-zone-search');
  zoneSearch.addEventListener('input', () => renderZoneAddOptions(findWidget(selectedId)));
  zoneSearch.addEventListener('focus', () => renderZoneAddOptions(findWidget(selectedId)));
  zoneSearch.addEventListener('blur', () => setTimeout(() => {
    // A result button's mousedown preventDefaults, so focus never actually leaves during a pick;
    // this only fires when the user clicks away for real.
    if (document.activeElement !== zoneSearch) {
      const optionsEl = document.getElementById('widget-zone-options');
      if (optionsEl) optionsEl.style.display = 'none';
    }
  }, 120));

  mergeCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetMergeSameDuration(selectedId, mergeCheckbox.checked).then(refreshWidgets);
  });
  soundLandCheckbox.addEventListener('change', () => {
    syncSoundDisclosure();
    window.eqTracker.setWidgetSoundOnLand(selectedId, soundLandCheckbox.checked);
  });
  soundExpireCheckbox.addEventListener('change', () => {
    syncSoundDisclosure();
    window.eqTracker.setWidgetSoundOnExpire(selectedId, soundExpireCheckbox.checked);
  });

  const soundOpenFolderBtn = document.getElementById('widget-sound-open-folder-btn');
  soundOpenFolderBtn.addEventListener('click', () => {
    window.eqTracker.openSoundsFolder();
  });

  // Shared by every preview button below - previewing plays right here in
  // the main window, entirely separate from overlay.js's own playback (the
  // eqsound:// protocol is registered globally, so any renderer can load
  // it), and respects the same volume slider the real alerts use so a
  // preview is representative of what you'll actually hear.
  function currentVolumeFraction() {
    return (Number(alertVolumeSlider.value) || 0) / 100;
  }

  alertVolumeSlider.addEventListener('input', () => {
    const volume = Number(alertVolumeSlider.value);
    alertVolumeValueEl.textContent = `${volume}%`;
    window.eqTracker.setWidgetAlertVolume(selectedId, volume);
  });
  if (soundCooldownSlider) {
    soundCooldownSlider.addEventListener('input', () => {
      const secs = Number(soundCooldownSlider.value);
      soundCooldownValueEl.textContent = secs ? `${secs}s` : 'off';
      window.eqTracker.setWidgetSoundCooldownSec(selectedId, secs);
    });
  }

  // One picker per alert TYPE (land/expire/warning), not one shared sound
  // for the whole widget - see backlog #16. Factored into a helper since
  // the three are otherwise identical apart from which ids/setter they
  // touch. setterName indexes into window.eqTracker rather than being
  // passed the function directly so this stays simple to call three times
  // below without repeating the same five-line wiring block three times.
  function setupSoundPicker(kind, setterName) {
    const nameEl = document.getElementById(`widget-sound-${kind}-name`);
    const chooseBtn = document.getElementById(`widget-sound-${kind}-choose-btn`);
    const previewBtn = document.getElementById(`widget-sound-${kind}-preview-btn`);
    const resetBtn = document.getElementById(`widget-sound-${kind}-reset-btn`);
    let currentSoundId = null;

    function render(soundId) {
      currentSoundId = soundId;
      // "Use default" is always shown, just disabled when already on the default beep - so it
      // reads as an available choice next to "Choose sound...", not something that only appears
      // once you are already off the default. Preview genuinely does nothing without a file.
      resetBtn.disabled = !soundId;
      previewBtn.style.display = soundId ? '' : 'none';
      if (!soundId) {
        nameEl.textContent = 'Default beep';
        return;
      }
      window.eqTracker.getSoundInfo(soundId).then((info) => {
        nameEl.textContent = info ? info.originalName : 'Default beep';
      });
    }

    chooseBtn.addEventListener('click', () => {
      window.eqTracker.pickSound().then((result) => {
        if (!result) return; // cancelled, or picked something with an unrecognized extension
        // updateLocalWidgetCache: without it the settings panel's own copy of the widget still has
        // the old landSoundId, so navigating away and back re-rendered this as "Default beep" even
        // though the sound itself had changed (reported live 30 Aug).
        window.eqTracker[setterName](selectedId, result.id).then((cfg) => {
          updateLocalWidgetCache(cfg);
          render(result.id);
        });
      });
    });
    previewBtn.addEventListener('click', () => {
      if (!currentSoundId) return;
      const audio = new Audio(`eqsound://sound/${currentSoundId}`);
      audio.volume = currentVolumeFraction();
      audio.play().catch(() => {});
    });
    resetBtn.addEventListener('click', () => {
      window.eqTracker[setterName](selectedId, null).then((cfg) => {
        updateLocalWidgetCache(cfg);
        render(null);
      });
    });

    return render;
  }

  // Progressive disclosure for the Sounds section.
  //
  // A picker for a sound that is switched off is a control that does nothing, and there were five
  // of them stacked up. Each one now appears only with its own toggle, and the volume only when
  // at least one of the three can actually make a noise - a volume slider on a silent aura is the
  // clearest case of the same problem.
  //
  // The warning "toggle" is derived rather than stored: soundWarningSec > 0 IS the on state. That
  // avoids adding a second persisted field that could disagree with the number it is meant to
  // describe. Turning it on with no previous value picks 10s so it does something immediately;
  // turning it off writes 0, which is what every existing aura already means by "off".
  const DEFAULT_WARNING_SEC = 10;

  function syncSoundDisclosure() {
    const warnOn = Number(soundWarningSlider.value) > 0;
    if (soundWarningCheckbox) soundWarningCheckbox.checked = warnOn;
    if (soundLandRowEl) soundLandRowEl.style.display = soundLandCheckbox.checked ? '' : 'none';
    if (soundExpireRowEl) soundExpireRowEl.style.display = soundExpireCheckbox.checked ? '' : 'none';
    if (soundWarningGroupEl) soundWarningGroupEl.style.display = warnOn ? '' : 'none';
    const anySound = soundLandCheckbox.checked || soundExpireCheckbox.checked || warnOn;
    if (alertVolumeRowEl) alertVolumeRowEl.style.display = anySound ? '' : 'none';
    if (soundCooldownRowEl) soundCooldownRowEl.style.display = anySound ? '' : 'none';
  }

  if (soundWarningCheckbox) {
    soundWarningCheckbox.addEventListener('change', () => {
      const seconds = soundWarningCheckbox.checked ? DEFAULT_WARNING_SEC : 0;
      soundWarningSlider.value = String(seconds);
      soundWarningValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
      window.eqTracker.setWidgetSoundWarningSec(selectedId, seconds);
      syncSoundDisclosure();
    });
  }

  const renderLandSoundPicker = setupSoundPicker('land', 'setWidgetLandSoundId');
  const renderExpireSoundPicker = setupSoundPicker('expire', 'setWidgetExpireSoundId');
  const renderWarningSoundPicker = setupSoundPicker('warning', 'setWidgetWarningSoundId');
  soundWarningSlider.addEventListener('input', () => {
    const seconds = Number(soundWarningSlider.value);
    soundWarningValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    window.eqTracker.setWidgetSoundWarningSec(selectedId, seconds);
    syncSoundDisclosure();
  });
  soundWarningLoopSlider.addEventListener('input', () => {
    const seconds = Number(soundWarningLoopSlider.value);
    soundWarningLoopValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    window.eqTracker.setWidgetSoundWarningLoopSec(selectedId, seconds);
  });

  maxDurationSlider.addEventListener('input', () => {
    const minutes = Number(maxDurationSlider.value);
    maxDurationValueEl.textContent = minutes === 0 ? 'off' : `${minutes}m`;
    window.eqTracker.setWidgetMaxDurationFilter(selectedId, minutes * 60);
  });
  // One duration for every trigger on the aura - see the constructor comment on
  // DEFAULT_TRIGGER_DURATION_SEC in widgetStore.js. setTriggerDurationSec rewrites durationSec on
  // every existing trigger too, so the list re-renders to show the change took effect everywhere,
  // not just on the next one added.
  triggerDurationSlider.addEventListener('input', () => {
    const seconds = Number(triggerDurationSlider.value);
    triggerDurationValueEl.textContent = `${seconds}s`;
    window.eqTracker.setWidgetTriggerDurationSec(selectedId, seconds).then(() => {
      refreshWidgets().then(() => renderCustomTimersList(findWidget(selectedId)));
    });
  });
  andWindowSlider.addEventListener('input', () => {
    const seconds = Number(andWindowSlider.value);
    andWindowValueEl.textContent = `${seconds}s`;
    window.eqTracker.setWidgetAndWindowSec(selectedId, seconds).then(updateLocalWidgetCache);
  });
  reverseDetectionCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetReverseDetection(selectedId, reverseDetectionCheckbox.checked).then(updateLocalWidgetCache);
  });
  newTimerChooseIconBtn.addEventListener('click', () => {
    const showing = newTimerIconPicker.style.display !== 'none';
    newTimerIconPicker.innerHTML = '';
    if (showing) {
      newTimerIconPicker.style.display = 'none';
      return;
    }
    newTimerIconPicker.appendChild(
      buildIconPicker(newTimerIconId, (iconId) => {
        newTimerIconId = iconId;
        window.eqTracker.getIconSet().then((iconSet) => {
          setTimerIconPreview(`eqicon://icon/${encodeURIComponent(iconSet)}/${iconId}`);
        });
        newTimerIconPicker.style.display = 'none';
        newTimerIconPicker.innerHTML = '';
      })
    );
    newTimerIconPicker.style.display = '';
  });
  newTimerModeRadios.forEach((r) => r.addEventListener('change', updateTimerModeVisibility));
  newTimerChannelSelect.addEventListener('change', updateTimerChannelVisibility);
  newTimerWhoRadios.forEach((r) => r.addEventListener('change', updateTimerWhoVisibility));

  // Reads the form into the same shape addWidgetCustomTimer/
  // updateWidgetCustomTimer expect, or null if required fields aren't
  // filled in yet - shared by the normal Add/Save button and "Save as new"
  // below, so the two can never drift into gathering fields differently.
  function readTimerFormData() {
    const name = newTimerNameInput.value.trim();
    // Not a form field any more - every trigger on this aura shares the one duration set on the
    // aura itself (see widget-trigger-duration-slider), and 0 is a legitimate value here (a
    // trigger that only needs to make a sound, never stay on screen). Falls back to
    // widgetStore.js's own DEFAULT_TRIGGER_DURATION_SEC only if the widget can't be found at all -
    // not imported directly since a renderer can't require a main-process module, so the literal
    // has to be kept in sync by hand if that default ever moves.
    const widgetTriggerDurationSec = findWidget(selectedId)?.triggerDurationSec;
    const totalSec = typeof widgetTriggerDurationSec === 'number' ? widgetTriggerDurationSec : 5;
    const mode = [...newTimerModeRadios].find((r) => r.checked)?.value || 'chat';

    let trigger;
    let endedText;
    let triggerChat;
    let endedChat;
    if (mode === 'chat') {
      const channel = newTimerChannelSelect.value;
      const isSelf = [...newTimerWhoRadios].find((r) => r.checked)?.value === 'self';
      const who = newTimerWhoNameInput.value.trim();
      const message = newTimerChatMessageInput.value.trim();
      if (!message || (!isSelf && !who)) return null;
      trigger = buildChatTriggerLine(channel, isSelf, who, message);
      triggerChat = { channel, isSelf, name: isSelf ? undefined : who, message };
      const endedMessage = newTimerChatEndedMessageInput.value.trim();
      if (endedMessage) {
        endedText = buildChatTriggerLine(channel, isSelf, who, endedMessage);
        endedChat = { channel, isSelf, name: isSelf ? undefined : who, message: endedMessage };
      }
    } else if (mode === 'skill') {
      // No ended text - a cast has no natural "this ended" log line, and an interrupted cast
      // already cancels the timer on its own (see customTimerEngine's matchOwnInterrupt handling).
      trigger = newTimerSkillSelect.value;
      endedText = undefined;
    } else if (mode === 'zone') {
      // No ended text, same reasoning as skill mode - "entering zone X" and "leaving zone X" are
      // each their own complete, momentary event with nothing that could end them early.
      trigger = newTimerZoneSelect.value;
      endedText = undefined;
    } else {
      trigger = newTimerTriggerInput.value.trim();
      endedText = newTimerEndedInput.value.trim() || undefined;
    }
    if (!name || !trigger || totalSec < 0) return null;

    return {
      name,
      durationSec: totalSec,
      triggerText: trigger,
      endedText,
      triggerChat,
      endedChat,
      iconId: newTimerIconId,
      // Note 10. Empty means no cooldown, which is what every timer that existed before this had.
      cooldownSec: Number(newTimerCooldownInput.value) || 0,
      // 'contains' only for a raw-text trigger - the chat builder writes a whole line it composed
      // itself, so matching part of it would be matching part of something the user never typed.
      // 'castOf' for a skill-cast trigger - triggerText above is a SPELL NAME here, not a line;
      // see customTimerEngine's castOf mode. 'zoneEnter'/'zoneLeave' for a zone trigger -
      // triggerText above is a ZONE NAME, not a line either; see customTimerEngine's zone handling.
      triggerMatch:
        mode === 'skill'
          ? 'castOf'
          : mode === 'zone'
            ? ([...newTimerZoneDirectionRadios].find((r) => r.checked)?.value === 'leave' ? 'zoneLeave' : 'zoneEnter')
            : mode === 'raw' && [...newTimerMatchRadios].find((r) => r.checked)?.value === 'contains'
              ? 'contains'
              : undefined,
    };
  }

  // Master unlock for every aura at once. State is read back from the main
  // process rather than tracked here, so the button stays correct even when
  // something else changes it (unlocking a single aura, a profile switch).
  const masterUnlockAllBtn = document.getElementById('master-unlock-all-btn');
  const masterHideAllBtn = document.getElementById('master-hide-all-btn');
  const masterMuteBtn = document.getElementById('master-mute-btn');


  // =========================================================================
  // Weekly log rotation at the raid reset. The switch lives on the Archive log card in Setup,
  // beside the manual button that does the same job, because they are the same action.
  const logRotationCheckbox = document.getElementById('log-rotation-checkbox');
  const logRotationStatusEl = document.getElementById('log-rotation-status');

  function renderLogRotationStatus(s) {
    if (!s) return;
    logRotationCheckbox.checked = s.enabled !== false;
    const last = s.lastRun;
    // `boundaryDate` is the LOCAL calendar day of the reset. `boundary` beside it is a UTC string,
    // and slicing a date out of that names the wrong day for anyone far enough east - so the field
    // is read, never the string.
    if (last && last.failed && last.failed.length) {
      // Said out loud rather than swallowed, and said FIRST: a rotation that failed means the live
      // log still holds more than this week, and the grid is reading a wider window than it thinks.
      logRotationStatusEl.textContent =
        ` The last attempt could not archive ${last.failed.length} file(s), so the live log still ` +
        `holds more than this week.`;
    } else if (last && last.skippedUnreadable && last.skippedUnreadable.length) {
      logRotationStatusEl.textContent =
        ` ${last.skippedUnreadable.length} log(s) had no readable timestamp at the top, so they ` +
        `were left alone rather than archived on a guess.`;
    } else if (last && last.rotated && last.rotated.length) {
      logRotationStatusEl.textContent =
        ` Last archived ${last.rotated.length} log${last.rotated.length === 1 ? '' : 's'} for the ` +
        `week of ${last.boundaryDate}.`;
    } else if (s.lastCheck && s.lastCheck.skippedSpansBoundary && s.lastCheck.skippedSpansBoundary.length) {
      // Not an error, and worth saying: this is the state a player who raids on Tuesday will sit in
      // all week, and without a word here it looks identical to the feature being broken.
      logRotationStatusEl.textContent =
        ' Not archiving this week - the log already has play from after the reset in it, and ' +
        'archiving it would take those kills out of what the Lockouts page can see.';
    } else if (s.lastCheck && s.lastCheck.skippedBusy && s.lastCheck.skippedBusy.length) {
      logRotationStatusEl.textContent =
        ' Waiting for a quiet moment - the game is writing to the log right now.';
    } else if (s.lastCheck && /written to right now/.test(s.lastCheck.reason || '')) {
      logRotationStatusEl.textContent =
        ' Waiting for a quiet moment - the game is writing to the log right now.';
    } else if (s.lastCheck && s.lastCheck.reason === 'no logs folder') {
      logRotationStatusEl.textContent = ' Not running: no EverQuest Logs folder is set.';
    } else if (s.lastError) {
      logRotationStatusEl.textContent = ` Last problem: ${s.lastError}`;
    } else if (s.lastCheck && s.lastCheck.skippedAlreadyDone && s.lastCheck.skippedAlreadyDone.length) {
      logRotationStatusEl.textContent = ` This week's log has already been archived.`;
    } else {
      logRotationStatusEl.textContent = '';
    }
  }

  window.eqTracker.getLogRotationStatus().then(renderLogRotationStatus);
  // A rotation is one of the things that makes the grid change, so the same broadcast is the cue to
  // re-read this. Without it the line here would keep saying whatever was true when Setup was
  // first opened.
  window.eqTracker.onLockoutsChanged(() => {
    window.eqTracker.getLogRotationStatus().then(renderLogRotationStatus);
  });
  // And whenever Setup is opened. The check runs on a timer in the main process, so the line here
  // is stale the moment after it is drawn - and the commonest thing it has to say ("waiting for a
  // quiet moment") only ever becomes true AFTER the page has loaded. Reading it once at startup
  // meant the card was permanently blank, which reads as nothing happening rather than as working.
  const setupNavBtn = document.querySelector('.nav-btn[data-page="page-settings"]');
  if (setupNavBtn) {
    setupNavBtn.addEventListener('click', () => {
      window.eqTracker.getLogRotationStatus().then(renderLogRotationStatus);
    });
  }
  logRotationCheckbox.addEventListener('change', () => {
    window.eqTracker.setLogRotationEnabled(logRotationCheckbox.checked).then(renderLogRotationStatus);
  });

  // Raid lockouts (Session D's module; this only renders its projection)
  // =========================================================================
  //
  // THE UNCERTAINTY IS THE FEATURE. Everything here is written so that a cell the module could not
  // decide stays undecided on screen. In particular `not_looked` NEVER renders as `open` - they are
  // different colours, different words and different tooltips, because "I have no log for that
  // week" and "you have not killed it" are different facts and conflating them is the exact failure
  // this tool exists to avoid.
  //
  // There is deliberately NO COUNTDOWN. A countdown needs the reset hour, which has never been
  // measured. If one appears here later, it was invented.
  const lockoutCharSelect = document.getElementById('lockout-character');
  const lockoutRescanBtn = document.getElementById('lockout-rescan');
  const lockoutScanStatus = document.getElementById('lockout-scan-status');
  const lockoutPeriodHeadingEl = document.getElementById('lockout-period-heading');
  const lockoutSummaryEl = document.getElementById('lockout-summary');
  const lockoutGridEl = document.getElementById('lockout-grid');
  let lockoutData = null;

  // --- Log tools ---
  // "Change log file" / "Back to live log" sit next to Rescan. "Add split files" and "Trim to
  // this week" are created inline next to the gap / multi-week notice in renderLockouts(), so they
  // only appear when they apply.
  const lkChangeLogBtn = document.getElementById('lockout-change-log');
  const lkResetTargetBtn = document.getElementById('lockout-reset-log-target');
  const lkLogTargetEl = document.getElementById('lockout-log-target');

  function renderLogTools(data) {
    const st = (data && data.status) || {};
    if (lkLogTargetEl) {
      lkLogTargetEl.textContent = st.logTarget ? `Reading ${st.logTarget}` : '';
      lkLogTargetEl.style.display = st.logTarget ? '' : 'none';
    }
    if (lkResetTargetBtn) lkResetTargetBtn.style.display = st.logTarget ? '' : 'none';
  }

  // One in-flight guard for every "re-read the log" action, so a double-click or a Rescan mid-read
  // cannot interleave (the main side is locked too, but the buttons should not look clickable).
  let lockoutBusy = false;
  async function withLockoutBusy(fn) {
    if (lockoutBusy) return;
    lockoutBusy = true;
    for (const b of [lkChangeLogBtn, lkResetTargetBtn, lockoutRescanBtn]) if (b) b.disabled = true;
    lockoutScanStatus.textContent = 'reading…';
    try { await fn(); } finally {
      lockoutBusy = false;
      for (const b of [lkChangeLogBtn, lkResetTargetBtn, lockoutRescanBtn]) if (b) b.disabled = false;
    }
  }

  if (lkChangeLogBtn) {
    lkChangeLogBtn.addEventListener('click', async () => {
      const groups = await window.eqTracker.listLockoutLogFiles();
      const picked = await pickLogFiles({
        title: 'Change log file',
        hint: 'The grid will read this file instead of your live log. "Back to live log" undoes it.',
        multi: false,
        groups,
        current: (lockoutData && lockoutData.status && lockoutData.status.logTarget) || null,
      });
      if (!picked) return;
      withLockoutBusy(async () => applyLockoutData(await window.eqTracker.setLockoutLogTargetByPath(picked[0])));
    });
  }
  if (lkResetTargetBtn) {
    lkResetTargetBtn.addEventListener('click', () => {
      withLockoutBusy(async () => applyLockoutData(await window.eqTracker.setLockoutLogTargetByPath(null)));
    });
  }

  // The reset day/hour. One store key; this pair of controls and the pair on the Setup page both
  // edit it and both listen for the change, so they can never diverge.
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // The old hardcoded value, shown before the stored one loads so the fields are never blank.
  const RESET_DEFAULT = { weekday: 2, hour: 11 };
  const resetControls = [
    { day: document.getElementById('lockout-reset-day'), hour: document.getElementById('lockout-reset-hour') },
    { day: document.getElementById('setup-reset-day'), hour: document.getElementById('setup-reset-hour') },
  ].filter((c) => c.day && c.hour);
  for (const c of resetControls) {
    c.day.innerHTML = DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
  }
  function paintResetControls(rule) {
    for (const c of resetControls) {
      c.day.value = String(rule.weekday);
      c.hour.value = String(rule.hour);
    }
  }
  function commitReset(c) {
    const weekday = Number(c.day.value);
    let hour = Math.round(Number(c.hour.value));
    if (c.hour.value === '' || !Number.isFinite(hour)) hour = RESET_DEFAULT.hour;
    hour = Math.min(23, Math.max(0, hour));
    window.eqTracker.setLockoutReset({ weekday, hour }).then(paintResetControls);
  }
  for (const c of resetControls) {
    c.day.addEventListener('change', () => commitReset(c));
    c.hour.addEventListener('change', () => commitReset(c));
  }
  paintResetControls(RESET_DEFAULT); // never blank; overwritten by the stored value below
  window.eqTracker.getLockoutReset().then((r) => paintResetControls(r && Number.isInteger(r.hour) ? r : RESET_DEFAULT));
  window.eqTracker.onLockoutResetChanged((rule) => {
    paintResetControls(rule);
    if (typeof renderLogRotationStatus === 'function') {
      window.eqTracker.getLogRotationStatus().then(renderLogRotationStatus);
    }
  });
  let lockoutLoaded = false;

  // The five states the module can put on a cell, with the words shown to the reader. The wording
  // matters as much as the colour: "not looked" has to read as an absence of evidence, not as a
  // verdict, or the whole design is lost at the last inch.
  const LOCKOUT_STATES = {
    completed: { text: 'done', title: 'Observed completed this period.' },
    // NOT "the logs cover the whole period" - that is what the module's own `because` says, and on
    // her live data it is false: 14 open cells while 68 of the period's 113 hours are unobserved
    // across gaps short enough to be tolerated. The line below the grid says so, with numbers, and
    // a tooltip contradicting it is worse than no tooltip.
    open: {
      text: 'open',
      title: 'No kill seen since the reset, and no gap long enough to change that judgement - '
        + 'see the note under the grid for what was not observed.',
    },
    conditional: { text: 'depends', title: 'Falls either way depending on the reset hour, which has never been measured.' },
    // 'unknown' is the STATE the core sets; `uncertainCount` is what it calls the tally of them.
    // Mapping the count's name instead of the state's is exactly the unmapped-name failure this
    // tool is named for - the cell rendered the raw string, unstyled. Caught by the test below.
    unknown: { text: 'unclear', title: 'A kill this period at a tier the game did not state — one of this raid\'s tiers may be done.' },
    not_looked: { text: 'not looked', title: 'No log covers this week. This is NOT the same as open.' },
  };

  // "2026-08-25" -> "Aug 25" (or "Aug 25, 2026" with the year). The bare ISO form stacked three
  // dashes next to the en-dash in "2026-08-25 – 2026-09-01" and read like a subtraction.
  const LK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function lkPrettyDate(iso, withYear) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const base = `${LK_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
    return withYear ? `${base}, ${m[1]}` : base;
  }

  function lockoutCell(cell) {
    const td = document.createElement('td');
    const meta = LOCKOUT_STATES[cell.state] || { text: cell.state, title: '' };
    td.className = `lockout-cell lockout-${cell.state}`;
    td.textContent = meta.text;
    // `because` is the module's own sentence explaining this exact cell. Shown rather than
    // summarised, because a paraphrase is where hedging gets lost.
    td.title = `${meta.title}\n\n${cell.because || ''}`.trim();
    // A "done" cell shows WHEN it was done - the first completion's date. The module already
    // carries it as a field (cell.completedAt, "YYYY-MM-DD HH:MM:SS"); render the date part.
    if (cell.state === 'completed' && cell.completedAt) {
      const d = document.createElement('span');
      d.className = 'lockout-killdate';
      d.textContent = ` ${lkPrettyDate(String(cell.completedAt).slice(0, 10))}`;
      td.appendChild(d);
    }
    if (cell.decidedBy) {
      const s = document.createElement('span');
      s.className = 'lockout-pivot';
      s.textContent = ` (${cell.decidedBy.pivot})`;
      td.appendChild(s);
    }
    return td;
  }

  function renderLockouts() {
    if (!lockoutData) return;
    const entry = lockoutData.characters.find((c) => c.character === lockoutCharSelect.value)
      || lockoutData.characters[0];
    lockoutGridEl.innerHTML = '';
    lockoutSummaryEl.textContent = '';
    if (lockoutPeriodHeadingEl) lockoutPeriodHeadingEl.textContent = 'This period';
    if (!entry || !entry.grid) {
      // Say WHICH nothing this is. "No logs read yet" covers three different situations - never
      // scanned, scanned and found no EverQuest folder, scanned and found no character logs - and
      // a page whose argument is that it names what it does not know cannot be vague about its
      // own plumbing.
      const st = (lockoutData && lockoutData.status) || {};
      let why;
      if (entry && entry.error) why = `Could not read the logs: ${entry.error}`;
      else if (st.backfill === 'running') why = 'Reading your logs…';
      else if (st.lastError === 'no logs folder configured' || st.backfill === 'failed') {
        why = "EverQuest's folder has not been found. Set it on the Setup page and come back.";
      } else if (st.backfill === 'done') {
        why = 'Your Logs folder was read, but it holds no character logs this could use.';
      } else why = 'Not read yet.';
      lockoutSummaryEl.textContent = why;
      return;
    }

    const grid = entry.grid;
    const cells = grid.cells || [];
    const raids = [...new Set(cells.map((c) => c.raid))];
    const tiers = [...new Set(cells.map((c) => c.difficultyLabel))];

    // The week's date range, in the heading. Dates only - the reset time lives in the "Reset time"
    // control below. periodEnd should always be there (lockoutCore fills it); fall back to
    // start + 7 days so the heading never shows a "?".
    if (lockoutPeriodHeadingEl && grid.period) {
      const p = grid.period;
      const start = String(p.periodStart || p.boundaryDay || '').slice(0, 10);
      let end = String(p.periodEnd || '').slice(0, 10);
      if (!end && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
        const d = new Date(`${start}T00:00:00`);
        d.setDate(d.getDate() + 7);
        end = d.toISOString().slice(0, 10);
      }
      if (start && end) {
        const sameYear = start.slice(0, 4) === end.slice(0, 4);
        lockoutPeriodHeadingEl.textContent =
          `This period: ${lkPrettyDate(start, !sameYear)} – ${lkPrettyDate(end, true)}`;
      } else {
        lockoutPeriodHeadingEl.textContent = 'This period';
      }
    }

    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (const t of tiers) {
      const th = document.createElement('th');
      th.textContent = t;
      head.appendChild(th);
    }
    lockoutGridEl.appendChild(head);

    for (const raid of raids) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const row = cells.find((c) => c.raid === raid);
      th.textContent = row ? row.label : raid;
      th.title = row && row.bosses ? `Bosses: ${row.bosses.join(', ')}` : '';
      tr.appendChild(th);
      for (const t of tiers) {
        const cell = cells.find((c) => c.raid === raid && c.difficultyLabel === t);
        tr.appendChild(cell ? lockoutCell(cell) : document.createElement('td'));
      }
      lockoutGridEl.appendChild(tr);
    }

    // Counts, straight from the module. Not recomputed here - a second count is a second chance to
    // disagree with the thing it is describing.
    lockoutSummaryEl.textContent =
      `${grid.completedCount} done · ${grid.openCount} open · ${grid.notLookedCount} not looked` +
      (grid.conditionalCount ? ` · ${grid.conditionalCount} depends` : '') +
      (grid.uncertainCount ? ` · ${grid.uncertainCount} unclear` : '');

    // COVERAGE GAPS, INCLUDING THE TOLERATED ONES. This is the most important line on the page
    // after the grid itself.
    //
    // The module treats a hole shorter than 24 h as not worth downgrading a cell for, marks it
    // `tolerated: true`, and lets the cell read `open` - whose own `because` then says "coverage
    // spans the period". That threshold is a documented judgement rather than a measurement, and
    // it is a reasonable one, but it means an `open` cell can sit on top of a 23-hour hole in the
    // record. Session D's own page renders `coverageHoles`, which excludes the tolerated ones, so
    // there they are invisible. Here they are not: an absence of evidence has to look like one,
    // and that is the entire argument for this feature existing.
    const gaps = (grid.period && grid.period.coverageGaps) || [];
    if (gaps.length) {
      const total = gaps.reduce((n, g) => n + (g.hours || 0), 0);
      // Only worth saying while there ARE open cells for it to be about. The clause describes
        // what the grid above is showing, and after a rotation the grid is 25 "not looked" and no
        // "open" at all - where it read "N of them short enough that the cells above still read
        // open" directly underneath a line saying 0 open. That is the guaranteed state of this page
        // for the first days after the weekly archive ships, and a page whose whole argument is
        // that it never claims more than it knows cannot contradict itself in its own summary.
        const tolerated = grid.openCount > 0 ? gaps.filter((g) => g.tolerated).length : 0;
      const warn = document.createElement('p');
      warn.className = 'hint lockout-gapwarn';
      warn.textContent =
        `Your logs have ${gaps.length} gap${gaps.length === 1 ? '' : 's'} in this period, ` +
        `${total.toFixed(1)}h in total` +
        (tolerated ? ` — ${tolerated} of them short enough that the cells above still read "open" rather than "not looked"` : '') +
        `. Anything that happened in a gap is not in the grid. `;
      // If you split your log by accident, the missing hours are usually in Logs\Split\ - point
      // the parser at those files. This does not touch the live log.
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = 'Add split files…';
      addBtn.addEventListener('click', async () => {
        const groups = await window.eqTracker.listLockoutLogFiles();
        // Tick only the per-day files whose date falls inside THIS lockout week. Ticking every
        // split file (the old behaviour) pulled in earlier weeks - which add their own nightly
        // gaps and a "spans a prior week" flag that then offers a pointless "trim the live log".
        const per = grid.period || {};
        const lo = String(per.periodStart || per.boundaryDay || '').slice(0, 10);
        const hi = String(per.periodEnd || '').slice(0, 10) || '9999-12-31';
        const dateIn = (name) => {
          const m = /(\d{4}-\d{2}-\d{2})/.exec(name || '');
          return !!m && m[1] >= lo && m[1] <= hi;
        };
        const preselectPaths = (groups.split || []).filter((f) => dateIn(f.name)).map((f) => f.path);
        const picked = await pickLogFiles({
          title: 'Add split files',
          hint: 'Ticked: the per-day files for this lockout week. Pick others only if you know they hold missing hours. This adds them to the grid for this session only — your live log is not touched.',
          multi: true,
          groups,
          preselectPaths,
        });
        if (!picked) return;
        addBtn.disabled = true;
        const r = await window.eqTracker.addLockoutLogsByPaths(picked);
        applyLockoutData(r.projection);
        if (r.added && r.added.files === 0) {
          await appConfirm({ title: 'Nothing added', message: 'Those files held no lines for this character.', okLabel: 'OK', hideCancel: true });
        }
      });
      warn.appendChild(addBtn);
      lockoutSummaryEl.appendChild(document.createElement('br'));
      lockoutSummaryEl.appendChild(warn);
    }

    // The log reaches back before this week - offer to split it at the reset. ONLY for the live
    // log: trimming a file loaded via "Change log file" would rewrite an archive or a mule's log.
    const lkStatus = (lockoutData && lockoutData.status) || {};
    const onLiveLog = !lkStatus.logTarget;
    // Once extra per-day/archive files have been stitched in, the grid is a multi-file view and its
    // prior-week coverage is coming from those files, not the live log - trimming the live log
    // would do nothing useful, so the offer is hidden.
    const multiLog = (lkStatus.extraLogs || 0) > 0;
    if (entry.spansPriorWeek && onLiveLog && !multiLog) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'This log covers more than the current week. ';
      const trimBtn = document.createElement('button');
      trimBtn.type = 'button';
      trimBtn.className = 'btn-danger';
      trimBtn.textContent = 'Trim log to this week…';
      trimBtn.addEventListener('click', async () => {
        const go = await appConfirm({
          title: 'Trim log to this week',
          message: 'Archive everything before this week’s reset and rewrite the live log to just the current week?',
          detail: 'The removed part is copied to Logs\\Archive\\ and size-verified before anything is changed. EverQuest can stay running.',
          okLabel: 'Trim log',
          danger: true,
        });
        if (!go) return;
        trimBtn.disabled = true;
        const r = await window.eqTracker.trimLockoutLog();
        applyLockoutData(r.projection);
        const rep = r.report || {};
        await appConfirm(rep.ok
          ? { title: 'Trimmed', message: `Archived ${(rep.archivedBytes / 1048576).toFixed(1)} MB.`, detail: rep.archivedTo, okLabel: 'OK', hideCancel: true }
          : { title: 'Not trimmed', message: rep.reason || 'unknown', okLabel: 'OK', hideCancel: true });
      });
      p.appendChild(trimBtn);
      lockoutSummaryEl.appendChild(p);
    }
  }

  function applyLockoutData(data) {
    lockoutData = data;
    const prev = lockoutCharSelect.value;
    lockoutCharSelect.innerHTML = '';
    for (const c of data.characters) {
      const o = document.createElement('option');
      o.value = c.character;
      o.textContent = c.character;
      lockoutCharSelect.appendChild(o);
    }
    if (prev && data.characters.some((c) => c.character === prev)) lockoutCharSelect.value = prev;
    const s = data.status || {};
    lockoutScanStatus.textContent = s.backfill === 'running' ? 'reading…' : '';
    renderLockouts();
    renderLogTools(data);
  }

  // Loaded the first time the page is opened, never at startup. The scan reads every log file in
  // the folder, and a user who never opens this page should not pay for it.
  function loadLockoutsOnce() {
    if (lockoutLoaded) return;
    lockoutLoaded = true;
    lockoutScanStatus.textContent = 'reading…';
    window.eqTracker.getLockouts().then(applyLockoutData);
  }

  document.getElementById('lockouts-nav-btn').addEventListener('click', loadLockoutsOnce);
  lockoutCharSelect.addEventListener('change', renderLockouts);
  lockoutRescanBtn.addEventListener('click', () => {
    withLockoutBusy(async () => applyLockoutData(await window.eqTracker.rescanLockouts()));
  });
  window.eqTracker.onLockoutsChanged(() => {
    if (lockoutLoaded) window.eqTracker.getLockouts().then(applyLockoutData);
  });

  function renderMasterButtons(state) {
    masterUnlockAllBtn.classList.toggle('active', state.allUnlocked);
    masterUnlockAllBtn.textContent = state.allUnlocked ? 'Lock all auras' : 'Unlock all auras';
    // Note 4. The label changes as well as the colour: the button is in the always-visible bar,
    // so it is read at a glance from across the room, and "Hide auras" while auras are already
    // hidden would be the wrong half of the sentence.
    masterHideAllBtn.classList.toggle('active', state.masterHidden);
    masterHideAllBtn.textContent = state.masterHidden ? 'Auras hidden - show' : 'Hide auras';
    // QOL #10 - same at-a-glance label treatment.
    if (masterMuteBtn) {
      masterMuteBtn.classList.toggle('active', state.soundsMuted);
      masterMuteBtn.textContent = state.soundsMuted ? 'Sounds muted - unmute' : 'Mute sounds';
    }
  }
  function refreshMasterButtons() {
    return window.eqTracker.getOverlayMasterState().then(renderMasterButtons);
  }
  masterUnlockAllBtn.addEventListener('click', () => {
    window.eqTracker.getOverlayMasterState().then((state) =>
      window.eqTracker.setOverlayAllUnlocked(!state.allUnlocked).then(() => {
        refreshMasterButtons();
        // The per-aura Unlock button shows the same state, so it has to be
        // re-read rather than left showing a stale label.
        if (selectedId) {
          window.eqTracker.isWidgetLocked(selectedId).then((locked) => {
            lockBtn.textContent = locked ? 'Unlock to move' : 'Lock aura';
            lockBtn.classList.toggle('unlocked', !locked);
          });
        }
      })
    );
  });
  // The Pause hotkey toggles the same state from outside this window, so the button has to
  // re-read rather than assume it is the only thing that can change it.
  window.eqTracker.onOverlayMasterStateChanged(() => refreshMasterButtons());
  masterHideAllBtn.addEventListener('click', () => {
    window.eqTracker.getOverlayMasterState().then((state) =>
      window.eqTracker.setOverlayMasterHidden(!state.masterHidden).then(refreshMasterButtons)
    );
  });
  if (masterMuteBtn) {
    masterMuteBtn.addEventListener('click', () => {
      window.eqTracker.getOverlayMasterState().then((state) =>
        window.eqTracker.setOverlaySoundsMuted(!state.soundsMuted).then(refreshMasterButtons)
      );
    });
  }
  refreshMasterButtons();

  addTimerBtn.addEventListener('click', () => openTimerModal());
  newTimerCancelBtn.addEventListener('click', closeTimerModal);
  closeCustomTimerModalBtn.addEventListener('click', closeTimerModal);
  customTimerModalBackdrop.addEventListener('click', (e) => {
    if (e.target === customTimerModalBackdrop) closeTimerModal();
  });
  newTimerAddBtn.addEventListener('click', () => {
    const timerData = readTimerFormData();
    if (!timerData) return;
    const request = editingTimerId
      ? window.eqTracker.updateWidgetCustomTimer(selectedId, editingTimerId, timerData)
      : window.eqTracker.addWidgetCustomTimer(selectedId, timerData);
    request
      .then(() => {
        closeTimerModal();
        return refreshWidgets();
      })
      .then(() => renderCustomTimersList(findWidget(selectedId)));
  });
  // Only ever shown while editing an existing timer (see the Edit button
  // handler) - always creates a new one from the form's current values
  // instead of overwriting the timer being edited, so tweaking a copy (a
  // different message on the same channel/person, say) doesn't cost you
  // the original.
  newTimerSaveAsNewBtn.addEventListener('click', () => {
    const timerData = readTimerFormData();
    if (!timerData) return;
    window.eqTracker
      .addWidgetCustomTimer(selectedId, timerData)
      .then(() => {
        closeTimerModal();
        return refreshWidgets();
      })
      .then(() => renderCustomTimersList(findWidget(selectedId)));
  });
  anchorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      anchorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.eqTracker.setWidgetContentAnchor(selectedId, btn.dataset.anchor);
    });
  });
  wrapTextCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetWrapText(selectedId, wrapTextCheckbox.checked);
  });
  iconJustifyRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) window.eqTracker.setWidgetIconJustify(selectedId, radio.value);
    });
  });
  textJustifyRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) window.eqTracker.setWidgetTextJustify(selectedId, radio.value);
    });
  });
  showIconLabelCheckbox.addEventListener('change', () => {
    updateIconLabelOptionsVisibility();
    window.eqTracker.setWidgetShowIconLabel(selectedId, showIconLabelCheckbox.checked);
  });
  groupAllyCheckbox.addEventListener('change', () => {
    // The direction choice only means anything while grouping is on, so it
    // appears and disappears with the toggle rather than sitting there inert.
    allyDirectionRow.style.display = groupAllyCheckbox.checked ? '' : 'none';
    window.eqTracker.setWidgetGroupAllyBuffs(selectedId, groupAllyCheckbox.checked);
  });
  allyDirectionRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) window.eqTracker.setWidgetGroupAllyDirection(selectedId, radio.value);
    });
  });
  hideAllyNameCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetHideAllyNameOnTile(selectedId, hideAllyNameCheckbox.checked);
  });

  timerTextColorPicker.addEventListener('input', () => {
    window.eqTracker.setWidgetTimerTextColor(selectedId, timerTextColorPicker.value);
  });
  labelTextColorPicker.addEventListener('input', () => {
    window.eqTracker.setWidgetLabelTextColor(selectedId, labelTextColorPicker.value);
  });
  marginWidthSlider.addEventListener('input', () => {
    const px = Number(marginWidthSlider.value);
    marginWidthValueEl.textContent = px + 'px';
    window.eqTracker.setWidgetIconMargin(selectedId, px);
  });

  iconLabelSizeSlider.addEventListener('input', () => {
    const size = Number(iconLabelSizeSlider.value);
    iconLabelSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetIconLabelSize(selectedId, size);
  });
  iconLabelAnchorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      iconLabelAnchorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.eqTracker.setWidgetIconLabelAnchor(selectedId, btn.dataset.anchor);
    });
  });
  deleteBtn.addEventListener('click', () => handleDelete(selectedId));
  filterSearch.addEventListener('input', applyBuffFilterSearch);

  duplicateWidgetBtn.addEventListener('click', () => {
    window.eqTracker.duplicateWidget(selectedId).then((config) => {
      if (config) focusWidget(config.id);
    });
  });
  // A custom sound is a file in THIS install's app data. The code carries an id that means
  // nothing on anyone else's machine, so the three sound-file slots are deliberately left out of
  // SHAREABLE_FIELDS and the recipient falls back to the default beep - a cosmetic loss nobody
  // needs more than a passing note about.
  function soundWarningFor(widget) {
    if (!widget) return '';
    const files = ['landSoundId', 'expireSoundId', 'warningSoundId'].filter((k) => widget[k]);
    if (!files.length) return '';
    const which = files.length === 1 ? 'sound file' : 'sound files';
    return `Note: your chosen ${which} will not travel with this code. Everything else does; whoever ` +
      `imports it hears the default beep unless you send them the file separately.`;
  }

  // Pulled out to its own function so the sidebar context menu's "Export as code..." (added 25
  // Aug - "any button that goes into the manage aura card, should be added to the right click
  // menu... this is just a shortcut to these buttons") can call the exact same logic instead of a
  // second, subtly different path - the same lesson Rename's own window.prompt() bug already
  // taught this file once.
  function handleExport(id) {
    window.eqTracker.exportWidget(id).then((code) => {
      if (!code) return;
      exportCodeOutput.value = code;
      exportCodeRow.style.display = '';
      const warning = soundWarningFor(findWidget(id));
      exportSoundWarningEl.textContent = warning;
      exportSoundWarningEl.style.display = warning ? '' : 'none';
      exportCodeOutput.select();
    });
  }
  exportBtn.addEventListener('click', () => handleExport(selectedId));
  copyCodeBtn.addEventListener('click', () => {
    exportCodeOutput.select();
    // Clipboard API is best-effort here - the textarea is already
    // selected either way, so a plain Ctrl+C always works as a fallback
    // even if the write silently fails for some reason. The button text
    // still flips to "Copied!" regardless of which path actually worked -
    // no way to tell from here whether the user follows up with a manual
    // Ctrl+C, and claiming success either way is the same as every other
    // "copy" button anywhere else doing this.
    navigator.clipboard?.writeText(exportCodeOutput.value).catch(() => {});
    copyCodeBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyCodeBtn.textContent = 'Copy';
    }, 1500);
  });
  importBtn.addEventListener('click', () => {
    const code = importCodeInput.value.trim();
    if (!code) return;
    window.eqTracker.peekWidgetCode(code).then((info) => {
      if (!info) {
        importStatus.textContent = "That doesn't look like a valid aura code.";
        return;
      }

      if (info.kind === 'self-buffs-builtin') {
        // Self Buffs is a singleton - this code has to overwrite the
        // existing one in place, never spawn a second "Self Buffs".
        // Settings only: name isn't touched.
        const confirmed = window.confirm(
          'This code is for the Self Buffs aura and will overwrite its current settings ' +
            '(display, filters, sounds, etc.) - not create a new aura. Continue?'
        );
        if (!confirmed) return;
        window.eqTracker.applyCodeToSelfBuffs(code).then((config) => {
          if (!config) {
            importStatus.textContent = 'Import failed.';
            return;
          }
          closeAddWidgetModal();
          focusWidget('self-buffs');
        });
        return;
      }

      window.eqTracker.importWidget(code).then((config) => {
        if (!config) {
          importStatus.textContent = "That doesn't look like a valid aura code.";
          return;
        }
        closeAddWidgetModal();
        focusWidget(config.id);
      });
    });
  });

  window.eqTracker.getKnownBuffs().then((buffs) => {
    allKnownBuffs = buffs;
  });

  // initProfileBar() (a separate closure, see above) creates/renames
  // profiles and can migrate widgets into a new one, but has no reference
  // into this panel's own `widgets` array or the open "Loadout profiles"
  // checklist - without this, creating a profile left an already-open
  // widget's checklist showing a stale snapshot from before the migration,
  // even though the real data on disk was already correct. Reacts to the
  // same profiles:changed broadcast initProfileBar listens to, independently.
  window.eqTracker.onProfilesChanged(() => {
    refreshProfilesCache().then(() => {
      refreshWidgets().then(() => {
        const widget = selectedId && findWidget(selectedId);
        if (widget) renderWidgetProfilesChecklist(widget);
      });
    });
  });
  // The dot's colour depends on which profile is CURRENT, not just which profiles a widget is
  // scoped to - switching profiles has to re-render the sidebar even though no widget's own
  // data changed at all.
  window.eqTracker.onActiveProfileChanged((id) => {
    currentActiveProfileId = id;
    renderWidgetSubmenu();
  });
  refreshProfilesCache().then(renderWidgetSubmenu);
  refreshActiveProfileCache().then(renderWidgetSubmenu);

  window.eqTracker.getActiveBuffs().then((buffs) => {
    latestSelfBuffs = buffs;
    refreshActiveBuffsCardIfSelected();
  });
  window.eqTracker.onActiveBuffsChanged((buffs) => {
    latestSelfBuffs = buffs;
    refreshActiveBuffsCardIfSelected();
  });
  window.eqTracker.getActiveAllyBuffs().then((buffs) => {
    latestAllyBuffs = buffs;
    refreshActiveBuffsCardIfSelected();
  });
  window.eqTracker.onActiveAllyBuffsChanged((buffs) => {
    latestAllyBuffs = buffs;
    refreshActiveBuffsCardIfSelected();
  });
  window.eqTracker.getActiveCustomTimers().then((timers) => {
    latestActiveCustomTimers = timers;
    refreshActiveBuffsCardIfSelected();
  });
  window.eqTracker.onActiveCustomTimersChanged((timers) => {
    latestActiveCustomTimers = timers;
    refreshActiveBuffsCardIfSelected();
  });

  refreshWidgets();

  const iconSetSelect = document.getElementById('icon-set-select');
  Promise.all([window.eqTracker.getIconSets(), window.eqTracker.getIconSet()]).then(([sets, current]) => {
    iconSetSelect.innerHTML = '';
    for (const set of sets) {
      const opt = document.createElement('option');
      opt.value = set;
      opt.textContent = set;
      opt.selected = set === current;
      iconSetSelect.appendChild(opt);
    }
  });
  iconSetSelect.addEventListener('change', () => {
    window.eqTracker.setIconSet(iconSetSelect.value);
  });
}

const KNOWN_BUFF_RENDER_CAP = 200;

// Lazily builds a scrollable grid of every available spell icon (built only
// when actually opened, not per-row up front - there can be thousands) and
// calls onSelect(iconId) when one is clicked.
// Icons themselves carry no name data at all - just a numeric ID into a
// sprite sheet - so a text search can't match against the icons directly.
// What it filters against instead is known buffs' names, since "I want
// this to look like buff X" is the realistic way someone would think to
// search for an icon by name at all - typing hides every thumbnail except
// ones some known buff with a matching name currently uses. Filters the
// grid itself directly (hide/show thumbnails) rather than showing a
// separate list of name matches to pick from - one thing to look at, not
// two.
function buildIconPicker(currentIconId, onSelect) {
  const outerWrap = document.createElement('div');

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Filter by buff name...';
  searchInput.className = 'text-input search-input';
  outerWrap.appendChild(searchInput);

  const wrap = document.createElement('div');
  wrap.className = 'icon-picker-grid';
  wrap.innerHTML = '<span class="empty">Loading icons...</span>';
  outerWrap.appendChild(wrap);

  Promise.all([window.eqTracker.getIconCount(), window.eqTracker.getIconSet(), window.eqTracker.getKnownBuffs()]).then(
    ([count, iconSet, knownBuffs]) => {
      wrap.innerHTML = '';
      if (!count) {
        wrap.innerHTML = '<span class="empty">No EQ install detected yet - set it up on the Setup page first.</span>';
        return;
      }
      // More than one buff can share the same icon (not unusual), so this
      // collects every name that resolves to each icon ID, not just one.
      const namesByIconId = new Map();
      for (const b of knownBuffs) {
        if (b.iconId == null) continue;
        if (!namesByIconId.has(b.iconId)) namesByIconId.set(b.iconId, []);
        namesByIconId.get(b.iconId).push(b.name);
      }

      const thumbs = [];
      for (let id = 0; id < count; id++) {
        const names = namesByIconId.get(id) || [];
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.className = 'icon-picker-thumb' + (id === currentIconId ? ' selected' : '');
        img.src = `eqicon://icon/${encodeURIComponent(iconSet)}/${id}`;
        img.title = names.length ? `Icon ${id} - ${names.join(', ')}` : `Icon ${id}`;
        img.addEventListener('click', () => onSelect(id));
        wrap.appendChild(img);
        thumbs.push({ img, lowerNames: names.map((n) => n.toLowerCase()) });
      }

      searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        for (const thumb of thumbs) {
          const matches = !query || thumb.lowerNames.some((n) => n.includes(query));
          thumb.img.style.display = matches ? '' : 'none';
        }
      });
    }
  );
  return outerWrap;
}

// Shared by the full Known Buffs search list and the Custom Buffs list -
// same row shape (icon, name, duration, landing/ended text, Overlay
// toggle, icon picker, Save, Delete) either way.
function buildKnownBuffRow(buff, refresh) {
  const li = document.createElement('li');
  li.className = 'unknown-buff-row';

  const icon = buildIconThumb(buff.iconUrl);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'buff-name';
  nameSpan.textContent = buff.name;

  const duration = buildDurationInputs(buff.durationSec);

  const overlayLabel = document.createElement('label');
  overlayLabel.className = 'overlay-toggle-label';
  const overlayCheckbox = document.createElement('input');
  overlayCheckbox.type = 'checkbox';
  overlayCheckbox.checked = buff.showOnOverlay !== false;
  overlayCheckbox.addEventListener('change', () => {
    window.eqTracker.setShowOnOverlay(buff.name, overlayCheckbox.checked);
  });
  overlayLabel.append(overlayCheckbox, document.createTextNode('Overlay'));

  // Manual override for "hide bard songs" - automatic detection only fires
  // from a "You begin singing X" cast-begin line, which some auto-renewing
  // songs never produce (the renewal shows up as landing text only). This
  // lets a song get tagged directly regardless of whether that line was
  // ever seen.
  const bardSongLabel = document.createElement('label');
  bardSongLabel.className = 'overlay-toggle-label';
  const bardSongCheckbox = document.createElement('input');
  bardSongCheckbox.type = 'checkbox';
  bardSongCheckbox.checked = !!buff.isBardSong;
  bardSongCheckbox.addEventListener('change', () => {
    window.eqTracker.setBardSong(buff.name, bardSongCheckbox.checked);
  });
  bardSongLabel.append(bardSongCheckbox, document.createTextNode('Bard song'));

  // Some spells carry a fixed duration the duration-extension AAs never
  // touch (Promised Renewal is the confirmed one). Without this the only
  // lever was the global multiplier, which is all-or-nothing - correcting one
  // unscaled spell would have thrown out the scaling every other buff needs.
  const noScalingLabel = document.createElement('label');
  noScalingLabel.className = 'overlay-toggle-label';
  noScalingLabel.title =
    "Don't apply your Spell Casting Reinforcement / Extended Enhancement bonus to this buff - for spells whose duration the game never extends.";
  const noScalingCheckbox = document.createElement('input');
  noScalingCheckbox.type = 'checkbox';
  noScalingCheckbox.checked = !!buff.noDurationScaling;
  noScalingCheckbox.addEventListener('change', () => {
    window.eqTracker.setNoDurationScaling(buff.name, noScalingCheckbox.checked);
  });
  noScalingLabel.append(noScalingCheckbox, document.createTextNode('No AA scaling'));

  const landingInput = document.createElement('input');
  landingInput.type = 'text';
  landingInput.placeholder = 'Landing text (optional)';
  landingInput.className = 'text-input';
  landingInput.value = buff.landingText || '';

  const endedInput = document.createElement('input');
  endedInput.type = 'text';
  endedInput.placeholder = 'Ended text (optional)';
  endedInput.className = 'text-input';
  endedInput.value = buff.endedText || '';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const totalSec = duration.getSeconds();
    if (totalSec <= 0) {
      duration.focus();
      return;
    }
    window.eqTracker
      .upsertKnownBuff(buff.name, totalSec, {
        landingText: landingInput.value.trim() || undefined,
        endedText: endedInput.value.trim() || undefined,
      })
      .then(refresh);
  });

  const pickerContainer = document.createElement('div');
  pickerContainer.className = 'row';
  pickerContainer.style.display = 'none';

  const iconBtn = document.createElement('button');
  iconBtn.textContent = 'Choose icon...';
  iconBtn.addEventListener('click', () => {
    const showing = pickerContainer.style.display !== 'none';
    pickerContainer.innerHTML = '';
    if (showing) {
      pickerContainer.style.display = 'none';
      return;
    }
    pickerContainer.appendChild(
      buildIconPicker(buff.iconId, (iconId) => {
        window.eqTracker.upsertKnownBuff(buff.name, buff.durationSec, { iconId }).then(refresh);
      })
    );
    pickerContainer.style.display = '';
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    if (!window.confirm(`Delete "${buff.name}" from the buff database? This can't be undone.`)) return;
    window.eqTracker.removeKnownBuff(buff.name).then(refresh);
  });

  const topRow = document.createElement('div');
  topRow.className = 'row';
  if (icon) topRow.append(icon);
  topRow.append(nameSpan, duration.element, saveBtn, overlayLabel, bardSongLabel, noScalingLabel, iconBtn, deleteBtn);

  const textRow = document.createElement('div');
  textRow.className = 'row';
  textRow.append(landingInput, endedInput);

  li.append(topRow, textRow, pickerContainer);
  return li;
}

function initKnownBuffsPanel() {
  const listEl = document.getElementById('known-buffs');
  const customListEl = document.getElementById('custom-buffs');
  const nameInput = document.getElementById('new-buff-name');
  const minutesInput = document.getElementById('new-buff-minutes');
  const secondsInput = document.getElementById('new-buff-seconds');
  const landingInputNew = document.getElementById('new-buff-landing');
  const endedInputNew = document.getElementById('new-buff-ended');
  const addBtn = document.getElementById('new-buff-add-btn');
  const searchInput = document.getElementById('known-buff-search');
  const newBuffIconPreview = document.getElementById('new-buff-icon-preview');
  const newBuffChooseIconBtn = document.getElementById('new-buff-choose-icon-btn');
  const newBuffIconPicker = document.getElementById('new-buff-icon-picker');

  let allBuffs = [];
  let newBuffIconId;

  function renderKnown(buffs, truncatedCount) {
    listEl.innerHTML = '';
    if (buffs.length === 0) {
      listEl.innerHTML = '<li class="empty">No matching buffs.</li>';
      return;
    }
    for (const buff of buffs) {
      listEl.appendChild(buildKnownBuffRow(buff, refresh));
    }
    if (truncatedCount) {
      const notice = document.createElement('li');
      notice.className = 'empty';
      notice.textContent = `+${truncatedCount} more - narrow your search to see them.`;
      listEl.appendChild(notice);
    }
  }

  function renderCustomBuffs() {
    const custom = allBuffs.filter((b) => b.custom);
    customListEl.innerHTML = '';
    if (custom.length === 0) {
      customListEl.innerHTML = '<li class="empty">None yet.</li>';
      return;
    }
    for (const buff of custom) {
      customListEl.appendChild(buildKnownBuffRow(buff, refresh));
    }
  }

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      listEl.innerHTML = `<li class="empty">Type to search ${allBuffs.length.toLocaleString()} known buffs...</li>`;
      return;
    }
    const filtered = allBuffs.filter((b) => b.name.toLowerCase().includes(query));
    const shown = filtered.slice(0, KNOWN_BUFF_RENDER_CAP);
    renderKnown(shown, filtered.length - shown.length);
  }

  function refresh() {
    return window.eqTracker.getKnownBuffs().then((buffs) => {
      allBuffs = buffs;
      applyFilter();
      renderCustomBuffs();
    });
  }

  searchInput.addEventListener('input', applyFilter);

  newBuffChooseIconBtn.addEventListener('click', () => {
    const showing = newBuffIconPicker.style.display !== 'none';
    newBuffIconPicker.innerHTML = '';
    if (showing) {
      newBuffIconPicker.style.display = 'none';
      return;
    }
    newBuffIconPicker.appendChild(
      buildIconPicker(newBuffIconId, (iconId) => {
        newBuffIconId = iconId;
        window.eqTracker.getIconSet().then((iconSet) => {
          newBuffIconPreview.src = `eqicon://icon/${encodeURIComponent(iconSet)}/${iconId}`;
          newBuffIconPreview.style.display = '';
        });
        newBuffIconPicker.style.display = 'none';
        newBuffIconPicker.innerHTML = '';
      })
    );
    newBuffIconPicker.style.display = '';
  });

  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const minutes = parseInt(minutesInput.value, 10) || 0;
    const seconds = parseInt(secondsInput.value, 10) || 0;
    const totalSec = minutes * 60 + seconds;
    if (!name || totalSec <= 0) return;
    window.eqTracker
      .upsertKnownBuff(name, totalSec, {
        landingText: landingInputNew.value.trim() || undefined,
        endedText: endedInputNew.value.trim() || undefined,
        iconId: newBuffIconId,
      })
      .then(() => {
        nameInput.value = '';
        minutesInput.value = '';
        secondsInput.value = '';
        landingInputNew.value = '';
        endedInputNew.value = '';
        newBuffIconId = undefined;
        newBuffIconPreview.style.display = 'none';
        refresh();
      });
  });

  refresh();
  // Resolving an unknown buff adds a new known-buff entry - keep this list
  // in sync with that (deliberately NOT hooked to onActiveBuffsChanged,
  // which fires every second and would blow away in-progress edits here).
  window.eqTracker.onUnknownBuffsChanged(refresh);

  // Each of these three sections lives in its own modal now rather than an
  // always-visible inline card - the underlying elements/logic above are
  // unchanged, kept live in the background (refresh() already runs
  // regardless of visibility) so a modal shows current data the instant
  // it's opened, no extra fetch needed.
  setupModalToggle('add-buff-modal-backdrop', 'open-add-buff-modal-btn', 'close-add-buff-modal');
  setupModalToggle('custom-buffs-modal-backdrop', 'open-custom-buffs-modal-btn', 'close-custom-buffs-modal');
  setupModalToggle('known-buffs-modal-backdrop', 'open-known-buffs-modal-btn', 'close-known-buffs-modal', () =>
    searchInput.focus()
  );
}

// Shared open/close wiring for the simple "button opens a modal" pattern -
// backdrop click or the X closes it, same as the remembered-choices modal.
// In-app confirm. No OS dialog. Resolves true on OK, false on Cancel / close / backdrop click.
// One at a time. A second modal (e.g. "logging is off" firing while the log picker is open) waits
// for the first to close rather than stacking two backdrops.
let _modalOpen = false;
function whenModalFree() {
  if (!_modalOpen) return Promise.resolve();
  return new Promise((res) => {
    const t = setInterval(() => { if (!_modalOpen) { clearInterval(t); res(); } }, 80);
  });
}

// Set while an appConfirm is on screen, so something else (e.g. "logging is OK now") can dismiss it.
let _appConfirmClose = null;
function closeAppConfirm(val = false) { if (_appConfirmClose) _appConfirmClose(val); }

async function appConfirm(opts = {}) {
  await whenModalFree();
  return _appConfirm(opts);
}
function _appConfirm({ title = 'Confirm', message = '', detail = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false, hideCancel = false } = {}) {
  return new Promise((resolve) => {
    _modalOpen = true;
    const bd = document.getElementById('app-confirm-modal-backdrop');
    document.getElementById('app-confirm-title').textContent = title;
    document.getElementById('app-confirm-message').textContent = message;
    const detEl = document.getElementById('app-confirm-detail');
    detEl.textContent = detail;
    detEl.style.display = detail ? '' : 'none';
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    const closeX = document.getElementById('app-confirm-close');
    cancel.style.display = hideCancel ? 'none' : '';
    cancel.textContent = cancelLabel;
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', !!danger);
    ok.classList.toggle('btn-prominent', !danger);
    const done = (val) => {
      bd.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeX.removeEventListener('click', onCancel);
      bd.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      _appConfirmClose = null;
      _modalOpen = false;
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === bd) done(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeX.addEventListener('click', onCancel);
    bd.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    _appConfirmClose = done;
    bd.style.display = 'flex';
  });
}

// In-app log-file picker. `groups` is { live:[], split:[], archive:[] } of { name, path, size }.
// Resolves an array of chosen paths, or null on cancel.
async function pickLogFiles(opts = {}) {
  await whenModalFree();
  return _pickLogFiles(opts);
}
function _pickLogFiles({ title = 'Choose a log file', hint = '', multi = false, groups = {}, preselectGroup = null, preselectPaths = null, current = null } = {}) {
  const preselectSet = preselectPaths ? new Set(preselectPaths) : null;
  return new Promise((resolve) => {
    _modalOpen = true;
    const bd = document.getElementById('log-picker-modal-backdrop');
    document.getElementById('log-picker-title').textContent = title;
    document.getElementById('log-picker-hint').textContent = hint;
    const list = document.getElementById('log-picker-list');
    list.innerHTML = '';
    const mb = (n) => (typeof n === 'number' && n >= 0 ? `  (${(n / 1048576).toFixed(1)} MB)` : '');
    const sections = [
      ['live', 'Current log folder'], ['split', 'Split (per-day)'], ['archive', 'Archive (weekly)'],
      ['export', 'Exported bundles'], ['backup', 'Backups'], // reused by the #3c config import picker
    ];
    let firstInput = null;
    for (const [key, label] of sections) {
      const files = groups[key] || [];
      if (!files.length) continue;
      const h = document.createElement('li');
      h.className = 'hint';
      h.textContent = label;
      list.appendChild(h);
      for (const f of files) {
        const li = document.createElement('li');
        const input = document.createElement('input');
        input.type = multi ? 'checkbox' : 'radio';
        input.name = 'log-pick';
        input.value = f.path;
        if (multi && preselectSet) input.checked = preselectSet.has(f.path);
        else if (multi && preselectGroup === key) input.checked = true;
        if (!multi && current && f.path === current) input.checked = true;
        input.addEventListener('change', syncOk);
        firstInput = firstInput || input;
        const lab = document.createElement('label');
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(` ${f.name}${mb(f.size)}`));
        li.appendChild(lab);
        list.appendChild(li);
      }
    }
    // For a single pick with no current match, default to the newest file so OK is never a no-op.
    if (!multi && firstInput && !list.querySelector('input:checked')) firstInput.checked = true;
    if (!list.children.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'No log files found.';
      list.appendChild(li);
    }
    const ok = document.getElementById('log-picker-ok');
    const cancel = document.getElementById('log-picker-cancel');
    const closeX = document.getElementById('log-picker-close');
    function syncOk() { ok.disabled = list.querySelectorAll('input:checked').length === 0; }
    syncOk();
    const done = (val) => {
      bd.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeX.removeEventListener('click', onCancel);
      bd.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      _modalOpen = false;
      resolve(val);
    };
    const onOk = () => {
      const picked = [...list.querySelectorAll('input:checked')].map((i) => i.value);
      done(picked.length ? picked : null);
    };
    const onCancel = () => done(null);
    const onBackdrop = (e) => { if (e.target === bd) done(null); };
    const onKey = (e) => {
      if (e.key === 'Escape') done(null);
      else if (e.key === 'Enter' && !ok.disabled) onOk();
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeX.addEventListener('click', onCancel);
    bd.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    bd.style.display = 'flex';
  });
}

function setupModalToggle(backdropId, openBtnId, closeBtnId, onOpen) {
  const backdrop = document.getElementById(backdropId);
  const openBtn = document.getElementById(openBtnId);
  const closeBtn = document.getElementById(closeBtnId);

  function open() {
    backdrop.style.display = 'flex';
    if (onOpen) onOpen();
  }
  function close() {
    backdrop.style.display = 'none';
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
}

init();

// App text size for THIS window. Backed by Electron's zoom factor in main.js - see the note
// there for why that rather than rewriting 316 hardcoded px values as rem.
//
// The slider is populated from the saved value on load. That is the same trap the alert-volume
// slider fell into: an HTML range with no `value` attribute silently falls back to the midpoint
// of its own range, so an unpopulated 80-160 slider would sit at 120 while the window rendered
// at 100%.
// A dropdown rather than a slider, and the reason is worth keeping: this setting rescales the
// window it lives in. A slider applying on `input` moved itself out from under the cursor on the
// first pixel of the drag, so the value jumped around and the control was effectively unusable.
// A dropdown has no such feedback loop - one value, committed once, after the pointer has left.
function initUiScale() {
  const select = document.getElementById('ui-scale-select');
  const resetBtn = document.getElementById('ui-scale-reset-btn');
  if (!select) return;

  function show(pct) {
    // Snap to the nearest offered step rather than leaving the box blank: a saved value from the
    // old slider (which had its own steps) must still select something.
    const options = Array.from(select.options).map((o) => Number(o.value));
    const nearest = options.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
    select.value = String(nearest);
  }

  window.eqTracker.getUiScale().then((pct) => show(pct || 100));

  select.addEventListener('change', () => {
    // The main process clamps and persists, and returns what it actually used.
    window.eqTracker.setUiScale(Number(select.value));
  });

  resetBtn.addEventListener('click', () => {
    show(100);
    window.eqTracker.setUiScale(100);
  });
}

// Drag-to-resize the sidebar.
//
// The width lives in a --sidebar-width custom property on :root rather than as an inline style on
// the sidebar itself, so CSS keeps deciding how it is used and this only supplies the number.
// 190 is repeated here and in main-window.css: CSS needs it to render before any script runs, and
// the drag needs it to clamp. Named rather than pretended away.
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 190;

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;

  // Never widen the sidebar past what the window can show. Applied to what is DISPLAYED only -
  // the stored preference is left alone, so a narrow window does not permanently shrink a width
  // chosen in a wide one. The main process keeps the same split (see clampStoredSidebarWidth).
  function fit(px) {
    const roomForPages = 320;
    const maxHere = Math.max(SIDEBAR_MIN, window.innerWidth - roomForPages);
    return Math.min(maxHere, Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px))));
  }

  let stored = SIDEBAR_DEFAULT;
  function apply(px) {
    document.documentElement.style.setProperty('--sidebar-width', `${fit(px)}px`);
  }

  window.eqTracker.getSidebarWidth().then((px) => {
    stored = px || SIDEBAR_DEFAULT;
    apply(stored);
  });

  // Re-fit on window resize, without touching the stored preference: shrink the window and the
  // sidebar gives way, widen it again and the chosen width comes back.
  window.addEventListener('resize', () => apply(stored));

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    // Pointer capture keeps the drag alive when the cursor outruns the 4px handle, which it will
    // immediately. Without it the drag dies the moment the pointer leaves the element.
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('sidebar-resizing');
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    apply(startWidth + (e.clientX - startX));
  });

  function endDrag(e) {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('dragging');
    document.body.classList.remove('sidebar-resizing');
    // Persist what is on screen, then trust the main process's clamp as the record of truth.
    const shown = Math.round(sidebar.getBoundingClientRect().width);
    window.eqTracker.setSidebarWidth(shown).then((saved) => { stored = saved; });
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Double-click restores the default, which is the quickest way out of a width that went wrong.
  handle.addEventListener('dblclick', () => {
    apply(SIDEBAR_DEFAULT);
    window.eqTracker.setSidebarWidth(SIDEBAR_DEFAULT).then((saved) => { stored = saved; });
  });
}

// Sound-only alert for an incoming trade request.
//
// The first alert in the app that draws nothing. Every other sound is a per-aura setting fired
// from a tile changing state, so it needs an aura to exist and a tile to appear. A trade request
// wants neither - it is a nudge, and building it as an aura would put a countdown on screen for
// something with no duration.
//
// It lives entirely in this window, with no new plumbing, because the settings renderer already
// receives every log line: logService broadcasts `log:line` for the raw feed on the Log page and
// preload exposes onLogLine. This just listens to the same stream. The window is alive for the
// app's whole lifetime (closing it quits the app), so there is no case where the app is running
// and this listener is not.
//
// Deliberately NOT firing on completion or cancellation: the note asked for the request, which is
// the one that needs attention while you are looking at something else. The other lines are in
// the log if they are ever wanted.
const TRADE_REQUEST_PATTERN = /^([A-Za-z]+) is interested in making a trade\.$/;

// "<Name> tells you, '<message>'" - measured in shareCodeChat.js's own survey of the owner's logs
// (44 occurrences). Kept separate from CHAT_PATTERN there rather than shared: that module also
// matches guild/group/say/shout, all of which should stay silent here.
const TELL_PATTERN = /^([A-Za-z]+) tells you, '.*'$/;

// Reported live: an unrated tell ping machine-guns the sound during a burst of messages. Pulled
// out as its own pure function (rather than left inline in initTradePing's closure) purely so a
// plain Node test can pin the actual decision - see test/trade-ping.test.js. cooldownMs of 0 means
// off, matching every other "0 = off" cooldown/threshold convention already used across this app
// (soundWarningSec, etc.) - always true regardless of how recent the last ping was.
function tellShouldPing(now, lastPingAt, cooldownMs) {
  if (cooldownMs <= 0) return true;
  return now - lastPingAt >= cooldownMs;
}

// The app-wide half of note 8. A radio group rather than a per-aura setting because the owner
// could not choose between the two readings and asked for both - which makes it something you
// try, and a setting you try belongs somewhere you change it once, not on every aura.
function initMergeRule() {
  const radios = document.querySelectorAll('input[name="merge-rule"]');
  window.eqTracker.getMergeRule().then((rule) => {
    radios.forEach((radio) => {
      radio.checked = radio.value === rule;
    });
  });
  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) window.eqTracker.setMergeRule(radio.value);
    });
  });
}

// Setup-page jump point to the sounds folder (25 Aug) - requested directly: "add a link in the
// setup to the sounds folder as an easy jump point." Reuses the exact same IPC call the per-aura
// Sounds section's own "Open sounds folder" button already uses (see initWidgetsPanel further
// down) - both open whatever soundService.js's defaultPickerDir() currently resolves to, which as
// of the bundled-sounds work earlier this session means the install's own sounds/ folder the
// first time (or any time nothing's been picked from elsewhere yet). Living on the Setup page
// means reaching it no longer requires opening a specific aura's settings first.
function initSoundsFolderLink() {
  const btn = document.getElementById('open-sounds-folder-btn');
  if (!btn) return;
  btn.addEventListener('click', () => window.eqTracker.openSoundsFolder());
}

// Setup > App info > App data - opens the userData folder (QOL #3a), and "Back up now" snapshots
// the whole folder into a dated subfolder (QOL #3b).
function initConfigFolderLink() {
  const openBtn = document.getElementById('open-config-folder-btn');
  if (openBtn) openBtn.addEventListener('click', () => window.eqTracker.openConfigFolder());

  const backupBtn = document.getElementById('backup-config-btn');
  const statusEl = document.getElementById('backup-config-status');
  if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
      backupBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Backing up…';
      const r = await window.eqTracker.backupConfig().catch(() => ({ ok: false, error: 'failed' }));
      backupBtn.disabled = false;
      if (statusEl) {
        statusEl.textContent = r.ok
          ? `Backed up ${r.items} item${r.items === 1 ? '' : 's'} to  backups\\${r.path.split(/[\\/]/).pop()}`
          : `Backup failed: ${r.error || 'unknown'}`;
        statusEl.classList.toggle('warn', !r.ok);
      }
    });
  }

  // QOL #3c - export / import a portable config bundle.
  const exportBtn = document.getElementById('export-config-btn');
  const importBtn = document.getElementById('import-config-btn');
  const openExportsBtn = document.getElementById('open-exports-folder-btn');
  const xferStatusEl = document.getElementById('transfer-config-status');
  const setXfer = (text, warn) => {
    if (!xferStatusEl) return;
    xferStatusEl.textContent = text;
    xferStatusEl.classList.toggle('warn', !!warn);
  };
  if (openExportsBtn) openExportsBtn.addEventListener('click', () => window.eqTracker.openExportsFolder());
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      setXfer('Exporting…');
      const r = await window.eqTracker.exportConfig().catch(() => ({ ok: false, error: 'failed' }));
      exportBtn.disabled = false;
      setXfer(
        r.ok
          ? `Exported to  exports\\${r.path.split(/[\\/]/).pop()}  — zip that folder to share it.`
          : `Export failed: ${r.error || 'unknown'}`,
        !r.ok
      );
    });
  }
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const list = await window.eqTracker.listImportableConfig().catch(() => []);
      if (!list.length) {
        await appConfirm({
          title: 'Nothing to import',
          message: 'No exported bundle or backup was found. Export one first, or drop a bundle folder into the exports folder.',
          okLabel: 'OK', hideCancel: true,
        });
        return;
      }
      const groups = { export: [], backup: [] };
      for (const b of list) groups[b.group].push({ name: b.name, path: b.path });
      const picked = await pickLogFiles({
        title: 'Import config',
        hint: 'Pick a bundle. Your current config is backed up first, then the app restarts.',
        multi: false,
        groups,
      });
      if (!picked) return;
      const go = await appConfirm({
        title: 'Import config',
        message: 'Replace this PC\'s auras, profiles, known-buff edits, sounds and settings with the picked bundle?',
        detail: 'Your current config is copied to backups\\ first. The app then restarts to load the new one.',
        okLabel: 'Import and restart',
        danger: true,
      });
      if (!go) return;
      setXfer('Importing…');
      const r = await window.eqTracker.importConfig(picked[0]).catch(() => ({ ok: false, error: 'failed' }));
      if (r.ok) {
        await appConfirm({
          title: 'Imported',
          message: `Imported ${r.items} item${r.items === 1 ? '' : 's'}. Restart the app now to load it.`,
          detail: `Your previous config was saved to ${r.backedUpTo}`,
          okLabel: 'OK', hideCancel: true,
        });
        setXfer('Imported — restart the app to apply.');
      } else {
        setXfer(`Import failed: ${r.error || 'unknown'}`, true);
      }
    });
  }
}

// QOL #5 - a one-line "is the app reading my log right now?" answer at the top of the Buff Tracker
// page. Polls a cheap main-process handler; a stale timestamp or the wrong filename is then
// visible at a glance instead of only in Log > Diagnostics.
function initLogActivityLine() {
  const el = document.getElementById('log-activity-line');
  if (!el) return;
  const ago = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
  };
  async function tick() {
    let a;
    try { a = await window.eqTracker.getLogActivity(); } catch { return; }
    el.classList.remove('warn', 'ok');
    if (!a.folderSet) {
      el.textContent = 'No EverQuest log folder is set yet — set it on the Log page.';
      el.classList.add('warn');
    } else if (!a.sawLine) {
      el.textContent = `Watching ${a.file || 'for a log file'} — nothing read yet. Type something in game (or /log on) to confirm.`;
    } else if (a.lastLineAgoMs < 15000) {
      el.textContent = `Reading ${a.file} — last line ${ago(a.lastLineAgoMs)}.`;
      el.classList.add('ok');
    } else if (a.lastLineAgoMs < 90000) {
      el.textContent = `Watching ${a.file} — last line ${ago(a.lastLineAgoMs)}.`;
    } else {
      el.textContent = `Watching ${a.file} — nothing for ${ago(a.lastLineAgoMs)}. If you are in game, check that /log on is active.`;
      el.classList.add('warn');
    }
  }
  tick();
  setInterval(tick, 3000);

  // QOL #9 - the exclusive-fullscreen warning shares this card. Push channel keeps it live; ask
  // once on load for the current value (null = the foreground watcher is off, so leave it hidden).
  const fsLine = document.getElementById('fullscreen-warning-line');
  if (fsLine) {
    const setFs = (active) => { fsLine.hidden = !active; };
    window.eqTracker.getFullscreenState?.().then((v) => setFs(v === true)).catch(() => {});
    window.eqTracker.onFullscreenWarning?.((active) => setFs(!!active));
  }
}

// About page's "Copy bug report" button - the simplest useful version of the backlog ask: the app
// version and the last chunk of today's detection log, together in one clipboard paste. The
// detection log is what actually makes a report diagnosable (see gotcha #28's whole history: a
// report and a correct landing looked identical without it) - version alone tells someone which
// build to look at, not what happened. getRecentLogTail returns '' with no error when Diagnostics
// has never been turned on (no log file exists yet) - the report still goes out with just the
// version rather than blocking on it, and the status text says so rather than staying silent.
function initBugReport() {
  const btn = document.getElementById('copy-bug-report-btn');
  const statusEl = document.getElementById('copy-bug-report-status');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const [versionInfo, logTail] = await Promise.all([
      window.eqTracker.getVersionInfo(),
      window.eqTracker.getRecentLogTail(4000),
    ]);
    const lines = [
      `EQLS Auras ${versionInfo.appVersion} (Electron ${versionInfo.electronVersion}, Node ${versionInfo.nodeVersion})`,
      '',
      'What happened:',
      '(describe it here)',
      '',
    ];
    if (logTail) {
      lines.push('Recent detection log:', '```', logTail.trim(), '```');
    } else {
      lines.push('(no detection log available - turn on Diagnostics under the Log page before reporting, if this happens again)');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      statusEl.textContent = 'Copied - paste it wherever you report bugs.';
    } catch {
      statusEl.textContent = 'Could not copy to clipboard.';
    }
  });
}

// The Action Bar overlay (CLAUDE.md's "Action bar cover replacements" backlog entry) - the
// calibration bar's own sliders/lock/reset/opacity, and the 12 gems (icon, name, disable, and an
// optional cooldown). See actionBarManager.js.
function initActionBarsPage() {
  const navBtn = document.getElementById('action-bars-nav-btn');
  if (!navBtn) return;
  const submenuEl = document.getElementById('action-bars-submenu');
  const addRow = submenuEl.querySelector('.nav-add-widget-row');
  const openAddBtn = document.getElementById('open-add-action-bar-modal-btn');
  const addModalBackdrop = document.getElementById('create-action-bar-modal-backdrop');
  const closeAddModalBtn = document.getElementById('close-create-action-bar-modal');
  const newBarNameInput = document.getElementById('new-action-bar-name-input');
  const createBarSubmitBtn = document.getElementById('create-action-bar-submit-btn');
  const pageTitleEl = document.getElementById('page-action-bars-title');
  const introCardEl = document.getElementById('action-bars-intro-card');
  const settingsPanelEl = document.getElementById('action-bars-settings-panel');
  const barNameInput = document.getElementById('action-bar-name-input');
  const deleteBarBtn = document.getElementById('delete-action-bar-btn');
  const copySettingsBtn = document.getElementById('action-bar-copy-settings-btn');
  const copySourceMenuEl = document.getElementById('action-bar-copy-source-menu');
  const removeOverridesBtn = document.getElementById('action-bar-remove-overrides-btn');
  const barProfilesTogglesEl = document.getElementById('action-bar-profiles-toggles');
  // Same right-click menu shape as an aura's own sidebar row - see openSidebarContextMenu
  // elsewhere in this file for the pattern being mirrored.
  const actionBarContextMenuEl = document.getElementById('action-bar-context-menu');
  const actionBarContextRenameBtn = document.getElementById('action-bar-context-rename');
  const actionBarContextDuplicateBtn = document.getElementById('action-bar-context-duplicate');
  const actionBarContextDeleteBtn = document.getElementById('action-bar-context-delete');
  const renameModalBackdrop = document.getElementById('rename-action-bar-modal-backdrop');
  const renameInput = document.getElementById('rename-action-bar-input');
  const renameSaveBtn = document.getElementById('rename-action-bar-save-btn');
  const renameCancelBtn = document.getElementById('rename-action-bar-cancel-btn');
  const closeRenameModalBtn = document.getElementById('close-rename-action-bar-modal');

  let actionBars = [];
  let selectedActionBarId = null;
  let actionBarContextMenuId = null;
  let renameActionBarId = null;

  // Same mechanic as the aura sidebar's profile dot (initWidgetsPanel, around line 1795) - kept
  // as this panel's own copy rather than sharing the widgets-panel variables, since the two
  // panels are separate top-level functions with no shared closure.
  let actionBarLatestProfiles = [];
  let actionBarCurrentActiveProfileId = null;
  function refreshActionBarProfilesCache() {
    return window.eqTracker.getProfiles().then((list) => {
      actionBarLatestProfiles = list;
    });
  }
  function refreshActionBarActiveProfileCache() {
    return window.eqTracker.getActiveProfileId().then((id) => {
      actionBarCurrentActiveProfileId = id;
    });
  }

  // Shared clamping logic for every floating popup on this page (the context menu and the copy-
  // settings source menu) - same math openSidebarContextMenu already uses for the widget one, so
  // a menu opened near the bottom/edge of this frameless window still draws fully on screen.
  function positionFloatingMenu(menuEl, x, y) {
    menuEl.style.display = 'block';
    const rect = menuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    menuEl.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    menuEl.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
  }

  function openActionBarContextMenu(id, x, y) {
    actionBarContextMenuId = id;
    positionFloatingMenu(actionBarContextMenuEl, x, y);
  }
  function closeActionBarContextMenu() {
    actionBarContextMenuEl.style.display = 'none';
    actionBarContextMenuId = null;
  }

  // Button-triggered popup, not a permanent dropdown in the card - requested directly: "copy
  // settings should be a button that opens a drop down to copy settings, not have the drop down
  // in the card." Built fresh each time it opens rather than kept in sync continuously, same
  // "only needed while actually open" reasoning as the context menu above.
  function openCopySourceMenu(x, y) {
    copySourceMenuEl.innerHTML = '';
    const others = actionBars.filter((b) => b.id !== selectedActionBarId);
    if (others.length === 0) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'hint';
      span.style.display = 'block';
      span.style.padding = '6px 10px';
      span.textContent = 'No other action bars exist.';
      li.appendChild(span);
      copySourceMenuEl.appendChild(li);
    } else {
      others.forEach((bar) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = bar.name;
        btn.addEventListener('click', () => {
          closeCopySourceMenu();
          if (!selectedActionBarId) return;
          window.eqTracker.copyActionBarSettings(selectedActionBarId, bar.id).then(() => {
            selectActionBar(selectedActionBarId); // reload the form so every copied field shows its new value
          });
        });
        li.appendChild(btn);
        copySourceMenuEl.appendChild(li);
      });
    }
    positionFloatingMenu(copySourceMenuEl, x, y);
  }
  function closeCopySourceMenu() {
    copySourceMenuEl.style.display = 'none';
  }

  window.addEventListener('click', (e) => {
    if (actionBarContextMenuEl.style.display !== 'none' && !actionBarContextMenuEl.contains(e.target)) {
      closeActionBarContextMenu();
    }
    if (copySourceMenuEl.style.display !== 'none' && !copySourceMenuEl.contains(e.target) && !copySettingsBtn.contains(e.target)) {
      closeCopySourceMenu();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeActionBarContextMenu();
    closeCopySourceMenu();
  });
  window.addEventListener('contextmenu', (e) => {
    if (actionBarContextMenuEl.style.display !== 'none' && !e.defaultPrevented) closeActionBarContextMenu();
  });

  function openRenameActionBarModal(id) {
    const bar = findActionBar(id);
    if (!bar) return;
    renameActionBarId = id;
    renameInput.value = bar.name;
    renameModalBackdrop.style.display = 'flex';
    renameInput.focus();
    renameInput.select();
  }
  function closeRenameActionBarModal() {
    renameModalBackdrop.style.display = 'none';
    renameActionBarId = null;
  }
  function saveRenameActionBar() {
    if (!renameActionBarId) return;
    const id = renameActionBarId;
    window.eqTracker.setActionBarName(id, renameInput.value.trim() || 'Action Bar').then(() => {
      closeRenameActionBarModal();
      refreshActionBarsList().then(() => {
        if (selectedActionBarId === id) selectActionBar(id); // refresh the title/name field too
      });
    });
  }
  renameSaveBtn.addEventListener('click', saveRenameActionBar);
  renameCancelBtn.addEventListener('click', closeRenameActionBarModal);
  closeRenameModalBtn.addEventListener('click', closeRenameActionBarModal);
  renameModalBackdrop.addEventListener('click', (e) => {
    if (e.target === renameModalBackdrop) closeRenameActionBarModal();
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRenameActionBar();
    else if (e.key === 'Escape') closeRenameActionBarModal();
  });

  function handleDuplicateActionBar(id) {
    window.eqTracker.duplicateActionBar(id).then((bar) => {
      if (!bar) return;
      refreshActionBarsList().then(() => {
        activateNavButton(navBtn);
        selectActionBar(bar.id);
      });
    });
  }

  function handleDeleteActionBar(id) {
    const bar = findActionBar(id);
    const confirmed = window.confirm(
      `Delete action bar "${bar ? bar.name : ''}"? This closes its overlay window and can't be undone.`
    );
    if (!confirmed) return;
    window.eqTracker.deleteActionBar(id).then(() => {
      refreshActionBarsList().then((list) => {
        if (selectedActionBarId !== id) return; // a different bar than the one open was deleted
        if (list.length > 0) selectActionBar(list[0].id);
        else selectActionBar(null);
      });
    });
  }

  actionBarContextRenameBtn.addEventListener('click', () => {
    const id = actionBarContextMenuId;
    closeActionBarContextMenu();
    if (id) openRenameActionBarModal(id);
  });
  actionBarContextDuplicateBtn.addEventListener('click', () => {
    const id = actionBarContextMenuId;
    closeActionBarContextMenu();
    if (id) handleDuplicateActionBar(id);
  });
  actionBarContextDeleteBtn.addEventListener('click', () => {
    const id = actionBarContextMenuId;
    closeActionBarContextMenu();
    if (id) handleDeleteActionBar(id);
  });

  // Same shape as renderWidgetProfilesChecklist - a checkbox per profile, ticking/unticking
  // updates activeProfileIds immediately (that IS the bar's visibility control, same as a widget).
  function renderActionBarProfilesChecklist(bar) {
    barProfilesTogglesEl.innerHTML = '';
    window.eqTracker.getProfiles().then((profiles) => {
      const activeIds = new Set(bar.activeProfileIds || []);
      // Same fix as renderWidgetProfilesChecklist: showOnAllProfiles reads as every checkbox
      // being ON even though activeIds is empty - rendering unchecked here made an actually-on
      // bar look off, needing a second click to really turn it off for that profile.
      const allOn = !!bar.showOnAllProfiles;
      profiles.forEach((profile) => {
        const checked = allOn || activeIds.has(profile.id);
        const label = document.createElement('label');
        label.className = 'profile-toggle' + (checked ? ' on' : '');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.addEventListener('change', () => {
          const fresh = findActionBar(bar.id);
          const current = fresh?.showOnAllProfiles
            ? new Set(profiles.map((p) => p.id))
            : new Set(fresh?.activeProfileIds || []);
          if (checkbox.checked) current.add(profile.id);
          else current.delete(profile.id);
          label.classList.toggle('on', checkbox.checked);
          window.eqTracker.setActionBarActiveProfileIds(bar.id, [...current]).then((updated) => {
            if (updated) {
              const idx = actionBars.findIndex((b) => b.id === bar.id);
              if (idx !== -1) actionBars[idx] = updated;
            }
          });
        });
        label.append(checkbox, document.createTextNode(profile.name));
        barProfilesTogglesEl.appendChild(label);
      });
      if (profiles.length === 0) {
        barProfilesTogglesEl.innerHTML = '<span class="hint">No profiles exist.</span>';
      }
    });
  }

  function findActionBar(id) {
    return actionBars.find((b) => b.id === id) || null;
  }

  function renderActionBarSubmenu() {
    submenuEl.querySelectorAll('.nav-sub-row').forEach((row) => row.remove());
    actionBars.forEach((bar) => {
      const row = document.createElement('div');
      row.className = 'nav-sub-row';
      const btn = document.createElement('button');
      btn.className = 'nav-btn nav-sub-btn' + (bar.id === selectedActionBarId ? ' active' : '');
      btn.dataset.page = 'page-action-bars';
      btn.addEventListener('click', () => {
        activateNavButton(btn);
        selectActionBar(bar.id);
      });
      const nameSpan = document.createElement('span');
      nameSpan.className = 'nav-sub-name';
      nameSpan.textContent = bar.name;
      btn.appendChild(nameSpan);

      // Same dot as the aura sidebar (initWidgetsPanel) - green means active on the CURRENT
      // profile right now, grey means it isn't, regardless of how many profiles it's scoped to.
      const activeProfileIds = bar.activeProfileIds || [];
      const isActiveNow = !!bar.showOnAllProfiles || activeProfileIds.includes(actionBarCurrentActiveProfileId);
      const dotWrap = document.createElement('span');
      dotWrap.className = 'profile-dot-wrap';
      const dot = document.createElement('span');
      dot.className = 'profile-dot' + (isActiveNow ? ' profile-dot-on' : ' profile-dot-off');
      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip-bubble';
      if (bar.showOnAllProfiles) {
        tooltip.textContent = 'Active now (every profile)';
      } else {
        const names = actionBarLatestProfiles.filter((p) => activeProfileIds.includes(p.id)).map((p) => p.name);
        const scopeText = names.length > 0 ? `scoped to: ${names.join(', ')}` : 'not scoped to any profile';
        tooltip.textContent = isActiveNow ? `Active now (${scopeText})` : `Not active on the current profile (${scopeText})`;
      }
      dotWrap.append(dot, tooltip);
      btn.appendChild(dotWrap);

      row.appendChild(btn);
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openActionBarContextMenu(bar.id, e.clientX, e.clientY);
      });
      submenuEl.insertBefore(row, addRow);
    });
  }

  function selectActionBar(id) {
    selectedActionBarId = id;
    const bar = findActionBar(id);
    renderActionBarSubmenu();
    if (!bar) {
      pageTitleEl.textContent = 'Action Bars';
      introCardEl.style.display = '';
      settingsPanelEl.style.display = 'none';
      return;
    }
    pageTitleEl.textContent = bar.name;
    introCardEl.style.display = 'none';
    settingsPanelEl.style.display = '';
    barNameInput.value = bar.name;
    Promise.all([window.eqTracker.getActionBarConfig(id), window.eqTracker.getIconSet()]).then(([config, iconSet]) => {
      if (selectedActionBarId !== id) return; // switched again before this resolved
      loadBarIntoForm(config, iconSet);
      renderActionBarProfilesChecklist(config);
    });
    window.eqTracker.isActionBarLocked(id).then((locked) => {
      if (selectedActionBarId !== id) return;
      unlockBtn.textContent = locked ? 'Unlock to move' : 'Lock bar';
      unlockBtn.classList.toggle('unlocked', !locked);
    });
  }

  function refreshActionBarsList() {
    return window.eqTracker.listActionBars().then((list) => {
      actionBars = list;
      renderActionBarSubmenu();
      return list;
    });
  }

  openAddBtn.addEventListener('click', () => {
    newBarNameInput.value = '';
    addModalBackdrop.style.display = 'flex';
    newBarNameInput.focus();
  });
  function closeAddModal() {
    addModalBackdrop.style.display = 'none';
  }
  closeAddModalBtn.addEventListener('click', closeAddModal);
  addModalBackdrop.addEventListener('click', (e) => {
    if (e.target === addModalBackdrop) closeAddModal();
  });
  function submitCreateActionBar() {
    const name = newBarNameInput.value.trim();
    window.eqTracker.createActionBar(name).then((bar) => {
      closeAddModal();
      return refreshActionBarsList().then(() => {
        activateNavButton(navBtn);
        selectActionBar(bar.id);
      });
    });
  }
  createBarSubmitBtn.addEventListener('click', submitCreateActionBar);
  newBarNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCreateActionBar();
  });

  barNameInput.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    const name = barNameInput.value.trim() || 'Action Bar';
    window.eqTracker.setActionBarName(selectedActionBarId, name).then(() => refreshActionBarsList());
  });
  copySettingsBtn.addEventListener('click', () => {
    if (!selectedActionBarId) return;
    const rect = copySettingsBtn.getBoundingClientRect();
    openCopySourceMenu(rect.left, rect.bottom + 4);
  });
  removeOverridesBtn.addEventListener('click', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.clearAllActionBarTextOverrides(selectedActionBarId).then(() => {
      for (let i = 0; i < 12; i++) {
        if (currentSlots[i]) currentSlots[i].nameSizeOverride = null;
        refreshGemBox(i);
      }
    });
  });
  deleteBarBtn.addEventListener('click', () => {
    if (selectedActionBarId) handleDeleteActionBar(selectedActionBarId);
  });

  const showAppFocusedCheckbox = document.getElementById('action-bar-show-app-focused-checkbox');
  const opacitySlider = document.getElementById('action-bar-opacity-slider');
  const opacityValue = document.getElementById('action-bar-opacity-value');
  const slotCountSlider = document.getElementById('action-bar-slot-count-slider');
  const slotCountValue = document.getElementById('action-bar-slot-count-value');
  const iconsSlider = document.getElementById('action-bar-icons-slider');
  const iconsValue = document.getElementById('action-bar-icons-value');
  const sizeSlider = document.getElementById('action-bar-size-slider');
  const sizeValue = document.getElementById('action-bar-size-value');
  const marginSlider = document.getElementById('action-bar-margin-slider');
  const marginValue = document.getElementById('action-bar-margin-value');
  const unlockBtn = document.getElementById('action-bar-unlock-btn');
  const resetBtn = document.getElementById('action-bar-reset-btn');
  const nudgeUpBtn = document.getElementById('action-bar-nudge-up');
  const nudgeDownBtn = document.getElementById('action-bar-nudge-down');
  const nudgeLeftBtn = document.getElementById('action-bar-nudge-left');
  const nudgeRightBtn = document.getElementById('action-bar-nudge-right');
  const slotsGridEl = document.getElementById('action-bar-slots-grid');
  const iconModalBackdrop = document.getElementById('action-bar-icon-modal-backdrop');
  const iconModalTitle = document.getElementById('action-bar-icon-modal-title');
  const iconGemBarEl = document.getElementById('action-bar-icon-gem-bar');
  const iconPickerModalBackdrop = document.getElementById('action-bar-icon-picker-modal-backdrop');
  const iconPickerModalTitle = document.getElementById('action-bar-icon-picker-modal-title');
  const iconPickerContainer = document.getElementById('action-bar-icon-picker-container');
  const closeIconPickerModalBtn = document.getElementById('close-action-bar-icon-picker-modal');
  const iconModalClearBtn = document.getElementById('action-bar-icon-clear-btn');
  const closeIconModalBtn = document.getElementById('close-action-bar-icon-modal');
  const slotNameInput = document.getElementById('action-bar-slot-name-input');
  const slotDisableCheckbox = document.getElementById('action-bar-slot-disable-checkbox');
  const slotCooldownStatus = document.getElementById('action-bar-slot-cooldown-status');
  const slotCooldownBtn = document.getElementById('action-bar-slot-cooldown-btn');
  const slotBgModeRadios = document.querySelectorAll('input[name="action-bar-slot-bg-mode"]');
  const slotBgColorPicker = document.getElementById('action-bar-slot-bg-color-picker');
  const slotBorderCheckbox = document.getElementById('action-bar-slot-border-checkbox');
  const slotBorderFieldRows = [
    document.getElementById('action-bar-slot-border-fields'),
    document.getElementById('action-bar-slot-border-fields-2'),
    document.getElementById('action-bar-slot-border-fields-3'),
  ];
  const slotBorderWidthSlider = document.getElementById('action-bar-slot-border-width-slider');
  const slotBorderWidthValue = document.getElementById('action-bar-slot-border-width-value');
  const slotBorderOffsetSlider = document.getElementById('action-bar-slot-border-offset-slider');
  const slotBorderOffsetValue = document.getElementById('action-bar-slot-border-offset-value');
  const slotBorderColorPicker = document.getElementById('action-bar-slot-border-color-picker');
  const slotTextSizeOverrideCheckbox = document.getElementById('action-bar-slot-text-size-override-checkbox');
  const slotTextSizeOverrideSlider = document.getElementById('action-bar-slot-text-size-override-slider');
  const slotTextSizeOverrideValue = document.getElementById('action-bar-slot-text-size-override-value');
  const slotInsetSlider = document.getElementById('action-bar-slot-inset-slider');
  const slotInsetValue = document.getElementById('action-bar-slot-inset-value');
  const slotStanceCheckbox = document.getElementById('action-bar-slot-stance-checkbox');
  const slotInvocationCheckbox = document.getElementById('action-bar-slot-invocation-checkbox');
  const slotToggleNameRow = document.getElementById('action-bar-slot-toggle-name-row');
  const slotToggleNameSelect = document.getElementById('action-bar-slot-toggle-name-select');
  const slotToggleDurationRow = document.getElementById('action-bar-slot-toggle-duration-row');
  const slotToggleDurationSlider = document.getElementById('action-bar-slot-toggle-duration-slider');
  const slotToggleDurationValue = document.getElementById('action-bar-slot-toggle-duration-value');
  const slotStanceFixedHintEl = document.getElementById('action-bar-slot-stance-fixed-hint');
  let knownAbilityGroups = { stances: [], invocations: [] };
  window.eqTracker.getKnownAbilityGroups().then((groups) => {
    knownAbilityGroups = groups;
  });
  const slotMultiIconCheckbox = document.getElementById('action-bar-slot-multi-icon-checkbox');
  const borderWidthSlider = document.getElementById('action-bar-border-width-slider');
  const borderWidthValue = document.getElementById('action-bar-border-width-value');
  const borderOffsetSlider = document.getElementById('action-bar-border-offset-slider');
  const borderOffsetValue = document.getElementById('action-bar-border-offset-value');
  const borderColorPicker = document.getElementById('action-bar-border-color-picker');
  // Bar-wide, not per-gem - requested directly: "you put each cooldown type inside the modal, it
  // should be a global setting per bar."
  const globalCooldownStyleRadios = document.querySelectorAll('input[name="action-bar-cooldown-style"]');
  const cooldownShowNumberCheckbox = document.getElementById('action-bar-cooldown-show-number-checkbox');
  const nameWrapCheckbox = document.getElementById('action-bar-name-wrap-checkbox');
  const nameSizeSlider = document.getElementById('action-bar-name-size-slider');
  const nameSizeValue = document.getElementById('action-bar-name-size-value');
  const nameColorPicker = document.getElementById('action-bar-name-color-picker');
  const nameAnchorButtons = document.querySelectorAll('#action-bar-name-anchor-grid .anchor-cell');
  const cooldownReplaceCheckbox = document.getElementById('action-bar-cooldown-replace-checkbox');
  const cooldownTextWrapCheckbox = document.getElementById('action-bar-cooldown-text-wrap-checkbox');
  const cooldownTextSizeSlider = document.getElementById('action-bar-cooldown-text-size-slider');
  const cooldownTextSizeValue = document.getElementById('action-bar-cooldown-text-size-value');
  const cooldownTextColorPicker = document.getElementById('action-bar-cooldown-text-color-picker');
  const cooldownTextAnchorButtons = document.querySelectorAll('#action-bar-cooldown-text-anchor-grid .anchor-cell');

  const cooldownModalBackdrop = document.getElementById('action-bar-cooldown-modal-backdrop');
  const cooldownModalTitle = document.getElementById('action-bar-cooldown-modal-title');
  const closeCooldownModalBtn = document.getElementById('close-action-bar-cooldown-modal');
  const cooldownDurationInput = document.getElementById('action-bar-cooldown-duration-input');
  const cooldownStyleRadios = document.querySelectorAll('input[name="action-bar-cooldown-style"]');
  const cooldownChatFields = document.getElementById('action-bar-cooldown-chat-fields');
  const cooldownRawFields = document.getElementById('action-bar-cooldown-raw-fields');
  const cooldownSkillFields = document.getElementById('action-bar-cooldown-skill-fields');
  const cooldownChannelSelect = document.getElementById('action-bar-cooldown-channel-select');
  const cooldownWhoRadios = document.querySelectorAll('input[name="action-bar-cooldown-who"]');
  const cooldownWhoNameInput = document.getElementById('action-bar-cooldown-who-name');
  const cooldownChatMessageInput = document.getElementById('action-bar-cooldown-chat-message');
  const cooldownTriggerInput = document.getElementById('action-bar-cooldown-trigger');
  const cooldownMatchRadios = document.querySelectorAll('input[name="action-bar-cooldown-match"]');
  const cooldownSkillSelect = document.getElementById('action-bar-cooldown-skill-select');
  const cooldownSaveBtn = document.getElementById('action-bar-cooldown-save-btn');
  const cooldownRemoveBtn = document.getElementById('action-bar-cooldown-remove-btn');

  renderTriggerTypeChoices(
    'action-bar-cooldown-trigger-types',
    'action-bar-cooldown-trigger-mode',
    // Zone/combat excluded on purpose - the user asked for "standard aura trigger behaviour, same
    // UI, but without the zone change or combat state selections" (a gem is one ability, not tied
    // to zone/combat context the way a whole aura can be).
    TRIGGER_TYPES.filter((t) => t.value !== 'zone' && t.value !== 'combat')
  );
  // Queried AFTER renderTriggerTypeChoices, not before - that call rebuilds this container's
  // innerHTML from scratch, so a NodeList captured earlier would keep pointing at the original,
  // now-detached radios. Reported live: picking "Skill cast"/"Exact log line" did nothing, because
  // the change listeners below were bound to elements nothing on screen could ever click any more.
  const cooldownModeRadios = document.querySelectorAll('input[name="action-bar-cooldown-trigger-mode"]');

  let currentIconSet = '';
  let currentSlots = []; // [{ iconId, name, disabled, cooldown }] x 12
  let editingSlotIndex = null; // which slot the Edit gem modal is open for
  let iconPickerTarget = 'primary'; // which icon ('primary'/'secondary') the nested icon-picker modal is editing
  const gemBoxes = []; // [{ box, img, placeholder }], index-aligned with the 12 slots

  function cooldownSummary(cooldown) {
    if (!cooldown) return 'No cooldown';
    return `Cooldown: ${cooldown.durationSec}s`;
  }

  // Wraps the grid at the same width as the real overlay, so it reads as a preview of the actual
  // bar layout rather than an arbitrary fixed grid.
  function setSlotGridColumns(perRow) {
    slotsGridEl.style.setProperty('--slot-cols', perRow);
  }

  // Updates one gem's box on the settings-page grid - icon, disabled dimming, and a hover tooltip
  // naming it. The overlay itself (not this settings grid) is what actually renders the name text
  // and cooldown visuals - this box is just the picker/summary.
  function refreshGemBox(index) {
    const g = gemBoxes[index];
    const s = currentSlots[index];
    if (!g || !s) return;
    if (s.iconId == null || !currentIconSet) {
      g.img.style.display = 'none';
      g.placeholder.style.display = '';
    } else {
      g.img.src = `eqicon://icon/${encodeURIComponent(currentIconSet)}/${s.iconId}`;
      g.img.style.display = '';
      g.placeholder.style.display = 'none';
    }
    // Same diagonal split the overlay itself draws (see actionbar.js's render) - only actually
    // splits once both halves are picked, matching the overlay's own rule. Both halves need their
    // own clip-path, one triangle each - the second image was previously left unclipped, so it sat
    // as a full square on top of the primary icon and hid the split entirely rather than showing it.
    const splitting = s.multiIcon && s.iconId != null && s.secondIconId != null && currentIconSet;
    g.img.style.clipPath = splitting ? 'polygon(0 0, 100% 0, 0 100%)' : 'none';
    if (splitting) {
      g.secondImg.src = `eqicon://icon/${encodeURIComponent(currentIconSet)}/${s.secondIconId}`;
      g.secondImg.style.display = '';
      g.secondImg.style.clipPath = 'polygon(100% 0, 100% 100%, 0 100%)';
    } else {
      g.secondImg.style.display = 'none';
      g.secondImg.style.clipPath = 'none';
    }
    // Per-gem custom border preview (see actionBarStore.js's borderEnabled/borderWidthPx/
    // borderOffsetPx/borderColor) - an outline rather than touching the box's own CSS border, so
    // it layers on top the same way it does on the real overlay instead of replacing the box's
    // existing static border.
    if (s.borderEnabled) {
      g.box.style.outline = `${s.borderWidthPx || 2}px solid ${s.borderColor || '#d2d6e1'}`;
      g.box.style.outlineOffset = `-${s.borderOffsetPx ?? 1}px`;
    } else {
      g.box.style.outline = 'none';
      g.box.style.outlineOffset = '';
    }
    g.box.classList.toggle('disabled', !!s.disabled);
    g.box.title = s.name ? `${s.name} (Slot ${index + 1})` : `Slot ${index + 1}`;
  }

  function closeIconModal() {
    iconModalBackdrop.style.display = 'none';
    editingSlotIndex = null;
  }

  // The Icon section of the "Edit gem" modal - same gem-bar/gem-slot boxes the "Buffs shown"
  // picker uses (see buildGemSlot above), one box per icon: just Icon 1 normally, Icon 1 AND
  // Icon 2 side by side once Multi icon is on. Requested directly: "when 2 icon options are
  // selected, it should show 2 boxes instead of 1" - replacing the old single always-visible
  // picker grid switched via an "Editing:" radio pair.
  function buildIconGemBox(index, target, iconId) {
    const box = document.createElement('button');
    box.type = 'button';
    const multi = !!currentSlots[index].multiIcon;
    box.className = 'gem-slot' + (iconId == null ? ' gem-add' : '');
    box.title = !multi ? 'Icon - click to choose' : target === 'secondary' ? 'Icon 2 (bottom-right) - click to choose' : 'Icon 1 (top-left) - click to choose';
    if (iconId != null && currentIconSet) {
      const img = document.createElement('img');
      img.src = `eqicon://icon/${encodeURIComponent(currentIconSet)}/${iconId}`;
      img.alt = '';
      box.appendChild(img);
    } else {
      box.textContent = '+';
    }
    box.addEventListener('click', () => openIconPickerModal(index, target));
    return box;
  }

  function renderIconGemBar(index) {
    const s = currentSlots[index];
    iconGemBarEl.innerHTML = '';
    iconGemBarEl.appendChild(buildIconGemBox(index, 'primary', s.iconId));
    if (s.multiIcon) iconGemBarEl.appendChild(buildIconGemBox(index, 'secondary', s.secondIconId));
  }

  // The actual icon-picker grid, opened as its own modal on top of "Edit gem" rather than sitting
  // inline in it permanently - "it should enter another modal for icon selection when + is
  // clicked." Picking a thumbnail writes it, refreshes the gem-bar box behind it, and closes just
  // this modal, leaving "Edit gem" open underneath.
  function openIconPickerModal(index, target) {
    iconPickerTarget = target;
    const s = currentSlots[index];
    const multi = !!s.multiIcon;
    iconPickerModalTitle.textContent = !multi ? 'Choose icon' : target === 'secondary' ? 'Choose icon - Icon 2 (bottom-right)' : 'Choose icon - Icon 1 (top-left)';
    const currentIconId = target === 'secondary' ? s.secondIconId : s.iconId;
    iconPickerContainer.innerHTML = '';
    iconPickerContainer.appendChild(
      buildIconPicker(currentIconId, (iconId) => {
        if (target === 'secondary') {
          currentSlots[index].secondIconId = iconId;
          window.eqTracker.setActionBarSlotSecondIcon(selectedActionBarId, index, iconId);
        } else {
          currentSlots[index].iconId = iconId;
          window.eqTracker.setActionBarSlotIcon(selectedActionBarId, index, iconId);
        }
        refreshGemBox(index);
        renderIconGemBar(index);
        closeIconPickerModal();
      })
    );
    iconPickerModalBackdrop.style.display = 'flex';
  }

  function closeIconPickerModal() {
    iconPickerModalBackdrop.style.display = 'none';
    iconPickerContainer.innerHTML = '';
  }

  // Opens the ONE consolidated "Edit gem" modal - icon, overlay name, disable, and the cooldown
  // status/button all live together here, rather than being spread across separate popups or
  // inline page controls. Requested directly: "selections should be a modal."
  // Shows/hides the "Which one" dropdown and duration row for whichever group (if any) is
  // currently checked, and (re)populates the dropdown from the right known-name list. Called both
  // when the modal opens (from the slot's own saved state) and on every checkbox change.
  function syncSlotToggleUI(group, currentName) {
    slotToggleNameRow.style.display = group ? '' : 'none';
    slotToggleDurationRow.style.display = group === 'invocation' ? '' : 'none';
    slotStanceFixedHintEl.style.display = group === 'stance' ? '' : 'none';
    if (!group) return;
    const names = group === 'stance' ? knownAbilityGroups.stances : knownAbilityGroups.invocations;
    slotToggleNameSelect.innerHTML = '';
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      slotToggleNameSelect.appendChild(opt);
    });
    if (currentName && names.includes(currentName)) slotToggleNameSelect.value = currentName;
  }

  function openGemModal(index) {
    editingSlotIndex = index;
    const s = currentSlots[index];
    iconModalTitle.textContent = `Edit gem - Slot ${index + 1}`;
    slotNameInput.value = s.name || '';
    slotDisableCheckbox.checked = !!s.disabled;
    slotCooldownStatus.textContent = cooldownSummary(s.cooldown);
    const bgMode = s.bgColor === 'transparent' ? 'transparent' : s.bgColor ? 'custom' : 'default';
    slotBgModeRadios.forEach((r) => (r.checked = r.value === bgMode));
    slotBgColorPicker.value = bgMode === 'custom' ? s.bgColor : '#808080';
    slotBgColorPicker.style.display = bgMode === 'custom' ? '' : 'none';
    slotBorderCheckbox.checked = !!s.borderEnabled;
    slotBorderFieldRows.forEach((row) => {
      if (row) row.style.display = s.borderEnabled ? '' : 'none';
    });
    slotBorderWidthSlider.value = s.borderWidthPx || 2;
    slotBorderWidthValue.textContent = `${slotBorderWidthSlider.value}px`;
    slotBorderOffsetSlider.value = s.borderOffsetPx ?? 1;
    slotBorderOffsetValue.textContent = `${slotBorderOffsetSlider.value}px`;
    slotBorderColorPicker.value = s.borderColor || '#d2d6e1';
    const hasOverride = typeof s.nameSizeOverride === 'number';
    slotTextSizeOverrideCheckbox.checked = hasOverride;
    slotTextSizeOverrideSlider.value = hasOverride ? s.nameSizeOverride : 11;
    slotTextSizeOverrideValue.textContent = `${slotTextSizeOverrideSlider.value}px`;
    slotTextSizeOverrideSlider.style.display = hasOverride ? '' : 'none';
    slotTextSizeOverrideValue.style.display = hasOverride ? '' : 'none';
    slotInsetSlider.value = s.insetPx || 0;
    slotInsetValue.textContent = `${s.insetPx || 0}px`;
    slotStanceCheckbox.checked = s.toggleGroup === 'stance';
    slotInvocationCheckbox.checked = s.toggleGroup === 'invocation';
    slotToggleDurationSlider.value = s.toggleDurationSec || 6;
    slotToggleDurationValue.textContent = `${s.toggleDurationSec || 6}s`;
    syncSlotToggleUI(s.toggleGroup, s.toggleName);
    slotMultiIconCheckbox.checked = !!s.multiIcon;
    renderIconGemBar(index);
    iconModalBackdrop.style.display = 'flex';
  }

  // --- Cooldown modal --------------------------------------------------

  function updateCooldownModeVisibility() {
    const mode = [...cooldownModeRadios].find((r) => r.checked)?.value || 'chat';
    cooldownChatFields.style.display = mode === 'chat' ? '' : 'none';
    cooldownRawFields.style.display = mode === 'raw' ? '' : 'none';
    cooldownSkillFields.style.display = mode === 'skill' ? '' : 'none';
  }

  function updateCooldownWhoVisibility() {
    const whoValue = [...cooldownWhoRadios].find((r) => r.checked)?.value || 'self';
    cooldownWhoNameInput.style.display = whoValue === 'name' ? '' : 'none';
  }

  // Same "no self-sent tell" reasoning as the widget custom-timer modal's updateTimerChannelVisibility.
  function updateCooldownChannelVisibility() {
    const isTell = cooldownChannelSelect.value === 'tell';
    const selfRadio = [...cooldownWhoRadios].find((r) => r.value === 'self');
    const nameRadio = [...cooldownWhoRadios].find((r) => r.value === 'name');
    selfRadio.disabled = isTell;
    if (isTell && selfRadio.checked) nameRadio.checked = true;
    updateCooldownWhoVisibility();
  }

  function populateCooldownSkillSelect(buffs) {
    const sorted = [...buffs].sort((a, b) => a.name.localeCompare(b.name));
    cooldownSkillSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '- choose a spell -';
    cooldownSkillSelect.appendChild(placeholder);
    for (const buff of sorted) {
      const opt = document.createElement('option');
      opt.value = buff.name;
      opt.textContent = buff.name;
      cooldownSkillSelect.appendChild(opt);
    }
  }

  function populateCooldownForm(cooldown) {
    cooldownDurationInput.value = cooldown?.durationSec ? String(cooldown.durationSec) : '';
    cooldownChannelSelect.value = 'say';
    cooldownWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
    cooldownWhoNameInput.value = '';
    cooldownChatMessageInput.value = '';
    cooldownTriggerInput.value = '';
    cooldownMatchRadios.forEach((r) => (r.checked = r.value === 'exact'));
    cooldownSkillSelect.value = '';

    if (cooldown?.triggerChat) {
      cooldownModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
      cooldownChannelSelect.value = cooldown.triggerChat.channel;
      cooldownWhoRadios.forEach((r) => (r.checked = r.value === (cooldown.triggerChat.isSelf ? 'self' : 'name')));
      cooldownWhoNameInput.value = cooldown.triggerChat.name || '';
      cooldownChatMessageInput.value = cooldown.triggerChat.message || '';
    } else if (cooldown?.triggerMatch === 'castOf') {
      cooldownModeRadios.forEach((r) => (r.checked = r.value === 'skill'));
      cooldownSkillSelect.value = cooldown.triggerText || '';
    } else if (cooldown) {
      cooldownModeRadios.forEach((r) => (r.checked = r.value === 'raw'));
      cooldownTriggerInput.value = cooldown.triggerText || '';
      cooldownMatchRadios.forEach((r) => (r.checked = r.value === (cooldown.triggerMatch === 'contains' ? 'contains' : 'exact')));
    } else {
      cooldownModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
    }
    updateCooldownChannelVisibility();
    updateCooldownModeVisibility();
  }

  // Mirrors readTimerFormData's shape (see the widget custom-timer modal), minus the fields a
  // single gem doesn't need: no separate timer name (the gem's own name field covers that), no
  // ended text (a cooldown ends itself when it reaches zero), no second cooldown-after-duration
  // phase (that's for a widget's buff-then-recast timer, not a plain gem cooldown).
  function readCooldownFormData() {
    const durationSec = Number(cooldownDurationInput.value);
    if (!(durationSec > 0)) return null;
    const mode = [...cooldownModeRadios].find((r) => r.checked)?.value || 'chat';

    let triggerText;
    let triggerChat;
    let triggerMatch;
    if (mode === 'chat') {
      const channel = cooldownChannelSelect.value;
      const isSelf = [...cooldownWhoRadios].find((r) => r.checked)?.value === 'self';
      const who = cooldownWhoNameInput.value.trim();
      const message = cooldownChatMessageInput.value.trim();
      if (!message || (!isSelf && !who)) return null;
      triggerText = buildChatTriggerLine(channel, isSelf, who, message);
      triggerChat = { channel, isSelf, name: isSelf ? undefined : who, message };
    } else if (mode === 'skill') {
      triggerText = cooldownSkillSelect.value;
      if (!triggerText) return null;
      triggerMatch = 'castOf';
    } else {
      triggerText = cooldownTriggerInput.value.trim();
      if (!triggerText) return null;
      triggerMatch = [...cooldownMatchRadios].find((r) => r.checked)?.value === 'contains' ? 'contains' : undefined;
    }

    return { triggerMatch, triggerText, triggerChat, durationSec };
  }

  // Opened FROM the Edit gem modal's own "Cooldown..." button - operates on whichever slot that
  // modal is currently editing (editingSlotIndex), so the two modals stack rather than needing
  // their own separate "which slot" tracking.
  function openCooldownModal() {
    if (editingSlotIndex == null) return;
    const index = editingSlotIndex;
    cooldownModalTitle.textContent = `Set cooldown - ${currentSlots[index].name || `Slot ${index + 1}`}`;
    window.eqTracker.getCastableBuffs().then((buffs) => {
      populateCooldownSkillSelect(buffs);
      populateCooldownForm(currentSlots[index].cooldown);
    });
    cooldownModalBackdrop.style.display = 'flex';
  }

  function closeCooldownModal() {
    cooldownModalBackdrop.style.display = 'none';
  }

  // --- 12 gem boxes --------------------------------------------------------
  // A plain grid, same "Icons per row" wrap as the real overlay - each box just opens the one
  // Edit gem modal above. No per-box controls live on the page itself.

  for (let i = 0; i < 12; i++) {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'icon-picker-box';
    box.title = `Slot ${i + 1}`;
    const img = document.createElement('img');
    img.alt = '';
    img.style.display = 'none';
    const secondImg = document.createElement('img');
    secondImg.className = 'icon-picker-box-second-img';
    secondImg.alt = '';
    secondImg.style.display = 'none';
    const placeholder = document.createElement('span');
    placeholder.className = 'icon-picker-placeholder';
    placeholder.textContent = String(i + 1);
    box.append(img, secondImg, placeholder);
    box.addEventListener('click', () => openGemModal(i));
    slotsGridEl.appendChild(box);
    gemBoxes.push({ box, img, secondImg, placeholder });
  }

  closeIconModalBtn.addEventListener('click', closeIconModal);
  iconModalBackdrop.addEventListener('click', (e) => {
    if (e.target === iconModalBackdrop) closeIconModal();
  });
  closeIconPickerModalBtn.addEventListener('click', closeIconPickerModal);
  iconPickerModalBackdrop.addEventListener('click', (e) => {
    if (e.target === iconPickerModalBackdrop) closeIconPickerModal();
  });
  iconModalClearBtn.addEventListener('click', () => {
    if (editingSlotIndex == null) return;
    if (iconPickerTarget === 'secondary') {
      currentSlots[editingSlotIndex].secondIconId = null;
      window.eqTracker.setActionBarSlotSecondIcon(selectedActionBarId, editingSlotIndex, null);
    } else {
      currentSlots[editingSlotIndex].iconId = null;
      window.eqTracker.setActionBarSlotIcon(selectedActionBarId, editingSlotIndex, null);
    }
    refreshGemBox(editingSlotIndex);
    renderIconGemBar(editingSlotIndex);
    closeIconPickerModal();
  });
  slotMultiIconCheckbox.addEventListener('change', () => {
    if (editingSlotIndex == null) return;
    const enabled = slotMultiIconCheckbox.checked;
    currentSlots[editingSlotIndex].multiIcon = enabled;
    window.eqTracker.setActionBarSlotMultiIcon(selectedActionBarId, editingSlotIndex, enabled);
    refreshGemBox(editingSlotIndex);
    renderIconGemBar(editingSlotIndex);
  });
  slotNameInput.addEventListener('change', () => {
    if (editingSlotIndex == null) return;
    currentSlots[editingSlotIndex].name = slotNameInput.value.trim();
    window.eqTracker.setActionBarSlotName(selectedActionBarId, editingSlotIndex, currentSlots[editingSlotIndex].name);
    refreshGemBox(editingSlotIndex);
  });
  slotDisableCheckbox.addEventListener('change', () => {
    if (editingSlotIndex == null) return;
    currentSlots[editingSlotIndex].disabled = slotDisableCheckbox.checked;
    window.eqTracker.setActionBarSlotDisabled(selectedActionBarId, editingSlotIndex, slotDisableCheckbox.checked);
    refreshGemBox(editingSlotIndex);
  });
  slotCooldownBtn.addEventListener('click', openCooldownModal);
  // Default (null, the CSS calibration tint) / custom colour / transparent (explicit see-through,
  // distinct from "unset" - see actionbar.js's render comment) - a 3-way radio rather than the
  // checkbox this used to be, since a colour input alone can't express "no colour at all".
  function applySlotBgColor() {
    if (editingSlotIndex == null) return;
    const mode = [...slotBgModeRadios].find((r) => r.checked)?.value || 'default';
    slotBgColorPicker.style.display = mode === 'custom' ? '' : 'none';
    const color = mode === 'transparent' ? 'transparent' : mode === 'custom' ? slotBgColorPicker.value : null;
    currentSlots[editingSlotIndex].bgColor = color;
    window.eqTracker.setActionBarSlotBgColor(selectedActionBarId, editingSlotIndex, color);
    refreshGemBox(editingSlotIndex);
  }
  slotBgModeRadios.forEach((r) => r.addEventListener('change', applySlotBgColor));
  slotBgColorPicker.addEventListener('input', applySlotBgColor);

  // Per-gem border, layered on top of the bar-wide one - same three options (width/offset/colour)
  // as the bar-wide border topic, scoped to just this slot.
  function applySlotBorderEnabled() {
    if (editingSlotIndex == null) return;
    const on = slotBorderCheckbox.checked;
    slotBorderFieldRows.forEach((row) => {
      if (row) row.style.display = on ? '' : 'none';
    });
    currentSlots[editingSlotIndex].borderEnabled = on;
    window.eqTracker.setActionBarSlotBorderEnabled(selectedActionBarId, editingSlotIndex, on);
    refreshGemBox(editingSlotIndex);
  }
  slotBorderCheckbox.addEventListener('change', applySlotBorderEnabled);
  slotBorderWidthSlider.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const px = Number(slotBorderWidthSlider.value);
    slotBorderWidthValue.textContent = `${px}px`;
    currentSlots[editingSlotIndex].borderWidthPx = px;
    window.eqTracker.setActionBarSlotBorderWidth(selectedActionBarId, editingSlotIndex, px);
    refreshGemBox(editingSlotIndex);
  });
  slotBorderOffsetSlider.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const px = Number(slotBorderOffsetSlider.value);
    slotBorderOffsetValue.textContent = `${px}px`;
    currentSlots[editingSlotIndex].borderOffsetPx = px;
    window.eqTracker.setActionBarSlotBorderOffset(selectedActionBarId, editingSlotIndex, px);
    refreshGemBox(editingSlotIndex);
  });
  slotBorderColorPicker.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const color = slotBorderColorPicker.value;
    currentSlots[editingSlotIndex].borderColor = color;
    window.eqTracker.setActionBarSlotBorderColor(selectedActionBarId, editingSlotIndex, color);
    refreshGemBox(editingSlotIndex);
  });
  slotTextSizeOverrideCheckbox.addEventListener('change', () => {
    if (editingSlotIndex == null) return;
    const on = slotTextSizeOverrideCheckbox.checked;
    slotTextSizeOverrideSlider.style.display = on ? '' : 'none';
    slotTextSizeOverrideValue.style.display = on ? '' : 'none';
    const size = on ? Number(slotTextSizeOverrideSlider.value) : null;
    currentSlots[editingSlotIndex].nameSizeOverride = size;
    window.eqTracker.setActionBarSlotNameSizeOverride(selectedActionBarId, editingSlotIndex, size);
  });
  slotTextSizeOverrideSlider.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const size = Number(slotTextSizeOverrideSlider.value);
    slotTextSizeOverrideValue.textContent = `${size}px`;
    currentSlots[editingSlotIndex].nameSizeOverride = size;
    window.eqTracker.setActionBarSlotNameSizeOverride(selectedActionBarId, editingSlotIndex, size);
  });
  slotInsetSlider.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const px = Number(slotInsetSlider.value);
    slotInsetValue.textContent = `${px}px`;
    currentSlots[editingSlotIndex].insetPx = px;
    window.eqTracker.setActionBarSlotInsetPx(selectedActionBarId, editingSlotIndex, px);
  });
  function applySlotToggleGroup(group) {
    if (editingSlotIndex == null) return;
    currentSlots[editingSlotIndex].toggleGroup = group;
    currentSlots[editingSlotIndex].toggleName = null;
    syncSlotToggleUI(group, null);
    window.eqTracker.setActionBarSlotToggleGroup(selectedActionBarId, editingSlotIndex, group).then(() => {
      // Turning a group on populates the dropdown, and the BROWSER auto-selects its first
      // option visually - but that's display only, no 'change' event fires for it, so nothing was
      // actually saved yet. Reported live: the dropdown showed "Arcane Mastery Invocation" right
      // after checking the box, but toggleName stayed null in the real data the whole time, and
      // the active border never fires because nothing was ever matched. Persist whatever the
      // select is now actually showing, same as if the user had picked it themselves.
      if (group && slotToggleNameSelect.value) {
        currentSlots[editingSlotIndex].toggleName = slotToggleNameSelect.value;
        window.eqTracker.setActionBarSlotToggleName(selectedActionBarId, editingSlotIndex, slotToggleNameSelect.value);
      }
    });
  }
  slotStanceCheckbox.addEventListener('change', () => {
    if (slotStanceCheckbox.checked) slotInvocationCheckbox.checked = false;
    applySlotToggleGroup(slotStanceCheckbox.checked ? 'stance' : null);
  });
  slotInvocationCheckbox.addEventListener('change', () => {
    if (slotInvocationCheckbox.checked) slotStanceCheckbox.checked = false;
    applySlotToggleGroup(slotInvocationCheckbox.checked ? 'invocation' : null);
  });
  slotToggleNameSelect.addEventListener('change', () => {
    if (editingSlotIndex == null) return;
    currentSlots[editingSlotIndex].toggleName = slotToggleNameSelect.value || null;
    window.eqTracker.setActionBarSlotToggleName(selectedActionBarId, editingSlotIndex, slotToggleNameSelect.value);
  });
  slotToggleDurationSlider.addEventListener('input', () => {
    if (editingSlotIndex == null) return;
    const sec = Number(slotToggleDurationSlider.value);
    slotToggleDurationValue.textContent = `${sec}s`;
    currentSlots[editingSlotIndex].toggleDurationSec = sec;
    window.eqTracker.setActionBarSlotToggleDurationSec(selectedActionBarId, editingSlotIndex, sec);
  });

  closeCooldownModalBtn.addEventListener('click', closeCooldownModal);
  cooldownModalBackdrop.addEventListener('click', (e) => {
    if (e.target === cooldownModalBackdrop) closeCooldownModal();
  });
  cooldownModeRadios.forEach((r) => r.addEventListener('change', updateCooldownModeVisibility));
  cooldownChannelSelect.addEventListener('change', updateCooldownChannelVisibility);
  cooldownWhoRadios.forEach((r) => r.addEventListener('change', updateCooldownWhoVisibility));
  cooldownSaveBtn.addEventListener('click', () => {
    if (editingSlotIndex == null) return;
    const data = readCooldownFormData();
    if (!data) return;
    currentSlots[editingSlotIndex].cooldown = data;
    window.eqTracker.setActionBarSlotCooldown(selectedActionBarId, editingSlotIndex, data);
    slotCooldownStatus.textContent = cooldownSummary(data);
    closeCooldownModal();
  });
  cooldownRemoveBtn.addEventListener('click', () => {
    if (editingSlotIndex == null) return;
    currentSlots[editingSlotIndex].cooldown = null;
    window.eqTracker.setActionBarSlotCooldown(selectedActionBarId, editingSlotIndex, null);
    slotCooldownStatus.textContent = cooldownSummary(null);
    closeCooldownModal();
  });

  function applySlotCountVisibility(count) {
    gemBoxes.forEach((g, i) => {
      g.box.style.display = i < count ? '' : 'none';
    });
  }

  // Populates every field on the page from one bar's config - called whenever the selection
  // changes (selectActionBar, above), not just once at page load, now that there's more than one
  // bar to switch between.
  function loadBarIntoForm(config, iconSet) {
    const opacityPct = Math.round((config.opacity ?? 1) * 100);
    opacitySlider.value = opacityPct;
    opacityValue.textContent = `${opacityPct}%`;
    const slotCount = config.slotCount || 12;
    slotCountSlider.value = slotCount;
    slotCountValue.textContent = slotCount;
    iconsSlider.value = config.iconsPerRow;
    iconsValue.textContent = config.iconsPerRow;
    sizeSlider.value = config.iconSize;
    sizeValue.textContent = `${config.iconSize}px`;
    marginSlider.value = config.marginPx;
    marginValue.textContent = `${config.marginPx}px`;
    globalCooldownStyleRadios.forEach((r) => (r.checked = r.value === (config.cooldownStyle || 'wipe')));
    cooldownShowNumberCheckbox.checked = !!config.cooldownShowNumber;
    nameWrapCheckbox.checked = config.nameLabelWrap !== false;
    nameSizeSlider.value = config.nameLabelSize || 11;
    nameSizeValue.textContent = `${config.nameLabelSize || 11}px`;
    nameColorPicker.value = config.nameLabelColor || '#f0f1f5';
    nameAnchorButtons.forEach((b) => b.classList.toggle('active', b.dataset.anchor === (config.nameLabelAnchor || 'bottom-center')));
    cooldownReplaceCheckbox.checked = config.cooldownReplacesLabel !== false;
    cooldownTextWrapCheckbox.checked = !!config.cooldownTextWrap;
    cooldownTextSizeSlider.value = config.cooldownTextSize || 13;
    cooldownTextSizeValue.textContent = `${config.cooldownTextSize || 13}px`;
    cooldownTextColorPicker.value = config.cooldownTextColor || '#ffffff';
    cooldownTextAnchorButtons.forEach((b) => b.classList.toggle('active', b.dataset.anchor === (config.cooldownTextAnchor || 'middle-center')));
    borderWidthSlider.value = config.borderWidthPx || 2;
    borderWidthValue.textContent = `${config.borderWidthPx || 2}px`;
    borderOffsetSlider.value = config.borderOffsetPx ?? 1;
    borderOffsetValue.textContent = `${config.borderOffsetPx ?? 1}px`;
    borderColorPicker.value = config.borderColor || '#d2d6e1';
    showAppFocusedCheckbox.checked = !!config.showWhenAppFocused;
    currentIconSet = iconSet || '';
    currentSlots = config.slots
      ? config.slots.map((s) => ({ ...s }))
      : Array.from({ length: 12 }, () => ({
          iconId: null,
          name: '',
          disabled: false,
          cooldown: null,
          bgColor: null,
          nameSizeOverride: null,
          insetPx: 0,
          toggleGroup: null,
          toggleName: null,
          toggleDurationSec: 6,
          borderEnabled: false,
          borderWidthPx: 2,
          borderOffsetPx: 1,
          borderColor: '#d2d6e1',
        }));
    setSlotGridColumns(config.iconsPerRow);
    for (let i = 0; i < 12; i++) refreshGemBox(i);
    applySlotCountVisibility(slotCount);
  }

  // Per-bar, NOT the global showAurasWhenAppFocused setting (Setup page's own checkbox) - it used
  // to be wired to that shared global flag, which meant toggling it for one bar made every bar
  // (and every aura) reappear at once. Reported directly: "toggling show action bar shows them all
  // not just the one you are on." Populated per-selection in loadBarIntoForm from
  // config.showWhenAppFocused; this listener writes back to whichever bar is currently selected.
  showAppFocusedCheckbox.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarShowWhenAppFocused(selectedActionBarId, showAppFocusedCheckbox.checked);
  });
  opacitySlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    opacityValue.textContent = `${opacitySlider.value}%`;
    window.eqTracker.setActionBarOpacity(selectedActionBarId, Number(opacitySlider.value) / 100);
  });
  slotCountSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    const n = Number(slotCountSlider.value);
    slotCountValue.textContent = n;
    applySlotCountVisibility(n);
    window.eqTracker.setActionBarSlotCount(selectedActionBarId, n);
  });
  globalCooldownStyleRadios.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked && selectedActionBarId) window.eqTracker.setActionBarCooldownStyle(selectedActionBarId, r.value);
    });
  });
  cooldownShowNumberCheckbox.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarCooldownShowNumber(selectedActionBarId, cooldownShowNumberCheckbox.checked);
  });
  nameWrapCheckbox.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarNameLabelWrap(selectedActionBarId, nameWrapCheckbox.checked);
  });
  nameSizeSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    const size = Number(nameSizeSlider.value);
    nameSizeValue.textContent = `${size}px`;
    window.eqTracker.setActionBarNameLabelSize(selectedActionBarId, size);
  });
  nameColorPicker.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarNameLabelColor(selectedActionBarId, nameColorPicker.value);
  });
  nameAnchorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!selectedActionBarId) return;
      nameAnchorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.eqTracker.setActionBarNameLabelAnchor(selectedActionBarId, btn.dataset.anchor);
    });
  });
  cooldownReplaceCheckbox.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarCooldownReplacesLabel(selectedActionBarId, cooldownReplaceCheckbox.checked);
  });
  cooldownTextWrapCheckbox.addEventListener('change', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarCooldownTextWrap(selectedActionBarId, cooldownTextWrapCheckbox.checked);
  });
  cooldownTextSizeSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    const size = Number(cooldownTextSizeSlider.value);
    cooldownTextSizeValue.textContent = `${size}px`;
    window.eqTracker.setActionBarCooldownTextSize(selectedActionBarId, size);
  });
  cooldownTextColorPicker.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarCooldownTextColor(selectedActionBarId, cooldownTextColorPicker.value);
  });
  cooldownTextAnchorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!selectedActionBarId) return;
      cooldownTextAnchorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.eqTracker.setActionBarCooldownTextAnchor(selectedActionBarId, btn.dataset.anchor);
    });
  });
  borderWidthSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    const px = Number(borderWidthSlider.value);
    borderWidthValue.textContent = `${px}px`;
    window.eqTracker.setActionBarBorderWidth(selectedActionBarId, px);
  });
  borderOffsetSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    const px = Number(borderOffsetSlider.value);
    borderOffsetValue.textContent = `${px}px`;
    window.eqTracker.setActionBarBorderOffset(selectedActionBarId, px);
  });
  borderColorPicker.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.setActionBarBorderColor(selectedActionBarId, borderColorPicker.value);
  });
  iconsSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    iconsValue.textContent = iconsSlider.value;
    setSlotGridColumns(Number(iconsSlider.value));
    window.eqTracker.setActionBarIconsPerRow(selectedActionBarId, Number(iconsSlider.value));
  });
  sizeSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    sizeValue.textContent = `${sizeSlider.value}px`;
    window.eqTracker.setActionBarIconSize(selectedActionBarId, Number(sizeSlider.value));
  });
  marginSlider.addEventListener('input', () => {
    if (!selectedActionBarId) return;
    marginValue.textContent = `${marginSlider.value}px`;
    window.eqTracker.setActionBarMarginPx(selectedActionBarId, Number(marginSlider.value));
  });
  unlockBtn.addEventListener('click', async () => {
    if (!selectedActionBarId) return;
    const locked = await window.eqTracker.toggleActionBarLock(selectedActionBarId);
    unlockBtn.textContent = locked ? 'Unlock to move' : 'Lock bar';
    unlockBtn.classList.toggle('unlocked', !locked);
  });
  resetBtn.addEventListener('click', () => {
    if (!selectedActionBarId) return;
    window.eqTracker.resetActionBarPosition(selectedActionBarId);
  });
  nudgeUpBtn.addEventListener('click', () => selectedActionBarId && window.eqTracker.nudgeActionBar(selectedActionBarId, 0, -1));
  nudgeDownBtn.addEventListener('click', () => selectedActionBarId && window.eqTracker.nudgeActionBar(selectedActionBarId, 0, 1));
  nudgeLeftBtn.addEventListener('click', () => selectedActionBarId && window.eqTracker.nudgeActionBar(selectedActionBarId, -1, 0));
  nudgeRightBtn.addEventListener('click', () => selectedActionBarId && window.eqTracker.nudgeActionBar(selectedActionBarId, 1, 0));

  // Same reasoning as initWidgetsPanel's identical listeners: a profile rename/create needs the
  // tooltip's name list refreshed, and switching the active profile needs the dot's colour
  // re-evaluated even though no action bar's own data changed.
  window.eqTracker.onProfilesChanged(() => {
    refreshActionBarProfilesCache().then(() => refreshActionBarsList());
  });
  window.eqTracker.onActiveProfileChanged((id) => {
    actionBarCurrentActiveProfileId = id;
    renderActionBarSubmenu();
  });
  refreshActionBarProfilesCache();
  refreshActionBarActiveProfileCache().then(renderActionBarSubmenu);

  refreshActionBarsList().then((list) => {
    if (list.length > 0) selectActionBar(list[0].id);
  });
}

function initTradePing() {
  const checkbox = document.getElementById('trade-ping-checkbox');
  const tellCheckbox = document.getElementById('tell-ping-checkbox');
  const tellCooldownRow = document.getElementById('tell-ping-cooldown-row');
  const tellCooldownSlider = document.getElementById('tell-ping-cooldown-slider');
  const tellCooldownValue = document.getElementById('tell-ping-cooldown-value');
  if (!checkbox) return;

  let enabled = false;
  let tellEnabled = false;
  // Reported live: a burst of tells machine-gunned the ping sound with nothing to slow it down.
  // Tracked in milliseconds to match Date.now() directly, default 3s - see the setting's own
  // comment in main.js for why. 0 means off (every tell pings, same as before this existed).
  let tellCooldownMs = 3000;
  let lastTellPingAt = 0;
  let audioCtx = null;

  // Two quick notes, the same shape as the overlay's alert beep. Built here rather than shared
  // with overlay.js because the two windows cannot share a module - and an AudioContext is
  // created lazily, since one made before any user interaction starts suspended.
  function ping() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      [[880, 0], [1320, 120]].forEach(([freq, delayMs]) => {
        const startAt = ctx.currentTime + delayMs / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.13);
      });
    } catch {
      // No audio device, or a context the browser refuses to start. A missed ping is not worth
      // an error dialog over.
    }
  }

  window.eqTracker.getTradePing().then((on) => { enabled = on; checkbox.checked = on; });

  checkbox.addEventListener('change', () => {
    enabled = checkbox.checked;
    window.eqTracker.setTradePing(enabled);
    // Play on enabling so it is obvious what was just turned on, and so the AudioContext is
    // created from a real click rather than from a log line arriving with no user gesture behind
    // it - which is the situation browsers refuse to start audio in.
    if (enabled) ping();
  });

  function syncTellCooldownRow() {
    if (tellCooldownRow) tellCooldownRow.style.display = tellEnabled ? '' : 'none';
  }

  if (tellCheckbox) {
    window.eqTracker.getTellPing().then((on) => {
      tellEnabled = on;
      tellCheckbox.checked = on;
      syncTellCooldownRow();
    });
    tellCheckbox.addEventListener('change', () => {
      tellEnabled = tellCheckbox.checked;
      window.eqTracker.setTellPing(tellEnabled);
      syncTellCooldownRow();
      if (tellEnabled) ping();
    });
  }

  if (tellCooldownSlider) {
    window.eqTracker.getTellPingCooldownSec().then((seconds) => {
      tellCooldownMs = seconds * 1000;
      tellCooldownSlider.value = seconds;
      tellCooldownValue.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    });
    tellCooldownSlider.addEventListener('input', () => {
      const seconds = Number(tellCooldownSlider.value);
      tellCooldownMs = seconds * 1000;
      tellCooldownValue.textContent = seconds === 0 ? 'off' : `${seconds}s`;
      window.eqTracker.setTellPingCooldownSec(seconds);
    });
  }

  window.eqTracker.onLogLine((line) => {
    if (!enabled && !tellEnabled) return;
    // Timestamps are stripped the same way the detection engine does it, so a line is matched on
    // its text alone.
    const stripped = String(line).replace(/^\[[^\]]+\]\s*/, '').trim();
    if (enabled && TRADE_REQUEST_PATTERN.test(stripped)) {
      ping();
    } else if (tellEnabled && TELL_PATTERN.test(stripped)) {
      const now = Date.now();
      if (tellShouldPing(now, lastTellPingAt, tellCooldownMs)) {
        lastTellPingAt = now;
        ping();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Buff Planner page (src/main/buffPlanner.js). Pick three classes + levels on
// the active loadout profile, see the highest-level buff for every line they
// cover packed into the 14 buff slots, and drag the priority order that
// decides which buffs win a slot when there are more than 14. Everything is
// recomputed on the main side from the live roster - this page only draws it.
// ---------------------------------------------------------------------------
const PLANNER_CLASSES = ['BRD', 'BST', 'CLR', 'DRU', 'ENC', 'MAG', 'NEC', 'PAL', 'RNG', 'SHD', 'SHM', 'WIZ'];
const PLANNER_MAX_LEVEL = 50;

function initBuffPlanner() {
  // Locked until the buff-loadout aura ships - the sidebar button is removed (see index.html), so
  // there is no way to reach this page. Bail before wiring anything (incl. the profile-change
  // listener) rather than keep a hidden page live.
  if (!document.querySelector('.nav-btn[data-page="page-planner"]')) return;

  const classRowEl = document.getElementById('planner-class-rows');
  const levelInputEl = document.getElementById('planner-level-input');
  const slotListEl = document.getElementById('planner-slot-list');
  const slotCountEl = document.getElementById('planner-slot-count');
  const totalsCardEl = document.getElementById('planner-totals-card');
  const totalsEl = document.getElementById('planner-totals');
  const statsUnknownEl = document.getElementById('planner-stats-unknown');
  const songCardEl = document.getElementById('planner-song-card');
  const songListEl = document.getElementById('planner-song-list');
  const songCountEl = document.getElementById('planner-song-count');
  const permCardEl = document.getElementById('planner-permanent-card');
  const permListEl = document.getElementById('planner-permanent-list');
  const permCountEl = document.getElementById('planner-permanent-count');
  const priorityListEl = document.getElementById('planner-priority-list');
  const overflowCardEl = document.getElementById('planner-overflow-card');
  const overflowListEl = document.getElementById('planner-overflow-list');
  const overflowCountEl = document.getElementById('planner-overflow-count');
  const emptyNoteEl = document.getElementById('planner-empty-note');
  const stackingStateEl = document.getElementById('planner-stacking-state');
  const activeProfileEl = document.getElementById('planner-active-profile');
  const priorityResetEl = document.getElementById('planner-priority-reset');
  if (!classRowEl) return;

  let classes = []; // up to 3 class codes - mirrors the active profile
  let level = PLANNER_MAX_LEVEL; // the one shared character level
  let order = []; // buff names, the dragged priority order
  let hasManualOrder = false; // true once the user has dragged (a non-empty saved buffPlanOrder)

  // One row, three class dropdowns - it's one multiclass character, not three mains, so there is
  // one level (the input above this row) and it applies to all three.
  function buildClassSelects() {
    classRowEl.querySelectorAll('.planner-class-select').forEach((el) => el.remove());
    for (let i = 0; i < 3; i++) {
      const sel = document.createElement('select');
      sel.className = 'text-input planner-class-select';
      sel.innerHTML =
        '<option value="">-</option>' +
        PLANNER_CLASSES.map((c) => '<option value="' + c + '">' + c + '</option>').join('');
      sel.value = classes[i] || '';
      sel.addEventListener('change', commitClasses);
      classRowEl.appendChild(sel);
    }
  }

  function readClassSelects() {
    const out = [];
    for (const sel of classRowEl.querySelectorAll('.planner-class-select')) {
      if (sel.value && !out.includes(sel.value)) out.push(sel.value);
    }
    return out;
  }

  function commitClasses() {
    classes = readClassSelects();
    window.eqTracker.setPlannerClasses(null, classes).then(recompute);
  }

  function commitLevel() {
    let n = Math.round(Number(levelInputEl.value));
    if (!Number.isFinite(n)) n = PLANNER_MAX_LEVEL;
    n = Math.min(PLANNER_MAX_LEVEL, Math.max(1, n));
    levelInputEl.value = String(n);
    level = n;
    window.eqTracker.setPlannerLevel(null, n).then(recompute);
  }

  // haste / spell haste come through 100-based (141 = +41%); everything else is additive points.
  function fmtStat(label, value) {
    if (label === 'haste' || label === 'spell haste') {
      const pct = Math.round(value - 100);
      return `${pct >= 0 ? '+' : ''}${pct}% ${label}`;
    }
    return `${value >= 0 ? '+' : ''}${Math.round(value)} ${label}`;
  }

  function buffRow(cand, opts) {
    opts = opts || {};
    const li = document.createElement('li');
    li.className = 'planner-buff-row' + (opts.draggable ? ' planner-draggable' : '');
    li.dataset.name = cand.name;
    const thumb = buildIconThumb(cand.iconUrl);
    if (thumb) li.appendChild(thumb);
    const main = document.createElement('div');
    main.className = 'planner-buff-main';
    const name = document.createElement('span');
    name.className = 'planner-buff-name';
    name.textContent = cand.name;
    const meta = document.createElement('span');
    meta.className = 'planner-buff-meta';
    // Lead with the stat this buff is ranked on (its category's headline), then its other stats in
    // character-sheet order. Every entry here is a real, named character stat.
    const stats = (cand.stats || []).slice().sort((a, b) => a.order - b.order);
    const headline = cand.stat || (stats[0] && stats[0].stat) || null;
    const statBit = headline
      ? fmtStat(headline, cand.magnitude != null ? cand.magnitude : stats[0].value)
      : cand.category;
    const extra = stats
      .filter((s) => s.stat !== headline)
      .slice(0, 3)
      .map((s) => fmtStat(s.stat, s.value))
      .join('  ');
    meta.textContent = [statBit, cand.castByClasses.join('/'), extra].filter(Boolean).join(' · ');
    main.append(name, meta);
    li.appendChild(main);
    const reason = opts.reason || (opts.reasonFromItem ? cand.reason : null);
    if (reason) {
      const r = document.createElement('span');
      r.className = 'planner-buff-reason';
      r.textContent = reason;
      li.appendChild(r);
    }
    return li;
  }

  const fillList = (el, list, opts) => {
    el.innerHTML = '';
    list.forEach((c) => el.appendChild(buffRow(c, opts)));
  };

  function render(plan) {
    const hasClasses = plan.classes.length > 0;
    emptyNoteEl.style.display = hasClasses ? 'none' : '';
    slotCountEl.textContent = String(plan.slots.length);
    stackingStateEl.textContent = plan.stackingKnown
      ? ''
      : 'Set your EQ folder on the Setup page so the planner can tell buff tiers apart properly.';

    // Total stats across every slotted buff.
    const totals = plan.totals || [];
    totalsCardEl.style.display = hasClasses ? '' : 'none';
    statsUnknownEl.style.display = plan.statsKnown ? 'none' : '';
    totalsEl.innerHTML = '';
    totals.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'planner-total-chip';
      chip.textContent = fmtStat(t.stat, t.value);
      totalsEl.appendChild(chip);
    });

    fillList(slotListEl, plan.slots);

    // Bard songs - their own 5-slot pool, only when Bard is one of the classes.
    songCardEl.style.display = plan.hasBard ? '' : 'none';
    songCountEl.textContent = String((plan.songSlots || []).length);
    fillList(songListEl, plan.songSlots || []);

    // Permanent buffs (Yaulp/Fury) - shown whenever any qualify.
    const perm = plan.permanentSlots || [];
    permCardEl.style.display = perm.length ? '' : 'none';
    permCountEl.textContent = String(perm.length);
    fillList(permListEl, perm);

    // One priority list covering the buff slots AND the song slots (both are capped, so order
    // matters for both); permanent buffs are uncapped so they aren't in it.
    priorityListEl.innerHTML = '';
    [...plan.candidates, ...(plan.songCandidates || [])].forEach((c) =>
      priorityListEl.appendChild(buffRow(c, { draggable: true }))
    );
    wireDrag();

    const allOverflow = [...plan.overflow, ...(plan.songOverflow || []), ...(plan.permanentOverflow || [])];
    fillList(overflowListEl, allOverflow, { reasonFromItem: true });
    overflowCardEl.style.display = allOverflow.length ? '' : 'none';
    overflowCountEl.textContent = String(allOverflow.length);

    if (priorityResetEl) priorityResetEl.style.display = hasManualOrder ? '' : 'none';
  }

  if (priorityResetEl) {
    priorityResetEl.addEventListener('click', () => {
      hasManualOrder = false;
      window.eqTracker.setPlannerOrder(null, []).then(recompute);
    });
  }

  let dragName = null;
  function wireDrag() {
    priorityListEl.querySelectorAll('.planner-draggable').forEach((li) => {
      li.setAttribute('draggable', 'true');
      li.addEventListener('dragstart', () => {
        dragName = li.dataset.name;
        li.classList.add('planner-dragging');
      });
      li.addEventListener('dragend', () => {
        dragName = null;
        li.classList.remove('planner-dragging');
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        const over = li.dataset.name;
        if (!dragName || dragName === over) return;
        const items = [...priorityListEl.querySelectorAll('.planner-draggable')];
        const names = items.map((x) => x.dataset.name);
        const from = names.indexOf(dragName);
        const to = names.indexOf(over);
        if (from === -1 || to === -1) return;
        names.splice(to, 0, names.splice(from, 1)[0]);
        order = names;
        const dragged = items[from];
        priorityListEl.insertBefore(dragged, li);
      });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        hasManualOrder = true;
        window.eqTracker.setPlannerOrder(null, order).then(recompute);
      });
    });
  }

  function recompute() {
    return window.eqTracker.computePlan(null).then((plan) => {
      order = [...plan.candidates, ...(plan.songCandidates || [])].map((c) => c.name);
      render(plan);
    });
  }

  function loadInput() {
    return Promise.all([
      window.eqTracker.getPlannerInput(null),
      window.eqTracker.getProfiles(),
      window.eqTracker.getActiveProfileId(),
    ])
      .then(([input, profiles, activeId]) => {
        classes = Array.isArray(input.classes) ? input.classes : [];
        level = typeof input.level === 'number' ? input.level : PLANNER_MAX_LEVEL;
        order = Array.isArray(input.buffPlanOrder) ? input.buffPlanOrder : [];
        hasManualOrder = order.length > 0;
        levelInputEl.value = String(level);
        const active = profiles.find((p) => p.id === activeId);
        activeProfileEl.textContent = active ? active.name : 'Default';
        buildClassSelects();
        return recompute();
      })
      .catch((err) => {
        // Most likely cause: the app is running a build from before the planner IPC existed.
        // Still draw the empty controls so the page isn't a blank card.
        console.error('Buff Planner: could not load input -', err);
        buildClassSelects();
      });
  }

  // Draw the controls immediately, before the async load - they should be there even if the IPC
  // round-trip is slow or fails.
  buildClassSelects();
  levelInputEl.addEventListener('change', commitLevel);

  const navBtn = document.querySelector('.nav-btn[data-page="page-planner"]');
  if (navBtn) navBtn.addEventListener('click', loadInput);
  window.eqTracker.onActiveProfileChanged(() => loadInput());

  loadInput();
}
