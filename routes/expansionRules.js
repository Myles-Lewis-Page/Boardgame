const express = require('express');
const router = express.Router();
const pool = require('../db');
const { parseRulebook } = require('../db/parseRulebook');
const { requireAuth } = require('../middleware/auth');
const { findOrCreateRuleCategoryPath } = require('../db/ruleCategoryTree');

// ---- Base rules for an expansion ----
// These still read/write rows scoped to a specific expansion, but every
// action now redirects back to the merged game page (/games/:gameId) where
// base + all expansion rules are browsed together, rather than a separate
// per-expansion page.

router.get('/games/:gameId/expansions/:expId/base-rules/paste', requireAuth, async (req, res) => {
  const { gameId, expId } = req.params;
  const { rows: expRows } = await pool.query('SELECT * FROM expansions WHERE id = $1 AND game_id = $2', [expId, gameId]);
  if (!expRows.length) return res.status(404).send('Expansion not found');
  res.render('paste-rulebook', { game: null, expansion: expRows[0], gameId });
});

router.post('/games/:gameId/expansions/:expId/base-rules/parse-preview', requireAuth, async (req, res) => {
  const { gameId, expId } = req.params;
  const { rawText } = req.body;
  const { rows: expRows } = await pool.query('SELECT * FROM expansions WHERE id = $1 AND game_id = $2', [expId, gameId]);
  if (!expRows.length) return res.status(404).send('Expansion not found');
  const sections = parseRulebook(rawText || '');
  res.render('preview-rulebook', { game: null, expansion: expRows[0], gameId, sections, rawText });
});

router.post('/games/:gameId/expansions/:expId/base-rules/save', requireAuth, async (req, res) => {
  const { gameId, expId } = req.params;
  let { titles, bodies } = req.body;
  if (!Array.isArray(titles)) titles = [titles];
  if (!Array.isArray(bodies)) bodies = [bodies];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < titles.length; i++) {
      if (!titles[i] || !titles[i].trim()) continue;
      await client.query(
        `INSERT INTO base_rule_sections (game_id, expansion_id, title, body, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [gameId, expId, titles[i].trim(), (bodies[i] || '').trim(), i]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${gameId}#tab-rules`);
});

router.post('/games/:gameId/expansions/:expId/base-rules', requireAuth, async (req, res) => {
  const { gameId, expId } = req.params;
  const { title, body, rule_category_path } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM base_rule_sections WHERE expansion_id = $1',
    [expId]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId = null;
    if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, expId, rule_category_path.split('>'));
    }
    await client.query(
      'INSERT INTO base_rule_sections (game_id, expansion_id, title, body, sort_order, rule_category_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [gameId, expId, title, body, rows[0].next_order, ruleCategoryId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${gameId}#tab-rules`);
});

router.post('/expansion-base-rules/:id/edit', requireAuth, async (req, res) => {
  const { title, body, gameId, expId, rule_category_path } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ruleCategoryId;
    if (rule_category_path && rule_category_path.trim()) {
      ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, expId, rule_category_path.split('>'));
    } else {
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
});

router.post('/expansion-base-rules/:id/uncategorize', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE base_rule_sections SET rule_category_id = NULL WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
});

router.post('/expansion-base-rules/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM base_rule_sections WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-rules`);
});

// ---- House rules for an expansion ----

router.post('/games/:gameId/expansions/:expId/house-rules', requireAuth, async (req, res) => {
  const { gameId, expId } = req.params;
  const { title, body, base_section_id } = req.body;
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM house_rules WHERE expansion_id = $1',
    [expId]
  );
  await pool.query(
    `INSERT INTO house_rules (game_id, expansion_id, base_section_id, title, body, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [gameId, expId, base_section_id || null, title, body, rows[0].next_order]
  );
  res.redirect(`/games/${gameId}#tab-house`);
});

router.post('/expansion-house-rules/:id/edit', requireAuth, async (req, res) => {
  const { title, body, gameId, base_section_id } = req.body;
  await pool.query(
    'UPDATE house_rules SET title=$1, body=$2, base_section_id=$3 WHERE id=$4',
    [title, body, base_section_id || null, req.params.id]
  );
  res.redirect(`/games/${gameId}#tab-house`);
});

router.post('/expansion-house-rules/:id/toggle', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE house_rules SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-house`);
});

router.post('/expansion-house-rules/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM house_rules WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-house`);
});

module.exports = router;
