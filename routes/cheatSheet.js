const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

// ---- Cheat Sheet: a condensed, hand-written summary (turn order, scoring,
// win condition) for a quick glance mid-game, separate from the full
// rulebook on the main game page. ----

router.get('/games/:id/cheat-sheet', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Game not found');
  res.render('cheat-sheet', { game: rows[0] });
}));

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
