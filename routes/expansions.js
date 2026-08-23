const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Kept as a fallback for any old bookmarked/shared links to a standalone
// expansion page - expansion management now lives inline on the game page's
// Expansions tab, so this just forwards there.
router.get('/games/:gameId/expansions/:expId', (req, res) => {
  res.redirect(`/games/${req.params.gameId}#tab-expansions`);
});

router.get('/games/:gameId/expansions/new', (req, res) => {
  res.redirect(`/games/${req.params.gameId}#tab-expansions`);
});

// Create expansion (requires login) - the form for this now lives inline in
// the Expansions tab on the game page itself. owned defaults to true when
// the field is missing entirely (e.g. old bookmarked form submissions);
// the checkbox itself defaults checked in the UI, same as the Games form.
router.post('/games/:gameId/expansions', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned } = req.body;
  const isOwned = owned === undefined ? true : !!owned;
  await pool.query(
    `INSERT INTO expansions (game_id, name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [gameId, name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, isOwned]
  );
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Edit expansion info (requires login) - submitted from an inline edit form
// on the game page, same pattern as editing the base game's own info.
router.post('/expansions/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { gameId, name, min_players, max_players, play_time_minutes, cover_image_url, notes, owned } = req.body;
  await pool.query(
    `UPDATE expansions SET name=$1, min_players=$2, max_players=$3, play_time_minutes=$4, cover_image_url=$5, notes=$6, owned=$7 WHERE id=$8`,
    [name, min_players || null, max_players || null, play_time_minutes || null, cover_image_url || null, notes || null, !!owned, id]
  );
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Quick "mark owned" action from the wishlist - just flips the flag, same
// as the equivalent route on games.
router.post('/expansions/:id/mark-owned', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('UPDATE expansions SET owned = true WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-expansions`);
});

// Delete expansion (requires login)
router.post('/expansions/:id/delete', requireAuth, async (req, res) => {
  const { gameId } = req.body;
  await pool.query('DELETE FROM expansions WHERE id = $1', [req.params.id]);
  res.redirect(`/games/${gameId}#tab-expansions`);
});

module.exports = router;
