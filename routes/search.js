const express = require('express');
const router = express.Router();
const pool = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.render('search-results', { q: '', games: [], expansions: [], sections: [], houseRules: [] });

  const like = `%${q}%`;

  const { rows: games } = await pool.query(
    `SELECT id, name, owned, genre, publisher
     FROM games
     WHERE variant_of_id IS NULL AND (name ILIKE $1 OR publisher ILIKE $1 OR genre ILIKE $1 OR notes ILIKE $1)
     ORDER BY name ASC LIMIT 20`,
    [like]
  );

  const { rows: expansions } = await pool.query(
    `SELECT e.id, e.name, e.owned, e.game_id, g.name AS game_name
     FROM expansions e JOIN games g ON g.id = e.game_id
     WHERE e.name ILIKE $1 OR e.notes ILIKE $1
     ORDER BY e.name ASC LIMIT 20`,
    [like]
  );

  const { rows: sections } = await pool.query(
    `SELECT s.id, s.title, s.body, s.game_id, s.expansion_id,
       g.name AS game_name, e.name AS expansion_name
     FROM base_rule_sections s
     JOIN games g ON g.id = s.game_id
     LEFT JOIN expansions e ON e.id = s.expansion_id
     WHERE s.title ILIKE $1 OR s.body ILIKE $1
     ORDER BY s.title ASC LIMIT 25`,
    [like]
  );

  const { rows: houseRules } = await pool.query(
    `SELECT h.id, h.title, h.body, h.game_id, h.expansion_id, h.is_active,
       g.name AS game_name, e.name AS expansion_name
     FROM house_rules h
     JOIN games g ON g.id = h.game_id
     LEFT JOIN expansions e ON e.id = h.expansion_id
     WHERE h.title ILIKE $1 OR h.body ILIKE $1
     ORDER BY h.title ASC LIMIT 25`,
    [like]
  );

  // Short excerpt around the match for rule sections/house rules, so
  // results give a preview instead of just a title.
  function excerpt(text) {
    if (!text) return '';
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.slice(0, 140) + (text.length > 140 ? '...' : '');
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + q.length + 60);
    return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  }
  sections.forEach(s => { s.excerpt = excerpt(s.body); });
  houseRules.forEach(h => { h.excerpt = excerpt(h.body); });

  res.render('search-results', { q, games, expansions, sections, houseRules });
}));

module.exports = router;
