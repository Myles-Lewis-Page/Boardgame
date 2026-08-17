document.addEventListener('DOMContentLoaded', () => {
  const inputs = document.querySelectorAll('.score-cell-input');

  function recalcTotal(playerId) {
    let total = 0;
    document.querySelectorAll(`.score-cell-input[data-player="${playerId}"]`).forEach(input => {
      const value = parseFloat(input.value) || 0;
      const multiplier = parseFloat(input.dataset.multiplier) || 1;
      total += value * multiplier;
    });
    const totalCell = document.querySelector(`[data-player-total="${playerId}"]`);
    if (totalCell) totalCell.textContent = total;
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

  inputs.forEach(input => {
    // Live totals update immediately on every keystroke...
    input.addEventListener('input', () => {
      input.classList.remove('score-cell-error');
      recalcTotal(input.dataset.player);
    });
    // ...but we only save to the server once they're done editing, so we're
    // not firing a request on every single keystroke.
    input.addEventListener('change', () => saveCell(input));
  });
});
