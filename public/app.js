document.addEventListener('DOMContentLoaded', () => {
  // Tab switching (Base Rules / House Rules)
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  // TOC smooth scroll + jump to House Rules tab if needed
  document.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();

      if (link.classList.contains('toc-house')) {
        tabButtons.forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="house"]').classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-house').classList.remove('hidden');
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Rulebook search: filters base rule sections by title/body text
  const ruleSearch = document.getElementById('rule-search');
  if (ruleSearch) {
    ruleSearch.addEventListener('input', () => {
      const query = ruleSearch.value.trim().toLowerCase();
      document.querySelectorAll('.searchable').forEach(card => {
        const matches = !query || card.dataset.searchText.includes(query);
        card.classList.toggle('hidden', !matches);
      });
      document.querySelectorAll('.toc-link:not(.toc-house)').forEach(link => {
        const targetId = link.getAttribute('href').slice(1);
        const target = document.getElementById(targetId);
        if (target) link.classList.toggle('hidden', target.classList.contains('hidden'));
      });
    });
  }
});
