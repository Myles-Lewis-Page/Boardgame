const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseCsvText } = require('../db/parseGamesCsv');
const { findOrCreateRuleCategoryPath, pathForRuleCategoryId } = require('../db/ruleCategoryTree');

const TEMPLATE = `game_name,expansion_name,section_title,category_path
Catan,,Trading,Gameplay
Catan,,Development Cards,Gameplay > Development Cards
Catan,Seafarers,Ships and Movement,Gameplay > Ships
`;

function parseSectionsCsv(rawText) {
  const rows = parseCsvText(rawText || '');
  if (rows.length === 0) return { entries: [], headerError: 'The file appears to be empty.' };

  const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = headerRow.indexOf('game_name');
  const expIdx = headerRow.indexOf('expansion_name');
  const titleIdx = headerRow.indexOf('section_title');
  const pathIdx = headerRow.indexOf('category_path');
  if (nameIdx === -1 || titleIdx === -1 || pathIdx === -1) {
    return { entries: [], headerError: `Expected columns "game_name", "section_title", and "category_path" (with optional "expansion_name"). Found: ${headerRow.join(', ') || '(none)'}.` };
  }

  const entries = rows.slice(1).map((r, idx) => ({
    row_number: idx + 2,
    game_name: (r[nameIdx] || '').trim(),
    expansion_name: expIdx === -1 ? '' : (r[expIdx] || '').trim(),
    section_title: (r[titleIdx] || '').trim(),
    category_path: (r[pathIdx] || '').trim()
  })).filter(e => e.game_name && e.section_title);

  return { entries, headerError: null };
}

router.get('/games/recategorize-sections/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="recategorize-sections-template.csv"');
  res.send(TEMPLATE);
});

router.get('/games/recategorize-sections', requireAuth, (req, res) => {
  res.render('recategorize-sections', {});
});

// Preview: match each row by game name (+ optional expansion name) + exact
// section title, so one file can retag sections across many games at once.
router.post('/games/recategorize-sections/preview', requireAuth, async (req, res) => {
  const { rawCsv } = req.body;
  const { entries, headerError } = parseSectionsCsv(rawCsv || '');
  if (headerError) return res.render('recategorize-sections-preview', { rows: [], headerError });

  const { rows: allGames } = await pool.query('SELECT id, name FROM games');
  const { rows: allExpansions } = await pool.query('SELECT id, name, game_id FROM expansions');
  const { rows: allSections } = await pool.query('SELECT id, game_id, expansion_id, title, rule_category_id FROM base_rule_sections');
  const { rows: allRuleCategories } = await pool.query('SELECT * FROM rule_categories');

  const gameByName = new Map(allGames.map(g => [g.name.trim().toLowerCase(), g]));

  const rows = entries.map(e => {
    const game = gameByName.get(e.game_name.toLowerCase());
    let expansion = null;
    if (game && e.expansion_name) {
      expansion = allExpansions.find(x => x.game_id === game.id && x.name.trim().toLowerCase() === e.expansion_name.toLowerCase());
    }

    let section = null;
    if (game) {
      const expId = e.expansion_name ? (expansion ? expansion.id : -1) : null;
      section = allSections.find(s =>
        s.game_id === game.id &&
        (expId === null ? s.expansion_id === null : s.expansion_id === expId) &&
        s.title.trim().toLowerCase() === e.section_title.toLowerCase()
      );
    }

    let notFoundReason = null;
    if (!game) notFoundReason = `no game named "${e.game_name}"`;
    else if (e.expansion_name && !expansion) notFoundReason = `no expansion named "${e.expansion_name}" under ${e.game_name}`;
    else if (!section) notFoundReason = `no section titled "${e.section_title}"${e.expansion_name ? ' in ' + e.expansion_name : ''} under ${e.game_name}`;

    return {
      row_number: e.row_number,
      game_name: e.game_name,
      expansion_name: e.expansion_name,
      section_title: e.section_title,
      category_path: e.category_path,
      sectionId: section ? section.id : null,
      gameId: game ? game.id : null,
      expansionId: expansion ? expansion.id : null,
      currentPath: section ? pathForRuleCategoryId(section.rule_category_id, allRuleCategories) : null,
      found: !!section,
      notFoundReason
    };
  });

  res.render('recategorize-sections-preview', { rows, headerError: null });
});

router.post('/games/recategorize-sections/save', requireAuth, async (req, res) => {
  let { section_title, category_path, section_id, game_id, expansion_id, include } = req.body;
  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  section_title = toArray(section_title);
  category_path = toArray(category_path);
  section_id = toArray(section_id);
  game_id = toArray(game_id);
  expansion_id = toArray(expansion_id);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let updatedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < section_title.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!section_id[i] || !game_id[i]) continue;
      if (!category_path[i] || !category_path[i].trim()) continue;

      const categoryId = await findOrCreateRuleCategoryPath(
        client, game_id[i], expansion_id[i] || null, category_path[i].split('>')
      );
      await client.query('UPDATE base_rule_sections SET rule_category_id = $1 WHERE id = $2', [categoryId, section_id[i]]);
      updatedCount++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('recategorize-sections-done', { updatedCount });
});

module.exports = router;
