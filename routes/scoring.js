const express = require('express');
const router = express.Router();
const pool = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

async function getGameOr404(gameId) {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  return rows[0] || null;
}

// ---- Score category setup (admin) ----

router.get('/games/:id/scoring/edit', requireAuth, asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');
  const { rows: categories } = await pool.query(
    'SELECT * FROM score_categories WHERE game_id = $1 ORDER BY sort_order ASC, id ASC',
    [game.id]
  );
  res.render('scoring-edit', { game, categories });
}));

router.post('/games/:id/scoring/categories', requireAuth, asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');
  const { label, group_label, is_multiplier, multiplier_value } = req.body;
  if (!label || !label.trim()) return res.redirect(`/games/${game.id}/scoring/edit`);

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM score_categories WHERE game_id = $1',
    [game.id]
  );
  const nextSort = maxRows[0].max_sort + 1;

  await pool.query(
    `INSERT INTO score_categories (game_id, group_label, label, is_multiplier, multiplier_value, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      game.id,
      group_label && group_label.trim() ? group_label.trim() : null,
      label.trim(),
      is_multiplier === 'on',
      is_multiplier === 'on' ? (parseFloat(multiplier_value) || 1) : 1,
      nextSort
    ]
  );
  res.redirect(`/games/${game.id}/scoring/edit`);
}));

router.post('/games/:id/scoring/categories/:catId/move', requireAuth, asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');
  const { direction } = req.body; // 'up' | 'down'

  const { rows: categories } = await pool.query(
    'SELECT * FROM score_categories WHERE game_id = $1 ORDER BY sort_order ASC, id ASC',
    [game.id]
  );
  const idx = categories.findIndex(c => c.id === parseInt(req.params.catId, 10));
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;

  if (idx !== -1 && swapWith >= 0 && swapWith < categories.length) {
    const a = categories[idx];
    const b = categories[swapWith];
    await pool.query('UPDATE score_categories SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
    await pool.query('UPDATE score_categories SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  }
  res.redirect(`/games/${game.id}/scoring/edit`);
}));

router.post('/games/:id/scoring/categories/:catId/delete', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM score_categories WHERE id = $1 AND game_id = $2', [req.params.catId, req.params.id]);
  res.redirect(`/games/${req.params.id}/scoring/edit`);
}));

// ---- Starting a new play session ----

router.get('/games/:id/play/new', asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');
  const { rows: categories } = await pool.query(
    'SELECT id FROM score_categories WHERE game_id = $1 LIMIT 1',
    [game.id]
  );
  res.render('play-new', { game, hasCategories: categories.length > 0 });
}));

router.post('/games/:id/play', asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');

  let names = req.body.player_name;
  if (!names) names = [];
  if (!Array.isArray(names)) names = [names];
  names = names.map(n => n.trim()).filter(Boolean);

  if (names.length === 0) return res.redirect(`/games/${game.id}/play/new`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sessionRows } = await client.query(
      'INSERT INTO game_sessions (game_id) VALUES ($1) RETURNING id',
      [game.id]
    );
    const sessionId = sessionRows[0].id;
    for (let i = 0; i < names.length; i++) {
      await client.query(
        'INSERT INTO session_players (session_id, player_name, sort_order) VALUES ($1, $2, $3)',
        [sessionId, names[i], i]
      );
    }
    await client.query('COMMIT');
    res.redirect(`/sessions/${sessionId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---- Live scoresheet ----

async function loadSession(sessionId) {
  const { rows: sessionRows } = await pool.query(
    `SELECT gs.*, g.name AS game_name, g.id AS game_id
     FROM game_sessions gs JOIN games g ON g.id = gs.game_id
     WHERE gs.id = $1`,
    [sessionId]
  );
  const session = sessionRows[0];
  if (!session) return null;

  const { rows: categories } = await pool.query(
    'SELECT * FROM score_categories WHERE game_id = $1 ORDER BY sort_order ASC, id ASC',
    [session.game_id]
  );
  const { rows: players } = await pool.query(
    'SELECT * FROM session_players WHERE session_id = $1 ORDER BY sort_order ASC, id ASC',
    [sessionId]
  );
  const { rows: scores } = await pool.query(
    `SELECT ss.* FROM session_scores ss
     JOIN session_players sp ON sp.id = ss.session_player_id
     WHERE sp.session_id = $1`,
    [sessionId]
  );

  const scoreMap = {}; // player_id -> category_id -> value
  scores.forEach(s => {
    if (!scoreMap[s.session_player_id]) scoreMap[s.session_player_id] = {};
    scoreMap[s.session_player_id][s.score_category_id] = parseFloat(s.value);
  });

  players.forEach(p => {
    p.total = 0;
    categories.forEach(c => {
      const raw = (scoreMap[p.id] && scoreMap[p.id][c.id]) || 0;
      const pts = c.is_multiplier ? raw * parseFloat(c.multiplier_value) : raw;
      p.total += pts;
    });
  });

  return { session, categories, players, scoreMap };
}

router.get('/sessions/:id', asyncHandler(async (req, res) => {
  const data = await loadSession(req.params.id);
  if (!data) return res.status(404).send('Session not found');
  res.render('session-scoresheet', data);
}));

router.post('/sessions/:id/scores', asyncHandler(async (req, res) => {
  const { session_player_id, score_category_id, value } = req.body;
  const numeric = parseFloat(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;

  await pool.query(
    `INSERT INTO session_scores (session_player_id, score_category_id, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_player_id, score_category_id)
     DO UPDATE SET value = EXCLUDED.value`,
    [session_player_id, score_category_id, safeValue]
  );

  // Return the updated totals so the client can refresh without a full reload.
  const { rows: catRows } = await pool.query('SELECT * FROM score_categories WHERE id = $1', [score_category_id]);
  res.json({ ok: true, category: catRows[0] });
}));

router.post('/sessions/:id/players', asyncHandler(async (req, res) => {
  const { player_name } = req.body;
  if (!player_name || !player_name.trim()) return res.redirect(`/sessions/${req.params.id}`);

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM session_players WHERE session_id = $1',
    [req.params.id]
  );
  await pool.query(
    'INSERT INTO session_players (session_id, player_name, sort_order) VALUES ($1, $2, $3)',
    [req.params.id, player_name.trim(), maxRows[0].max_sort + 1]
  );
  res.redirect(`/sessions/${req.params.id}`);
}));

router.post('/sessions/:id/finish', asyncHandler(async (req, res) => {
  await pool.query('UPDATE game_sessions SET finished_at = now() WHERE id = $1', [req.params.id]);
  res.redirect(`/sessions/${req.params.id}`);
}));

router.post('/sessions/:id/reopen', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('UPDATE game_sessions SET finished_at = NULL WHERE id = $1', [req.params.id]);
  res.redirect(`/sessions/${req.params.id}`);
}));

router.post('/sessions/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT game_id FROM game_sessions WHERE id = $1', [req.params.id]);
  const gameId = rows[0] && rows[0].game_id;
  await pool.query('DELETE FROM game_sessions WHERE id = $1', [req.params.id]);
  res.redirect(gameId ? `/games/${gameId}/sessions` : '/games');
}));

// ---- History ----

router.get('/games/:id/sessions', asyncHandler(async (req, res) => {
  const game = await getGameOr404(req.params.id);
  if (!game) return res.status(404).send('Game not found');

  const { rows: sessions } = await pool.query(
    `SELECT gs.id, gs.started_at, gs.finished_at
     FROM game_sessions gs WHERE gs.game_id = $1
     ORDER BY gs.started_at DESC`,
    [game.id]
  );

  for (const s of sessions) {
    const { rows: players } = await pool.query(
      `SELECT sp.id, sp.player_name,
        COALESCE(SUM(CASE WHEN sc.is_multiplier THEN ss.value * sc.multiplier_value ELSE ss.value END), 0) AS total
       FROM session_players sp
       LEFT JOIN session_scores ss ON ss.session_player_id = sp.id
       LEFT JOIN score_categories sc ON sc.id = ss.score_category_id
       WHERE sp.session_id = $1
       GROUP BY sp.id, sp.player_name
       ORDER BY total DESC, sp.sort_order ASC`,
      [s.id]
    );
    s.players = players;
    s.winner = players[0];
  }

  res.render('game-sessions', { game, sessions });
}));

module.exports = router;
