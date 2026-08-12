const express = require('express');
const router = express.Router();
const pool = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/randomizer', asyncHandler(async (req, res) => {
  const { rows: games } = await pool.query(`
    SELECT id, name, min_players, max_players, play_time_minutes, cover_image_url, genre
    FROM games
    WHERE owned = true AND variant_of_id IS NULL
    ORDER BY name ASC
  `);
  res.render('randomizer', { games });
}));

module.exports = router;
