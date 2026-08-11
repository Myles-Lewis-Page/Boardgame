const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseRulebook } = require('../db/parseRulebook');
const { parseGamesCsv, CSV_TEMPLATE } = require('../db/parseGamesCsv');

// ---- Bulk import (same CSV format as the games import, saved to the wishlist instead) ----

router.get('/wishlist/import/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="wishlist-template.csv"');
  res.send(CSV_TEMPLATE);
});

router.get('/wishlist/import', requireAuth, (req, res) => {
  res.render('wishlist-import', {});
});

router.post('/wishlist/import/preview', requireAuth, (req, res) => {
  const { rawCsv } = req.body;
  const { games, headerError } = parseGamesCsv(rawCsv || '');
  res.render('wishlist-import-preview', { games, headerError, rawCsv });
});

router.post('/wishlist/import/save', requireAuth, async (req, res) => {
  let { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, rules_text, include } = req.body;

  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  name = toArray(name);
  publisher = toArray(publisher);
  genre = toArray(genre);
  min_players = toArray(min_players);
  max_players = toArray(max_players);
  play_time_minutes = toArray(play_time_minutes);
  cover_image_url = toArray(cover_image_url);
  notes = toArray(notes);
  rules_text = toArray(rules_text);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let insertedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!name[i] || !name[i].trim()) continue;
      await client.query(
        `INSERT INTO wishlist_games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, rules_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          name[i].trim(),
          publisher[i] || null,
          genre[i] || null,
          min_players[i] ? parseInt(min_players[i], 10) : null,
          max_players[i] ? parseInt(max_players[i], 10) : null,
          play_time_minutes[i] ? parseInt(play_time_minutes[i], 10) : null,
          cover_image_url[i] || null,
          notes[i] || null,
          (rules_text[i] || '').trim() || null
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

  res.render('wishlist-import-done', { insertedCount });
});

// List wishlist games (public)
router.get('/wishlist', async (req, res) => {
  const { rows: wishlistGames } = await pool.query('SELECT * FROM wishlist_games ORDER BY name ASC');
  res.render('wishlist-index', { wishlistGames });
});

// New wishlist entry form (requires login)
router.get('/wishlist/new', requireAuth, (req, res) => {
  res.render('wishlist-new');
});

// Create wishlist entry (requires login)
router.post('/wishlist', requireAuth, async (req, res) => {
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, rules_text } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO wishlist_games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, rules_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, rules_text || null]
  );
  res.redirect(`/wishlist/${rows[0].id}`);
});

// Wishlist entry detail: shows a read-only preview of the rule sections
// that will be created once you mark it owned (public to view)
router.get('/wishlist/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wishlist_games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Wishlist entry not found');
  const entry = rows[0];
  const previewSections = entry.rules_text ? parseRulebook(entry.rules_text) : [];
  res.render('wishlist-detail', { entry, previewSections });
});

// Edit wishlist entry (requires login)
router.get('/wishlist/:id/edit', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wishlist_games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Wishlist entry not found');
  res.render('wishlist-edit', { entry: rows[0] });
});

router.post('/wishlist/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, rules_text } = req.body;
  await pool.query(
    `UPDATE wishlist_games SET name=$1, publisher=$2, genre=$3, min_players=$4, max_players=$5,
     play_time_minutes=$6, cover_image_url=$7, notes=$8, rules_text=$9 WHERE id=$10`,
    [name, publisher || null, genre || null, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, rules_text || null, id]
  );
  res.redirect(`/wishlist/${id}`);
});

// Delete wishlist entry (requires login)
router.post('/wishlist/:id/delete', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM wishlist_games WHERE id = $1', [req.params.id]);
  res.redirect('/wishlist');
});

// Convert to an owned game: copies all fields into a new games row, then
// parses the stored rules_text (if any) straight into base_rule_sections,
// so nothing has to be re-entered. Removes the wishlist entry afterward.
router.post('/wishlist/:id/convert', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wishlist_games WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Wishlist entry not found');
  const entry = rows[0];

  const client = await pool.connect();
  let newGameId;
  try {
    await client.query('BEGIN');

    const { rows: gameRows } = await client.query(
      `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [entry.name, entry.publisher, entry.genre, entry.min_players, entry.max_players, entry.play_time_minutes, entry.cover_image_url, entry.notes]
    );
    newGameId = gameRows[0].id;

    if (entry.rules_text && entry.rules_text.trim()) {
      const sections = parseRulebook(entry.rules_text);
      for (let i = 0; i < sections.length; i++) {
        if (!sections[i].title.trim()) continue;
        await client.query(
          `INSERT INTO base_rule_sections (game_id, title, body, sort_order) VALUES ($1, $2, $3, $4)`,
          [newGameId, sections[i].title.trim(), sections[i].body.trim(), i]
        );
      }
    }

    await client.query('DELETE FROM wishlist_games WHERE id = $1', [entry.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/games/${newGameId}`);
});

module.exports = router;
