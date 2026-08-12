const MAX_DEPTH = 4;

/**
 * Orders by name, except: anything that looks like "Setup" always sorts
 * first, and anything that looks like scoring/winning always sorts last.
 * Used for both rule categories and loose (uncategorized) section titles,
 * so a game's Rules tab reads Setup -> everything else -> Scoring/Winning
 * by default, regardless of what order the rulebook text happened to list
 * things in.
 */
function setupFirstWinningLastCompare(nameA, nameB) {
  const rank = name => {
    const n = name.toLowerCase();
    if (n.includes('setup')) return 0;
    if (n.includes('winning') || n.includes('scoring') || n.includes('end of game') || n.includes('ending')) return 2;
    return 1;
  };
  const rankA = rank(nameA);
  const rankB = rank(nameB);
  if (rankA !== rankB) return rankA - rankB;
  return nameA.localeCompare(nameB);
}

/**
 * Builds a nested tree from a flat list of rule_categories rows that all
 * belong to the same game/expansion scope (caller is responsible for
 * pre-filtering to that scope).
 */
function buildTree(rows) {
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
    nodes.sort((a, b) => setupFirstWinningLastCompare(a.name, b.name));
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

/** Flattens a tree into an ordered array for a <select>, with an indent prefix. */
function flattenForSelect(tree, depth = 0, out = []) {
  tree.forEach(node => {
    out.push({ id: node.id, depth: node.depth, indent: '\u2014 '.repeat(depth), name: node.name });
    flattenForSelect(node.children, depth + 1, out);
  });
  return out;
}

/**
 * Find-or-create a category path (e.g. ['Gameplay', 'Development Cards'])
 * scoped to a specific game_id + expansion_id (expansionId may be null for
 * the base game's own rulebook). Mirrors db/categoryTree.js's version but
 * every lookup/insert is additionally scoped so identically-named
 * categories in different games' rulebooks never collide.
 */
async function findOrCreateRuleCategoryPath(client, gameId, expansionId, pathSegments) {
  const segments = pathSegments.map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > MAX_DEPTH) {
    throw new Error(`Rule category path "${segments.join(' > ')}" is ${segments.length} levels deep, max is ${MAX_DEPTH}`);
  }

  const expId = expansionId || null;
  let parentId = null;
  let categoryId = null;

  for (let depth = 1; depth <= segments.length; depth++) {
    const name = segments[depth - 1];
    const { rows } = await client.query(
      `SELECT id FROM rule_categories
       WHERE game_id = $1 AND expansion_id IS NOT DISTINCT FROM $2
         AND parent_id IS NOT DISTINCT FROM $3 AND name = $4`,
      [gameId, expId, parentId, name]
    );
    if (rows.length > 0) {
      categoryId = rows[0].id;
    } else {
      const { rows: inserted } = await client.query(
        `INSERT INTO rule_categories (game_id, expansion_id, parent_id, name, depth)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [gameId, expId, parentId, name, depth]
      );
      categoryId = inserted[0].id;
    }
    parentId = categoryId;
  }
  return categoryId;
}

/** Walks parent_id links to build a "Grandparent > Parent > Name" path for one category id. */
function pathForRuleCategoryId(categoryId, allRows) {
  if (!categoryId) return null;
  const byId = new Map(allRows.map(r => [r.id, r]));
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

module.exports = { MAX_DEPTH, buildTree, flattenForSelect, findOrCreateRuleCategoryPath, pathForRuleCategoryId, setupFirstWinningLastCompare };
