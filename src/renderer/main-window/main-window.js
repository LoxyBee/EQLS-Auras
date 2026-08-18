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

  initNavigation();
  initProfileBar();
  initLogPanel();
  initDetectionSettingsPanel();
  initBuffPanels();
  initWidgetsPanel();
  initKnownBuffsPanel();
  initCharacterSettingsPanel();
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
          `Delete the loadout profile "${profile.name}"? This permanently discards its remembered ambiguous-cast answers. Widgets aren't deleted or hidden - they just stop listing this profile as one they belong to.`
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
        checklistEl.innerHTML = '<li class="empty">No widgets yet.</li>';
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
  const memorizedStatusEl = document.getElementById('memorized-spells-status');

  window.eqTracker.getSpellbookState().then((state) => {
    spellbookStatusEl.textContent = state.filePath
      ? `Found - ${state.spellCount} spells (${state.filePath})`
      : 'Not found yet - will pick it up automatically once detected.';
  });

  function renderMemorized(names) {
    memorizedStatusEl.textContent = names.length > 0 ? names.join(', ') : 'None seen yet this session.';
  }
  window.eqTracker.getMemorizedSpells().then(renderMemorized);
  window.eqTracker.onMemorizedSpellsChanged(renderMemorized);

  const autoHideCheckbox = document.getElementById('auto-hide-overlay-checkbox');
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

  function appendLine(line) {
    const div = document.createElement('div');
    div.textContent = line;
    feedEl.appendChild(div);
    while (feedEl.children.length > MAX_FEED_LINES) {
      feedEl.removeChild(feedEl.firstChild);
    }
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function appendDebugLine(line) {
    const div = document.createElement('div');
    div.textContent = line;
    debugFeedEl.appendChild(div);
    while (debugFeedEl.children.length > MAX_FEED_LINES) {
      debugFeedEl.removeChild(debugFeedEl.firstChild);
    }
    debugFeedEl.scrollTop = debugFeedEl.scrollHeight;
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

function initWidgetsPanel() {
  const submenuEl = document.getElementById('widgets-submenu');
  const addRow = submenuEl.querySelector('.nav-add-widget-row');
  const widgetsNavBtn = document.getElementById('widgets-nav-btn');
  const introCard = document.getElementById('widgets-intro-card');
  const iconSetCard = document.getElementById('icon-set-card');

  const settingsPanel = document.getElementById('widget-settings-panel');
  const settingsTitle = document.getElementById('widget-settings-title');
  const nameInput = document.getElementById('widget-name-input');
  const enabledCheckbox = document.getElementById('widget-enabled-checkbox');
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
  const soundWarningLoopSlider = document.getElementById('widget-sound-loop-slider');
  const soundWarningLoopValueEl = document.getElementById('widget-sound-loop-value');
  // Scoped per grid, not a bare '.anchor-cell' query - the label position
  // grid reuses the same cell markup/class, and a global query would mix
  // the two grids' buttons together (wrong "active" cell, wrong grid
  // cleared on click).
  const anchorButtons = document.querySelectorAll('#widget-anchor-grid .anchor-cell');
  const iconOnlySettings = document.getElementById('widget-icon-only-settings');
  const iconPositionSettings = document.getElementById('widget-icon-position-settings');
  const iconLabelSectionEl = document.getElementById('widget-icon-label-section');
  const showIconLabelCheckbox = document.getElementById('widget-show-icon-label-checkbox');
  const iconLabelOptionsEl = document.getElementById('widget-icon-label-options');
  const iconLabelSizeSlider = document.getElementById('widget-icon-label-size-slider');
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
  const modalNewWidgetNameInput = document.getElementById('modal-new-widget-name');
  const modalAddBuffWidgetBtn = document.getElementById('modal-add-buff-widget-btn');
  const modalAddTimerWidgetBtn = document.getElementById('modal-add-timer-widget-btn');

  const activeBuffsCardEl = document.getElementById('widget-active-buffs-card');
  const manageCardEl = document.getElementById('widget-manage-card');
  const widgetProfilesCardEl = document.getElementById('widget-profiles-card');
  const widgetProfilesChecklistEl = document.getElementById('widget-profiles-checklist');
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
  const newTimerTriggerInput = document.getElementById('widget-new-timer-trigger');
  const newTimerEndedInput = document.getElementById('widget-new-timer-ended');
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
  const newTimerIconPreview = document.getElementById('widget-new-timer-icon-preview');
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
    widgetProfilesCardEl.style.display = '';
    const buffs = filterActiveBuffsForWidget(widget);
    activeBuffsListEl.innerHTML = '';
    if (buffs.length === 0) {
      activeBuffsListEl.innerHTML = '<li class="empty">Nothing active on this widget right now.</li>';
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
        else if (widget.buffSource === 'customTimer') window.eqTracker.removeActiveCustomTimer(buff.name);
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
        excludeBtn.title = 'Hide this buff from this widget only - other widgets are unaffected';
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
  function renderWidgetProfilesChecklist(widget) {
    widgetProfilesChecklistEl.innerHTML = '';
    window.eqTracker.getProfiles().then((profiles) => {
      if (profiles.length <= 1) {
        widgetProfilesChecklistEl.innerHTML = '<li class="empty">Only one profile exists - add more from the top bar.</li>';
        return;
      }
      const activeIds = new Set(widget.activeProfileIds || []);
      profiles.forEach((profile) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = activeIds.has(profile.id);
        checkbox.addEventListener('change', () => {
          const current = new Set(findWidget(widget.id)?.activeProfileIds || []);
          if (checkbox.checked) current.add(profile.id);
          else current.delete(profile.id);
          window.eqTracker.setWidgetActiveProfileIds(widget.id, [...current]).then(refreshWidgets);
        });
        label.append(checkbox, ' ' + profile.name);
        li.appendChild(label);
        widgetProfilesChecklistEl.appendChild(li);
      });
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
      btn.textContent = widget.name;
      btn.addEventListener('click', () => {
        activateNavButton(btn);
        selectWidget(widget.id);
      });

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
    widgetProfilesCardEl.style.display = 'none';
    trackOthersRowEl.style.display = 'none';
    selectedBuffsSectionEl.style.display = 'none';
    introCard.style.display = '';
    iconSetCard.style.display = '';
  }

  // Icon size/icons-per-row/timer-text-position only mean anything in Icon
  // mode; row size only means anything in List mode - shown/hidden
  // together whenever the mode changes.
  function updateIconOnlyVisibility(displayMode) {
    iconOnlySettings.style.display = displayMode === 'icons' ? '' : 'none';
    iconPositionSettings.style.display = displayMode === 'icons' ? '' : 'none';
    iconLabelSectionEl.style.display = displayMode === 'icons' ? '' : 'none';
    listOnlySettings.style.display = displayMode === 'icons' ? 'none' : '';
    displayIconOnlySettings.style.display = displayMode === 'icons' ? '' : 'none';
    displayListOnlySettings.style.display = displayMode === 'icons' ? 'none' : '';
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
      widgetProfilesCardEl.style.display = 'none';
      trackOthersRowEl.style.display = 'none';
      selectedBuffsSectionEl.style.display = 'none';
      return;
    }
    introCard.style.display = 'none';
    iconSetCard.style.display = 'none';
    settingsPanel.style.display = '';
    exportCodeRow.style.display = 'none';
    exportCodeOutput.value = '';
    settingsTitle.textContent = `${widget.name} settings`;
    nameInput.value = widget.name;
    enabledCheckbox.checked = widget.enabled;
    // Self-vs-ally is a togglable choice on a self/ally custom widget, but
    // a "custom timer widget" fixes its source at creation time (see the
    // Add Widget modal's two distinct buttons) and never offers this
    // toggle - same reasoning as the two builtin kinds having a fixed,
    // implied source (Self Buffs always self, Ally Buffs always ally).
    buffSourceRow.style.display = widget.kind === 'custom' && widget.buffSource !== 'customTimer' ? '' : 'none';
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
    soundLandCheckbox.checked = !!widget.soundOnLand;
    soundExpireCheckbox.checked = !!widget.soundOnExpire;
    const warningSec = widget.soundWarningSec || 0;
    soundWarningSlider.value = warningSec;
    soundWarningValueEl.textContent = warningSec === 0 ? 'off' : `${warningSec}s`;
    const warningLoopSec = widget.soundWarningLoopSec || 0;
    soundWarningLoopSlider.value = warningLoopSec;
    soundWarningLoopValueEl.textContent = warningLoopSec === 0 ? 'off' : `${warningLoopSec}s`;
    anchorButtons.forEach((b) => b.classList.toggle('active', b.dataset.anchor === (widget.contentAnchor || 'bottom-center')));
    wrapTextCheckbox.checked = !!widget.wrapText;
    showIconLabelCheckbox.checked = !!widget.showIconLabel;
    const labelSize = typeof widget.iconLabelSize === 'number' ? widget.iconLabelSize : 11;
    iconLabelSizeSlider.value = labelSize;
    iconLabelSizeValueEl.textContent = `${labelSize}px`;
    iconLabelAnchorButtons.forEach((b) =>
      b.classList.toggle('active', b.dataset.anchor === (widget.iconLabelAnchor || 'top-center'))
    );
    updateIconLabelOptionsVisibility();
    updateIconOnlyVisibility(widget.displayMode);
    deleteBtn.style.display = widget.deletable ? '' : 'none';
    duplicateWidgetBtn.style.display = widget.kind === 'self-buffs-builtin' ? 'none' : '';

    window.eqTracker.isWidgetLocked(id).then((locked) => {
      lockBtn.textContent = locked ? 'Unlock to move' : 'Lock widget';
      lockBtn.classList.toggle('unlocked', !locked);
    });

    renderBuffFilter(widget);
    renderActiveBuffsForWidget(widget);
    renderWidgetProfilesChecklist(widget);
  }

  function renderBuffFilter(widget) {
    // Custom timers are a wholly separate concept from buff-picking (own
    // card, own heading - see widget-custom-timers-card) - not a "buffs
    // shown" filter mode at all, since there's no shared pool to pick
    // from. Shown/hidden independently of filterCard.
    customTimersCardEl.style.display = widget.buffSource === 'customTimer' ? '' : 'none';
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
          ? 'This widget shows every buff you\'ve cast on a current group member, marked "Overlay" ' +
            'the same way self buffs are - uncheck "Overlay" for a buff on the Known Buffs page to ' +
            'hide it here too.'
          : 'This widget shows every buff marked "Overlay" on the Known Buffs page. To hide a ' +
            'specific buff from it, uncheck "Overlay" for that buff there instead.';
      filterSearch.style.display = 'none';
      filterListEl.innerHTML = '';
      selectedBuffsSectionEl.style.display = 'none';
      selfBuffsFiltersEl.style.display = '';
      hideBardSongsCheckbox.checked = !!widget.hideBardSongs;
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
    filterHint.textContent = 'Pick which known buffs should show on this widget.';
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
  function renderSelectedBuffsList(widget) {
    const names = widget.buffNames || [];
    selectedBuffsSectionEl.style.display = names.length > 0 ? '' : 'none';
    selectedBuffsListEl.innerHTML = '';
    for (const name of names) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'overlay-toggle-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', () => toggleBuffFilterName(widget, name, cb.checked));
      label.append(cb, document.createTextNode(name));
      li.appendChild(label);
      selectedBuffsListEl.appendChild(li);
    }
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
    newTimerChatFieldsEl.style.display = mode === 'chat' ? '' : 'none';
    newTimerRawFieldsEl.style.display = mode === 'raw' ? '' : 'none';
  }

  function resetTimerForm() {
    editingTimerId = null;
    newTimerIconId = undefined;
    newTimerNameInput.value = '';
    newTimerMinutesInput.value = '';
    newTimerSecondsInput.value = '';
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
    newTimerAddBtn.textContent = 'Add';
    newTimerSaveAsNewBtn.style.display = 'none';
    newTimerCancelBtn.style.display = 'none';
    newTimerIconPreview.style.display = 'none';
    newTimerIconPicker.style.display = 'none';
    newTimerIconPicker.innerHTML = '';
  }

  function renderCustomTimersList(widget) {
    customTimersListEl.innerHTML = '';
    const timers = widget.customTimers || [];
    if (timers.length === 0) {
      customTimersListEl.innerHTML = '<li class="empty">None yet - add one above.</li>';
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
        editBtn.addEventListener('click', () => {
          editingTimerId = timer.id;
          newTimerNameInput.value = timer.name;
          newTimerMinutesInput.value = String(Math.floor(timer.durationSec / 60));
          newTimerSecondsInput.value = String(timer.durationSec % 60);
          // Restores whichever mode this timer was actually built in -
          // triggerChat only exists on a timer set up via the chat-message
          // builder (see the Add/Save handler below); anything else
          // (including every timer that predates this feature) only ever
          // had a raw triggerText/endedText, so it lands back in raw mode
          // with the exact line it already has, unchanged.
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
          if (iconUrl) {
            newTimerIconPreview.src = iconUrl;
            newTimerIconPreview.style.display = '';
          } else {
            newTimerIconPreview.style.display = 'none';
          }
          newTimerAddBtn.textContent = 'Save changes';
          newTimerSaveAsNewBtn.style.display = '';
          newTimerCancelBtn.style.display = '';
          newTimerNameInput.focus();
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          if (!window.confirm(`Delete timer "${timer.name}"? This can't be undone.`)) return;
          if (editingTimerId === timer.id) resetTimerForm();
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

  function toggleBuffFilterName(widget, name, checked) {
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
      `Delete widget "${widget ? widget.name : ''}"? This closes its overlay window and can't be undone.`
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
  ];

  // Not-yet-built premade ideas - shown as visible-but-disabled entries at
  // the end of the list (see .premade-widget-choice.planned in the CSS) so
  // the roadmap is discoverable in the app itself, not just a note buried in
  // project docs. No create() - clicking these does nothing.
  const PLANNED_PREMADE_WIDGETS = [
    {
      name: 'You Have Been Dispelled',
      description:
        'A one-time event notification, not a duration timer - flashes a message when a dispel lands on you. ' +
        'Not built yet.',
    },
    {
      name: 'Bard Song',
      description:
        'A dedicated widget for bard songs specifically (own filter/behavior separate from other self buffs, ' +
        'e.g. tuned for how often they auto-renew). Not built yet.',
    },
  ];

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
        premade.create(premade.name).then((config) => {
          closeAddWidgetModal();
          focusWidget(config.id);
        });
      });
      li.appendChild(btn);
      premadeListEl.appendChild(li);
    }
    for (const planned of PLANNED_PREMADE_WIDGETS) {
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
  modalNewWidgetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWidget();
  });

  nameInput.addEventListener('change', () => {
    window.eqTracker.setWidgetName(selectedId, nameInput.value.trim() || 'Widget').then(refreshWidgets);
  });
  enabledCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetEnabled(selectedId, enabledCheckbox.checked).then(refreshWidgets);
  });
  lockBtn.addEventListener('click', async () => {
    const locked = await window.eqTracker.toggleWidgetLock(selectedId);
    lockBtn.textContent = locked ? 'Unlock to move' : 'Lock widget';
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
      updateIconOnlyVisibility(radio.value);
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
  soundLandCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetSoundOnLand(selectedId, soundLandCheckbox.checked);
  });
  soundExpireCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetSoundOnExpire(selectedId, soundExpireCheckbox.checked);
  });
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

  // Topic disclosures (UX_VISUAL_DESIGN.md) - the topics themselves are
  // static markup (always present, just shown/hidden and repopulated per
  // selected widget), so this only needs wiring once here, not re-wired on
  // every widget selection. Deliberately no reset-on-switch: which topics
  // are open/closed persists as you click between widgets in the sidebar,
  // since nothing about switching widgets destroys these DOM nodes.
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.topic').classList.toggle('open');
    });
  });
  hideBardSongsCheckbox.addEventListener('change', () => {
    window.eqTracker.setWidgetHideBardSongs(selectedId, hideBardSongsCheckbox.checked);
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
          newTimerIconPreview.src = `eqicon://icon/${encodeURIComponent(iconSet)}/${iconId}`;
          newTimerIconPreview.style.display = '';
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
    };
  }

  newTimerCancelBtn.addEventListener('click', resetTimerForm);
  newTimerAddBtn.addEventListener('click', () => {
    const timerData = readTimerFormData();
    if (!timerData) return;
    const request = editingTimerId
      ? window.eqTracker.updateWidgetCustomTimer(selectedId, editingTimerId, timerData)
      : window.eqTracker.addWidgetCustomTimer(selectedId, timerData);
    request
      .then(() => {
        resetTimerForm();
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
        resetTimerForm();
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
  exportBtn.addEventListener('click', () => {
    window.eqTracker.exportWidget(selectedId).then((code) => {
      if (!code) return;
      exportCodeOutput.value = code;
      exportCodeRow.style.display = '';
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
        importStatus.textContent = "That doesn't look like a valid widget code.";
        return;
      }

      if (info.kind === 'self-buffs-builtin') {
        // Self Buffs is a singleton - this code has to overwrite the
        // existing one in place, never spawn a second "Self Buffs".
        // Settings only: name isn't touched.
        const confirmed = window.confirm(
          'This code is for the Self Buffs widget and will overwrite its current settings ' +
            '(display, filters, sounds, etc.) - not create a new widget. Continue?'
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
          importStatus.textContent = "That doesn't look like a valid widget code.";
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
    refreshWidgets().then(() => {
      const widget = selectedId && findWidget(selectedId);
      if (widget) renderWidgetProfilesChecklist(widget);
    });
  });

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
  topRow.append(nameSpan, duration.element, saveBtn, overlayLabel, bardSongLabel, iconBtn, deleteBtn);

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
