-- Seeds the scoresheet (score_categories) for Wingspan and Catan.
-- Safe to run more than once: each game is skipped if it already has any
-- scoring categories, so this won't duplicate rows or touch anything
-- you've already customized by hand.
--
-- Run it directly against your database, e.g.:
--   psql "$DATABASE_URL" -f db/seedScoreCategories.sql
-- or paste the contents into Railway's Postgres query console.

-- ---- Wingspan ----
INSERT INTO score_categories (game_id, group_label, label, is_multiplier, multiplier_value, sort_order)
SELECT g.id, v.group_label, v.label, v.is_multiplier, v.multiplier_value, v.sort_order
FROM games g
JOIN (VALUES
  (NULL,              'Birds',                false, 1, 0),
  (NULL,              'Bonus cards',           false, 1, 1),
  (NULL,              'End-of-round goals',    false, 1, 2),
  ('1 point each',    'Eggs',                  true,  1, 3),
  ('1 point each',    'Food on cards',         true,  1, 4),
  ('1 point each',    'Tucked cards',          true,  1, 5),
  ('Nectar',          'Nectar',                false, 1, 6)
) AS v(group_label, label, is_multiplier, multiplier_value, sort_order)
  ON TRUE
WHERE LOWER(g.name) = LOWER('Wingspan')
  AND NOT EXISTS (SELECT 1 FROM score_categories sc WHERE sc.game_id = g.id);

-- ---- Catan ----
INSERT INTO score_categories (game_id, group_label, label, is_multiplier, multiplier_value, sort_order)
SELECT g.id, v.group_label, v.label, v.is_multiplier, v.multiplier_value, v.sort_order
FROM games g
JOIN (VALUES
  ('Settlements & cities', 'Settlements',         true,  1, 0),
  ('Settlements & cities', 'Cities',              true,  2, 1),
  ('Bonuses',              'Longest Road',        false, 1, 2),
  ('Bonuses',              'Largest Army',        false, 1, 3),
  ('Development cards',    'Victory point cards', true,  1, 4)
) AS v(group_label, label, is_multiplier, multiplier_value, sort_order)
  ON TRUE
WHERE LOWER(g.name) = LOWER('Catan')
  AND NOT EXISTS (SELECT 1 FROM score_categories sc WHERE sc.game_id = g.id);
