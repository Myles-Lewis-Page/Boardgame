const express = require('express');
const router = express.Router();
const pool = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/dashboard', asyncHandler(async (req, res) => {
  const { rows: totals } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM games WHERE owned = true AND variant_of_id IS NULL) AS owned_games,
      (SELECT COUNT(*) FROM games WHERE owned = false AND variant_of_id IS NULL) AS wishlist_games,
      (SELECT COUNT(*) FROM expansions WHERE owned = true) AS owned_expansions,
      (SELECT COUNT(*) FROM game_sessions) AS total_plays,
      (SELECT COUNT(*) FROM game_sessions WHERE started_at >= date_trunc('month', now())) AS plays_this_month
  `);

  const { rows: mostPlayed } = await pool.query(`
    SELECT g.id, g.name, g.cover_image_url, COUNT(gs.id) AS play_count
    FROM games g JOIN game_sessions gs ON gs.game_id = g.id
    GROUP BY g.id, g.name, g.cover_image_url
    ORDER BY play_count DESC, g.name ASC
    LIMIT 6
  `);

  const { rows: recentSessions } = await pool.query(`
    WITH totals AS (
      SELECT sp.session_id, sp.player_name,
        COALESCE(SUM(CASE WHEN sc.is_multiplier OR sc.is_award THEN ss.value * sc.multiplier_value ELSE ss.value END), 0) AS total
      FROM session_players sp
      LEFT JOIN session_scores ss ON ss.session_player_id = sp.id
      LEFT JOIN score_categories sc ON sc.id = ss.score_category_id
      GROUP BY sp.session_id, sp.player_name
    ),
    winners AS (
      SELECT DISTINCT ON (session_id) session_id, player_name AS winner_name
      FROM totals ORDER BY session_id, total DESC
    )
    SELECT gs.id, g.name AS game_name, gs.started_at, gs.finished_at, w.winner_name
    FROM game_sessions gs
    JOIN games g ON g.id = gs.game_id
    LEFT JOIN winners w ON w.session_id = gs.id AND gs.finished_at IS NOT NULL
    ORDER BY gs.started_at DESC
    LIMIT 8
  `);

  // Owned games that have never been played at all.
  const { rows: neverPlayed } = await pool.query(`
    SELECT g.id, g.name, g.cover_image_url
    FROM games g
    WHERE g.owned = true AND g.variant_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM game_sessions gs WHERE gs.game_id = g.id)
    ORDER BY g.name ASC
    LIMIT 8
  `);

  // Owned games with a play history, sorted by longest since last played -
  // separate from neverPlayed since "played once years ago" and "never
  // touched" are different nudges.
  const { rows: dueForReplay } = await pool.query(`
    SELECT g.id, g.name, g.cover_image_url, MAX(gs.started_at) AS last_played
    FROM games g JOIN game_sessions gs ON gs.game_id = g.id
    WHERE g.owned = true AND g.variant_of_id IS NULL
    GROUP BY g.id, g.name, g.cover_image_url
    ORDER BY last_played ASC
    LIMIT 6
  `);

  res.render('dashboard', {
    totals: totals[0], mostPlayed, recentSessions, neverPlayed, dueForReplay
  });
}));

module.exports = router;
