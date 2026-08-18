const listEl = document.getElementById('cast-list');

function render(casts) {
  listEl.innerHTML = '';
  for (const cast of casts) {
    const card = document.createElement('div');
    card.className = 'cast-card';

    const textRow = document.createElement('div');
    textRow.className = 'cast-text-row';

    const text = document.createElement('span');
    text.className = 'cast-text';
    text.textContent = `"${cast.text}"`;

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'cast-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', () => window.eqAmbiguous.dismissAmbiguousCast(cast.text));

    textRow.append(text, dismissBtn);

    const candidateRow = document.createElement('div');
    candidateRow.className = 'cast-candidates';
    for (const candidateName of cast.candidateNames) {
      const btn = document.createElement('button');
      btn.textContent = candidateName;
      btn.addEventListener('click', () => window.eqAmbiguous.resolveAmbiguousCast(cast.text, candidateName));
      candidateRow.appendChild(btn);
    }

    card.append(textRow, candidateRow);
    listEl.appendChild(card);
  }
}

window.eqAmbiguous.getAmbiguousCasts().then(render);
window.eqAmbiguous.onAmbiguousCastsChanged(render);
