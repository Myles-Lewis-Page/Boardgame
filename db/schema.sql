CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT,
  genre TEXT,
  min_players INTEGER,
  max_players INTEGER,
  play_time_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Upgrade path for databases created before genre/play_time_minutes existed.
ALTER TABLE games ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS play_time_minutes INTEGER;

-- Base rules: sections parsed/entered from the official rulebook.
CREATE TABLE IF NOT EXISTS base_rule_sections (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- House rules: your own modifications, optionally tied to a base section
-- (e.g. "override" a specific base rule) or standalone (a new house rule).
CREATE TABLE IF NOT EXISTS house_rules (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  base_section_id INTEGER REFERENCES base_rule_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_base_rule_sections_game ON base_rule_sections(game_id);
CREATE INDEX IF NOT EXISTS idx_house_rules_game ON house_rules(game_id);
