const express = require('express');
const router = express.Router();
const pool = require('../db');
const { parseRulebook } = require('../db/parseRulebook');

// Show paste-rulebook form for a game
router.get('/games/:gameId/base-rules/paste', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!rows.length) return res.status(404).send('Game not found');
  res.render('paste-rulebook', { game: rows[0] });
});

// Handle pasted rulebook text -> parse -> preview before saving
router.post('/games/:gameId/base-rules/parse-preview', async (req, res) => {
  const { rawText } = req.body;
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!rows.length) return res.status(404).send('Game not found');
  const sections = parseRulebook(rawText || '');
  res.render('preview-rulebook', { game: rows[0], sections, rawText });
});

// Save the (possibly hand-edited) parsed sections
router.post('/games/:gameId/base-rules/save', async (req, res) => {
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
});

// Add a single base rule section manually
router.post('/games/:gameId/base-rules', async (req, res) => {
  const { gameId } = req.params;
  const { title, body } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM base_rule_sections WHERE game_id = $1',
    [gameId]
  );
  await pool.query(
    'INSERT INTO base_rule_sections (game_id, title, body, sort_order) VALUES ($1, $2, $3, $4)',
    [gameId, title, body, rows[0].next_order]
  );
  res.redirect(`/games/${gameId}`);
});

// Edit a base rule section
router.post('/base-rules/:id/edit', async (req, res) => {
  const { title, body, gameId } = req.body;
  await pool.query('UPDATE base_rule_sections SET title=$1, body=$2 WHERE id=$3', [title, body, req.params.id]);
  res.redirect(`/games/${gameId}`);
});

// Delete a base rule section
router.post('/base-rules/:id/delete', async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM base_rule_sections WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}`);
});

module.exports = router;
