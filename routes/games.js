const express = require('express');
const router = express.Router();
const pool = require('../db');

// List all games
router.get('/', async (req, res) => {
  const { rows: games } = await pool.query('SELECT * FROM games ORDER BY name ASC');
  res.render('index', { games });
});

// New game form
router.get('/new', (req, res) => {
  res.render('new-game');
});

// Create game
router.post('/', async (req, res) => {
  const { name, publisher, min_players, max_players, play_time, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO games (name, publisher, min_players, max_players, play_time, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, publisher || null, min_players || null, max_players || null, play_time || null, notes || null]
  );
  res.redirect(`/games/${rows[0].id}`);
});

// Game detail: base rules + house rules
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

// Edit game info
router.post('/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { name, publisher, min_players, max_players, play_time, notes } = req.body;
  await pool.query(
    `UPDATE games SET name=$1, publisher=$2, min_players=$3, max_players=$4, play_time=$5, notes=$6 WHERE id=$7`,
    [name, publisher || null, min_players || null, max_players || null, play_time || null, notes || null, id]
  );
  res.redirect(`/games/${id}`);
});

// Delete game
router.post('/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
  res.redirect('/games');
});

module.exports = router;
