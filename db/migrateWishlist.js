const { parseRulebook } = require('./parseRulebook');
const { parseRuleCategoriesMapping } = require('./parseGamesCsv');
const { findOrCreateRuleCategoryPath } = require('./ruleCategoryTree');

/**
 * Runs once per boot, but is a no-op after the first successful run on any
 * given database: if wishlist_games doesn't exist (fresh install, or an
 * already-migrated one), it returns immediately. Otherwise it copies every
 * wishlist entry into games as owned = false - including parsing its saved
 * rules_text into real base_rule_sections (with rule_categories applied),
 * so a migrated wishlist game is functionally identical to one that had
 * been imported directly with owned=false - then drops wishlist_games.
 */
async function migrateWishlistIntoGames(pool) {
  const { rows: check } = await pool.query("SELECT to_regclass('public.wishlist_games') AS reg");
  if (!check[0].reg) return { migrated: 0, skipped: 0 };

  const { rows: wishlistRows } = await pool.query('SELECT * FROM wishlist_games');

  const client = await pool.connect();
  let migrated = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');

    for (const w of wishlistRows) {
      const { rows: existing } = await client.query('SELECT id FROM games WHERE LOWER(name) = LOWER($1)', [w.name]);
      if (existing.length) { skipped++; continue; } // a game with this name already exists - don't clobber it

      const { rows: inserted } = await client.query(
        `INSERT INTO games (name, publisher, genre, min_players, max_players, play_time_minutes, cover_image_url, notes, category_id, owned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) RETURNING id`,
        [w.name, w.publisher, w.genre, w.min_players, w.max_players, w.play_time_minutes, w.cover_image_url, w.notes, w.category_id]
      );
      const newGameId = inserted[0].id;

      if (w.rules_text && w.rules_text.trim()) {
        const sections = parseRulebook(w.rules_text);
        const catMap = parseRuleCategoriesMapping(w.rule_categories);
        for (let i = 0; i < sections.length; i++) {
          if (!sections[i].title.trim()) continue;
          let ruleCategoryId = null;
          const path = catMap.get(sections[i].title.trim().toUpperCase());
          if (path) ruleCategoryId = await findOrCreateRuleCategoryPath(client, newGameId, null, path.split('>'));
          await client.query(
            `INSERT INTO base_rule_sections (game_id, title, body, sort_order, rule_category_id) VALUES ($1, $2, $3, $4, $5)`,
            [newGameId, sections[i].title.trim(), sections[i].body.trim(), i, ruleCategoryId]
          );
        }
      }
      migrated++;
    }

    await client.query('DROP TABLE IF EXISTS wishlist_games');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { migrated, skipped };
}

module.exports = { migrateWishlistIntoGames };
