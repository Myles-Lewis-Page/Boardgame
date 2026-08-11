const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Add a house rule (requires login)
router.post('/games/:gameId/house-rules', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { title, body, base_section_id } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM house_rules WHERE game_id = $1',
    [gameId]
  );
  await pool.query(
    `INSERT INTO house_rules (game_id, base_section_id, title, body, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [gameId, base_section_id || null, title, body, rows[0].next_order]
  );
  res.redirect(`/games/${gameId}`);
});

// Edit a house rule (requires login)
router.post('/house-rules/:id/edit', requireAuth, async (req, res) => {
  const { title, body, gameId, base_section_id } = req.body;
  await pool.query(
    'UPDATE house_rules SET title=$1, body=$2, base_section_id=$3 WHERE id=$4',
    [title, body, base_section_id || null, req.params.id]
  );
  res.redirect(`/games/${gameId}`);
});

// Toggle active/inactive (requires login)
router.post('/house-rules/:id/toggle', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE house_rules SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

// Delete a house rule (requires login)
router.post('/house-rules/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM house_rules WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

module.exports = router;
