/* layout.mjs — layered grid layout for scenes without hand-laid positions.
 * Ranks flow downward; nodes within a rank spread horizontally, centered.
 * Nodes with an explicit pos (directive `pos:x,y`) keep it; the rest are placed.
 */

export function autoLayout(nodes, edges) {
  const need = nodes.filter((n) => !n.pos);
  if (!need.length) return nodes;

  const ids = nodes.map((n) => n.id);
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const e of edges || []) {
    if (preds.has(e.to) && succs.has(e.from)) {
      preds.get(e.to).push(e.from);
      succs.get(e.from).push(e.to);
    }
  }

  // longest-path rank, cycle-guarded
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let iter = 0; iter < ids.length + 1; iter++) {
    let moved = false;
    for (const id of ids) {
      for (const p of preds.get(id)) {
        if (rank.get(p) + 1 > rank.get(id)) { rank.set(id, rank.get(p) + 1); moved = true; }
      }
    }
    if (!moved) break;
  }

  // group by rank, order within rank by definition order
  const byRank = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(n);
  }

  for (const [r, row] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    row.forEach((n, i) => {
      if (n.pos) return;
      const x = r * 1.6 + (i - (row.length - 1) / 2) * 3.4;
      const y = r * 2.7;
      n.pos = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
  }
  return nodes;
}

/* bp:node LAY "layered layout" group:engines
 * bp:does Assigns positions when none are ==hand-laid==: longest-path ranks downward, centered spread within a rank.
 * bp:built src/layout.mjs — autoLayout(), cycle-guarded rank relaxation.
 */
