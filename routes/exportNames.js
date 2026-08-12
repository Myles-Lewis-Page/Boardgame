const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Plain-text export of every exact stored name (games, expansions with
// their parent, wishlist entries) - useful for debugging CSV name mismatches
// without needing direct database access.
router.get('/admin/export-names', requireAuth, async (req, res) => {
  const { rows: games } = await pool.query('SELECT id, name FROM games ORDER BY name ASC');
  const { rows: expansions } = await pool.query(
    `SELECT e.name, g.name AS game_name FROM expansions e JOIN games g ON g.id = e.game_id ORDER BY g.name ASC, e.name ASC`
  );
  const { rows: wishlist } = await pool.query('SELECT id, name FROM wishlist_games ORDER BY name ASC');

  const lines = [];
  lines.push('=== GAMES (' + games.length + ') ===');
  games.forEach(g => lines.push(g.name));
  lines.push('');
  lines.push('=== EXPANSIONS (' + expansions.length + ') ===');
  expansions.forEach(e => lines.push(e.game_name + ' -> ' + e.name));
  lines.push('');
  lines.push('=== WISHLIST (' + wishlist.length + ') ===');
  wishlist.forEach(w => lines.push(w.name));

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="library-names-export.txt"');
  res.send(lines.join('\n'));
});

module.exports = router;
