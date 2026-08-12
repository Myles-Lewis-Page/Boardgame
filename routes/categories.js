const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { MAX_DEPTH, buildCategoryTree, flattenForSelect, annotatePathLabels } = require('../db/categoryTree');

async function getFlatTree(client) {
  const { rows } = await client.query('SELECT * FROM categories ORDER BY depth ASC, name ASC');
  const tree = buildCategoryTree(rows);
  annotatePathLabels(tree);
  return { rows, tree, flat: flattenForSelect(tree) };
}

// Manage categories (public to view, editing gated below per-action)
router.get('/categories', async (req, res) => {
  const { rows, flat } = await getFlatTree(pool);
  // Only categories with depth < MAX_DEPTH can be a parent for a new child
  const eligibleParents = flat.filter(f => f.depth < MAX_DEPTH);
  res.render('categories-manage', { flat, eligibleParents, totalCount: rows.length, maxDepth: MAX_DEPTH });
});

// Add a category (requires login)
router.post('/categories', requireAuth, async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name || !name.trim()) return res.redirect('/categories');

  let depth = 1;
  if (parent_id) {
    const { rows } = await pool.query('SELECT depth FROM categories WHERE id = $1', [parent_id]);
    if (rows.length) depth = rows[0].depth + 1;
  }
  if (depth > MAX_DEPTH) {
    return res.status(400).send(`Categories can only go ${MAX_DEPTH} levels deep.`);
  }

  await pool.query(
    'INSERT INTO categories (name, parent_id, depth) VALUES ($1, $2, $3)',
    [name.trim(), parent_id || null, depth]
  );
  res.redirect('/categories');
});

// Rename a category (requires login) - reparenting isn't supported, since
// changing a parent could push descendants past the depth limit; delete and
// recreate instead if a category needs to move.
router.post('/categories/:id/edit', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (name && name.trim()) {
    await pool.query('UPDATE categories SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
  }
  res.redirect('/categories');
});

// Delete a category (requires login) - cascades to any sub-categories
// beneath it; games/expansions using it just lose that category (set null).
router.post('/categories/:id/delete', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
  res.redirect('/categories');
});

module.exports = router;
