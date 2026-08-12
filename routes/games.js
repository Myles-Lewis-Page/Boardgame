const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildCategoryTree, flattenForSelect, annotatePathLabels, pathForCategoryId } = require('../db/categoryTree');
const { buildTree: buildRuleCategoryTree, pathForRuleCategoryId } = require('../db/ruleCategoryTree');

async function getCategorySelectOptions() {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY depth ASC, name ASC');
  const tree = buildCategoryTree(rows);
  annotatePathLabels(tree);
  return { flat: flattenForSelect(tree), allRows: rows };
}

// List all games (public) - sort/filter/search happens client-side in the
// browser via embedded JSON, so it's instant on an iPad with no reloads.
router.get('/', async (req, res) => {
  const { rows: games } = await pool.query(`
    SELECT g.*, COALESCE(exp_counts.expansion_count, 0) AS expansion_count
    FROM games g
    LEFT JOIN (
      SELECT game_id, COUNT(*) AS expansion_count FROM expansions GROUP BY game_id
    ) exp_counts ON exp_counts.game_id = g.id
    ORDER BY g.name ASC
  `);
  const { rows: genreRows } = await pool.query(
    "SELECT DISTINCT genre FROM games WHERE genre IS NOT NULL AND genre <> '' ORDER BY genre ASC"
  );
  const { flat: categoryOptions, allRows: allCategoryRows } = await getCategorySelectOptions();

  // Attach a display path + list of ancestor ids (for filtering by any level
  // of the tree, not just the exact leaf) to each game.
  const gamesWithCategory = games.map(g => {
    const path = pathForCategoryId(g.category_id, allCategoryRows);
    const ancestorIds = [];
    let current = g.category_id ? allCategoryRows.find(r => r.id === g.category_id) : null;
    while (current) {
      ancestorIds.push(current.id);
      current = current.parent_id ? allCategoryRows.find(r => r.id === current.parent_id) : null;
    }
    return { ...g, category_path: path, category_ancestor_ids: ancestorIds };
  });

  res.render('index', { games: gamesWithCategory, genres: genreRows.map(r => r.genre), categoryOptions });
});

// New game form (requires login)
router.get('/new', requireAuth, async (req, res) => {
  const { flat: categoryOptions } = await getCategorySelectOptions();
  res.render('new-game', { categoryOptions });
});

// Create game (requires login)
router.post('/', requireAuth, async (req, res) => {
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, category_id || null]
  );
  res.redirect(`/games/${rows[0].id}`);
});

// Game detail: all rules (base game + every expansion, merged into one
// browsable/searchable view) plus house rules, also merged (public)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
  if (!gameRows.length) return res.status(404).send('Game not found');
  const game = gameRows[0];

  const { rows: expansions } = await pool.query(
    'SELECT * FROM expansions WHERE game_id = $1 ORDER BY name ASC',
    [id]
  );

  // Pull every rule section and house rule for this game in one query each,
  // base game rows have expansion_id NULL, expansion rows have it set.
  // Grouping them here means the page can render one unified list instead
  // of forcing a separate page per expansion.
  const { rows: allSections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE game_id = $1 ORDER BY expansion_id NULLS FIRST, sort_order ASC, id ASC',
    [id]
  );
  const { rows: allHouseRules } = await pool.query(
    'SELECT * FROM house_rules WHERE game_id = $1 ORDER BY expansion_id NULLS FIRST, sort_order ASC, id ASC',
    [id]
  );

  // All rule categories belonging to this game (its own base-game categories
  // plus every expansion's, since rule_categories.game_id always points at
  // the top-level game regardless of which expansion a category is under).
  const { rows: allRuleCategories } = await pool.query(
    'SELECT * FROM rule_categories WHERE game_id = $1 ORDER BY depth ASC, name ASC',
    [id]
  );

  // "sources" is the ordered list of things rules can belong to: the base
  // game first, then each owned expansion. Used to build filter chips, the
  // grouped table of contents, and the "add rules for..." picker.
  const sources = [
    { key: 'base', label: game.name, isBase: true, expansionId: null },
    ...expansions.map(exp => ({ key: `exp-${exp.id}`, label: exp.name, isBase: false, expansionId: exp.id }))
  ];

  const baseSections = allSections.filter(s => s.expansion_id === null);
  const baseHouseRules = allHouseRules.filter(h => h.expansion_id === null);

  const { flat: categoryOptions, allRows: allCategoryRows } = await getCategorySelectOptions();
  const categoryPath = pathForCategoryId(game.category_id, allCategoryRows);

  res.render('game-detail', {
    game, expansions, sources,
    allSections, allHouseRules,
    baseSections, baseHouseRules,
    allRuleCategories, buildRuleCategoryTree, pathForRuleCategoryId,
    categoryOptions, categoryPath
  });
});

// Edit game info (requires login)
router.post('/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id } = req.body;
  await pool.query(
    `UPDATE games SET name=$1, publisher=$2, genre=$3, min_players=$4, max_players=$5, play_time_minutes=$6, cover_image_url=$7, notes=$8, category_id=$9 WHERE id=$10`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, category_id || null, id]
  );
  res.redirect(`/games/${id}`);
});

// Delete game (requires login)
router.post('/:id/delete', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
  res.redirect('/games');
});

module.exports = router;
