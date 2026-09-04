/* SearchDropdown - a themed replacement for a native <select>, with a filter box for long lists.
 *
 * The <select> stays in the DOM as the source of truth: enhance() hides it, builds a button +
 * popup (filter input + list) beside it, and mirrors every pick back onto the <select>.value and
 * fires its 'change' event - so every existing `sel.value` / `sel.addEventListener('change')` in
 * main-window.js keeps working untouched.
 *
 * A MutationObserver rebuilds the list whenever the <select>'s <option>s change (the many
 * `sel.innerHTML = ''; ...append...; sel.value = x` populate blocks), on the next frame so the
 * trailing `.value =` has already run.
 *
 * The filter input only appears when there are more than FILTER_THRESHOLD options - a filter over
 * five choices is just an extra keystroke.
 */
(function () {
  'use strict';
  const FILTER_THRESHOLD = 7;

  function optionsOf(sel) {
    return Array.from(sel.options).map((o) => ({
      value: o.value,
      label: o.textContent || o.value,
      disabled: o.disabled,
    }));
  }

  function enhance(sel) {
    if (!sel || sel.dataset.sdEnhanced) return;
    sel.dataset.sdEnhanced = '1';
    sel.classList.add('sd-native');

    const wrap = document.createElement('div');
    wrap.className = 'sd-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    const display = document.createElement('button');
    display.type = 'button';
    display.className = 'sd-display';
    display.innerHTML = '<span class="sd-text"></span><span class="sd-caret">▾</span>';
    const textEl = display.querySelector('.sd-text');
    wrap.appendChild(display);

    const popup = document.createElement('div');
    popup.className = 'sd-popup';
    popup.hidden = true;
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'sd-filter';
    filter.placeholder = 'Type to filter…';
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    const list = document.createElement('ul');
    list.className = 'sd-list';
    popup.appendChild(filter);
    popup.appendChild(list);
    wrap.appendChild(popup);

    let opts = [];
    let activeIdx = -1;

    function currentLabel() {
      const o = opts.find((x) => x.value === sel.value);
      return o ? o.label : '';
    }
    function refreshDisplay() {
      const label = currentLabel();
      textEl.textContent = label || (sel.options[0] ? sel.options[0].textContent : '');
      textEl.classList.toggle('sd-placeholder', !label);
      display.disabled = sel.disabled;
    }

    function renderList() {
      const q = filter.value.trim().toLowerCase();
      list.innerHTML = '';
      activeIdx = -1;
      const shown = opts.filter((o) => !q || o.label.toLowerCase().includes(q));
      if (!shown.length) {
        const li = document.createElement('li');
        li.className = 'sd-empty';
        li.textContent = 'No matches';
        list.appendChild(li);
        return;
      }
      shown.forEach((o) => {
        const li = document.createElement('li');
        li.className = 'sd-item';
        li.textContent = o.label;
        li.dataset.value = o.value;
        if (o.value === sel.value) li.classList.add('sd-current');
        if (o.disabled) li.classList.add('sd-disabled');
        li.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus off the item so click-outside logic is simple
          if (o.disabled) return;
          pick(o.value);
        });
        list.appendChild(li);
      });
    }

    function rebuild() {
      opts = optionsOf(sel);
      const many = opts.length > FILTER_THRESHOLD;
      filter.hidden = !many;
      refreshDisplay();
      renderList();
    }

    function pick(value) {
      if (sel.value !== value) {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Deferred, not synchronous. This runs on the <li>'s mousedown; hiding the popup here would
      // remove that <li> from the render tree before the click that follows the mousedown is
      // dispatched, and the browser then retargets that click to whatever is now under the pointer.
      // When the popup overlapped a modal backdrop, that target was the backdrop - and "click the
      // backdrop" closes the modal. Reported live: picking a spell "sometimes" closed the Add Aura
      // modal. Closing on the next tick keeps the <li> in place for the click.
      setTimeout(close, 0);
      refreshDisplay();
    }

    function open() {
      if (sel.disabled || !popup.hidden) return;
      popup.hidden = false;
      filter.value = '';
      renderList();
      if (!filter.hidden) filter.focus();
      document.addEventListener('mousedown', onDocDown, true);
      // Scroll the current pick into view.
      const cur = list.querySelector('.sd-current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      if (popup.hidden) return;
      popup.hidden = true;
      document.removeEventListener('mousedown', onDocDown, true);
    }
    function onDocDown(e) {
      if (!wrap.contains(e.target)) close();
    }

    display.addEventListener('click', () => (popup.hidden ? open() : close()));
    filter.addEventListener('input', renderList);
    filter.addEventListener('keydown', (e) => {
      const items = Array.from(list.querySelectorAll('.sd-item:not(.sd-disabled)'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        activeIdx += e.key === 'ArrowDown' ? 1 : -1;
        if (activeIdx < 0) activeIdx = items.length - 1;
        if (activeIdx >= items.length) activeIdx = 0;
        items.forEach((li, i) => li.classList.toggle('sd-active', i === activeIdx));
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const li = items[activeIdx] || items[0];
        if (li) pick(li.dataset.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
        display.focus();
      }
    });

    // Rebuild when the <option>s change (populate blocks), on the next frame so a trailing
    // `sel.value = ...` in the same block has already happened.
    let raf = 0;
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(rebuild);
    });
    obs.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    // And when other code sets sel.value directly (no mutation fires for that) - poll cheaply on
    // focus/blur of the wrapper and after any change event we didn't originate.
    sel.addEventListener('change', refreshDisplay);

    rebuild();
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('select').forEach(enhance);
  }

  window.SearchDropdown = { enhance, enhanceAll };
})();
