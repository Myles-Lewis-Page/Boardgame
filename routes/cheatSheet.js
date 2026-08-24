const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const pool = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');

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
