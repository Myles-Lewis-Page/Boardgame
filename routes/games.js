const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { buildCategoryTree, flattenForSelect, annotatePathLabels, pathForCategoryId } = require('../db/categoryTree');
const { buildTree: buildRuleCategoryTree, pathForRuleCategoryId, setupFirstWinningLastCompare } = require('../db/ruleCategoryTree');

async function getCategorySelectOptions() {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY depth ASC, name ASC');
  const tree = buildCategoryTree(rows);
  annotatePathLabels(tree);
  return { flat: flattenForSelect(tree), allRows: rows };
}

// For the "Variation of" picker: every other game, alphabetically. Excludes
// the game itself when editing (a game can't be a variation of itself).
async function getVariantOptions(excludeId) {
  const { rows } = excludeId
    ? await pool.query('SELECT id, name FROM games WHERE id <> $1 ORDER BY name ASC', [excludeId])
    : await pool.query('SELECT id, name FROM games ORDER BY name ASC');
  return rows;
}

// List all games (public) - defaults to owned games only, since that's your
// actual shelf; wishlist entries (owned=false) get their own filtered page.
// Games tagged as a variation of another game are excluded here too, same
// as expansions - they're reached via the canonical game's "Variations"
// list instead of cluttering the main grid with near-duplicate cards.
// Sort/filter/search happens client-side via embedded JSON, so it's instant.
router.get('/', asyncHandler(async (req, res) => {
  const { rows: games } = await pool.query(`
    SELECT g.*, COALESCE(exp_counts.expansion_count, 0) AS expansion_count, vo.name AS variant_of_name
    FROM games g
    LEFT JOIN (
      SELECT game_id, COUNT(*) AS expansion_count FROM expansions GROUP BY game_id
    ) exp_counts ON exp_counts.game_id = g.id
    LEFT JOIN games vo ON vo.id = g.variant_of_id
    WHERE g.owned = true AND g.variant_of_id IS NULL
    ORDER BY g.name ASC
  `);
  const { rows: genreRows } = await pool.query(
    "SELECT DISTINCT genre FROM games WHERE owned = true AND variant_of_id IS NULL AND genre IS NOT NULL AND genre <> '' ORDER BY genre ASC"
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
}));

// New game form (requires login)
router.get('/new', requireAuth, asyncHandler(async (req, res) => {
  const { flat: categoryOptions } = await getCategorySelectOptions();
  const variantOptions = await getVariantOptions();
  const defaultOwned = req.query.owned !== 'false'; // ?owned=false pre-unchecks it (used by the Wishlist "+ Add" button)
  res.render('new-game', { categoryOptions, variantOptions, defaultOwned });
}));

// Create game (requires login)
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id, owned, variant_of_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id, owned, variant_of_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, category_id || null, !!owned, variant_of_id || null]
  );
  res.redirect(`/games/${rows[0].id}`);
}));

// Game detail: all rules (base game + every expansion, merged into one
// browsable/searchable view) plus house rules, also merged (public)
router.get('/:id', asyncHandler(async (req, res) => {
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

  // Setup options: alternate ways to set up a session (e.g. Dominion's
  // curated Kingdom sets). Shown above the search bar on the Rules tab,
  // separate from the sequential rulebook flow.
  const { rows: allSetupOptions } = await pool.query(
    'SELECT * FROM setup_options WHERE game_id = $1 ORDER BY expansion_id NULLS FIRST, sort_order ASC, id ASC',
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
  const variantOptions = await getVariantOptions(id);

  // If this game is tagged as a variation of another one, fetch that game
  // for the "Variation of X" link. Separately, fetch any games tagged as
  // variations OF this one, for the "Variations" list.
  let variantOf = null;
  if (game.variant_of_id) {
    const { rows } = await pool.query('SELECT id, name FROM games WHERE id = $1', [game.variant_of_id]);
    variantOf = rows[0] || null;
  }
  const { rows: variations } = await pool.query(
    'SELECT id, name, cover_image_url, owned FROM games WHERE variant_of_id = $1 ORDER BY name ASC',
    [id]
  );

  res.render('game-detail', {
    game, expansions, sources,
    allSections, allHouseRules, allSetupOptions,
    baseSections, baseHouseRules,
    allRuleCategories, buildRuleCategoryTree, pathForRuleCategoryId, setupFirstWinningLastCompare,
    categoryOptions, categoryPath,
    variantOptions, variantOf, variations
  });
}));

// Edit game info (requires login)
router.post('/:id/edit', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id, owned, variant_of_id } = req.body;
  // A game can't be a variation of itself.
  const safeVariantOfId = (variant_of_id && variant_of_id !== id) ? variant_of_id : null;
  await pool.query(
    `UPDATE games SET name=$1, publisher=$2, genre=$3, min_players=$4, max_players=$5, play_time_minutes=$6, cover_image_url=$7, notes=$8, category_id=$9, owned=$10, variant_of_id=$11 WHERE id=$12`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, category_id || null, !!owned, safeVariantOfId, id]
  );
  res.redirect(`/games/${id}`);
}));

// Quick "mark owned" action from the wishlist/game page - just flips the
// flag, no data copying needed since wishlist and owned games share the
// same row and the same rules/expansions/house rules all along.
router.post('/:id/mark-owned', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('UPDATE games SET owned = true WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${req.params.id}`);
}));

// Copy the base game's rule sections into this variation - handy when two
// variations share the same core rules (e.g. Monopoly: Here and Now and
// Red Wingopoly are both standard Monopoly rules, just different property
// names). Copies title/body only; the copies start uncategorized since rule
// categories are scoped to each game individually.
router.post('/:id/copy-rules-from-variant', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { sourceGameId } = req.body;
  if (!sourceGameId) return res.redirect(`/games/${id}`);

  const { rows: sourceSections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE game_id = $1 AND expansion_id IS NULL ORDER BY sort_order ASC',
    [sourceGameId]
  );
  const { rows: existing } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM base_rule_sections WHERE game_id = $1 AND expansion_id IS NULL',
    [id]
  );
  let nextOrder = existing[0].next_order;
  for (const s of sourceSections) {
    await pool.query(
      'INSERT INTO base_rule_sections (game_id, title, body, sort_order) VALUES ($1, $2, $3, $4)',
      [id, s.title, s.body, nextOrder++]
    );
  }
  res.redirect(`/games/${id}#tab-rules`);
}));

// Delete game (requires login)
router.post('/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
  res.redirect('/games');
}));

module.exports = router;
