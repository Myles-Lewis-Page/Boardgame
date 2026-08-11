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

-- Wishlist: games you don't own yet. Stores the same info as a real game,
-- plus the raw pasted rulebook text (unparsed) so that converting to an
-- owned game can split it into base_rule_sections in one step without you
-- having to paste it again.
CREATE TABLE IF NOT EXISTS wishlist_games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT,
  genre TEXT,
  min_players INTEGER,
  max_players INTEGER,
  play_time_minutes INTEGER,
  cover_image_url TEXT,
  notes TEXT,
  rules_text TEXT,
  created_at TIMESTAMP DEFAULT now()
);
