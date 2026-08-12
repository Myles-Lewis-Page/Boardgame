/**
 * Minimal dependency-free CSV parser, good enough for a games import file
 * (handles quoted fields, embedded commas, embedded quotes via "", and
 * multi-line quoted fields for the rules_text column).
 * Not a full RFC4180 implementation, but covers what a spreadsheet export
 * (Google Sheets/Excel "CSV" save) produces.
 */
const { parseRulebook } = require('./parseRulebook');

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

const EXPECTED_HEADERS = [
  'name', 'publisher', 'genre', 'min_players', 'max_players',
  'play_time_minutes', 'cover_image_url', 'notes', 'rules_text', 'expansion_of', 'category_path', 'rule_categories', 'owned'
];

/**
 * Parses a rule_categories cell into a Map of SECTION TITLE (uppercased) ->
 * category path string. Format is one "Title=Path" pair per line, e.g.:
 *   SETUP=Setup
 *   DEVELOPMENT CARDS=Gameplay > Development Cards
 * Titles are matched case-insensitively against the section titles produced
 * by parseRulebook() on the same row's rules_text.
 */
function parseRuleCategoriesMapping(text) {
  const map = new Map();
  if (!text) return map;
  text.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const title = line.slice(0, idx).trim();
    const path = line.slice(idx + 1).trim();
    if (title && path) map.set(title.toUpperCase(), path);
  });
  return map;
}

/**
 * Parses raw CSV text into an array of game row objects plus per-row
 * validation errors, matched against EXPECTED_HEADERS. Headers can be in
 * any order and unknown columns are ignored; missing optional columns are
 * just left blank.
 */
function parseGamesCsv(rawText) {
  const rows = parseCsvText(rawText || '');
  if (rows.length === 0) {
    return { headers: [], games: [], headerError: 'The file appears to be empty.' };
  }

  const headerRow = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!headerRow.includes('name')) {
    return {
      headers: headerRow,
      games: [],
      headerError: `Couldn't find a "name" column. Found columns: ${headerRow.join(', ') || '(none)'}.`
    };
  }

  const games = rows.slice(1).map((r, idx) => {
    const raw = {};
    headerRow.forEach((h, i) => { raw[h] = (r[i] || '').trim(); });

    const errors = [];
    if (!raw.name) errors.push('missing name');

    const toIntOrNull = (val, label) => {
      if (!val) return null;
      const n = parseInt(val, 10);
      if (Number.isNaN(n)) { errors.push(`"${label}" isn't a number (${val})`); return null; }
      return n;
    };

    return {
      row_number: idx + 2, // +2: 1-indexed, plus header row
      name: raw.name || '',
      publisher: raw.publisher || '',
      genre: raw.genre || '',
      min_players: toIntOrNull(raw.min_players, 'min_players'),
      max_players: toIntOrNull(raw.max_players, 'max_players'),
      play_time_minutes: toIntOrNull(raw.play_time_minutes, 'play_time_minutes'),
      cover_image_url: raw.cover_image_url || '',
      notes: raw.notes || '',
      rules_text: raw.rules_text || '',
      detected_section_count: raw.rules_text ? parseRulebook(raw.rules_text).length : 0,
      expansion_of: raw.expansion_of || '',
      category_path: raw.category_path || '',
      rule_categories: raw.rule_categories || '',
      // Blank/missing = owned (true) by default; only an explicit false-like
      // value opts a row into the wishlist instead.
      owned: !['false', 'no', '0', 'wishlist'].includes((raw.owned || '').trim().toLowerCase()),
      errors
    };
  });

  return { headers: headerRow, games, headerError: null };
}

const CSV_TEMPLATE = `name,publisher,genre,min_players,max_players,play_time_minutes,cover_image_url,notes,rules_text,expansion_of,category_path,rule_categories,owned
Catan,Kosmos,Strategy,3,4,90,,Base game plus Seafarers expansion,"SETUP
Place the board in the middle of the table. Give each player 2 wood and 2 brick.

BUILDING ROADS
Roads cost 1 wood and 1 brick. You must connect to an existing road or settlement.

TRADING
You may trade with other players or the bank at a 4:1 ratio.",,Strategy > Settlement Building,"SETUP=Setup
BUILDING ROADS=Gameplay
TRADING=Gameplay",true
Catan: Seafarers,Kosmos,Strategy,3,4,90,,Adds ships and islands,,Catan,Strategy > Settlement Building,,true
Dominion,Rio Grande Games,Deck Building,2,4,45,,,,,Strategy > Deck Building,,true
Root,Leder Games,Strategy,2,4,90,,Don't own it yet,,,Strategy > Area Control & War,,false
`;

module.exports = { parseCsvText, parseGamesCsv, EXPECTED_HEADERS, CSV_TEMPLATE, parseRuleCategoriesMapping };
