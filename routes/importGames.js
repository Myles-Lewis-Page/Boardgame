const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseGamesCsv, CSV_TEMPLATE } = require('../db/parseGamesCsv');

// Download a starter CSV template (requires login, same as the rest of import)
router.get('/games/import/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="games-template.csv"');
  res.send(CSV_TEMPLATE);
});

// Show the import form (paste text or choose a .csv file - file is read
// client-side into the textarea, no server-side file upload handling needed)
router.get('/games/import', requireAuth, (req, res) => {
  res.render('games-import', { });
});

// Parse pasted/uploaded CSV text -> preview with per-row validation
router.post('/games/import/preview', requireAuth, (req, res) => {
  const { rawCsv } = req.body;
  const { headers, games, headerError } = parseGamesCsv(rawCsv || '');
  res.render('games-import-preview', { games, headerError, rawCsv });
});

// Save all valid rows (skips rows still marked as having errors)
router.post('/games/import/save', requireAuth, async (req, res) => {
  let { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, include } = req.body;

  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  name = toArray(name);
  publisher = toArray(publisher);
  genre = toArray(genre);
  min_players = toArray(min_players);
  max_players = toArray(max_players);
  play_time_minutes = toArray(play_time_minutes);
  cover_image_url = toArray(cover_image_url);
  notes = toArray(notes);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let insertedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!name[i] || !name[i].trim()) continue;
      await client.query(
        `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          name[i].trim(),
          publisher[i] || null,
          genre[i] || null,
          min_players[i] ? parseInt(min_players[i], 10) : null,
          max_players[i] ? parseInt(max_players[i], 10) : null,
          play_time_minutes[i] ? parseInt(play_time_minutes[i], 10) : null,
          cover_image_url[i] || null,
          notes[i] || null
        ]
      );
      insertedCount++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('games-import-done', { insertedCount });
});

module.exports = router;
