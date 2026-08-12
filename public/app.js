document.addEventListener('DOMContentLoaded', () => {
  // ---- Tab switching (Rules / House Rules / Expansions) ----
  const tabButtons = document.querySelectorAll('.tab-btn');

  function activateTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const panel = document.getElementById('tab-' + tabName);
    if (!btn || !panel) return;
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    panel.classList.remove('hidden');
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // Support landing directly on a tab via URL hash, e.g. /games/3#tab-house
  // (used after actions like adding a house rule so you land back where you were)
  if (window.location.hash) {
    const match = window.location.hash.match(/^#tab-(\w+)/);
    if (match) activateTab(match[1]);
  }

  // ---- TOC smooth scroll + jump to House Rules tab if needed ----
  document.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();
      if (link.classList.contains('toc-house')) activateTab('house');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ---- Rulebook search: filters rule sections by title/body text ----
  const ruleSearch = document.getElementById('rule-search');

  function sectionMatchesSearch(card, query) {
    return !query || card.dataset.searchText.includes(query);
  }

  // ---- "Playing with" filter chips: show/hide rules and house rules by
  // source (base game vs. a specific expansion). Combines with search so a
  // section only shows if it passes both filters. ----
  const filterCheckboxes = document.querySelectorAll('.source-filter-checkbox');

  function getVisibleSources() {
    const visible = new Set();
    filterCheckboxes.forEach(cb => { if (cb.checked) visible.add(cb.dataset.source); });
    return visible;
  }

  function applyFilters() {
    const query = ruleSearch ? ruleSearch.value.trim().toLowerCase() : '';
    const visibleSources = filterCheckboxes.length > 0 ? getVisibleSources() : null;

    // Rule section cards (Rules tab)
    document.querySelectorAll('.rule-card.searchable').forEach(card => {
      const sourceOk = !visibleSources || visibleSources.has(card.dataset.source);
      const searchOk = sectionMatchesSearch(card, query);
      card.classList.toggle('hidden', !(sourceOk && searchOk));
    });

    // House rule cards (House Rules tab) - source filter only, no search box there
    document.querySelectorAll('#tab-house .rule-card[data-source]').forEach(card => {
      const sourceOk = !visibleSources || visibleSources.has(card.dataset.source);
      card.classList.toggle('hidden', !sourceOk);
    });

    // TOC entries, group headers, and setup options follow the same source filter
    if (visibleSources) {
      document.querySelectorAll('[data-source]').forEach(el => {
        if (
          el.classList.contains('toc-link') ||
          el.classList.contains('toc-subheader') ||
          el.classList.contains('toc-cat-header') ||
          el.classList.contains('source-group-header') ||
          el.classList.contains('rule-category-block') ||
          el.classList.contains('setup-option-card')
        ) {
          el.classList.toggle('hidden', !visibleSources.has(el.dataset.source));
        }
      });
    }

    // TOC links additionally hide if their target section is hidden by search
    document.querySelectorAll('.toc-link:not(.toc-house)').forEach(link => {
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target && target.classList.contains('hidden')) link.classList.add('hidden');
    });

    // A category block with no visible rule cards anywhere underneath it
    // (after both filters) collapses too, so search doesn't leave behind
    // hollow category headers with nothing under them.
    document.querySelectorAll('.rule-category-block').forEach(block => {
      const hasVisibleSection = block.querySelector('.rule-card.searchable:not(.hidden)');
      block.classList.toggle('hidden', !hasVisibleSection);
    });
    document.querySelectorAll('.toc-cat-header').forEach(header => {
      const contentBlock = document.getElementById('rulecat-' + header.dataset.catId);
      if (contentBlock) header.classList.toggle('hidden', contentBlock.classList.contains('hidden'));
    });
  }

  if (ruleSearch) ruleSearch.addEventListener('input', applyFilters);
  filterCheckboxes.forEach(cb => cb.addEventListener('change', applyFilters));
  if (filterCheckboxes.length > 0 || ruleSearch) applyFilters();

  // ---- "Add rules for: [source]" picker on the Rules tab: points the
  // Paste Rulebook link and the manual Add Section form at whichever
  // source (base game or a specific expansion) is selected. ----
  const rulesAddTarget = document.getElementById('rules-add-target');
  const pasteLink = document.getElementById('paste-rulebook-link');
  const addSectionForm = document.getElementById('add-section-form-el');
  const gameIdMatch = window.location.pathname.match(/^\/games\/(\d+)/);
  const gameId = gameIdMatch ? gameIdMatch[1] : null;

  function updateRulesAddTargets() {
    if (!rulesAddTarget || !gameId) return;
    const opt = rulesAddTarget.options[rulesAddTarget.selectedIndex];
    const expId = opt.dataset.expansionId;
    if (expId) {
      if (pasteLink) pasteLink.href = `/games/${gameId}/expansions/${expId}/base-rules/paste`;
      if (addSectionForm) addSectionForm.action = `/games/${gameId}/expansions/${expId}/base-rules`;
    } else {
      if (pasteLink) pasteLink.href = `/games/${gameId}/base-rules/paste`;
      if (addSectionForm) addSectionForm.action = `/games/${gameId}/base-rules`;
    }
  }
  if (rulesAddTarget) {
    rulesAddTarget.addEventListener('change', updateRulesAddTargets);
    updateRulesAddTargets();
  }

  // ---- "Applies to: [source]" picker on the Add House Rule form ----
  const houseAddTarget = document.getElementById('house-add-target');
  const addHouseForm = document.getElementById('add-house-form-el');

  function updateHouseAddTarget() {
    if (!houseAddTarget || !addHouseForm || !gameId) return;
    const opt = houseAddTarget.options[houseAddTarget.selectedIndex];
    const expId = opt.dataset.expansionId;
    addHouseForm.action = expId
      ? `/games/${gameId}/expansions/${expId}/house-rules`
      : `/games/${gameId}/house-rules`;
  }
  if (houseAddTarget) {
    houseAddTarget.addEventListener('change', updateHouseAddTarget);
    updateHouseAddTarget();
  }

  // ---- "Add setup option for: [source]" picker ----
  const setupAddTarget = document.getElementById('setup-add-target');
  const addSetupOptionForm = document.getElementById('add-setup-option-form-el');

  function updateSetupAddTarget() {
    if (!setupAddTarget || !addSetupOptionForm || !gameId) return;
    const opt = setupAddTarget.options[setupAddTarget.selectedIndex];
    const expId = opt.dataset.expansionId;
    addSetupOptionForm.action = expId
      ? `/games/${gameId}/expansions/${expId}/setup-options`
      : `/games/${gameId}/setup-options`;
  }
  if (setupAddTarget) {
    setupAddTarget.addEventListener('change', updateSetupAddTarget);
    updateSetupAddTarget();
  }
});
