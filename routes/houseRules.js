const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { findOrCreateRuleCategoryPath } = require('../db/ruleCategoryTree');

// Add a house rule (requires login). Two modes:
// - "override": tied to base_section_id, shows folded into that section on
//   the Rules tab when active.
// - "extra": filed under rule_category_path (or left uncategorized), shows
//   as its own card on the Rules tab when active, alongside the base rules.
router.post('/games/:gameId/house-rules', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const { title, body, mode, base_section_id, rule_category_path } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM house_rules WHERE game_id = $1',
    [gameId]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId = null;
    let sectionId = null;
    if (mode === 'override') {
      sectionId = base_section_id || null;
    } else if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, null, rule_category_path.split('>'));
    }
    await client.query(
      `INSERT INTO house_rules (game_id, base_section_id, rule_category_id, title, body, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [gameId, sectionId, ruleCategoryId, title, body, rows[0].next_order]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${gameId}#tab-rules`);
}));

// Edit a house rule (requires login)
router.post('/house-rules/:id/edit', requireAuth, asyncHandler(async (req, res) => {
  const { title, body, gameId, mode, base_section_id, rule_category_path } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId = null;
    let sectionId = null;
    if (mode === 'override') {
      sectionId = base_section_id || null;
    } else if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, null, rule_category_path.split('>'));
    }
    await client.query(
      'UPDATE house_rules SET title=$1, body=$2, base_section_id=$3, rule_category_id=$4 WHERE id=$5',
      [title, body, sectionId, ruleCategoryId, req.params.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${gameId}#tab-rules`);
}));

// Toggle active/inactive (requires login)
router.post('/house-rules/:id/toggle', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE house_rules SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
}));

// Delete a house rule (requires login)
router.post('/house-rules/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM house_rules WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
}));

module.exports = router;
