# Board Game Rules

Keep track of the board games you own, sort/filter them to decide what to
play, and reference the official rules plus your own house rules for each
one. Built for browsing on an iPad in the game room.

## Stack
Node.js + Express + EJS (server-rendered) + Postgres. Chosen for minimal
moving parts and cheap Railway hosting (no separate frontend build/deploy).

## Access model
- **Browsing (homepage, game pages, rules, search, sort/filter): open to
  everyone**, no login.
- **Adding/editing games, pasting rulebooks, adding/editing house rules:
  requires the shared passcode** (`ADMIN_PASSWORD` env var). There's no
  per-user accounts, just one passcode for the household/game room, entered
  once and remembered for 30 days via a login cookie.

## Features
- **Sort/filter/search on the homepage**: by name, player count, genre, and
  play time, all done instantly in the browser (no reloads) so it feels
  snappy on an iPad.
- **Rulebook table of contents**: each game's base rules get a sticky side
  nav (a horizontal chip bar on narrower screens) built from the section
  titles (Setup, Play, Scoring, etc., whatever the game actually has),
  jumping straight to that section.
- **In-rulebook search**: a search box on each game's page filters the base
  rule sections by title/body text as you type.
- **House rules**: standalone or explicitly flagged as overriding a specific
  base rule section, with an on/off toggle so an old house rule can stay on
  file without applying.

## How rulebook import works
No external AI/API call. Paste rulebook text on a game's page (once logged
in), and a heuristic splitter breaks it into sections based on heading-like
lines (numbered, ALL CAPS, or short title-case lines). You review and edit
every section before saving, so a rough auto-split is fine, nothing gets
saved without your OK.

## Local development

```bash
npm install
cp .env.example .env
# edit .env: local Postgres connection string, ADMIN_PASSWORD, SESSION_SECRET
npm run dev
```

The schema (`db/schema.sql`) is applied automatically on boot with
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so no separate
migration step is needed, including if you're upgrading from an earlier
version of this app without genre/play-time fields.

## Deploying on Railway

1. Push this repo to GitHub.
2. In Railway: New Project -> Deploy from GitHub repo -> select this repo.
3. Add a Postgres plugin to the project (Railway auto-injects `DATABASE_URL`
   into your service, no manual wiring needed).
4. In the service's Variables tab, set:
   - `ADMIN_PASSWORD` - the passcode you'll use to log in and edit
   - `SESSION_SECRET` - any random string
   - `NODE_ENV` - `production`
5. Railway will detect Node via Nixpacks and run `npm start` automatically
   (also pinned in `railway.json`).
6. First boot creates/upgrades all tables automatically.
7. On the iPad, open the Railway URL and add it to the home screen (Share ->
   Add to Home Screen) for an app-like feel.

## Project structure

```
server.js              app entry point, sessions, mounts routes, ensures schema on boot
middleware/auth.js      shared-passcode auth guard + isAdmin view helper
db/index.js             Postgres connection pool
db/schema.sql            table definitions (with upgrade-safe ALTER TABLE)
db/parseRulebook.js      heuristic rulebook text -> sections splitter
routes/auth.js           login/logout
routes/games.js          game CRUD (mutations require login)
routes/baseRules.js      paste/parse/save/edit base rule sections (mutations require login)
routes/houseRules.js     add/edit/toggle/delete house rules (mutations require login)
views/                   EJS templates
public/                  CSS, tab/TOC/search JS, homepage sort/filter JS
```

## Data model

- `games`: name, publisher, genre, min/max players, play_time_minutes, notes
- `base_rule_sections`: official rules, per game, split into titled sections
  (these titles drive the table-of-contents sidebar)
- `house_rules`: your modifications, per game, optionally linked to a
  `base_rule_sections.id` it overrides (otherwise standalone). Each has an
  `is_active` toggle so you can keep a house rule on file without applying it.
