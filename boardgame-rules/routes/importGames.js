const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseGamesCsv, CSV_TEMPLATE, parseRuleCategoriesMapping } = require('../db/parseGamesCsv');
const { parseRulebook } = require('../db/parseRulebook');
const { findOrCreateCategoryPath } = require('../db/categoryTree');
const { findOrCreateRuleCategoryPath } = require('../db/ruleCategoryTree');

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
    cover_image_url, notes, rules_text, expansion_of, category_path, rule_categories, owned, variant_of, include
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
  category_path = toArray(category_path);
  rule_categories = toArray(rule_categories);
  owned = toArray(owned);
  variant_of = toArray(variant_of);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let insertedGamesCount = 0;
  let insertedExpansionsCount = 0;
  let sectionsInsertedCount = 0;
  let sectionsCategorizedCount = 0;
  let skippedExpansions = [];
  let skippedVariants = [];

  // Inserts a game/expansion's rule sections AND, in the same pass, assigns
  // each one its rule sub-category based on the row's rule_categories
  // mapping (Title=Path per line) - no separate recategorize step needed
  // for anything added through this import.
  async function insertRules(client, gameId, expansionId, rawRules, rawRuleCategories) {
    const trimmed = (rawRules || '').trim();
    if (!trimmed) return;
    const sections = parseRulebook(trimmed);
    const catMap = parseRuleCategoriesMapping(rawRuleCategories);
    for (let s = 0; s < sections.length; s++) {
      if (!sections[s].title.trim()) continue;

      let ruleCategoryId = null;
      const path = catMap.get(sections[s].title.trim().toUpperCase());
      if (path) {
        ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, expansionId, path.split('>'));
        sectionsCategorizedCount++;
      }

      await client.query(
        `INSERT INTO base_rule_sections (game_id, expansion_id, title, body, sort_order, rule_category_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [gameId, expansionId, sections[s].title.trim(), sections[s].body.trim(), s, ruleCategoryId]
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

      let categoryId = null;
      if (category_path[i] && category_path[i].trim()) {
        categoryId = await findOrCreateCategoryPath(client, category_path[i].split('>'));
      }

      const { rows } = await client.query(
        `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id, owned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          name[i].trim(),
          publisher[i] || null,
          genre[i] || null,
          min_players[i] ? parseInt(min_players[i], 10) : null,
          max_players[i] ? parseInt(max_players[i], 10) : null,
          play_time_minutes[i] ? parseInt(play_time_minutes[i], 10) : null,
          cover_image_url[i] || null,
          notes[i] || null,
          categoryId,
          owned[i] !== 'false'
        ]
      );
      insertedGamesCount++;
      const newGameId = rows[0].id;
      gameIdByName.set(name[i].trim().toLowerCase(), newGameId);
      await insertRules(client, newGameId, null, rules_text[i], rule_categories[i]);
    }

    // Pass 1b: variant_of links between standalone games - a second pass
    // over the same rows so it doesn't matter which one appears first in
    // the file. Only applies to standalone games, not expansions (a
    // variation is a full top-level game, same as expansions can't be
    // variations of each other).
    for (const i of includedRows) {
      if (expansion_of[i] && expansion_of[i].trim()) continue;
      if (!variant_of[i] || !variant_of[i].trim()) continue;

      const thisGameId = gameIdByName.get(name[i].trim().toLowerCase());
      const targetId = gameIdByName.get(variant_of[i].trim().toLowerCase());
      if (!thisGameId || !targetId || thisGameId === targetId) {
        skippedVariants.push({ name: name[i].trim(), variant_of: variant_of[i].trim() });
        continue;
      }
      await client.query('UPDATE games SET variant_of_id = $1 WHERE id = $2', [targetId, thisGameId]);
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

      let categoryId = null;
      if (category_path[i] && category_path[i].trim()) {
        categoryId = await findOrCreateCategoryPath(client, category_path[i].split('>'));
      }

      const { rows } = await client.query(
        `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          parentId,
          name[i].trim(),
          min_players[i] ? parseInt(min_players[i], 10) : null,
          max_players[i] ? parseInt(max_players[i], 10) : null,
          play_time_minutes[i] ? parseInt(play_time_minutes[i], 10) : null,
          cover_image_url[i] || null,
          notes[i] || null,
          categoryId
        ]
      );
      insertedExpansionsCount++;
      const newExpansionId = rows[0].id;
      await insertRules(client, parentId, newExpansionId, rules_text[i], rule_categories[i]);
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
    sectionsCategorizedCount,
    skippedExpansions,
    skippedVariants
  });
});

module.exports = router;
