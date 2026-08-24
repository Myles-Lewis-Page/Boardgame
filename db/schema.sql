CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT,
  genre TEXT,
  min_players INTEGER,
  max_players INTEGER,
  play_time_minutes INTEGER,
  cover_image_url TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Upgrade path for databases created before genre/play_time_minutes/cover_image_url existed.
ALTER TABLE games ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS play_time_minutes INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- "owned" replaces the separate wishlist_games table: a game you don't own
-- yet is just a row here with owned = false. Marking it owned is a single
-- column flip instead of copying data between tables.
ALTER TABLE games ADD COLUMN IF NOT EXISTS owned BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_games_owned ON games(owned);

-- Variations: a different theme/reskin of the same underlying game (e.g.
-- Monopoly: Here and Now and Red Wingopoly are both just Monopoly with
-- different property names). This is deliberately separate from
-- expansions - a variation is its own full top-level game (own box art,
-- own owned/wishlist status, own rules if they differ), just tagged as
-- being the same ruleset as another game rather than adding to it.
ALTER TABLE games ADD COLUMN IF NOT EXISTS variant_of_id INTEGER REFERENCES games(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_games_variant_of ON games(variant_of_id);

-- Cheat sheet: a short, hand-curated summary (not auto-extracted from the
-- rulebook, since that's rarely concise) for a quick glance mid-game.
-- One per game - deliberately not per-expansion, since a cheat sheet is
-- about how to actually play, which usually doesn't change per expansion.
ALTER TABLE games ADD COLUMN IF NOT EXISTS cheat_turn_order TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS cheat_scoring TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS cheat_win_condition TEXT;

-- Cheat sheet entries: each category (turn order / scoring / win
-- condition) can have multiple entries, not just one - e.g. Root needs a
-- separate Turn Order card per faction, since each plays completely
-- differently. `label` is the card title (e.g. "Eyrie Dynasties");
-- `body` is plain written content, filled in from the game's actual rules
-- when the cheat sheet is built, not linked live to a rule_section row.
CREATE TABLE IF NOT EXISTS cheat_sheet_entries (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('turn_order', 'scoring', 'win_condition')),
  label TEXT,
  body TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cheat_sheet_entries_game ON cheat_sheet_entries(game_id);

-- Expansions: each belongs to a parent game. Their rules (base + house)
-- live in the same tables as the parent game's rules, scoped by expansion_id.
CREATE TABLE IF NOT EXISTS expansions (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_players INTEGER,
  max_players INTEGER,
  play_time_minutes INTEGER,
  cover_image_url TEXT,
  notes TEXT,
  owned BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expansions_game ON expansions(game_id);
-- Lets an expansion sit on the wishlist (owned = false) the same way a game
-- can - existing rows default to true so nothing already in your library
-- gets silently moved to the wishlist by this migration.
ALTER TABLE expansions ADD COLUMN IF NOT EXISTS owned BOOLEAN NOT NULL DEFAULT true;

-- Base rules: sections parsed/entered from the official rulebook.
-- expansion_id is NULL for the base game's own rules, or set when the
-- section belongs to one of that game's expansions instead.
CREATE TABLE IF NOT EXISTS base_rule_sections (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
ALTER TABLE base_rule_sections ADD COLUMN IF NOT EXISTS expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_base_rule_sections_expansion ON base_rule_sections(expansion_id);

-- House rules: your own modifications, optionally tied to a base section
-- (e.g. "override" a specific base rule) or standalone (a new house rule).
-- expansion_id works the same way as on base_rule_sections above.
CREATE TABLE IF NOT EXISTS house_rules (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE,
  base_section_id INTEGER REFERENCES base_rule_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
ALTER TABLE house_rules ADD COLUMN IF NOT EXISTS expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_house_rules_expansion ON house_rules(expansion_id);

CREATE INDEX IF NOT EXISTS idx_base_rule_sections_game ON base_rule_sections(game_id);
CREATE INDEX IF NOT EXISTS idx_house_rules_game ON house_rules(game_id);

-- Categories: a self-referencing tree, up to 4 levels deep (depth 1-4).
-- This is separate from the free-text "genre" field - genre stays a quick
-- flat tag, categories are for deliberately organizing a growing collection
-- into a browsable hierarchy (e.g. Strategy > Deck Building > Dice-Driven).
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

ALTER TABLE games ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE expansions ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_games_category ON games(category_id);
CREATE INDEX IF NOT EXISTS idx_expansions_category ON expansions(category_id);

-- Rule categories: a self-referencing tree, up to 4 levels deep, used to
-- organize a game's (or an expansion's) rule SECTIONS into a nested table
-- of contents, e.g. "Gameplay > Development Cards > Knight Cards". Scoped
-- per game_id (+ expansion_id when it belongs to an expansion's own
-- rulebook rather than the base game's), since "Setup" in one game's
-- rulebook has nothing to do with "Setup" in another's.
CREATE TABLE IF NOT EXISTS rule_categories (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES rule_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_categories_game ON rule_categories(game_id);
CREATE INDEX IF NOT EXISTS idx_rule_categories_expansion ON rule_categories(expansion_id);
CREATE INDEX IF NOT EXISTS idx_rule_categories_parent ON rule_categories(parent_id);

ALTER TABLE base_rule_sections ADD COLUMN IF NOT EXISTS rule_category_id INTEGER REFERENCES rule_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_base_rule_sections_rule_category ON base_rule_sections(rule_category_id);

-- Setup options: named alternate ways to set up a session of this game
-- (e.g. Dominion's curated Kingdom card sets like "Beginner Game" or
-- "Interactive Kingdom", or a Catan board layout variant). Deliberately
-- separate from base_rule_sections - these aren't steps in the rulebook's
-- narrative flow, they're a menu of setup choices you pick one of before
-- playing, so they're browsed as their own list rather than nested into
-- the Setup/Gameplay/Scoring table of contents.
CREATE TABLE IF NOT EXISTS setup_options (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_setup_options_game ON setup_options(game_id);
CREATE INDEX IF NOT EXISTS idx_setup_options_expansion ON setup_options(expansion_id);

-- House rules can now be filed under a rule category (when added as an
-- "extra" rule, not overriding anything), so they can actually show up on
-- the Rules tab alongside the base sections instead of only living on the
-- separate House Rules tab.
ALTER TABLE house_rules ADD COLUMN IF NOT EXISTS rule_category_id INTEGER REFERENCES rule_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_house_rules_rule_category ON house_rules(rule_category_id);

-- Score tracker: each game gets its own custom scoresheet, e.g. Wingspan's
-- Birds / Bonus cards / Eggs / Nectar rows. A category can belong to a
-- named group (the bold subheaders like "1 point each") for visual
-- grouping only - it has no effect on scoring math. is_multiplier means
-- the player enters a raw count and it's multiplied by multiplier_value
-- to get points (e.g. "1 point each" categories use multiplier_value=1
-- just to keep the math consistent); when false, the player enters the
-- point value directly (e.g. Wingspan's Bonus cards, Round goals).
-- is_award is for one-off bonuses only one player can hold at a time
-- (Catan's Longest Road / Largest Army): instead of a number input it
-- renders as a single set of radio buttons across all players, and
-- whoever's picked scores multiplier_value points (everyone else scores 0).
CREATE TABLE IF NOT EXISTS score_categories (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  group_label TEXT,
  label TEXT NOT NULL,
  is_multiplier BOOLEAN NOT NULL DEFAULT false,
  multiplier_value NUMERIC NOT NULL DEFAULT 1,
  is_award BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_score_categories_game ON score_categories(game_id);
ALTER TABLE score_categories ADD COLUMN IF NOT EXISTS is_award BOOLEAN NOT NULL DEFAULT false;

-- A single played session of a game. finished_at is NULL while the
-- scoresheet is still being filled in live during play.
CREATE TABLE IF NOT EXISTS game_sessions (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT now(),
  finished_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_game ON game_sessions(game_id);

CREATE TABLE IF NOT EXISTS session_players (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_session_players_session ON session_players(session_id);

-- One cell of the scoresheet: a player's raw entry for one category.
-- "value" is always what the player typed (a count for multiplier
-- categories, or the point total for direct-entry categories).
CREATE TABLE IF NOT EXISTS session_scores (
  id SERIAL PRIMARY KEY,
  session_player_id INTEGER NOT NULL REFERENCES session_players(id) ON DELETE CASCADE,
  score_category_id INTEGER NOT NULL REFERENCES score_categories(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(session_player_id, score_category_id)
);
CREATE INDEX IF NOT EXISTS idx_session_scores_player ON session_scores(session_player_id);
