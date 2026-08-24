-- Removes the cheat sheet system entirely from the database: the
-- cheat_sheet_entries table and the 3 legacy free-text columns on games.
-- This is destructive - any cheat sheet content you've written (including
-- the batch content added earlier for ~43 games) will be permanently
-- deleted. The QR code and printable shelf label feature is untouched;
-- it never used these tables.
--
-- Run it directly against your database, e.g.:
--   psql "$DATABASE_URL" -f db/removeCheatSheetSystem.sql

DROP TABLE IF EXISTS cheat_sheet_entries;

ALTER TABLE games DROP COLUMN IF EXISTS cheat_turn_order;
ALTER TABLE games DROP COLUMN IF EXISTS cheat_scoring;
ALTER TABLE games DROP COLUMN IF EXISTS cheat_win_condition;
