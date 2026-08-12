const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseCsvText } = require('../db/parseGamesCsv');

const TEMPLATE = `game_name,cover_image_url
Catan,https://example.com/catan-box-art.jpg
Ticket to Ride,https://example.com/ttr-box-art.jpg
`;

function parseBoxArtCsv(rawText) {
  const rows = parseCsvText(rawText || '');
  if (rows.length === 0) return { entries: [], headerError: 'The file appears to be empty.' };

  const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = headerRow.indexOf('game_name');
  const urlIdx = headerRow.indexOf('cover_image_url');
  if (nameIdx === -1 || urlIdx === -1) {
    return { entries: [], headerError: `Expected columns "game_name" and "cover_image_url". Found: ${headerRow.join(', ') || '(none)'}.` };
  }

  const entries = rows.slice(1).map((r, idx) => ({
    row_number: idx + 2,
    game_name: (r[nameIdx] || '').trim(),
    cover_image_url: (r[urlIdx] || '').trim()
  })).filter(e => e.game_name);

  return { entries, headerError: null };
}

router.get('/games/update-box-art/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="box-art-template.csv"');
  res.send(TEMPLATE);
});

router.get('/games/update-box-art', requireAuth, (req, res) => {
  res.render('update-box-art', {});
});

// Preview: match each row against games AND expansions (case-insensitive
// exact name), so one file can set art for both at once.
router.post('/games/update-box-art/preview', requireAuth, async (req, res) => {
  const { rawCsv } = req.body;
  const { entries, headerError } = parseBoxArtCsv(rawCsv || '');
  if (headerError) return res.render('update-box-art-preview', { rows: [], headerError });

  const { rows: allGames } = await pool.query('SELECT id, name, cover_image_url FROM games');
  const { rows: allExpansions } = await pool.query('SELECT id, name, cover_image_url FROM expansions');
  const gameByName = new Map(allGames.map(g => [g.name.trim().toLowerCase(), g]));
  const expByName = new Map(allExpansions.map(e => [e.name.trim().toLowerCase(), e]));

  const rows = entries.map(e => {
    const key = e.game_name.toLowerCase();
    const game = gameByName.get(key);
    const exp = !game ? expByName.get(key) : null;
    const match = game ? { type: 'game', id: game.id, currentUrl: game.cover_image_url }
      : exp ? { type: 'expansion', id: exp.id, currentUrl: exp.cover_image_url }
      : null;

    return {
      row_number: e.row_number,
      game_name: e.game_name,
      cover_image_url: e.cover_image_url,
      matchType: match ? match.type : null,
      matchId: match ? match.id : null,
      currentUrl: match ? match.currentUrl : null,
      found: !!match
    };
  });

  res.render('update-box-art-preview', { rows, headerError: null });
});

router.post('/games/update-box-art/save', requireAuth, async (req, res) => {
  let { game_name, cover_image_url, match_type, match_id, include } = req.body;
  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  game_name = toArray(game_name);
  cover_image_url = toArray(cover_image_url);
  match_type = toArray(match_type);
  match_id = toArray(match_id);
  const includeSet = new Set(toArray(include));

  const TABLE_BY_TYPE = { game: 'games', expansion: 'expansions' };

  const client = await pool.connect();
  let updatedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < game_name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!match_type[i] || !match_id[i]) continue;
      if (!cover_image_url[i] || !cover_image_url[i].trim()) continue;

      const table = TABLE_BY_TYPE[match_type[i]];
      if (!table) continue;
      await client.query(`UPDATE ${table} SET cover_image_url = $1 WHERE id = $2`, [cover_image_url[i].trim(), match_id[i]]);
      updatedCount++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('update-box-art-done', { updatedCount });
});

module.exports = router;
