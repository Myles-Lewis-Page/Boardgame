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
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expansions_game ON expansions(game_id);

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
