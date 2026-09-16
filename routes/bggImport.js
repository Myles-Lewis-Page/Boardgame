const express = require('express');
const router = express.Router();
const { XMLParser } = require('fast-xml-parser');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const BGG_BASE = 'https://boardgamegeek.com/xmlapi2';
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// All BGG XML API requests must carry the registered app token as of BGG's
// 2025 API policy change - unauthenticated requests get a flat 401.
function bggHeaders() {
  const token = process.env.BGG_APP_TOKEN;
  if (!token) {
    const err = new Error('BGG_APP_TOKEN is not set - register an app token at boardgamegeek.com and add it to the environment.');
    err.status = 500;
    throw err;
  }
  return { Authorization: `Bearer ${token}` };
}

// Accepts a bare numeric id ("13") or a full BGG URL
// (https://boardgamegeek.com/boardgame/13/catan) and returns just the id.
function extractBggId(input) {
  const trimmed = (input || '').trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/boardgamegeek\.com\/boardgame(?:expansion)?\/(\d+)/);
  return match ? match[1] : null;
}

// Normalizes the various shapes fast-xml-parser can hand back for a
// possibly-repeated element (BGG's search results and item.name in
// particular) into a plain array.
function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// BGG XML API search: GET /games/bgg-search?q=<name>
// Returns a JSON list of candidate matches for the client to render and
// let the user click through to bgg-details.
router.get('/games/bgg-search', requireAuth, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const url = `${BGG_BASE}/search?query=${encodeURIComponent(q)}&type=boardgame`;
  const response = await fetch(url, { headers: bggHeaders() });
  if (!response.ok) {
    return res.status(response.status).json({ error: `BGG search failed (${response.status})` });
  }
  const xml = await response.text();
  const parsed = xmlParser.parse(xml);

  const items = toArray(parsed?.items?.item);
  const results = items.map(item => ({
    id: item['@_id'],
    name: toArray(item.name).find(n => n['@_type'] === 'primary')?.['@_value']
      || toArray(item.name)[0]?.['@_value']
      || 'Unknown',
    year: item.yearpublished?.['@_value'] || null
  }));

  res.json({ results });
}));

// BGG XML API thing details: GET /games/bgg-details/:id
// :id can be a bare BGG id or a full BGG game URL (pasted directly).
// Returns fields pre-mapped to the games table's columns so the frontend
// can drop the response straight into the add-game form.
router.get('/games/bgg-details/:id', requireAuth, asyncHandler(async (req, res) => {
  const bggId = extractBggId(req.params.id);
  if (!bggId) {
    return res.status(400).json({ error: 'Could not find a BGG id in that input.' });
  }

  const url = `${BGG_BASE}/thing?id=${bggId}&stats=1`;
  const response = await fetch(url, { headers: bggHeaders() });
  if (!response.ok) {
    return res.status(response.status).json({ error: `BGG lookup failed (${response.status})` });
  }
  const xml = await response.text();
  const parsed = xmlParser.parse(xml);
  const item = parsed?.items?.item;
  if (!item) {
    return res.status(404).json({ error: 'No BGG game found for that id.' });
  }

  const names = toArray(item.name);
  const primaryName = names.find(n => n['@_type'] === 'primary')?.['@_value'] || names[0]?.['@_value'] || '';

  const publishers = toArray(item.link).filter(l => l['@_type'] === 'boardgamepublisher');
  const categories = toArray(item.link).filter(l => l['@_type'] === 'boardgamecategory');

  // Description comes back as HTML-entity-encoded text with literal
  // "&#10;" line breaks - strip tags/entities down to plain text for the
  // notes field rather than dumping raw BGG markup into the form.
  const rawDescription = item.description || '';
  const notes = rawDescription
    .replace(/&#10;/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&#39;/g, "'")
    .trim();

  res.json({
    bgg_id: bggId,
    name: primaryName,
    publisher: publishers[0]?.['@_value'] || null,
    genre: categories[0]?.['@_value'] || null,
    min_players: item.minplayers?.['@_value'] ? parseInt(item.minplayers['@_value'], 10) : null,
    max_players: item.maxplayers?.['@_value'] ? parseInt(item.maxplayers['@_value'], 10) : null,
    play_time_minutes: item.playingtime?.['@_value'] ? parseInt(item.playingtime['@_value'], 10) : null,
    cover_image_url: item.image || null,
    notes
  });
}));

module.exports = router;
