const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// List all games (public) - sort/filter/search happens client-side in the
// browser via embedded JSON, so it's instant on an iPad with no reloads.
router.get('/', async (req, res) => {
  const { rows: games } = await pool.query('SELECT * FROM games ORDER BY name ASC');
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

// Game detail: base rules + house rules (public)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
  if (!gameRows.length) return res.status(404).send('Game not found');
  const game = gameRows[0];

  const { rows: baseSections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE game_id = $1 ORDER BY sort_order ASC, id ASC',
    [id]
  );
  const { rows: houseRules } = await pool.query(
    'SELECT * FROM house_rules WHERE game_id = $1 ORDER BY sort_order ASC, id ASC',
    [id]
  );

  res.render('game-detail', { game, baseSections, houseRules });
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
