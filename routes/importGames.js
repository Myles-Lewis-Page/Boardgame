const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseGamesCsv, CSV_TEMPLATE } = require('../db/parseGamesCsv');
const { parseRulebook } = require('../db/parseRulebook');

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

// Save all valid rows (skips rows still marked as having errors). Rows with
// an expansion_of value are inserted as expansions instead of top-level
// games - the parent can be another game in this same file, or a game
// that's already in the database (matched by exact, case-insensitive name).
// Standalone games are always inserted first, in a first pass, so a parent
// created earlier in the same batch is available by the time its expansion
// rows are processed, regardless of what order they appeared in the file.
router.post('/games/import/save', requireAuth, async (req, res) => {
  let {
    name, publisher, genre, min_players, max_players, play_time_minutes,
    cover_image_url, notes, rules_text, expansion_of, include
  } = req.body;

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
  expansion_of = toArray(expansion_of);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let insertedGamesCount = 0;
  let insertedExpansionsCount = 0;
  let sectionsInsertedCount = 0;
  let skippedExpansions = [];

  async function insertRules(client, gameId, expansionId, rawRules) {
    const trimmed = (rawRules || '').trim();
    if (!trimmed) return;
    const sections = parseRulebook(trimmed);
    for (let s = 0; s < sections.length; s++) {
      if (!sections[s].title.trim()) continue;
      await client.query(
        `INSERT INTO base_rule_sections (game_id, expansion_id, title, body, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [gameId, expansionId, sections[s].title.trim(), sections[s].body.trim(), s]
      );
      sectionsInsertedCount++;
    }
  }

  try {
    await client.query('BEGIN');

    // Seed the name->id lookup with games already in the database, so a
    // row can be an expansion of a game imported in an earlier session.
    const { rows: existingGames } = await client.query('SELECT id, name FROM games');
    const gameIdByName = new Map(existingGames.map(g => [g.name.trim().toLowerCase(), g.id]));

    const includedRows = [];
    for (let i = 0; i < name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!name[i] || !name[i].trim()) continue;
      includedRows.push(i);
    }

    // Pass 1: standalone games (no expansion_of) - always processed first.
    for (const i of includedRows) {
      if (expansion_of[i] && expansion_of[i].trim()) continue;

      const { rows } = await client.query(
        `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
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
      insertedGamesCount++;
      const newGameId = rows[0].id;
      gameIdByName.set(name[i].trim().toLowerCase(), newGameId);
      await insertRules(client, newGameId, null, rules_text[i]);
    }

    // Pass 2: expansions - looked up against the map built above, which now
    // includes both pre-existing games and everything just created in pass 1.
    for (const i of includedRows) {
      if (!expansion_of[i] || !expansion_of[i].trim()) continue;

      const parentId = gameIdByName.get(expansion_of[i].trim().toLowerCase());
      if (!parentId) {
        skippedExpansions.push({ name: name[i].trim(), expansion_of: expansion_of[i].trim() });
        continue;
      }

      const { rows } = await client.query(
        `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          parentId,
          name[i].trim(),
          min_players[i] ? parseInt(min_players[i], 10) : null,
          max_players[i] ? parseInt(max_players[i], 10) : null,
          play_time_minutes[i] ? parseInt(play_time_minutes[i], 10) : null,
          cover_image_url[i] || null,
          notes[i] || null
        ]
      );
      insertedExpansionsCount++;
      const newExpansionId = rows[0].id;
      await insertRules(client, parentId, newExpansionId, rules_text[i]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('games-import-done', {
    insertedCount: insertedGamesCount,
    insertedExpansionsCount,
    sectionsInsertedCount,
    skippedExpansions
  });
});

module.exports = router;
