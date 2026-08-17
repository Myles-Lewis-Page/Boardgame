document.addEventListener('DOMContentLoaded', () => {
  const numberInputs = document.querySelectorAll('.score-cell-input');
  const awardRadios = document.querySelectorAll('.score-award-radio');
  const allPlayerIds = new Set();
  document.querySelectorAll('[data-player-total]').forEach(el => allPlayerIds.add(el.dataset.playerTotal));

  function recalcTotal(playerId) {
    let total = 0;
    document.querySelectorAll(`.score-cell-input[data-player="${playerId}"]`).forEach(input => {
      const value = parseFloat(input.value) || 0;
      const multiplier = parseFloat(input.dataset.multiplier) || 1;
      total += value * multiplier;
    });
    document.querySelectorAll(`.score-award-radio[data-player="${playerId}"]`).forEach(radio => {
      if (radio.checked) total += parseFloat(radio.dataset.multiplier) || 0;
    });
    const totalCell = document.querySelector(`[data-player-total="${playerId}"]`);
    if (totalCell) totalCell.textContent = total;
  }

  function recalcAllTotals() {
    allPlayerIds.forEach(recalcTotal);
  }

  function saveCell(input) {
    const playerId = input.dataset.player;
    const categoryId = input.dataset.category;
    const value = input.value === '' ? 0 : input.value;

    fetch(`/sessions/${SESSION_ID}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_player_id: playerId,
        score_category_id: categoryId,
        value: value
      })
    }).catch(() => {
      input.classList.add('score-cell-error');
    });
  }

  numberInputs.forEach(input => {
    // Live totals update immediately on every keystroke...
    input.addEventListener('input', () => {
      input.classList.remove('score-cell-error');
      recalcTotal(input.dataset.player);
    });
    // ...but we only save to the server once they're done editing, so we're
    // not firing a request on every single keystroke.
    input.addEventListener('change', () => saveCell(input));
  });

  function saveAward(categoryId, playerId) {
    return fetch(`/sessions/${SESSION_ID}/scores/award`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score_category_id: categoryId, session_player_id: playerId })
    });
  }

  awardRadios.forEach(radio => {
    radio.dataset.wasChecked = radio.checked ? 'true' : 'false';

    // Radios don't naturally support "click again to deselect" - handle it
    // ourselves so you can clear an award without picking a different player.
    radio.addEventListener('click', (e) => {
      if (radio.dataset.wasChecked === 'true') {
        e.preventDefault();
        radio.checked = false;
        radio.dataset.wasChecked = 'false';
        saveAward(radio.dataset.category, null).catch(() => radio.classList.add('score-cell-error'));
        recalcAllTotals();
      }
    });

    radio.addEventListener('change', () => {
      document.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => {
        r.dataset.wasChecked = r === radio ? 'true' : 'false';
      });
      saveAward(radio.dataset.category, radio.dataset.player).catch(() => radio.classList.add('score-cell-error'));
      recalcAllTotals();
    });
  });
});
