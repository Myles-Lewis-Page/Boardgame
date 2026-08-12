const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseCsvText } = require('../db/parseGamesCsv');

const TEMPLATE = `game_name,variant_of
Red Wingopoly,Monopoly: Here and Now
`;

function parseLinkCsv(rawText) {
  const rows = parseCsvText(rawText || '');
  if (rows.length === 0) return { entries: [], headerError: 'The file appears to be empty.' };

  const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = headerRow.indexOf('game_name');
  const targetIdx = headerRow.indexOf('variant_of');
  if (nameIdx === -1 || targetIdx === -1) {
    return { entries: [], headerError: `Expected columns "game_name" and "variant_of". Found: ${headerRow.join(', ') || '(none)'}.` };
  }

  const entries = rows.slice(1).map((r, idx) => ({
    row_number: idx + 2,
    game_name: (r[nameIdx] || '').trim(),
    variant_of: (r[targetIdx] || '').trim()
  })).filter(e => e.game_name && e.variant_of);

  return { entries, headerError: null };
}

router.get('/games/link-variants/template', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="link-variants-template.csv"');
  res.send(TEMPLATE);
});

router.get('/games/link-variants', requireAuth, (req, res) => {
  res.render('link-variants', {});
});

router.post('/games/link-variants/preview', requireAuth, async (req, res) => {
  const { rawCsv } = req.body;
  const { entries, headerError } = parseLinkCsv(rawCsv || '');
  if (headerError) return res.render('link-variants-preview', { rows: [], headerError });

  const { rows: allGames } = await pool.query('SELECT id, name, variant_of_id FROM games');
  const byName = new Map(allGames.map(g => [g.name.trim().toLowerCase(), g]));
  const byId = new Map(allGames.map(g => [g.id, g]));

  const rows = entries.map(e => {
    const game = byName.get(e.game_name.toLowerCase());
    const target = byName.get(e.variant_of.toLowerCase());
    const currentTarget = game && game.variant_of_id ? byId.get(game.variant_of_id) : null;
    const found = !!(game && target && game.id !== target.id);

    return {
      row_number: e.row_number,
      game_name: e.game_name,
      variant_of: e.variant_of,
      gameId: game ? game.id : null,
      targetId: target ? target.id : null,
      currentTargetName: currentTarget ? currentTarget.name : null,
      found,
      notFoundReason: !game ? `no game named "${e.game_name}"` : !target ? `no game named "${e.variant_of}"` : 'a game can\'t be a variation of itself'
    };
  });

  res.render('link-variants-preview', { rows, headerError: null });
});

router.post('/games/link-variants/save', requireAuth, async (req, res) => {
  let { game_name, gameId, targetId, include } = req.body;
  const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  game_name = toArray(game_name);
  gameId = toArray(gameId);
  targetId = toArray(targetId);
  const includeSet = new Set(toArray(include));

  const client = await pool.connect();
  let updatedCount = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < game_name.length; i++) {
      if (!includeSet.has(String(i))) continue;
      if (!gameId[i] || !targetId[i]) continue;
      await client.query('UPDATE games SET variant_of_id = $1 WHERE id = $2', [targetId[i], gameId[i]]);
      updatedCount++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.render('link-variants-done', { updatedCount });
});

module.exports = router;
