require('dotenv').config();
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { attachAuthLocals } = require('./middleware/auth');

// Safety net: log unexpected errors instead of letting the whole process
// die from something outside a request cycle. Route-level errors are
// handled by asyncHandler + the Express error middleware below; this is
// just the last line of defense so one bad background error can't take
// the entire app down.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway sits behind a proxy; needed for secure cookies to work

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days - it's a game room, staying logged in is convenient
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));
app.use(attachAuthLocals);

app.get('/', (req, res) => res.redirect('/games'));

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/importGames')); // must be mounted before games router so /games/import doesn't match games.js's /:id route
app.use('/', require('./routes/expansions')); // must be mounted before games router for the same reason (/games/:id/expansions/...)
app.use('/', require('./routes/expansionRules'));
app.use('/', require('./routes/wishlist'));
app.use('/', require('./routes/categories'));
app.use('/', require('./routes/recategorize'));
app.use('/', require('./routes/recategorizeSections'));
app.use('/', require('./routes/updateBoxArt'));
app.use('/', require('./routes/linkVariants'));
app.use('/', require('./routes/cheatSheet'));
app.use('/', require('./routes/randomizer'));
app.use('/', require('./routes/scoring')); // must be mounted before games router so /games/:id/play, /scoring, /sessions don't hit games.js's /:id route
app.use('/games', require('./routes/games'));
app.use('/', require('./routes/baseRules'));
app.use('/', require('./routes/houseRules'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something broke: ' + err.message);
});

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Schema ensured.');
}

ensureSchema()
  .then(async () => {
    const { migrateWishlistIntoGames } = require('./db/migrateWishlist');
    const { migrated, skipped } = await migrateWishlistIntoGames(pool);
    if (migrated || skipped) {
      console.log(`Wishlist migration: ${migrated} entries moved into games (owned=false), ${skipped} skipped (name already existed).`);
    }
  })
  .then(() => {
    app.listen(PORT, () => console.log(`Board game rules app running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
