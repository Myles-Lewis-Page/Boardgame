const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

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
  res.render('index', { games, genres: genreRows.map(r => r.genre) });
});

// New game form (requires login)
router.get('/new', requireAuth, (req, res) => {
  res.render('new-game');
});

// Create game (requires login)
router.post('/', requireAuth, async (req, res) => {
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null]
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

  // "sources" is the ordered list of things rules can belong to: the base
  // game first, then each owned expansion. Used to build filter chips, the
  // grouped table of contents, and the "add rules for..." picker.
  const sources = [
    { key: 'base', label: game.name, isBase: true, expansionId: null },
    ...expansions.map(exp => ({ key: `exp-${exp.id}`, label: exp.name, isBase: false, expansionId: exp.id }))
  ];

  const baseSections = allSections.filter(s => s.expansion_id === null);
  const baseHouseRules = allHouseRules.filter(h => h.expansion_id === null);

  res.render('game-detail', {
    game, expansions, sources,
    allSections, allHouseRules,
    baseSections, baseHouseRules
  });
});

// Edit game info (requires login)
router.post('/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes } = req.body;
  await pool.query(
    `UPDATE games SET name=$1, publisher=$2, genre=$3, min_players=$4, max_players=$5, play_time_minutes=$6, cover_image_url=$7, notes=$8 WHERE id=$9`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, id]
  );
  res.redirect(`/games/${id}`);
});

// Delete game (requires login)
router.post('/:id/delete', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
  res.redirect('/games');
});

module.exports = router;
