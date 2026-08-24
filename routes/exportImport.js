const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { pathForRuleCategoryId, findOrCreateRuleCategoryPath } = require('../db/ruleCategoryTree');
const { pathForCategoryId } = require('../db/categoryTree');

// ---- Export: everything needed to fully rebuild your library - games,
// expansions, rules (with category paths instead of raw IDs, so they
// survive re-import into a fresh database with different auto-increment
// IDs), house rules, setup options, and scoring categories. Play history
// (sessions/scores) is NOT included - it's tied to specific score
// categories in a way that's fiddly to remap safely, and this is meant
// as a structural backup of your library and rules, not a full database
// dump. ----

router.get('/export', requireAuth, asyncHandler(async (req, res) => {
  const { rows: categories } = await pool.query('SELECT * FROM categories');
  const { rows: games } = await pool.query('SELECT * FROM games ORDER BY id ASC');
  const { rows: allExpansions } = await pool.query('SELECT * FROM expansions ORDER BY id ASC');
  const { rows: allRuleCategories } = await pool.query('SELECT * FROM rule_categories');
  const { rows: allSections } = await pool.query('SELECT * FROM base_rule_sections ORDER BY sort_order ASC, id ASC');
  const { rows: allHouseRules } = await pool.query('SELECT * FROM house_rules ORDER BY sort_order ASC, id ASC');
  const { rows: allSetupOptions } = await pool.query('SELECT * FROM setup_options ORDER BY sort_order ASC, id ASC');
  const { rows: allScoreCategories } = await pool.query('SELECT * FROM score_categories ORDER BY sort_order ASC, id ASC');

  function sectionTitleById(id) {
    const s = allSections.find(x => x.id === id);
    return s ? s.title : null;
  }

  function serializeRules(gameId, expansionId) {
    const sections = allSections
      .filter(s => s.game_id === gameId && s.expansion_id === expansionId)
      .map(s => ({
        title: s.title,
        body: s.body,
        sort_order: s.sort_order,
        rule_category_path: pathForRuleCategoryId(s.rule_category_id, allRuleCategories)
      }));
    const houseRules = allHouseRules
      .filter(h => h.game_id === gameId && h.expansion_id === expansionId)
      .map(h => ({
        title: h.title,
        body: h.body,
        is_active: h.is_active,
        sort_order: h.sort_order,
        overrides_section_title: sectionTitleById(h.base_section_id),
        rule_category_path: pathForRuleCategoryId(h.rule_category_id, allRuleCategories)
      }));
    const setupOptions = allSetupOptions
      .filter(o => o.game_id === gameId && o.expansion_id === expansionId)
      .map(o => ({ title: o.title, body: o.body, sort_order: o.sort_order }));
    return { sections, houseRules, setupOptions };
  }

  const exportedGames = games.map(g => {
    const expansions = allExpansions
      .filter(e => e.game_id === g.id)
      .map(e => ({
        name: e.name,
        min_players: e.min_players,
        max_players: e.max_players,
        play_time_minutes: e.play_time_minutes,
        cover_image_url: e.cover_image_url,
        notes: e.notes,
        owned: e.owned,
        ...serializeRules(g.id, e.id)
      }));

    const scoreCategories = allScoreCategories
      .filter(c => c.game_id === g.id)
      .map(c => ({
        group_label: c.group_label,
        label: c.label,
        is_multiplier: c.is_multiplier,
        multiplier_value: c.multiplier_value,
        is_award: c.is_award,
        sort_order: c.sort_order
      }));

    return {
      name: g.name,
      publisher: g.publisher,
      genre: g.genre,
      min_players: g.min_players,
      max_players: g.max_players,
      play_time_minutes: g.play_time_minutes,
      cover_image_url: g.cover_image_url,
      notes: g.notes,
      owned: g.owned,
      category_path: pathForCategoryId(g.category_id, categories),
      variant_of_name: g.variant_of_id ? (games.find(x => x.id === g.variant_of_id) || {}).name : null,
      expansions,
      scoreCategories,
      ...serializeRules(g.id, null)
    };
  });

  const payload = {
    exported_at: new Date().toISOString(),
    format: 'boardgame-rules-export-v1',
    games: exportedGames
  };

  const filename = `board-game-library-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
}));

router.get('/export-import', requireAuth, asyncHandler(async (req, res) => {
  res.render('export-import', { result: null });
}));

// ---- Import: additive only. A game whose name (case-insensitive)
// already exists in your library is skipped entirely, so re-importing
// (or importing a partial/old export) never overwrites or duplicates
// anything already there. ----

router.post('/import', requireAuth, asyncHandler(async (req, res) => {
  const { json_data } = req.body;
  let data;
  try {
    data = JSON.parse(json_data);
  } catch (err) {
    return res.render('export-import', { result: { error: 'That doesn\'t look like valid JSON - check you pasted the whole file.' } });
  }

  if (!data || !Array.isArray(data.games)) {
    return res.render('export-import', { result: { error: 'This file doesn\'t look like a board game library export (missing a "games" list).' } });
  }

  const summary = { gamesAdded: 0, gamesSkipped: [], expansionsAdded: 0, sectionsAdded: 0, houseRulesAdded: 0, setupOptionsAdded: 0, scoreCategoriesAdded: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const g of data.games) {
      const { rows: existing } = await client.query('SELECT id FROM games WHERE LOWER(name) = LOWER($1)', [g.name]);
      if (existing.length) {
        summary.gamesSkipped.push(g.name);
        continue;
      }

      let categoryId = null;
      if (g.category_path) {
        const parts = g.category_path.split('>').map(s => s.trim()).filter(Boolean);
        let parentId = null;
        for (const name of parts) {
          const { rows: catRows } = await client.query(
            'SELECT id FROM categories WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2',
            [name, parentId]
          );
          if (catRows.length) {
            categoryId = catRows[0].id;
          } else {
            const { rows: inserted } = await client.query(
              'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id',
              [name, parentId]
            );
            categoryId = inserted[0].id;
          }
          parentId = categoryId;
        }
      }

      const { rows: gameRows } = await client.query(
        `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, owned, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [g.name, g.publisher, g.genre, g.min_players, g.max_players, g.play_time_minutes, g.cover_image_url, g.notes, g.owned, categoryId]
      );
      const gameId = gameRows[0].id;
      summary.gamesAdded++;

      async function importRules(expansionId, sections, houseRules, setupOptions) {
        const sectionIdByTitle = new Map();
        for (const s of sections || []) {
          let ruleCategoryId = null;
          if (s.rule_category_path) {
            ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, expansionId, s.rule_category_path.split('>'));
          }
          const { rows } = await client.query(
            'INSERT INTO base_rule_sections (game_id, expansion_id, rule_category_id, title, body, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [gameId, expansionId, ruleCategoryId, s.title, s.body, s.sort_order || 0]
          );
          sectionIdByTitle.set(s.title, rows[0].id);
          summary.sectionsAdded++;
        }
        for (const h of houseRules || []) {
          let ruleCategoryId = null;
          if (h.rule_category_path) {
            ruleCategoryId = await findOrCreateRuleCategoryPath(client, gameId, expansionId, h.rule_category_path.split('>'));
          }
          const baseSectionId = h.overrides_section_title ? sectionIdByTitle.get(h.overrides_section_title) || null : null;
          await client.query(
            `INSERT INTO house_rules (game_id, expansion_id, base_section_id, rule_category_id, title, body, is_active, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [gameId, expansionId, baseSectionId, ruleCategoryId, h.title, h.body, h.is_active !== false, h.sort_order || 0]
          );
          summary.houseRulesAdded++;
        }
        for (const o of setupOptions || []) {
          await client.query(
            'INSERT INTO setup_options (game_id, expansion_id, title, body, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [gameId, expansionId, o.title, o.body, o.sort_order || 0]
          );
          summary.setupOptionsAdded++;
        }
      }

      await importRules(null, g.sections, g.houseRules, g.setupOptions);

      for (const exp of g.expansions || []) {
        const { rows: expRows } = await client.query(
          `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [gameId, exp.name, exp.min_players, exp.max_players, exp.play_time_minutes, exp.cover_image_url, exp.notes, exp.owned]
        );
        const expansionId = expRows[0].id;
        summary.expansionsAdded++;
        await importRules(expansionId, exp.sections, exp.houseRules, exp.setupOptions);
      }

      for (const sc of g.scoreCategories || []) {
        await client.query(
          `INSERT INTO score_categories (game_id, group_label, label, is_multiplier, multiplier_value, is_award, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [gameId, sc.group_label, sc.label, sc.is_multiplier, sc.multiplier_value, sc.is_award, sc.sort_order || 0]
        );
        summary.scoreCategoriesAdded++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('export-import', { result: { summary } });
}));

module.exports = router;
