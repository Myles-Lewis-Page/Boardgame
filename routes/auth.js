const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
  const next_url = req.query.next || '/games';
  res.render('login', { error: null, next_url });
});

router.post('/login', (req, res) => {
  const { password, next_url } = req.body;
  const correct = process.env.ADMIN_PASSWORD;

  if (!correct) {
    return res.render('login', {
      error: 'ADMIN_PASSWORD is not set on the server yet. Add it in Railway variables.',
      next_url: next_url || '/games'
    });
  }

  if (password === correct) {
    req.session.isAdmin = true;
    return res.redirect(next_url || '/games');
  }

  res.render('login', { error: 'Wrong passcode, try again.', next_url: next_url || '/games' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/games'));
});

module.exports = router;
