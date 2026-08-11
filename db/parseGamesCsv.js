/**
 * Minimal dependency-free CSV parser, good enough for a games import file
 * (handles quoted fields, embedded commas, embedded quotes via "").
 * Not a full RFC4180 implementation, but covers what a spreadsheet export
 * (Google Sheets/Excel "CSV" save) produces.
 */
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
  'play_time_minutes', 'cover_image_url', 'notes'
];

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
      errors
    };
  });

  return { headers: headerRow, games, headerError: null };
}

const CSV_TEMPLATE = `name,publisher,genre,min_players,max_players,play_time_minutes,cover_image_url,notes
Catan,Kosmos,Strategy,3,4,90,https://example.com/catan.jpg,Base game plus Seafarers expansion
Dominion,Rio Grande Games,Deck Building,2,4,45,,
Ticket to Ride,Days of Wonder,Family,2,5,60,,
`;

module.exports = { parseCsvText, parseGamesCsv, EXPECTED_HEADERS, CSV_TEMPLATE };
