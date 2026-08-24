const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { buildTree: buildRuleCategoryTree, pathForRuleCategoryId, setupFirstWinningLastCompare } = require('../db/ruleCategoryTree');

// All owned expansions across every game, one flat page - the expansion
// equivalent of the main /games list.
router.get('/expansions', async (req, res) => {
  const { rows: expansions } = await pool.query(
    `SELECT e.*, g.name AS game_name
     FROM expansions e JOIN games g ON g.id = e.game_id
     WHERE e.owned = true
     ORDER BY g.name ASC, e.name ASC`
  );
  res.render('expansions-index', { expansions, title: 'My Expansions', emptyMessage: 'No expansions added yet.' });
});

// All wishlist (owned = false) expansions across every game - the
// expansion equivalent of /wishlist.
router.get('/expansions/wishlist', async (req, res) => {
  const { rows: expansions } = await pool.query(
    `SELECT e.*, g.name AS game_name
     FROM expansions e JOIN games g ON g.id = e.game_id
     WHERE e.owned = false
     ORDER BY g.name ASC, e.name ASC`
  );
  res.render('expansions-index', { expansions, title: 'Wishlist Expansions', emptyMessage: 'Nothing on the expansion wishlist yet.' });
});

// Full rules view for a single expansion - works the same whether the
// expansion is owned or on the wishlist, since there's only ever one
// source on this page (unlike the merged game page, which filters wishlist
// expansions out of the combined Rules tab).
router.get('/games/:gameId/expansions/:expId', asyncHandler(async (req, res) => {
  const { gameId, expId } = req.params;
  const { rows: expRows } = await pool.query('SELECT * FROM expansions WHERE id = $1 AND game_id = $2', [expId, gameId]);
  if (!expRows.length) return res.status(404).send('Expansion not found');
  const expansion = expRows[0];

  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  if (!gameRows.length) return res.status(404).send('Game not found');
  const game = gameRows[0];

  const { rows: sections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );
  const { rows: houseRules } = await pool.query(
    'SELECT * FROM house_rules WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );
  const { rows: ruleCategories } = await pool.query(
    'SELECT * FROM rule_categories WHERE expansion_id = $1 ORDER BY depth ASC, name ASC',
    [expId]
  );
  const { rows: setupOptions } = await pool.query(
    'SELECT * FROM setup_options WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );

  const activeHouseRules = houseRules.filter(h => h.is_active);
  const extraHouseRules = activeHouseRules.filter(h => !h.base_section_id);
  const overridesBySection = new Map(
    activeHouseRules.filter(h => h.base_section_id).map(h => [h.base_section_id, h])
  );

  const catTree = buildRuleCategoryTree(ruleCategories);
  const sectionsByCategory = new Map();
  sections.forEach(s => {
    if (!s.rule_category_id) return;
    if (!sectionsByCategory.has(s.rule_category_id)) sectionsByCategory.set(s.rule_category_id, []);
    sectionsByCategory.get(s.rule_category_id).push(s);
  });
  const houseRulesByCategory = new Map();
  extraHouseRules.forEach(h => {
    if (!h.rule_category_id) return;
    if (!houseRulesByCategory.has(h.rule_category_id)) houseRulesByCategory.set(h.rule_category_id, []);
    houseRulesByCategory.get(h.rule_category_id).push(h);
  });
  const uncategorizedItems = [
    ...sections.filter(s => !s.rule_category_id).map(s => ({ type: 'section', title: s.title, s })),
    ...extraHouseRules.filter(h => !h.rule_category_id).map(h => ({ type: 'houserule', title: h.title, h })),
  ].sort((a, b) => setupFirstWinningLastCompare(a.title, b.title));

  res.render('expansion-detail', {
    game, expansion, sections, houseRules, ruleCategories, setupOptions,
    catTree, sectionsByCategory, houseRulesByCategory, overridesBySection, uncategorizedItems,
    activeHouseRules, extraHouseRules,
    pathForRuleCategoryId
  });
}));

router.get('/games/:gameId/expansions/new', (req, res) => {
  res.redirect(`/games/${req.params.gameId}#tab-expansions`);
});

// Create expansion (requires login) - the form for this now lives inline in
// the Expansions tab on the game page itself. owned defaults to true when
// the field is missing entirely (e.g. old bookmarked form submissions);
// the checkbox itself defaults checked in the UI, same as the Games form.
router.post('/games/:gameId/expansions', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned } = req.body;
  const isOwned = owned === undefined ? true : !!owned;
  await pool.query(
    `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [gameId, name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, isOwned]
  );
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Edit expansion info (requires login) - submitted from an inline edit form
// on the game page, same pattern as editing the base game's own info.
router.post('/expansions/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { gameId, name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned } = req.body;
  await pool.query(
    `UPDATE expansions SET name=$1, min_players=$2, max_players=$3, play_time_minutes=$4, cover_image_url=$5, notes=$6, owned=$7 WHERE id=$8`,
    [name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, !!owned, id]
  );
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Quick "mark owned" action from the wishlist - just flips the flag, same
// as the equivalent route on games.
router.post('/expansions/:id/mark-owned', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE expansions SET owned = true WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Delete expansion (requires login)
router.post('/expansions/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM expansions WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Clean, sequential print view of a single expansion's rules - same
// treatment as the game-wide print route, just scoped to one expansion.
router.get('/games/:gameId/expansions/:expId/print', asyncHandler(async (req, res) => {
  const { gameId, expId } = req.params;
  const { rows: expRows } = await pool.query('SELECT * FROM expansions WHERE id = $1 AND game_id = $2', [expId, gameId]);
  if (!expRows.length) return res.status(404).send('Expansion not found');
  const expansion = expRows[0];

  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  if (!gameRows.length) return res.status(404).send('Game not found');
  const game = gameRows[0];

  const { rows: sections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );
  const { rows: houseRules } = await pool.query(
    'SELECT * FROM house_rules WHERE expansion_id = $1 AND is_active = true ORDER BY sort_order ASC, id ASC',
    [expId]
  );
  const { rows: ruleCategories } = await pool.query(
    'SELECT * FROM rule_categories WHERE expansion_id = $1 ORDER BY depth ASC, name ASC',
    [expId]
  );

  const overridesBySection = new Map(houseRules.filter(h => h.base_section_id).map(h => [h.base_section_id, h]));
  const extraHouseRules = houseRules.filter(h => !h.base_section_id);
  const catTree = buildRuleCategoryTree(ruleCategories);
  const sectionsByCategory = new Map();
  sections.forEach(s => {
    if (!s.rule_category_id) return;
    if (!sectionsByCategory.has(s.rule_category_id)) sectionsByCategory.set(s.rule_category_id, []);
    sectionsByCategory.get(s.rule_category_id).push(s);
  });
  const uncategorized = sections.filter(s => !s.rule_category_id).sort((a, b) => setupFirstWinningLastCompare(a.title, b.title));

  const printSources = [{
    key: 'exp', label: expansion.name, expansionId: expansion.id,
    uncategorized, catTree, sectionsByCategory, overridesBySection, extraHouseRules
  }];

  res.render('game-print', { game: { id: game.id, name: `${game.name}: ${expansion.name}` }, printSources, backUrl: `/games/${game.id}/expansions/${expansion.id}` });
}));

module.exports = router;
