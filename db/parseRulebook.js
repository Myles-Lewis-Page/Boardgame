/**
 * Naive but effective rulebook-text splitter.
 * Splits pasted rulebook text into { title, body } sections based on
 * heading-like lines: short lines that are ALL CAPS, numbered ("1. Setup",
 * "III. Combat"), or end without punctuation and are followed by a blank line.
 *
 * This isn't AI parsing (no external API calls) - it's a heuristic so the
 * app works offline/free on Railway. Every section is fully editable after
 * import, so a rough split is fine.
 */
function isHeadingLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 60) return false; // headings are short

  const numbered = /^(\d+[\.\)]|[IVXLC]+[\.\)])\s+\S/.test(trimmed);
  const allCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/[a-z]/.test(trimmed);
  const titleCaseShort = /^[A-Z][A-Za-z0-9\s'\-:]{2,50}$/.test(trimmed) &&
    trimmed.split(' ').length <= 6 &&
    !trimmed.endsWith('.') && !trimmed.endsWith(',');

  return numbered || allCaps || titleCaseShort;
}

function parseRulebook(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (isHeadingLine(line) && line.trim().length > 0) {
      // Only treat as a new heading if the next non-empty context suggests body text follows,
      // or if we don't have a current section yet.
      if (current && current.body.trim().length === 0) {
        // previous heading had no body yet; replace title (avoid empty sections)
        current.title = line.trim();
        continue;
      }
      current = { title: line.trim(), body: '' };
      sections.push(current);
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      // Text before the first detected heading - bucket it under "Introduction"
      current = { title: 'Introduction', body: line };
      sections.push(current);
    }
  }

  return sections
    .map(s => ({ title: s.title, body: s.body.trim() }))
    .filter(s => s.body.length > 0)
    .map((s, i) => ({ ...s, sort_order: i }));
}

module.exports = { parseRulebook };
