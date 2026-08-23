const express = require('express');
const router = express.Router();
const pool = require('../db');
const { pathForCategoryId } = require('../db/categoryTree');
const { asyncHandler } = require('../middleware/asyncHandler');

// Wishlist is now just games with owned = false, so this whole file is a
// thin read-only view over the games table plus a couple of redirects -
// there's no separate table, import flow, or "convert" step anymore.

router.get('/wishlist', asyncHandler(async (req, res) => {
  const { rows: wishlistGames } = await pool.query(
    `SELECT g.*, COALESCE(exp_counts.expansion_count, 0) AS expansion_count
     FROM games g
     LEFT JOIN (SELECT game_id, COUNT(*) AS expansion_count FROM expansions GROUP BY game_id) exp_counts
       ON exp_counts.game_id = g.id
     WHERE g.owned = false AND g.variant_of_id IS NULL
     ORDER BY g.name ASC`
  );
  const { rows: allCategories } = await pool.query('SELECT * FROM categories');
  const withPaths = wishlistGames.map(g => ({ ...g, category_path: pathForCategoryId(g.category_id, allCategories) }));

  // Wishlist expansions - unowned expansions of a game you (usually) already
  // own, so they're kept separate from the game-wishlist grid above.
  const { rows: wishlistExpansions } = await pool.query(
    `SELECT e.*, g.name AS game_name
     FROM expansions e JOIN games g ON g.id = e.game_id
     WHERE e.owned = false
     ORDER BY g.name ASC, e.name ASC`
  );

  res.render('wishlist-index', { wishlistGames: withPaths, wishlistExpansions });
}));

// Adding/viewing a wishlist entry is the same form/page as any other game -
// these just forward there. "/games/new" already has an Owned checkbox.
router.get('/wishlist/new', (req, res) => res.redirect('/games/new?owned=false'));
router.get('/wishlist/:id', (req, res) => res.redirect(`/games/${req.params.id}`));

module.exports = router;
