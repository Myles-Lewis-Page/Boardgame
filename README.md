# Board Game Rules

Keep track of the board games you own, with the official base rules and your
own editable house rules per game (house rules can stand alone or override a
specific base rule section).

## Stack
Node.js + Express + EJS (server-rendered) + Postgres. Chosen for minimal
moving parts and cheap Railway hosting (no separate frontend build/deploy).

## How rulebook import works
There's no external AI/API call. Paste rulebook text on a game's page, and a
heuristic splitter breaks it into sections based on heading-like lines
(numbered, ALL CAPS, or short title-case lines). You review and edit every
section before saving, so a rough auto-split is fine, nothing gets saved
without your OK.

## Local development

```bash
npm install
cp .env.example .env
# edit .env with a local Postgres connection string
npm run dev
```

The schema (`db/schema.sql`) is applied automatically on boot with
`CREATE TABLE IF NOT EXISTS`, so no separate migration step is needed.

## Deploying on Railway

1. Push this repo to GitHub.
2. In Railway: New Project -> Deploy from GitHub repo -> select this repo.
3. Add a Postgres plugin to the project (Railway auto-injects `DATABASE_URL`
   into your service, no manual wiring needed).
4. Railway will detect Node via Nixpacks and run `npm start` automatically
   (also pinned in `railway.json`).
5. First boot creates all tables automatically.

## Project structure

```
server.js              app entry point, mounts routes, ensures schema on boot
db/index.js             Postgres connection pool
db/schema.sql            table definitions
db/parseRulebook.js      heuristic rulebook text -> sections splitter
routes/games.js          game CRUD
routes/baseRules.js      paste/parse/save/edit base rule sections
routes/houseRules.js     add/edit/toggle/delete house rules
views/                   EJS templates
public/                  CSS + small JS for tab switching
```

## Data model

- `games`: name, publisher, player count, play time, notes
- `base_rule_sections`: official rules, per game, split into titled sections
- `house_rules`: your modifications, per game, optionally linked to a
  `base_rule_sections.id` it overrides (otherwise standalone). Each has an
  `is_active` toggle so you can keep a house rule on file without applying it.
