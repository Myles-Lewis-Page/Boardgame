const pool = require('./index');

/**
 * One-off seed: builds the scoresheet (score_categories rows) for Wingspan
 * and Catan, matching each game's real scoring breakdown. Safe to re-run -
 * skips any game that already has categories set up, so it won't duplicate
 * rows or clobber anything you've customized by hand.
 *
 * Run once with: node db/seedScoreCategories.js
 */

const WINGSPAN_CATEGORIES = [
  // group_label, label, is_multiplier, multiplier_value
  [null, 'Birds', false, 1],
  [null, 'Bonus cards', false, 1],
  [null, 'End-of-round goals', false, 1],
  ['1 point each', 'Eggs', true, 1],
  ['1 point each', 'Food on cards', true, 1],
  ['1 point each', 'Tucked cards', true, 1],
  // Nectar (Oceania expansion) doesn't score at a flat rate - leave it as
  // direct entry and do the ratio math yourself when you fill it in.
  ['Nectar', 'Nectar', false, 1],
];

const CATAN_CATEGORIES = [
  // group_label, label, is_multiplier, multiplier_value, is_award
  ['Settlements & cities', 'Settlements', true, 1, false],
  ['Settlements & cities', 'Cities', true, 2, false],
  ['Bonuses', 'Longest Road', false, 2, true],
  ['Bonuses', 'Largest Army', false, 2, true],
  ['Development cards', 'Victory point cards', true, 1, false],
];

async function seedGameCategories(client, gameName, categories) {
  const { rows: gameRows } = await client.query(
    'SELECT id FROM games WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [gameName]
  );
  if (!gameRows.length) {
    console.log(`Skipped "${gameName}": no game with that name in your library.`);
    return;
  }
  const gameId = gameRows[0].id;

  const { rows: existing } = await client.query(
    'SELECT id FROM score_categories WHERE game_id = $1 LIMIT 1',
    [gameId]
  );
  if (existing.length) {
    console.log(`Skipped "${gameName}": already has scoring categories set up.`);
    return;
  }

  for (let i = 0; i < categories.length; i++) {
    const [groupLabel, label, isMultiplier, multiplierValue, isAward] = categories[i];
    await client.query(
      `INSERT INTO score_categories (game_id, group_label, label, is_multiplier, multiplier_value, is_award, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [gameId, groupLabel, label, isMultiplier, multiplierValue, !!isAward, i]
    );
  }
  console.log(`Seeded ${categories.length} scoring rows for "${gameName}".`);
}

async function main() {
  const client = await pool.connect();
  try {
    await seedGameCategories(client, 'Wingspan', WINGSPAN_CATEGORIES);
    await seedGameCategories(client, 'Catan', CATAN_CATEGORIES);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
