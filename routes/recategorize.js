const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseCsvText } = require('../db/parseGamesCsv');
const { findOrCreateCategoryPath, pathForCategoryId } = require('../db/categoryTree');

const TEMPLATE = `game_name,category_path
Catan,Strategy > Settlement Building
Catan: Seafarers,Strategy > Settlement Building
Ticket to Ride,Strategy > Route Building
`;

function parseRecategorizeCsv(rawText) {
  const rows = parseCsvText(rawText || '');
  if (rows.length === 0) return { entries: [], headerError: 'The file appears to be empty.' };

  const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = headerRow.indexOf('game_name');
  const pathIdx = headerRow.indexOf('category_path');
  if (nameIdx === -1 || pathIdx === -1) {
    return { entries: [], headerError: `Expected columns "game_name" and "category_path". Found: ${headerRow.join(', ') || '(none)'}.` };
  }

  const entries = rows.slice(1).map((r, idx) => ({
    row_number: idx + 2,
    game_name: (r[nameIdx] || '').trim(),
    category_path: (r[pathIdx] || '').trim()
  })).filter(e => e.game_name);

  return { entries, headerError: null };
}

// Download a starter template
router.get('/games/recategorize/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="recategorize-template.csv"');
  res.send(TEMPLATE);
});

// Show the form
router.get('/games/recategorize', requireAuth, (req, res) => {
  res.render('recategorize', {});
});

// Preview: match each row's game_name against existing games AND
// expansions (case-insensitive exact match), so one file can recategorize
// both at once without needing to know which table something lives in.
router.post('/games/recategorize/preview', requireAuth, async (req, res) => {
  const { rawCsv } = req.body;
  const { entries, headerError } = parseRecategorizeCsv(rawCsv || '');
  if (headerError) return res.render('recategorize-preview', { rows: [], headerError });

  const { rows: allGames } = await pool.query('SELECT id, name, category_id FROM games');
  const { rows: allExpansions } = await pool.query('SELECT id, name, category_id, game_id FROM expansions');
  const { rows: allCategories } = await pool.query('SELECT * FROM categories');

  const gameByName = new Map(allGames.map(g => [g.name.trim().toLowerCase(), g]));
  const expByName = new Map(allExpansions.map(e => [e.name.trim().toLowerCase(), e]));

  const rows = entries.map(e => {
    const key = e.game_name.toLowerCase();
    const game = gameByName.get(key);
    const exp = !game ? expByName.get(key) : null;
    const match = game ? { type: 'game', id: game.id, categoryId: game.category_id }
      : exp ? { type: 'expansion', id: exp.id, categoryId: exp.category_id }
      : null;

    return {
      row_number: e.row_number,
      game_name: e.game_name,
      category_path: e.category_path,
      matchType: match ? match.type : null,
      matchId: match ? match.id : null,
      currentPath: match ? pathForCategoryId(match.categoryId, allCategories) : null,
      found: !!match
    };
  });

  res.render('recategorize-preview', { rows, headerError: null });
});

// Save: for included + matched rows, find-or-create the category path and
// update category_id on whichever table (games or expansions) it matched.
router.post('/games/recategorize/save', requireAuth, async (req, res) => {
  let { game_name, category_path, match_type, match_id, include } = req.body;
  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  game_name = toArray(game_name);
  category_path = toArray(category_path);
  match_type = toArray(match_type);
  match_id = toArray(match_id);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let updatedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < game_name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!match_type[i] || !match_id[i]) continue;
      if (!category_path[i] || !category_path[i].trim()) continue;

      const categoryId = await findOrCreateCategoryPath(client, category_path[i].split('>'));
      const table = match_type[i] === 'game' ? 'games' : 'expansions';
      await client.query(`UPDATE ${table} SET category_id = $1 WHERE id = $2`, [categoryId, match_id[i]]);
      updatedCount++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('recategorize-done', { updatedCount });
});

module.exports = router;
