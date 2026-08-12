const express = require('express');
const router = express.Router();
const pool = require('../db');
const { parseRulebook } = require('../db/parseRulebook');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { findOrCreateRuleCategoryPath } = require('../db/ruleCategoryTree');

// Show paste-rulebook form for a game (requires login)
router.get('/games/:gameId/base-rules/paste', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!rows.length) return res.status(404).send('Game not found');
  res.render('paste-rulebook', { game: rows[0] });
}));

// Handle pasted rulebook text -> parse -> preview before saving (requires login)
router.post('/games/:gameId/base-rules/parse-preview', requireAuth, asyncHandler(async (req, res) => {
  const { rawText } = req.body;
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!rows.length) return res.status(404).send('Game not found');
  const sections = parseRulebook(rawText || '');
  res.render('preview-rulebook', { game: rows[0], sections, rawText });
}));

// Save the (possibly hand-edited) parsed sections (requires login)
router.post('/games/:gameId/base-rules/save', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  let { titles, bodies } = req.body; // arrays, same index = same section
  if (!Array.isArray(titles)) titles = [titles];
  if (!Array.isArray(bodies)) bodies = [bodies];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < titles.length; i++) {
      if (!titles[i] || !titles[i].trim()) continue;
      await client.query(
        `INSERT INTO base_rule_sections (game_id, title, body, sort_order) VALUES ($1, $2, $3, $4)`,
        [gameId, titles[i].trim(), (bodies[i] || '').trim(), i]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${gameId}`);
}));

// Add a single base rule section manually (requires login)
router.post('/games/:gameId/base-rules', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const { title, body, rule_category_path } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM base_rule_sections WHERE game_id = $1',
    [gameId]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId = null;
    if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, null, rule_category_path.split('>'));
    }
    await client.query(
      'INSERT INTO base_rule_sections (game_id, title, body, sort_order, rule_category_id) VALUES ($1, $2, $3, $4, $5)',
      [gameId, title, body, rows[0].next_order, ruleCategoryId]
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

// Edit a base rule section (requires login)
router.post('/base-rules/:id/edit', requireAuth, asyncHandler(async (req, res) => {
  const { title, body, gameId, rule_category_path } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId;
    if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, null, rule_category_path.split('>'));
    } else {
      // Leaving the field blank keeps whatever category this section already had,
      // rather than clearing it - clearing requires the dedicated "Uncategorize" button.
      const { rows } = await client.query('SELECT rule_category_id FROM base_rule_sections WHERE id = $1', [req.params.id]);
      ruleCategoryId = rows.length ? rows[0].rule_category_id : null;
    }
    await client.query(
      'UPDATE base_rule_sections SET title=$1, body=$2, rule_category_id=$3 WHERE id=$4',
      [title, body, ruleCategoryId, req.params.id]
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

// Clear a section's rule category without editing anything else (requires login)
router.post('/base-rules/:id/uncategorize', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE base_rule_sections SET rule_category_id = NULL WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
}));

// Delete a base rule section (requires login)
router.post('/base-rules/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM base_rule_sections WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
}));

// ---- Setup options (alternate ways to set up a session, e.g. Dominion's
// curated Kingdom card sets) - separate from the sequential rulebook flow. ----

router.post('/games/:gameId/setup-options', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const { title, body } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM setup_options WHERE game_id = $1 AND expansion_id IS NULL',
    [gameId]
  );
  await pool.query(
    'INSERT INTO setup_options (game_id, title, body, sort_order) VALUES ($1, $2, $3, $4)',
    [gameId, title, body, rows[0].next_order]
  );
  res.redirect(`/games/${gameId}#tab-rules`);
}));

router.post('/setup-options/:id/edit', requireAuth, asyncHandler(async (req, res) => {
  const { title, body, gameId } = req.body;
  await pool.query('UPDATE setup_options SET title=$1, body=$2 WHERE id=$3', [title, body, req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
}));

router.post('/setup-options/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM setup_options WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
}));

module.exports = router;
