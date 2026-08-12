(function () {
  const playersInput = document.getElementById('rnd-players');
  const timeInput = document.getElementById('rnd-time');
  const pickBtn = document.getElementById('rnd-pick-btn');
  const resultBox = document.getElementById('rnd-result');
  const noMatchBox = document.getElementById('rnd-no-match');

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getMatches() {
    const players = parseInt(playersInput.value, 10);
    const time = timeInput.value ? parseInt(timeInput.value, 10) : null;

    return ALL_GAMES.filter(g => {
      if (players) {
        const min = g.min_players || 1;
        const max = g.max_players || 99;
        if (players < min || players > max) return false;
      }
      if (time && g.play_time_minutes) {
        if (g.play_time_minutes > time) return false;
      }
      return true;
    });
  }

  function renderResult(game, matchCount) {
    resultBox.classList.remove('hidden');
    noMatchBox.classList.add('hidden');
    resultBox.innerHTML = `
      <a class="game-card randomizer-pick" href="/games/${game.id}">
        ${game.cover_image_url
          ? `<img class="box-art-thumb" src="${escapeHtml(game.cover_image_url)}" alt="${escapeHtml(game.name)} box art">`
          : `<div class="box-art-thumb box-art-placeholder">🎲</div>`}
        <h2>${escapeHtml(game.name)}</h2>
        <p class="meta">
          ${game.genre ? escapeHtml(game.genre) + ' &middot; ' : ''}
          ${game.min_players || '?'}-${game.max_players || '?'} players
          ${game.play_time_minutes ? ' &middot; ' + game.play_time_minutes + ' min' : ''}
        </p>
      </a>
      <p class="randomizer-match-count">${matchCount} game${matchCount === 1 ? '' : 's'} fit${matchCount === 1 ? 's' : ''} what you asked for.</p>
      <button class="btn btn-secondary" id="rnd-reroll-btn">🎲 Pick a Different One</button>
    `;
    document.getElementById('rnd-reroll-btn').addEventListener('click', () => pickFrom(getMatches()));
  }

  function pickFrom(matches) {
    if (matches.length === 0) {
      resultBox.classList.add('hidden');
      noMatchBox.classList.remove('hidden');
      return;
    }
    const choice = matches[Math.floor(Math.random() * matches.length)];
    renderResult(choice, matches.length);
  }

  pickBtn.addEventListener('click', () => pickFrom(getMatches()));
})();
