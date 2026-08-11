(function () {
  const grid = document.getElementById('game-grid');
  const searchBox = document.getElementById('search-box');
  const sortSelect = document.getElementById('sort-select');
  const genreSelect = document.getElementById('genre-select');
  const playersSelect = document.getElementById('players-select');
  const noResults = document.getElementById('no-results');

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatMeta(g) {
    const parts = [];
    if (g.genre) parts.push(g.genre);
    if (g.min_players || g.max_players) {
      parts.push(`${g.min_players || '?'}-${g.max_players || '?'} players`);
    }
    if (g.play_time_minutes) parts.push(`${g.play_time_minutes} min`);
    return parts.join(' &middot; ');
  }

  function render() {
    const query = searchBox.value.trim().toLowerCase();
    const genre = genreSelect.value;
    const playerCount = playersSelect.value ? parseInt(playersSelect.value, 10) : null;
    const sortBy = sortSelect.value;

    let filtered = ALL_GAMES.filter(g => {
      if (query && !g.name.toLowerCase().includes(query)) return false;
      if (genre && g.genre !== genre) return false;
      if (playerCount) {
        const min = g.min_players || 1;
        const max = g.max_players || 99;
        if (playerCount < min || playerCount > max) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'players-asc': return (a.min_players || 0) - (b.min_players || 0);
        case 'players-desc': return (b.min_players || 0) - (a.min_players || 0);
        case 'time-asc': return (a.play_time_minutes || 0) - (b.play_time_minutes || 0);
        case 'time-desc': return (b.play_time_minutes || 0) - (a.play_time_minutes || 0);
        default: return a.name.localeCompare(b.name);
      }
    });

    noResults.classList.toggle('hidden', filtered.length > 0);

    grid.innerHTML = filtered.map(g => `
      <a class="game-card" href="/games/${g.id}">
        <h2>${escapeHtml(g.name)}</h2>
        <p class="meta">${formatMeta(g)}</p>
      </a>
    `).join('');
  }

  [searchBox, sortSelect, genreSelect, playersSelect].forEach(el => {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  render();
})();
