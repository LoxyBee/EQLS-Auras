const messageEl = document.getElementById('message');
const keepBtn = document.getElementById('keep-btn');
const resetBtn = document.getElementById('reset-btn');

function render(pending) {
  if (!pending) {
    messageEl.textContent = '';
    return;
  }
  messageEl.textContent = pending.message;
  keepBtn.textContent = pending.keepLabel;
  resetBtn.textContent = pending.resetLabel;
}

keepBtn.addEventListener('click', () => window.eqResetPrompt.answer('keep'));
resetBtn.addEventListener('click', () => window.eqResetPrompt.answer('reset'));

window.eqResetPrompt.getPending().then(render);
window.eqResetPrompt.onPendingChanged(render);
