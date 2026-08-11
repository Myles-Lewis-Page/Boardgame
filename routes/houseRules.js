const express = require('express');
const router = express.Router();
const pool = require('../db');

// Add a house rule (optionally linked to a base section it overrides)
router.post('/games/:gameId/house-rules', async (req, res) => {
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

// Edit a house rule
router.post('/house-rules/:id/edit', async (req, res) => {
  const { title, body, gameId, base_section_id } = req.body;
  await pool.query(
    'UPDATE house_rules SET title=$1, body=$2, base_section_id=$3 WHERE id=$4',
    [title, body, base_section_id || null, req.params.id]
  );
  res.redirect(`/games/${gameId}`);
});

// Toggle active/inactive (so you can keep house rules on file without them applying)
router.post('/house-rules/:id/toggle', async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE house_rules SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

// Delete a house rule
router.post('/house-rules/:id/delete', async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM house_rules WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

module.exports = router;
