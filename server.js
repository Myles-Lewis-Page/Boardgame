require('dotenv').config();
const express = require('express');
const methodOverride = require('method-override');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/games'));

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
  .then(() => {
    app.listen(PORT, () => console.log(`Board game rules app running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
