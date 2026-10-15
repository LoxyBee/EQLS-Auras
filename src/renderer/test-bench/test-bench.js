'use strict';

// Test bench window (dev builds only) - see src/main/testBench.js.
(function () {
  const api = window.eqTestBench;
  const lineEl = document.getElementById('line');
  const statusEl = document.getElementById('status');
  const presetsEl = document.getElementById('presets');
  const historyEl = document.getElementById('history');
  const historyEmptyEl = document.getElementById('history-empty');
  const examplesEl = document.getElementById('examples');

  let history = [];
  let historyCursor = -1; // Up/Down position in history; -1 = the line being typed

  function status(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function renderHistory(list) {
    history = Array.isArray(list) ? list : [];
    historyEl.innerHTML = '';
    historyEmptyEl.style.display = history.length ? 'none' : '';
    for (const line of history) {
      const li = document.createElement('li');
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.className = 'resend';
      resend.textContent = line;
      resend.title = `Send again: ${line}`;
      resend.addEventListener('click', () => sendLine(line));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.title = 'Remove from history';
      remove.addEventListener('click', () => api.removeHistory(line).then(renderHistory));
      li.append(resend, remove);
      historyEl.appendChild(li);
    }
  }

  function renderPresets(presets) {
    presetsEl.innerHTML = '';
    const groups = new Map();
    presets.forEach((p, index) => {
      const g = p.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ ...p, index });
    });
    for (const [name, items] of groups) {
      const h = document.createElement('h3');
      h.textContent = name;
      const wrap = document.createElement('div');
      wrap.className = 'group';
      for (const p of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.title = (p.lines || []).map((l) => l.text).join('\n');
        btn.addEventListener('click', () =>
          api.runPreset(p.index).then((r) => {
            if (r && r.ok) status(`Sent "${p.label}" (${r.count} line${r.count === 1 ? '' : 's'})`);
            else status((r && r.error) || 'Could not send', true);
          })
        );
        wrap.appendChild(btn);
      }
      presetsEl.append(h, wrap);
    }
  }

  function sendLine(text) {
    return api.send(text).then((r) => {
      if (r && r.ok) status(`Sent: ${r.line}`);
      else status((r && r.error) || 'Could not send', true);
      return r;
    });
  }

  document.getElementById('send-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = lineEl.value;
    if (!text.trim()) return;
    sendLine(text).then((r) => {
      if (r && r.ok) {
        lineEl.value = '';
        historyCursor = -1;
      }
    });
  });

  // Shell-style recall: Up = older, Down = newer, back to an empty box past the newest.
  lineEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!history.length) return;
    e.preventDefault();
    historyCursor += e.key === 'ArrowUp' ? 1 : -1;
    historyCursor = Math.max(-1, Math.min(history.length - 1, historyCursor));
    lineEl.value = historyCursor === -1 ? '' : history[historyCursor];
  });

  document.getElementById('clear-history').addEventListener('click', () => api.clearHistory().then(renderHistory));
  document.getElementById('exit').addEventListener('click', () => api.stop());
  examplesEl.addEventListener('change', () => api.setExamples(examplesEl.checked));

  api.onHistory(renderHistory);
  api.onState((s) => {
    if (s && typeof s.examples === 'boolean') examplesEl.checked = s.examples;
  });

  api.getPresets().then((p) => renderPresets(Array.isArray(p) ? p : []));
  api.getHistory().then(renderHistory);
  api.getState().then((s) => {
    if (s && typeof s.examples === 'boolean') examplesEl.checked = s.examples;
  });
  lineEl.focus();
})();
