// Simple shared-passcode auth for a game-room app: no per-user accounts,
// just one passcode (set via ADMIN_PASSWORD env var) that unlocks the
// ability to add/edit games and rules. Browsing and reading is always public.

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  const next_url = req.originalUrl;
  res.redirect(`/login?next=${encodeURIComponent(next_url)}`);
}

// Makes `isAdmin` available in every view without repeating it in each route.
function attachAuthLocals(req, res, next) {
  res.locals.isAdmin = !!(req.session && req.session.isAdmin);
  next();
}

module.exports = { requireAuth, attachAuthLocals };
