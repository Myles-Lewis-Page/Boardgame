const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

// ---- Cheat Sheet: a condensed, at-a-glance summary (turn order, scoring,
// win condition) for mid-game reference, separate from the full rulebook.
// Each category can hold multiple entries - e.g. Root needs a separate
// Turn Order card per faction, since each plays completely differently.
// The legacy single free-text fields on `games` still work as a fallback
// for anything simple enough not to need multiple cards. ----

const CATEGORIES = [
  { key: 'turn_order', label: 'Turn Order', legacyField: 'cheat_turn_order' },
  { key: 'scoring', label: 'Scoring', legacyField: 'cheat_scoring' },
  { key: 'win_condition', label: 'Win Condition', legacyField: 'cheat_win_condition' },
];

router.get('/games/:id/cheat-sheet', asyncHandler(async (req, res) => {
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
  if (!gameRows.length) return res.status(404).send('Game not found');
  const game = gameRows[0];

  const { rows: entries } = await pool.query(
    'SELECT * FROM cheat_sheet_entries WHERE game_id = $1 ORDER BY category ASC, sort_order ASC, id ASC',
    [game.id]
  );
  const entriesByCategory = {};
  CATEGORIES.forEach(c => { entriesByCategory[c.key] = entries.filter(e => e.category === c.key); });

  res.render('cheat-sheet', { game, categories: CATEGORIES, entriesByCategory });
}));

router.post('/games/:id/cheat-sheet/entries', requireAuth, asyncHandler(async (req, res) => {
  const { category, label, body } = req.body;
  if (!CATEGORIES.some(c => c.key === category) || !body || !body.trim()) {
    return res.redirect(`/games/${req.params.id}/cheat-sheet`);
  }
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM cheat_sheet_entries WHERE game_id = $1 AND category = $2',
    [req.params.id, category]
  );
  await pool.query(
    'INSERT INTO cheat_sheet_entries (game_id, category, label, body, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [req.params.id, category, label && label.trim() ? label.trim() : null, body.trim(), rows[0].next_order]
  );
  res.redirect(`/games/${req.params.id}/cheat-sheet`);
}));

router.post('/cheat-sheet-entries/:id/edit', requireAuth, asyncHandler(async (req, res) => {
  const { label, body, gameId } = req.body;
  await pool.query(
    'UPDATE cheat_sheet_entries SET label = $1, body = $2 WHERE id = $3',
    [label && label.trim() ? label.trim() : null, body, req.params.id]
  );
  res.redirect(`/games/${gameId}/cheat-sheet`);
}));

router.post('/cheat-sheet-entries/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM cheat_sheet_entries WHERE id = $1 RETURNING game_id', [req.params.id]);
  const gameId = rows[0] && rows[0].game_id;
  res.redirect(gameId ? `/games/${gameId}/cheat-sheet` : '/games');
}));

// Legacy free-text fallback (single blob per category), kept for simple
// games that don't need multiple cards.
router.post('/games/:id/cheat-sheet', requireAuth, asyncHandler(async (req, res) => {
  const { cheat_turn_order, cheat_scoring, cheat_win_condition } = req.body;
  await pool.query(
    'UPDATE games SET cheat_turn_order = $1, cheat_scoring = $2, cheat_win_condition = $3 WHERE id = $4',
    [cheat_turn_order || null, cheat_scoring || null, cheat_win_condition || null, req.params.id]
  );
  res.redirect(`/games/${req.params.id}/cheat-sheet`);
}));

// ---- QR code + printable shelf label, so a physical box can link
// straight back to its page. Generated on the fly, nothing stored. ----

router.get('/games/:id/qr.png', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Game not found');
  const url = `${req.protocol}://${req.get('host')}/games/${req.params.id}`;
  const buffer = await QRCode.toBuffer(url, { width: 400, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
}));

router.get('/games/:id/label', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Game not found');
  res.render('game-label', { game: rows[0] });
}));

module.exports = router;
