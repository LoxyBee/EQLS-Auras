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
  initWidgetsPanel();
  initKnownBuffsPanel();
  initCharacterSettingsPanel();
  initUiScale();
  initSidebarResize();
  initMergeRule();
  initTradePing();
}

// Custom title bar (UX_VISUAL_DESIGN.md / the frameless-window follow-up) -
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

// Topic disclosures (UX_VISUAL_DESIGN.md) - global, not scoped to any one
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

// UX_REDESIGN_PLAN.md's "default landing page": with no EQ folder
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

  setupModalToggle('create-profile-modal-backdrop', 'profile-add-btn', 'close-create-profile-modal', populateCreateProfileChecklist);

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

  function updateTotal() {
    const aaPct = AA_REINFORCEMENT_PERCENTS[Number(aaSelect.value)] || 0;
    const exaltPct = EXALTATION_PERCENTS[Number(exaltSelect.value)] || 0;
    totalEl.textContent = `+${aaPct + exaltPct}%`;
  }

  function save() {
    window.eqTracker.setCharacterSettings({
      aaLevel: Number(aaSelect.value),
      exaltationLevel: Number(exaltSelect.value),
    });
    updateTotal();
  }

  window.eqTracker.getCharacterSettings().then((settings) => {
    aaSelect.value = String(settings.aaLevel || 0);
    exaltSelect.value = String(settings.exaltationLevel || 0);
    updateTotal();
  });

  aaSelect.addEventListener('change', save);
  exaltSelect.addEventListener('change', save);
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

  window.eqTracker.getSpellbookState().then((state) => {
    if (state.filePath) {
      spellbookStatusEl.textContent = `Found - ${state.spellCount} spells (${state.filePath})`;
      spellbookStatusEl.classList.remove('warn');
      spellbookMissingHintEl.style.display = 'none';
      return;
    }
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
  });

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
  // Filled in from whichever hotkey actually registered, rather than hard-coded. The markup used
  // to say "or press Pause" while Electron was refusing that key outright, so the one readout of
  // the feature was also the thing telling everyone it worked.
  const masterHideHintEl = document.getElementById('master-hide-hint');
  window.eqTracker.getHideHotkey().then((key) => {
    masterHideHintEl.textContent = key ? `or press ${HOTKEY_LABELS[key] || key}` : '';
  });

  // Note 38. Where the player is, kept current from the same broadcast that re-evaluates
  // visibility in the main process, so the "hidden here" warning below cannot drift from reality.
  let currentZone = null;
  window.eqTracker.getCurrentZone().then((z) => {
    currentZone = z;
    if (selectedId) renderWidgetZones(findWidget(selectedId));
  });
  window.eqTracker.onZoneChanged((z) => {
    currentZone = z;
    if (selectedId) renderWidgetZones(findWidget(selectedId));
  });
  window.eqTracker.getKnownZones().then((zones) => {
    const list = document.getElementById('known-zones');
    for (const z of zones) {
      const opt = document.createElement('option');
      opt.value = z;
      list.appendChild(opt);
    }
  });

  const loadoutLabelCheckbox = document.getElementById('loadout-label-checkbox');
  window.eqTracker.getLoadoutLabel().then((enabled) => {
    loadoutLabelCheckbox.checked = !!enabled;
  });
  loadoutLabelCheckbox.addEventListener('change', () => {
    // refreshWidgets, because turning it on creates the label the first time and it should appear
    // in the aura list straight away rather than after the next unrelated refresh.
    window.eqTracker.setLoadoutLabel(loadoutLabelCheckbox.checked).then(refreshWidgets);
  });

  window.eqTracker.getShowAurasWhenAppFocused().then((enabled) => {
    showAurasAppFocusedCheckbox.checked = enabled;
  });
  showAurasAppFocusedCheckbox.addEventListener('change', () => {
    window.eqTracker.setShowAurasWhenAppFocused(showAurasAppFocusedCheckbox.checked);
  });
  window.eqTracker.getAutoHideOverlayEnabled().then((enabled) => {
    autoHideCheckbox.checked = enabled;
  });
  autoHideCheckbox.addEventListener('change', () => {
    window.eqTracker.setAutoHideOverlayEnabled(autoHideCheckbox.checked);
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

  const splitEnabledCheckbox = document.getElementById('split-enabled-checkbox');
  const splitGapCheckbox = document.getElementById('split-gap-checkbox');
  const splitOutputFolderEl = document.getElementById('split-output-folder');
  const splitChooseFolderBtn = document.getElementById('split-choose-folder-btn');
  const splitResetFolderBtn = document.getElementById('split-reset-folder-btn');

  const fileSizeEl = document.getElementById('log-file-size');
  const archivePromptEl = document.getElementById('archive-prompt');
  const archiveNowBtn = document.getElementById('archive-now-btn');

  function renderState(state) {
    folderEl.textContent = state.eqFolder || 'Not detected - click Browse';
    fileEl.textContent = state.currentFile || (state.watching ? 'Waiting for a log file...' : '-');
    errorEl.textContent = state.lastError || '';

    if (state.split) {
      splitEnabledCheckbox.checked = state.split.enabled;
      splitGapCheckbox.checked = state.split.splitOnGap;
      splitOutputFolderEl.textContent = state.split.outputDir || '-';
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

  window.eqTracker.getLogState().then(renderState);
  window.eqTracker.onLogStatus(renderState);
  window.eqTracker.onLogLine(appendLine);
  window.eqTracker.onDebugLine(appendDebugLine);
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
  splitGapCheckbox.addEventListener('change', async () => {
    renderState(await window.eqTracker.setSplitOnGap(splitGapCheckbox.checked));
  });
  splitChooseFolderBtn.addEventListener('click', async () => {
    renderState(await window.eqTracker.chooseSplitFolder());
  });
  splitResetFolderBtn.addEventListener('click', async () => {
    renderState(await window.eqTracker.resetSplitFolder());
  });

  archiveNowBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      "This copies the current log to a timestamped file, then erases the live log file's contents. " +
        'Best done right after logging out or /log off, not mid-session. Continue?'
    );
    if (!confirmed) return;
    const result = await window.eqTracker.archiveLogNow();
    if (!result.ok) {
      window.alert('Archive failed: ' + result.error);
    }
    renderState(await window.eqTracker.getLogState());
  });
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
    value: 'zone',
    label: 'Zone change',
    description: 'Starts when you enter or leave a particular zone.',
    planned: true,
  },
  {
    value: 'combat',
    label: 'Combat state',
    description: 'Starts when you enter or leave combat.',
    planned: true,
  },
];

function renderTriggerTypeChoices() {
  const container = document.getElementById('widget-new-timer-trigger-types');
  container.innerHTML = '';
  for (const type of TRIGGER_TYPES) {
    const label = document.createElement('label');
    label.className = 'trigger-type-choice' + (type.planned ? ' planned' : '');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'widget-new-timer-trigger-mode';
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
  const textSizeSlider = document.getElementById('widget-text-size-slider');
  const textSizeValueEl = document.getElementById('widget-text-size-value');
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
  const soundLandCheckbox = document.getElementById('widget-sound-land-checkbox');
  const soundExpireCheckbox = document.getElementById('widget-sound-expire-checkbox');
  const soundWarningSlider = document.getElementById('widget-sound-warning-slider');
  const soundWarningValueEl = document.getElementById('widget-sound-warning-value');
  const alertVolumeSlider = document.getElementById('widget-alert-volume-slider');
  const alertVolumeValueEl = document.getElementById('widget-alert-volume-value');
  const soundWarningLoopSlider = document.getElementById('widget-sound-loop-slider');
  const soundWarningLoopValueEl = document.getElementById('widget-sound-loop-value');
  // Scoped per grid, not a bare '.anchor-cell' query - the label position
  // grid reuses the same cell markup/class, and a global query would mix
  // the two grids' buttons together (wrong "active" cell, wrong grid
  // cleared on click).
  const anchorButtons = document.querySelectorAll('#widget-anchor-grid .anchor-cell');
  const iconOnlySettings = document.getElementById('widget-icon-only-settings');
  const iconPositionSettings = document.getElementById('widget-icon-position-settings');
  // Everything a sound-only aura has no use for - see updateDisplayModeVisibility below.
  const soundOnlyHintEl = document.getElementById('widget-sound-only-hint');
  const textMessageInput = document.getElementById('widget-text-message-input');
  const textMessageRowEl = document.getElementById('widget-text-message-row');
  // textAura*, not text* - there is already a textSizeSlider for the shared list/icon text size,
  // and this is the separate, much larger one a text aura gets to itself.
  const textAuraSizeSlider = document.getElementById('widget-text-size-slider');
  const textAuraSizeValueEl = document.getElementById('widget-text-size-value');
  const textAuraSizeRowEl = document.getElementById('widget-text-size-row');
  const textHintEl = document.getElementById('widget-text-hint');
  const textInstantSlider = document.getElementById('widget-text-instant-slider');
  const textInstantValueEl = document.getElementById('widget-text-instant-value');
  const textInstantRowEl = document.getElementById('widget-text-instant-row');
  const textInstantHintEl = document.getElementById('widget-text-instant-hint');
  const displayModeRowEl = document.getElementById('widget-display-mode-row');
  const buffSourceTimerLabelEl = document.getElementById('widget-buff-source-timer-label');
  const categoryBordersCheckbox = document.getElementById('widget-category-borders-checkbox');
  const trackEnemiesCheckbox = document.getElementById('widget-track-enemies-checkbox');
  const allyAlertCheckbox = document.getElementById('widget-ally-alert-checkbox');
  const alwaysOnCheckbox = document.getElementById('widget-always-on-checkbox');
  const alwaysOnRowEl = document.getElementById('widget-always-on-row');
  const alwaysOnHintEl = document.getElementById('widget-always-on-hint');
  const allProfilesCheckbox = document.getElementById('widget-all-profiles-checkbox');
  const allyAlertRowEl = document.getElementById('widget-ally-alert-row');
  const allyAlertHintEl = document.getElementById('widget-ally-alert-hint');
  const enemiesRowEl = document.getElementById('widget-enemies-row');
  const enemiesHintEl = document.getElementById('widget-enemies-hint');
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
  const modalAddSoundWidgetBtn = document.getElementById('modal-add-sound-widget-btn');
  const modalNewWidgetNameInput = document.getElementById('modal-new-widget-name');
  const modalAddBuffWidgetBtn = document.getElementById('modal-add-buff-widget-btn');
  const modalAddTimerWidgetBtn = document.getElementById('modal-add-timer-widget-btn');

  const activeBuffsCardEl = document.getElementById('widget-active-buffs-card');
  const manageCardEl = document.getElementById('widget-manage-card');
  const widgetProfilesTogglesEl = document.getElementById('widget-profiles-toggles');
  const activeBuffsListEl = document.getElementById('widget-active-buffs-list');
  const excludedBuffsSectionEl = document.getElementById('widget-excluded-buffs-section');
  const excludedBuffsListEl = document.getElementById('widget-excluded-buffs-list');
  const toggleExcludedBtn = document.getElementById('widget-toggle-excluded-btn');
  let excludedListExpanded = false;

  const filterCard = document.getElementById('widget-buff-filter-card');
  const filterHint = document.getElementById('widget-buff-filter-hint');
  const filterSearch = document.getElementById('widget-buff-filter-search');
  const filterListEl = document.getElementById('widget-buff-filter-list');
  const selectedBuffsSectionEl = document.getElementById('widget-selected-buffs-section');
  const selectedBuffsListEl = document.getElementById('widget-selected-buffs-list');
  const trackOthersRowEl = document.getElementById('widget-track-others-row');
  const trackOthersCheckbox = document.getElementById('widget-track-others-checkbox');
  const customTimersCardEl = document.getElementById('widget-custom-timers-card');
  const customTimersListEl = document.getElementById('widget-custom-timers-list');
  const newTimerNameInput = document.getElementById('widget-new-timer-name');
  const newTimerMinutesInput = document.getElementById('widget-new-timer-minutes');
  const newTimerSecondsInput = document.getElementById('widget-new-timer-seconds');
  const newTimerCooldownInput = document.getElementById('widget-new-timer-cooldown');
  const newTimerMatchRadios = document.querySelectorAll('input[name="widget-new-timer-match"]');
  const newTimerTriggerInput = document.getElementById('widget-new-timer-trigger');
  const newTimerEndedInput = document.getElementById('widget-new-timer-ended');
  renderTriggerTypeChoices();
  const newTimerModeRadios = document.querySelectorAll('input[name="widget-new-timer-trigger-mode"]');
  const newTimerChatFieldsEl = document.getElementById('widget-new-timer-chat-fields');
  const newTimerRawFieldsEl = document.getElementById('widget-new-timer-raw-fields');
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
  const hideBardSongsCheckbox = document.getElementById('widget-hide-bard-songs-checkbox');
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
  // Note 38. The zones an aura is limited to, as removable chips.
  //
  // The warning underneath is the part that matters. A zone rule is a NEW way for an aura to be
  // missing with no explanation, which is the failure this project keeps having - so when the rule
  // is what is hiding it, the panel says so and names the zone you are actually in.
  function renderWidgetZones(widget) {
    if (!widget) return;
    const zones = widget.visibleInZones || [];
    const listEl = document.getElementById('widget-zone-list');
    const warnEl = document.getElementById('widget-zone-warning');
    listEl.innerHTML = '';
    for (const zone of zones) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'profile-toggle on';
      chip.title = 'Stop limiting this aura to ' + zone;
      chip.textContent = zone + '  x';
      chip.addEventListener('click', () => {
        const next = (findWidget(widget.id)?.visibleInZones || []).filter((z) => z !== zone);
        window.eqTracker.setWidgetVisibleInZones(widget.id, next).then(refreshWidgets);
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
      profiles.forEach((profile) => {
        const label = document.createElement('label');
        label.className = 'profile-toggle' + (activeIds.has(profile.id) ? ' on' : '');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = activeIds.has(profile.id);
        checkbox.addEventListener('change', () => {
          const current = new Set(findWidget(widget.id)?.activeProfileIds || []);
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
    widgets.forEach((widget, index) => {
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

      // Scoped to specific profiles (not every one that exists) - flagged
      // so a widget disappearing after a profile switch isn't a mystery.
      // latestProfiles.length === 0 before the initial fetch resolves
      // means "unknown yet," not "zero profiles exist" (there's always at
      // least the default one) - skip the dot rather than risk a false
      // positive on first render.
      const activeProfileIds = widget.activeProfileIds || [];
      if (latestProfiles.length > 0 && activeProfileIds.length < latestProfiles.length) {
        const dotWrap = document.createElement('span');
        dotWrap.className = 'profile-dot-wrap';
        const dot = document.createElement('span');
        dot.className = 'profile-dot';
        const names = latestProfiles.filter((p) => activeProfileIds.includes(p.id)).map((p) => p.name);
        const tooltip = document.createElement('span');
        tooltip.className = 'tooltip-bubble';
        tooltip.textContent = names.length > 0 ? `Active on: ${names.join(', ')}` : 'Not active on any profile';
        dotWrap.append(dot, tooltip);
        btn.appendChild(dotWrap);
      }

      // Reordering just swaps this widget with its immediate neighbor in
      // the stored list - getAll()/this submenu both render in array order,
      // so that's the entire implementation. stopPropagation so a move
      // click doesn't also select/navigate to the widget.
      const upBtn = document.createElement('button');
      upBtn.className = 'nav-sub-move-btn';
      upBtn.textContent = '▲';
      upBtn.title = 'Move up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.eqTracker.moveWidget(widget.id, 'up').then(refreshWidgets);
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'nav-sub-move-btn';
      downBtn.textContent = '▼';
      downBtn.title = 'Move down';
      downBtn.disabled = index === widgets.length - 1;
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.eqTracker.moveWidget(widget.id, 'down').then(refreshWidgets);
      });

      row.append(btn, upBtn, downBtn);
      submenuEl.insertBefore(row, addRow);
    });
  }

  function deselectWidget() {
    selectedId = null;
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

  // Icon size/icons-per-row/timer-text-position only mean anything in Icon mode; row size only
  // means anything in List mode; and a Sound-only aura draws nothing, so NONE of it applies -
  // not the per-mode groups, not opacity, not sort order, not the position controls, not the
  // timer-text or Alerts topics (both purely about how a tile looks).
  //
  // They are hidden rather than disabled because every one of them is a real, saveable setting
  // that simply could not have an effect here. Leaving a live control on screen that does
  // nothing is how a user ends up convinced the app is broken. Hiding is also non-destructive:
  // the stored values are untouched, so switching back to List or Icons restores the aura
  // exactly as it was configured.
  //
  // What deliberately STAYS visible in sound-only mode: the name, profile membership, "Buffs
  // shown" (what it listens for), Display style itself (the way back out), and the whole
  // Sounds topic - which is the entire remaining point of the aura.
  function updateDisplayModeVisibility(displayMode) {
    const isIcons = displayMode === 'icons';
    const isSoundOnly = displayMode === 'sound-only';
    // A text aura draws one line of words and nothing else, so everything about tiles, rows,
    // grids and countdowns is as meaningless to it as it is to a sound-only aura. Its own two
    // settings - what it says and how big - appear instead.
    //
    // The Display style radios are hidden entirely for one. A text aura is a TYPE, chosen once
    // when it is created, the same way a custom timer aura's source is fixed at creation and
    // never offered as a toggle afterwards.
    const isTextAura = displayMode === 'text';
    textMessageRowEl.style.display = isTextAura ? '' : 'none';
    textAuraSizeRowEl.style.display = isTextAura ? '' : 'none';
    textInstantRowEl.style.display = isTextAura ? '' : 'none';
    textInstantHintEl.style.display = isTextAura ? '' : 'none';
    // Her wording: "a toggle under text only custom creation". It belongs to this aura type and
    // nowhere else - the warning has no duration, so there is nothing for a tile aura to draw.
    allyAlertRowEl.style.display = isTextAura ? '' : 'none';
    allyAlertHintEl.style.display = isTextAura ? '' : 'none';
    // An aura with nothing to wait for only makes sense where there is something to say without
    // an event behind it, which is the text mode and nothing else.
    alwaysOnRowEl.style.display = isTextAura ? '' : 'none';
    alwaysOnHintEl.style.display = isTextAura ? '' : 'none';
    textHintEl.style.display = isTextAura ? '' : 'none';
    // Both of these are TYPES now, chosen once in the add-aura flow beside Custom buff aura and
    // Custom timer aura - so neither offers Display style at all. It was a radio for sound-only
    // first, and the owner's reasoning for text applies to it just as well: a fourth option on
    // every aura is a fourth thing to read and rule out on every aura, and two different ways of
    // answering "what kind of aura is this" is worse than either one on its own.
    displayModeRowEl.style.display = isTextAura || isSoundOnly ? 'none' : '';
    buffSourceTimerLabelEl.style.display = isTextAura || isSoundOnly ? '' : 'none';
    iconOnlySettings.style.display = isIcons ? '' : 'none';
    iconPositionSettings.style.display = isIcons ? '' : 'none';
    iconLabelSectionEl.style.display = isIcons ? '' : 'none';
    listOnlySettings.style.display = isIcons || isSoundOnly ? 'none' : '';
    displayIconOnlySettings.style.display = isIcons ? '' : 'none';
    displayListOnlySettings.style.display = isIcons || isSoundOnly ? 'none' : '';
    soundOnlyHintEl.style.display = isSoundOnly ? '' : 'none';
    // Sort order still means something to a text aura even though it shows one thing: it is what
    // decides WHICH one, when more than one of the things it watches is active at once.
    sortOrderRowEl.style.display = isSoundOnly ? 'none' : '';
    // Merging is about how tiles are drawn. A sound-only aura draws none, and a text aura draws
    // exactly one whatever happens, so there is never anything to merge.
    mergeRowEl.style.display = isSoundOnly || isTextAura ? 'none' : '';
    mergeHintEl.style.display = isSoundOnly || isTextAura ? 'none' : '';
    // A sound aura draws no tile to put an edge on. A text aura draws one, but it is a plate of
    // words rather than a spell tile, and giving it a spell-type edge would be the first thing on
    // screen the mode promised never to draw.
    bordersRowEl.style.display = isSoundOnly || isTextAura ? 'none' : '';
    bordersHintEl.style.display = isSoundOnly || isTextAura ? 'none' : '';
    // The countdown's own styling, which a text aura has no countdown for.
    timerTextTopicEl.style.display = isSoundOnly || isTextAura ? 'none' : '';
    opacityRowEl.style.display = isSoundOnly ? 'none' : '';
    positionRowEl.style.display = isSoundOnly ? 'none' : '';
    positionHintEl.style.display = isSoundOnly ? 'none' : '';
    alertsTopicEl.style.display = isSoundOnly ? 'none' : '';
    // The per-mode groups below are shown for anything that is not icon mode, so a text aura
    // needs the same extra clause sound-only does or they reappear underneath it.
    if (isTextAura) {
      listOnlySettings.style.display = 'none';
      displayListOnlySettings.style.display = 'none';
    }
  }

  // The label's own size/position controls stay hidden until "Show label"
  // is actually checked - no point showing options for a feature that's
  // currently off.
  function updateIconLabelOptionsVisibility() {
    iconLabelOptionsEl.style.display = showIconLabelCheckbox.checked ? '' : 'none';
  }

  function selectWidget(id) {
    selectedId = id;
    const widget = findWidget(id);
    if (!widget) {
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
    exportCodeRow.style.display = 'none';
    exportSoundWarningEl.style.display = 'none';
    exportCodeOutput.value = '';
    settingsTitle.textContent = `${widget.name} settings`;
    nameInput.value = widget.name;
    // Self-vs-ally is a togglable choice on a self/ally custom widget, but
    // a "custom timer widget" fixes its source at creation time (see the
    // Add Widget modal's two distinct buttons) and never offers this
    // toggle - same reasoning as the two builtin kinds having a fixed,
    // implied source (Self Buffs always self, Ally Buffs always ally).
    // An announcer type keeps its source row even once it is on text triggers, because that is the
    // one choice it is allowed to change its mind about. Every other aura hides the row as soon
    // as it is a timer aura, since the source is fixed at creation.
    const announcer = widget.displayMode === 'text' || widget.displayMode === 'sound-only';
    buffSourceRow.style.display =
      widget.kind === 'custom' && (announcer || widget.buffSource !== 'customTimer') ? '' : 'none';
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
    trackEnemiesCheckbox.checked = !!widget.trackOnEnemies;
    allyAlertCheckbox.checked = !!widget.allyDebuffAlert;
    alwaysOnCheckbox.checked = !!widget.alwaysOn;
    allProfilesCheckbox.checked = !!widget.showOnAllProfiles;
    textMessageInput.value = widget.textAuraMessage || '';
    const textAuraSize = widget.textAuraSize || 32;
    textAuraSizeSlider.value = String(textAuraSize);
    textAuraSizeValueEl.textContent = `${textAuraSize}px`;
    const instantSec = widget.textAuraInstantSec || 6;
    textInstantSlider.value = String(instantSec);
    textInstantValueEl.textContent = `${instantSec}s`;
    soundLandCheckbox.checked = !!widget.soundOnLand;
    soundExpireCheckbox.checked = !!widget.soundOnExpire;
    const warningSec = widget.soundWarningSec || 0;
    soundWarningSlider.value = warningSec;
    soundWarningValueEl.textContent = warningSec === 0 ? 'off' : `${warningSec}s`;
    const warningLoopSec = widget.soundWarningLoopSec || 0;
    soundWarningLoopSlider.value = warningLoopSec;
    soundWarningLoopValueEl.textContent = warningLoopSec === 0 ? 'off' : `${warningLoopSec}s`;
    // The volume slider was the one control in this panel never populated from the widget, so it
    // always showed the markup default rather than the aura's saved value. And because the input
    // carried no `value` attribute at all, an HTML range falls back to the midpoint of its own
    // range - 50 on a 0-100 track - so the handle sat halfway along while the sound played at
    // the real default of 100%. That is the whole of the reported "slider starts in the middle
    // but it's 100%": not a scale problem, a control that never loaded its value.
    const alertVolume = typeof widget.alertVolume === 'number' ? widget.alertVolume : 100;
    alertVolumeSlider.value = alertVolume;
    alertVolumeValueEl.textContent = `${alertVolume}%`;
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
    updateDisplayModeVisibility(widget.displayMode);
    deleteBtn.style.display = widget.deletable ? '' : 'none';
    duplicateWidgetBtn.style.display = widget.kind === 'self-buffs-builtin' ? 'none' : '';

    window.eqTracker.isWidgetLocked(id).then((locked) => {
      lockBtn.textContent = locked ? 'Unlock to move' : 'Lock aura';
      lockBtn.classList.toggle('unlocked', !locked);
    });

    renderBuffFilter(widget);
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

  function renderBuffFilter(widget) {
    // Custom timers are a wholly separate concept from buff-picking (own
    // card, own heading - see widget-custom-timers-card) - not a "buffs
    // shown" filter mode at all, since there's no shared pool to pick
    // from. Shown/hidden independently of filterCard.
    customTimersCardEl.style.display = widget.buffSource === 'customTimer' ? '' : 'none';
    // Grouping is per-person, so it needs tiles that actually carry a person -
    // shown for the Ally Buffs builtin and any custom aura set to the ally
    // source, hidden everywhere else rather than offering a setting that
    // could never do anything.
    // A sound-only aura draws no tiles, so there are no tiles to group - the options would be
    // real settings that could never have any effect. Handled here rather than in
    // updateDisplayModeVisibility because renderBuffFilter runs afterwards and would put them
    // straight back.
    const showsAllies =
      (widget.kind === 'ally-buffs-builtin' || widget.buffSource === 'ally') &&
      widget.displayMode !== 'sound-only';
    allyGroupingSettingsEl.style.display = showsAllies ? '' : 'none';

    // Watching a spell on an enemy only means anything to an aura reading the ally list, because
    // that is where a landing on somebody who is not you goes. Offered to a self-source aura it
    // would be a live switch that widens detection and then draws nothing - the exact "empty aura
    // and no way to tell why" this is meant to avoid.
    //
    // NOT gated on sound-only the way the grouping options above are. An aura that only makes a
    // noise is a perfectly good way to hear that a mez landed or was resisted, which is the case
    // the owner asked for when she said instants belong on sound and text auras.
    const canWatchEnemies = widget.kind === 'ally-buffs-builtin' || widget.buffSource === 'ally';
    enemiesRowEl.style.display = canWatchEnemies ? '' : 'none';
    enemiesHintEl.style.display = canWatchEnemies ? '' : 'none';
    if (widget.buffSource === 'customTimer') {
      resetTimerForm();
      renderCustomTimersList(widget);
    }

    // Only self-buffs-builtin, not ally - "track buffs cast on me by
    // others" is about buffs landing on the player, unrelated to the Ally
    // Buffs widget's own concern (buffs the player casts on others).
    trackOthersRowEl.style.display = widget.kind === 'self-buffs-builtin' ? '' : 'none';
    if (widget.kind === 'self-buffs-builtin') {
      window.eqTracker.getTrackOthersEnabled().then((enabled) => {
        trackOthersCheckbox.checked = enabled;
      });
    }

    if (widget.kind === 'self-buffs-builtin' || widget.kind === 'ally-buffs-builtin') {
      filterCard.style.display = '';
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
      // Checkbox reads "Show bard songs" but the stored field is
      // hideBardSongs - inverted here (and in the change handler below)
      // rather than renaming the persisted field, which would need a data
      // migration for no real benefit.
      hideBardSongsCheckbox.checked = !widget.hideBardSongs;
      const maxDurationMin = Math.round((widget.maxDurationFilterSec || 0) / 60);
      maxDurationSlider.value = maxDurationMin;
      maxDurationValueEl.textContent = maxDurationMin === 0 ? 'off' : `${maxDurationMin}m`;
      return;
    }
    if (widget.buffSource === 'customTimer') {
      filterCard.style.display = 'none';
      selectedBuffsSectionEl.style.display = 'none';
      return;
    }
    filterCard.style.display = '';
    filterHint.textContent = 'Pick which known buffs should show on this aura.';
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
    add.addEventListener('click', () => {
      filterSearch.focus();
      filterSearch.select();
    });
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
    slot.title = `${name} - click to stop watching it`;
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
    slot.addEventListener('click', () => toggleBuffFilterName(widget, name, false));
    return slot;
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
    newTimerMinutesInput.value = '';
    newTimerSecondsInput.value = '';
    newTimerCooldownInput.value = '';
    newTimerMatchRadios.forEach((r) => (r.checked = r.value === 'exact'));
    newTimerTriggerInput.value = '';
    newTimerEndedInput.value = '';
    newTimerModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
    newTimerChannelSelect.value = 'say';
    newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
    newTimerWhoNameInput.value = '';
    newTimerChatMessageInput.value = '';
    newTimerChatEndedMessageInput.value = '';
    updateTimerChannelVisibility();
    updateTimerModeVisibility();
    newTimerAddBtn.textContent = 'Add timer';
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
    newTimerMinutesInput.value = String(Math.floor(timer.durationSec / 60));
    newTimerSecondsInput.value = String(timer.durationSec % 60);
    // Blank, not "0", when there is no cooldown - a zero in the box reads as a cooldown of no
    // length rather than as no cooldown at all.
    newTimerCooldownInput.value = timer.cooldownSec ? String(timer.cooldownSec) : '';
    // castOf lands on "exactly" here because there is no radio for it - it is built by the
    // cooldown premade from a spell name rather than typed, and offering it as a third option
    // would need a spell picker in this form. Editing such a timer keeps its mode regardless:
    // updateCustomTimer does not accept triggerMatch, so it cannot overwrite it.
    newTimerMatchRadios.forEach((r) => (r.checked = r.value === (timer.triggerMatch === 'contains' ? 'contains' : 'exact')));
    // Restores whichever mode this timer was actually built in - triggerChat
    // only exists on a timer set up via the chat-message builder; anything
    // else (including every timer that predates that feature) only ever had a
    // raw triggerText/endedText, so it lands back in raw mode with the exact
    // line it already has, unchanged.
    if (timer.triggerChat) {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'chat'));
      newTimerChannelSelect.value = timer.triggerChat.channel;
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === (timer.triggerChat.isSelf ? 'self' : 'name')));
      newTimerWhoNameInput.value = timer.triggerChat.name || '';
      newTimerChatMessageInput.value = timer.triggerChat.message || '';
      newTimerChatEndedMessageInput.value = timer.endedChat?.message || '';
      newTimerTriggerInput.value = '';
      newTimerEndedInput.value = '';
    } else {
      newTimerModeRadios.forEach((r) => (r.checked = r.value === 'raw'));
      newTimerTriggerInput.value = timer.triggerText;
      newTimerEndedInput.value = timer.endedText || '';
      newTimerChannelSelect.value = 'say';
      newTimerWhoRadios.forEach((r) => (r.checked = r.value === 'self'));
      newTimerWhoNameInput.value = '';
      newTimerChatMessageInput.value = '';
      newTimerChatEndedMessageInput.value = '';
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
  function openTimerModal(timer, iconUrl) {
    resetTimerForm();
    if (timer) populateTimerForm(timer, iconUrl);
    customTimerModalTitle.textContent = timer ? 'Edit timer' : 'Add timer';
    customTimerModalBackdrop.style.display = 'flex';
    newTimerNameInput.focus();
  }

  function closeTimerModal() {
    customTimerModalBackdrop.style.display = 'none';
    resetTimerForm();
  }

  function renderCustomTimersList(widget) {
    customTimersListEl.innerHTML = '';
    const timers = widget.customTimers || [];
    if (timers.length === 0) {
      customTimersListEl.innerHTML = '<li class="empty">None yet - use + Add timer.</li>';
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
        const duration = document.createElement('span');
        duration.className = 'buff-timer';
        const m = Math.floor(timer.durationSec / 60);
        const s = timer.durationSec % 60;
        duration.textContent = `${m}:${String(s).padStart(2, '0')}`;
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openTimerModal(timer, iconUrl));
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          if (!window.confirm(`Delete timer "${timer.name}"? This can't be undone.`)) return;
          if (editingTimerId === timer.id) closeTimerModal();
          window.eqTracker.removeWidgetCustomTimer(widget.id, timer.id).then(() => {
            refreshWidgets().then(() => renderCustomTimersList(findWidget(widget.id)));
          });
        });
        if (icon) li.append(icon);
        li.append(name, duration, editBtn, deleteBtn);
        customTimersListEl.appendChild(li);
      }
    });
  }

  function applyBuffFilterSearch() {
    const widget = findWidget(selectedId);
    if (!widget || widget.kind === 'self-buffs-builtin' || widget.kind === 'ally-buffs-builtin') return;
    if (widget.buffSource === 'customTimer') return;
    const query = filterSearch.value.trim().toLowerCase();
    const filtered = query ? allKnownBuffs.filter((b) => b.name.toLowerCase().includes(query)) : allKnownBuffs;
    const shown = filtered.slice(0, KNOWN_BUFF_RENDER_CAP);
    renderBuffFilterList(shown, filtered.length - shown.length, widget);
  }

  function renderBuffFilterList(buffs, truncatedCount, widget) {
    filterListEl.innerHTML = '';
    if (buffs.length === 0) {
      filterListEl.innerHTML = '<li class="empty">No matching buffs.</li>';
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

  // Note 27: "Buffs and debuffs can never share one aura." Enforced when adding rather than
  // filtered out of the picker, because the reason has to be sayable - a spell silently missing
  // from a search is indistinguishable from the app not knowing it.
  function conflictsWithPicked(widget, name) {
    const picked = widget.buffNames || [];
    if (!picked.length) return null;
    const known = allKnownBuffs.find((b) => b.name === name);
    if (!known) return null;
    const isDet = (b) => b && (b.kind === 'det' || b.scaleCategory === 'debuff' || b.scaleCategory === 'charm');
    const incoming = isDet(known);
    for (const other of picked) {
      const existing = allKnownBuffs.find((b) => b.name === other);
      if (!existing) continue;
      if (isDet(existing) !== incoming) return other;
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

  widgetsNavBtn.addEventListener('click', deselectWidget);

  // Note 6 - an aura's name was clicked in its move box out on the overlay. Registered in here
  // rather than alongside the other IPC listeners because focusWidget lives in this closure.
  window.eqTracker.onOpenWidgetSettings((id) => focusWidget(id));

  // Refreshes the widget list, then selects+focuses a specific one - shared
  // by every path that ends with a brand-new (or overwritten) widget:
  // custom creation, premade creation, and both import outcomes below.
  function focusWidget(id) {
    return refreshWidgets().then(() => {
      const btn = submenuEl.querySelector(`[data-widget-id="${id}"]`);
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
      id: 'ally-buffs',
      name: 'Ally Buffs',
      description: 'Shows every buff you’ve cast on your current group members, with the same filter options (hide bard songs, hide long buffs, sound alerts, etc.) as Self Buffs.',
      create: (name) => window.eqTracker.createAllyBuffsWidget(name),
    },
    {
      id: 'dispelled',
      name: 'You Have Been Dispelled',
      description:
        'Flashes DISPELLED in large letters when something strips your buffs, then clears itself ' +
        'after eight seconds. A text aura - it draws no icon and no countdown. Listens for all ' +
        'three strengths of the message.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'dispelled'),
    },
    {
      id: 'resisted',
      name: 'Resist flash',
      description:
        'Flashes RESISTED for a second and a half whenever a spell you cast is resisted. Covers ' +
        'every spell at once, not one you have to pick - useful for mez and charm, where a resist ' +
        'is the difference between a mob standing still and a mob hitting you.',
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'resisted'),
    },
    {
      id: 'ally-cast',
      name: 'Someone else cast a mez',
      description:
        'Warns you when a groupmate - or anything else - starts casting a mez or charm, so you ' +
        'know not to break it. A warning, not a countdown: the game never says when somebody ' +
        "else's debuff ends, so a timer here would be invented.",
      create: (name) => window.eqTracker.createTextAuraWidget(name, 'allyCast'),
    },
    {
      id: 'buff-timer',
      name: 'Buff timer',
      description:
        'Pick one spell and whether you are watching it on yourself, on someone you cast it on, ' +
        'or on something you cast it at, and the aura is built for you.',
      // No create() - this one opens a panel instead. See renderPremadeList.
      panel: 'buff-timer',
    },
    {
      id: 'cooldown-timer',
      name: 'Cooldown timer',
      description:
        'Pick a spell and get a countdown to when you can cast it again, rather than how long it ' +
        'lasts. The recast time is filled in for you, and you can correct it.',
      panel: 'buff-timer',
      mode: 'cooldown',
    },
    {
      id: 'enemy-debuff',
      name: 'Debuff on an enemy',
      description:
        'A timer for a mez, charm, snare or slow on the thing you cast it at, showing its name ' +
        'and clearing when it dies, wears off, or the mez is broken. Same picker as Buff timer, ' +
        'opened with the enemy option already chosen.',
      panel: 'buff-timer',
      // Which of the three "On:" options the panel should start on. The picker is identical; the
      // only difference between this premade and Buff timer is what it assumes you came for.
      defaultSource: 'enemy',
    },
  ];

  // Not-yet-built premade ideas - shown as visible-but-disabled entries at
  // the end of the list (see .premade-widget-choice.planned in the CSS) so
  // the roadmap is discoverable in the app itself, not just a note buried in
  // project docs. No create() - clicking these does nothing.
  const PLANNED_PREMADE_WIDGETS = [
    {
      name: 'Bard Song',
      description:
        'A dedicated aura for bard songs specifically (own filter/behavior separate from other self buffs, ' +
        'e.g. tuned for how often they auto-renew). Not built yet.',
    },
    // The rest of the roadmap, shown in the app rather than only in FEATURES.md. Listing something
    // as "not built yet" turns "this seems broken" into "that's coming", which is worth more than
    // it looks to anyone using the app who did not write it.
    {
      name: 'First aggro',
      description:
        'Shows who hit the boss first, or who the boss hit first. Not built yet - and it can only ' +
        'ever be as complete as your own log, which does not see everything across a raid.',
    },
    {
      name: 'Damage parser',
      description: 'A running damage readout built from the combat log. Not built yet.',
    },
    {
      name: 'Travel guide',
      description:
        'Knows which travel spells you have scribed and shows the shortest route somewhere. ' +
        'Not built yet.',
    },
    {
      name: 'Global recovery',
      description: 'A countdown for the global recovery time between casts. Not built yet.',
    },
  ];

  // ---- The buff-timer premade (note 14) --------------------------------------------------
  //
  // The first premade that asks something before it builds. Kept generic on purpose: the planned
  // cooldown and enemy-debuff premades are the same shape - pick one spell, answer one question -
  // and should reuse this rather than each growing their own picker.
  const buffTimerSearch = document.getElementById('buff-timer-search');
  const buffTimerListEl = document.getElementById('buff-timer-list');
  const buffTimerChosenRow = document.getElementById('buff-timer-chosen-row');
  const buffTimerChosenEl = document.getElementById('buff-timer-chosen');
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

  // The list is capped for the same reason the per-aura picker is: 720 trackable spells rendered
  // at once is a long scroll nobody reads, and typing two letters is faster than any of it.
  const BUFF_TIMER_RENDER_CAP = 40;
  let trackableBuffs = [];
  let castableBuffs = [];
  let buffTimerChoice = null;
  let buffTimerPreferredSource = 'self';
  // 'buff' or 'cooldown'. The picker is the same either way; what differs is which list it shows,
  // which question it asks underneath, and what it builds. Note 15 said the cooldown premade
  // should reuse note 14's panel rather than growing a second one over the same spells.
  let buffTimerMode = 'buff';

  function buffTimerPool() {
    return buffTimerMode === 'cooldown' ? castableBuffs : trackableBuffs;
  }

  function renderBuffTimerList() {
    const query = buffTimerSearch.value.trim().toLowerCase();
    const pool = buffTimerPool();
    buffTimerListEl.innerHTML = '';
    if (!query) {
      const what = buffTimerMode === 'cooldown' ? 'spells with a recast time' : 'spells this app can track';
      buffTimerListEl.innerHTML = `<li class="empty">Type to search ${pool.length} ${what}...</li>`;
      return;
    }
    const matches = pool.filter((b) => b.name.toLowerCase().includes(query));
    if (!matches.length) {
      // Says WHY rather than just "none". A spell can be perfectly real and still not be here,
      // because the roster has no landing message for it - and that is a different problem from
      // having spelled it wrong.
      buffTimerListEl.innerHTML =
        buffTimerMode === 'cooldown'
          ? '<li class="empty">Nothing matching. Only spells with a recast longer than the global cooldown are here.</li>'
          : '<li class="empty">Nothing matching. Only spells the app has a landing message for can be tracked.</li>';
      return;
    }
    for (const buff of matches.slice(0, BUFF_TIMER_RENDER_CAP)) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'premade-widget-choice';
      const strong = document.createElement('strong');
      strong.textContent = buff.name;
      const span = document.createElement('span');
      if (buffTimerMode === 'cooldown') {
        span.textContent = `${buff.reuseSec}s recast + ${buff.castSec}s cast = ${buff.cooldownSec}s`;
      } else {
        const howLong = buff.infinite ? 'lasts until dispelled' : buff.durationSec ? `${buff.durationSec}s` : 'no duration';
        const where = buff.enemy
          ? 'on you, an ally, or something you cast it at'
          : buff.ally
            ? 'on you or on an ally'
            : 'on you only';
        span.textContent = `${howLong} - ${where}`;
      }
      btn.append(strong, span);
      btn.addEventListener('click', () => chooseBuffTimerSpell(buff));
      li.appendChild(btn);
      buffTimerListEl.appendChild(li);
    }
    if (matches.length > BUFF_TIMER_RENDER_CAP) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = `...and ${matches.length - BUFF_TIMER_RENDER_CAP} more - keep typing to narrow it down.`;
      buffTimerListEl.appendChild(li);
    }
  }

  function chooseBuffTimerSpell(buff) {
    buffTimerChoice = buff;
    buffTimerChosenEl.textContent = buff.name;
    buffTimerChosenRow.style.display = '';
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
      return;
    }

    buffTimerCooldownRow.style.display = 'none';
    buffTimerCooldownHint.style.display = 'none';
    buffTimerSourceRow.style.display = '';

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
  }

  // preferredSource is what the premade that opened this panel came for - the radios still show
  // all three, so the choice is visible rather than hidden, it just starts on the likely one.
  function resetBuffTimerPanel(preferredSource, mode) {
    buffTimerMode = mode === 'cooldown' ? 'cooldown' : 'buff';
    buffTimerPreferredSource = preferredSource === 'enemy' || preferredSource === 'ally' ? preferredSource : 'self';
    buffTimerChoice = null;
    buffTimerSearch.value = '';
    buffTimerChosenRow.style.display = 'none';
    buffTimerSourceRow.style.display = 'none';
    buffTimerCreateRow.style.display = 'none';
    buffTimerAllyWarning.style.display = 'none';
    buffTimerEnemyWarning.style.display = 'none';
    buffTimerCooldownRow.style.display = 'none';
    buffTimerCooldownHint.style.display = 'none';
    buffTimerSourceRow.querySelector('input[value="self"]').checked = true;
    renderBuffTimerList();
  }

  buffTimerSearch.addEventListener('input', renderBuffTimerList);
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
          closeAddWidgetModal();
          focusWidget(config.id);
        });
      return;
    }
    const source = buffTimerSourceRow.querySelector('input[name="buff-timer-source"]:checked').value;
    // Named after the spell, because that is what the user just picked and searched for - having
    // to name it as well would be a second question for no information.
    window.eqTracker
      .createBuffTimerWidget(buffTimerChoice.name, buffTimerChoice.name, source)
      .then((config) => {
        closeAddWidgetModal();
        focusWidget(config.id);
      });
  });

  // Electron's accelerator spelling is not how anyone reads a key off their keyboard.
  const HOTKEY_LABELS = {
    ScrollLock: 'Scroll Lock',
    'Alt+Shift+H': 'Alt+Shift+H',
  };

  function renderPremadeList() {
    premadeListEl.innerHTML = '';
    for (const premade of PREMADE_WIDGETS) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'premade-widget-choice';
      const strong = document.createElement('strong');
      strong.textContent = premade.name;
      const span = document.createElement('span');
      span.textContent = premade.description;
      btn.append(strong, span);
      btn.addEventListener('click', () => {
        // A premade with a panel asks something first; the rest build immediately.
        if (premade.panel) {
          addWidgetPanels.forEach((panel) => {
            panel.style.display = panel.id === `add-widget-${premade.panel}-panel` ? '' : 'none';
          });
          if (premade.panel === 'buff-timer') {
            resetBuffTimerPanel(premade.defaultSource, premade.mode);
            buffTimerSearch.focus();
          }
          return;
        }
        premade.create(premade.name).then((config) => {
          closeAddWidgetModal();
          focusWidget(config.id);
        });
      });
      li.appendChild(btn);
      premadeListEl.appendChild(li);
    }
    // A premade that has been BUILT must not still be sitting in the planned list, or the Add
    // Aura list offers it twice - once working, once greyed out as "Not built yet". That happened
    // to both Buff timer and Debuff on an enemy, because building one means adding an entry over
    // there and it is easy to forget to remove this one. Filtered rather than merely tested, so
    // the app is right even if someone adds a premade without reading the test.
    const builtNames = new Set(PREMADE_WIDGETS.map((p) => p.name));
    for (const planned of PLANNED_PREMADE_WIDGETS.filter((p) => !builtNames.has(p.name))) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'premade-widget-choice planned';
      btn.disabled = true;
      const strong = document.createElement('strong');
      strong.textContent = planned.name;
      const badge = document.createElement('span');
      badge.className = 'planned-badge';
      badge.textContent = 'Planned';
      strong.appendChild(badge);
      const span = document.createElement('span');
      span.textContent = planned.description;
      btn.append(strong, span);
      li.appendChild(btn);
      premadeListEl.appendChild(li);
    }
  }

  function showAddWidgetChoices() {
    addWidgetChoicesEl.style.display = '';
    addWidgetPanels.forEach((panel) => (panel.style.display = 'none'));
  }

  function openAddWidgetModal() {
    // Fetched once, when the modal opens, rather than held for the session: the roster changes
    // when someone edits a buff on the Known Buffs page, and a stale list would offer a spell
    // that can no longer be tracked.
    window.eqTracker.getTrackableBuffs().then((buffs) => {
      trackableBuffs = buffs;
      renderBuffTimerList();
    });
    window.eqTracker.getCastableBuffs().then((buffs) => {
      castableBuffs = buffs;
      renderBuffTimerList();
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
  addWidgetBackBtns.forEach((btn) => btn.addEventListener('click', showAddWidgetChoices));

  addWidgetChoicesEl.querySelectorAll('.add-widget-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      addWidgetChoicesEl.style.display = 'none';
      addWidgetPanels.forEach((panel) => {
        panel.style.display = panel.id === `add-widget-${btn.dataset.choice}-panel` ? '' : 'none';
      });
      if (btn.dataset.choice === 'custom') modalNewWidgetNameInput.focus();
      else if (btn.dataset.choice === 'import') importCodeInput.focus();
    });
  });

  // buffSource is undefined here for a plain buff widget (backend defaults
  // to 'self'; togglable to 'ally' afterward in settings) - 'customTimer'
  // for a timer widget locks that in permanently, never offered as a
  // settings toggle (see buffSourceRow visibility above).
  function addWidget(buffSource) {
    const name = modalNewWidgetNameInput.value.trim();
    if (!name) return;
    window.eqTracker.createWidget(name, buffSource).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  }
  modalAddBuffWidgetBtn.addEventListener('click', () => addWidget());
  modalAddTimerWidgetBtn.addEventListener('click', () => addWidget('customTimer'));
  modalAddSoundWidgetBtn.addEventListener('click', () => {
    const name = modalNewWidgetNameInput.value.trim();
    if (!name) return;
    window.eqTracker.createSoundOnlyWidget(name).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  });
  modalAddTextWidgetBtn.addEventListener('click', () => {
    const name = modalNewWidgetNameInput.value.trim();
    if (!name) return;
    // Its own creator rather than createWidget with a flag: a text aura is a type, and it starts
    // with settings of its own that a plain custom aura has no use for.
    window.eqTracker.createTextAuraWidget(name).then((config) => {
      closeAddWidgetModal();
      focusWidget(config.id);
    });
  });
  modalNewWidgetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWidget();
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
  buffSourceRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      window.eqTracker.setWidgetBuffSource(selectedId, radio.value).then((widget) => {
        refreshWidgets();
        if (widget) renderBuffFilter(widget);
      });
    });
  });
  displayModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      updateDisplayModeVisibility(radio.value);
      window.eqTracker.setWidgetDisplayMode(selectedId, radio.value);
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
  textMessageInput.addEventListener('change', () => {
    window.eqTracker.setWidgetTextAuraMessage(selectedId, textMessageInput.value);
  });
  textInstantSlider.addEventListener('input', () => {
    const seconds = Number(textInstantSlider.value);
    textInstantValueEl.textContent = `${seconds}s`;
    window.eqTracker.setWidgetTextAuraInstantSec(selectedId, seconds);
  });
  textAuraSizeSlider.addEventListener('input', () => {
    const size = Number(textAuraSizeSlider.value);
    textAuraSizeValueEl.textContent = `${size}px`;
    window.eqTracker.setWidgetTextAuraSize(selectedId, size);
  });
  categoryBordersCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetCategoryBorders(selectedId, categoryBordersCheckbox.checked);
  });
  trackEnemiesCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetTrackOnEnemies(selectedId, trackEnemiesCheckbox.checked);
  });
  allyAlertCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetAllyDebuffAlert(selectedId, allyAlertCheckbox.checked);
  });
  alwaysOnCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetAlwaysOn(selectedId, alwaysOnCheckbox.checked);
  });
  const zoneInput = document.getElementById('widget-zone-input');
  const zoneAddBtn = document.getElementById('widget-zone-add-btn');
  function addZoneToSelected() {
    const zone = zoneInput.value.trim();
    if (!zone || !selectedId) return;
    const current = findWidget(selectedId)?.visibleInZones || [];
    if (current.includes(zone)) {
      zoneInput.value = '';
      return;
    }
    window.eqTracker.setWidgetVisibleInZones(selectedId, [...current, zone]).then(() => {
      zoneInput.value = '';
      refreshWidgets();
    });
  }
  zoneAddBtn.addEventListener('click', addZoneToSelected);
  zoneInput.addEventListener('keydown', (e) => {
    // Enter adds it. Typing a zone name and pressing Enter is what everyone does with a box like
    // this, and having it do nothing reads as the box being broken.
    if (e.key === 'Enter') {
      e.preventDefault();
      addZoneToSelected();
    }
  });

  allProfilesCheckbox.addEventListener('change', () => {
    // refreshWidgets, because this changes whether the aura is on screen right now - the per-
    // profile tick boxes beside it do the same for the same reason.
    window.eqTracker.setWidgetShowOnAllProfiles(selectedId, allProfilesCheckbox.checked).then(refreshWidgets);
  });
  mergeCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetMergeSameDuration(selectedId, mergeCheckbox.checked).then(refreshWidgets);
  });
  soundLandCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetSoundOnLand(selectedId, soundLandCheckbox.checked);
  });
  soundExpireCheckbox.addEventListener('change', () => {
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
      if (!soundId) {
        nameEl.textContent = 'Default beep';
        resetBtn.style.display = 'none';
        previewBtn.style.display = 'none';
        return;
      }
      resetBtn.style.display = '';
      previewBtn.style.display = '';
      window.eqTracker.getSoundInfo(soundId).then((info) => {
        nameEl.textContent = info ? info.originalName : 'Default beep';
      });
    }

    chooseBtn.addEventListener('click', () => {
      window.eqTracker.pickSound().then((result) => {
        if (!result) return; // cancelled, or picked something with an unrecognized extension
        window.eqTracker[setterName](selectedId, result.id).then(() => render(result.id));
      });
    });
    previewBtn.addEventListener('click', () => {
      if (!currentSoundId) return;
      const audio = new Audio(`eqsound://sound/${currentSoundId}`);
      audio.volume = currentVolumeFraction();
      audio.play().catch(() => {});
    });
    resetBtn.addEventListener('click', () => {
      window.eqTracker[setterName](selectedId, null).then(() => render(null));
    });

    return render;
  }

  const renderLandSoundPicker = setupSoundPicker('land', 'setWidgetLandSoundId');
  const renderExpireSoundPicker = setupSoundPicker('expire', 'setWidgetExpireSoundId');
  const renderWarningSoundPicker = setupSoundPicker('warning', 'setWidgetWarningSoundId');
  soundWarningSlider.addEventListener('input', () => {
    const seconds = Number(soundWarningSlider.value);
    soundWarningValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    window.eqTracker.setWidgetSoundWarningSec(selectedId, seconds);
  });
  soundWarningLoopSlider.addEventListener('input', () => {
    const seconds = Number(soundWarningLoopSlider.value);
    soundWarningLoopValueEl.textContent = seconds === 0 ? 'off' : `${seconds}s`;
    window.eqTracker.setWidgetSoundWarningLoopSec(selectedId, seconds);
  });

  hideBardSongsCheckbox.addEventListener('change', () => {
    // Inverted - see the render side above.
    window.eqTracker.setWidgetHideBardSongs(selectedId, !hideBardSongsCheckbox.checked);
  });
  maxDurationSlider.addEventListener('input', () => {
    const minutes = Number(maxDurationSlider.value);
    maxDurationValueEl.textContent = minutes === 0 ? 'off' : `${minutes}m`;
    window.eqTracker.setWidgetMaxDurationFilter(selectedId, minutes * 60);
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
    const totalSec = (Number(newTimerMinutesInput.value) || 0) * 60 + (Number(newTimerSecondsInput.value) || 0);
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
    } else {
      trigger = newTimerTriggerInput.value.trim();
      endedText = newTimerEndedInput.value.trim() || undefined;
    }
    if (!name || !trigger || totalSec <= 0) return null;

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
      // Only meaningful for a raw-text trigger. The chat builder writes a whole line it composed
      // itself, so matching part of it would be matching part of something the user never typed.
      triggerMatch:
        mode === 'raw' && [...newTimerMatchRadios].find((r) => r.checked)?.value === 'contains'
          ? 'contains'
          : undefined,
    };
  }

  // Master unlock for every aura at once. State is read back from the main
  // process rather than tracked here, so the button stays correct even when
  // something else changes it (unlocking a single aura, a profile switch).
  const masterUnlockAllBtn = document.getElementById('master-unlock-all-btn');
  const masterHideAllBtn = document.getElementById('master-hide-all-btn');

  function renderMasterButtons(state) {
    masterUnlockAllBtn.classList.toggle('active', state.allUnlocked);
    masterUnlockAllBtn.textContent = state.allUnlocked ? 'Lock all auras' : 'Unlock all auras';
    // Note 4. The label changes as well as the colour: the button is in the always-visible bar,
    // so it is read at a glance from across the room, and "Hide auras" while auras are already
    // hidden would be the wrong half of the sentence.
    masterHideAllBtn.classList.toggle('active', state.masterHidden);
    masterHideAllBtn.textContent = state.masterHidden ? 'Auras hidden - show' : 'Hide auras';
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
  // SHAREABLE_FIELDS and the recipient falls back to the default beep. For an aura with tiles
  // that is a cosmetic loss nobody needs warning about. For a sound-only aura the sound IS the
  // aura, so the recipient gets a different thing wearing the same name with no signal at all -
  // which is why this says so at the moment the code is produced rather than in the docs.
  function soundWarningFor(widget) {
    if (!widget) return '';
    const files = ['landSoundId', 'expireSoundId', 'warningSoundId'].filter((k) => widget[k]);
    if (!files.length) return '';
    const which = files.length === 1 ? 'sound file' : 'sound files';
    return widget.displayMode === 'sound-only'
      ? `Your chosen ${which} will NOT travel with this code - whoever imports it hears the default ` +
        `beep instead. This aura is nothing but its sound, so send them the file separately if you ` +
        `want them to hear what you hear.`
      : `Note: your chosen ${which} will not travel with this code. Everything else does; whoever ` +
        `imports it hears the default beep unless you send them the file separately.`;
  }

  exportBtn.addEventListener('click', () => {
    window.eqTracker.exportWidget(selectedId).then((code) => {
      if (!code) return;
      exportCodeOutput.value = code;
      exportCodeRow.style.display = '';
      const warning = soundWarningFor(findWidget(selectedId));
      exportSoundWarningEl.textContent = warning;
      exportSoundWarningEl.style.display = warning ? '' : 'none';
      exportCodeOutput.select();
    });
  });
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
        // Spelled out separately because it is the one outcome someone would not predict from
        // "overwrite its current settings": Self Buffs cannot be deleted, so an unexpected
        // sound-only code leaves them looking at an empty screen with no obvious way back.
        const soundOnlyWarning =
          info.displayMode === 'sound-only'
            ? '\n\nNOTE: this code is for a SOUND ONLY aura. Self Buffs will stop drawing ' +
              'anything on screen and will only make sounds. You can put it back with Display ' +
              'style > List on its settings page.'
            : '';
        const confirmed = window.confirm(
          'This code is for the Self Buffs aura and will overwrite its current settings ' +
            '(display, filters, sounds, etc.) - not create a new aura. Continue?' +
            soundOnlyWarning
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
  refreshProfilesCache().then(renderWidgetSubmenu);

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
function initUiScale() {
  const slider = document.getElementById('ui-scale-slider');
  const valueEl = document.getElementById('ui-scale-value');
  const resetBtn = document.getElementById('ui-scale-reset-btn');
  if (!slider) return;

  function show(pct) {
    slider.value = pct;
    valueEl.textContent = `${pct}%`;
  }

  window.eqTracker.getUiScale().then((pct) => show(pct || 100));

  slider.addEventListener('input', () => {
    const pct = Number(slider.value);
    valueEl.textContent = `${pct}%`;
    // Applied live on drag so the size can be judged by eye rather than by the number. The main
    // process clamps and persists, and returns what it actually used.
    window.eqTracker.setUiScale(pct);
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

function initTradePing() {
  const checkbox = document.getElementById('trade-ping-checkbox');
  const testBtn = document.getElementById('trade-ping-test-btn');
  if (!checkbox) return;

  let enabled = false;
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

  testBtn.addEventListener('click', ping);

  window.eqTracker.onLogLine((line) => {
    if (!enabled) return;
    // Timestamps are stripped the same way the detection engine does it, so a line is matched on
    // its text alone.
    const stripped = String(line).replace(/^\[[^\]]+\]\s*/, '').trim();
    if (TRADE_REQUEST_PATTERN.test(stripped)) ping();
  });
}
