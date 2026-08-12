const MAX_DEPTH = 4;

/**
 * Turns a flat list of category rows (id, name, parent_id, depth) into a
 * nested tree: [{ ...row, children: [...] }]. Top-level categories (no
 * parent) come first, each level sorted by name.
 */
function buildCategoryTree(rows) {
  const byId = new Map(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  byId.forEach(node => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortTree = nodes => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

/**
 * Flattens the tree into a single ordered array suitable for a <select>,
 * each entry carrying its display depth and a "-- " indent prefix so the
 * hierarchy is visible in a plain dropdown list.
 */
function flattenForSelect(tree, depth = 0, out = []) {
  tree.forEach(node => {
    out.push({
      id: node.id,
      depth: node.depth,
      indent: '\u2014 '.repeat(depth), // em dash indent
      name: node.name,
      pathLabel: node.pathLabel || node.name
    });
    flattenForSelect(node.children, depth + 1, out);
  });
  return out;
}

/**
 * Builds a "Grandparent > Parent > Name" style path label for every node in
 * the tree, mutating pathLabel onto each node before it's flattened.
 */
function annotatePathLabels(tree, ancestry = []) {
  tree.forEach(node => {
    const path = [...ancestry, node.name];
    node.pathLabel = path.join(' > ');
    annotatePathLabels(node.children, path);
  });
  return tree;
}

/**
 * Given a Postgres client (inside a transaction) and a path like
 * ['Strategy', 'Deck Building', 'Dice-Driven'], walks it level by level,
 * finding an existing category with that name under that parent, or
 * creating one if it doesn't exist yet. Returns the id of the final
 * (leaf) category in the path. Throws if the path would exceed MAX_DEPTH.
 */
async function findOrCreateCategoryPath(client, pathSegments) {
  const segments = pathSegments.map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > MAX_DEPTH) {
    throw new Error(`Category path "${segments.join(' > ')}" is ${segments.length} levels deep, max is ${MAX_DEPTH}`);
  }

  let parentId = null;
  let categoryId = null;
  for (let depth = 1; depth <= segments.length; depth++) {
    const name = segments[depth - 1];
    const { rows } = await client.query(
      parentId === null
        ? 'SELECT id FROM categories WHERE name = $1 AND parent_id IS NULL'
        : 'SELECT id FROM categories WHERE name = $1 AND parent_id = $2',
      parentId === null ? [name] : [name, parentId]
    );
    if (rows.length > 0) {
      categoryId = rows[0].id;
    } else {
      const { rows: inserted } = await client.query(
        'INSERT INTO categories (name, parent_id, depth) VALUES ($1, $2, $3) RETURNING id',
        [name, parentId, depth]
      );
      categoryId = inserted[0].id;
    }
    parentId = categoryId;
  }
  return categoryId;
}

/**
 * Given a category id and the full flat list of category rows, walks up
 * parent_id links to build the "Grandparent > Parent > Name" display path.
 */
function pathForCategoryId(categoryId, allCategoryRows) {
  if (!categoryId) return null;
  const byId = new Map(allCategoryRows.map(r => [r.id, r]));
  const parts = [];
  let current = byId.get(categoryId);
  let guard = 0;
  while (current && guard < MAX_DEPTH + 1) {
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : null;
    guard++;
  }
  return parts.join(' > ');
}

module.exports = { MAX_DEPTH, buildCategoryTree, flattenForSelect, annotatePathLabels, findOrCreateCategoryPath, pathForCategoryId };
