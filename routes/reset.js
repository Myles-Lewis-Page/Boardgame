const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Confirmation page - deliberately not a one-click action
router.get('/admin/reset', requireAuth, (req, res) => {
  res.render('admin-reset', {});
});

// Wipes every game, expansion, rule section, house rule, wishlist entry,
// and both category trees. Table structure is untouched - this only clears
// data, so the app keeps working normally afterward, just empty.
router.post('/admin/reset', requireAuth, async (req, res) => {
  const { confirm_text } = req.body;
  if (confirm_text !== 'DELETE EVERYTHING') {
    return res.render('admin-reset', { error: 'Type exactly "DELETE EVERYTHING" (all caps) to confirm.' });
  }

  await pool.query('TRUNCATE TABLE games, wishlist_games, categories RESTART IDENTITY CASCADE');

  res.render('admin-reset-done', {});
});

module.exports = router;
