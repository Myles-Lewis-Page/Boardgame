const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// New expansion form (requires login)
router.get('/games/:gameId/expansions/new', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!rows.length) return res.status(404).send('Game not found');
  res.render('expansion-new', { game: rows[0] });
});

// Create expansion (requires login)
router.post('/games/:gameId/expansions', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { name, min_players, max_players, play_time_minutes, cover_image_url, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [gameId, name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null]
  );
  res.redirect(`/games/${gameId}/expansions/${rows[0].id}`);
});

// Expansion detail: its own base rules + house rules (public)
router.get('/games/:gameId/expansions/:expId', async (req, res) => {
  const { gameId, expId } = req.params;

  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  if (!gameRows.length) return res.status(404).send('Game not found');

  const { rows: expRows } = await pool.query(
    'SELECT * FROM expansions WHERE id = $1 AND game_id = $2', [expId, gameId]
  );
  if (!expRows.length) return res.status(404).send('Expansion not found');

  const { rows: baseSections } = await pool.query(
    'SELECT * FROM base_rule_sections WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );
  const { rows: houseRules } = await pool.query(
    'SELECT * FROM house_rules WHERE expansion_id = $1 ORDER BY sort_order ASC, id ASC',
    [expId]
  );

  res.render('expansion-detail', { game: gameRows[0], expansion: expRows[0], baseSections, houseRules });
});

// Edit expansion info (requires login)
router.post('/expansions/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { gameId, name, min_players, max_players, play_time_minutes, cover_image_url, notes } = req.body;
  await pool.query(
    `UPDATE expansions SET name=$1, min_players=$2, max_players=$3, play_time_minutes=$4, cover_image_url=$5, notes=$6 WHERE id=$7`,
    [name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, id]
  );
  res.redirect(`/games/${gameId}/expansions/${id}`);
});

// Delete expansion (requires login)
router.post('/expansions/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM expansions WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

module.exports = router;
