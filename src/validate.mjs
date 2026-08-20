/* validate.mjs — schema validation for blueprint scenes. */

export const VALID_STATUS = new Set(["built", "in-progress", "planned", "broken"]);

export function validateScene(sc, where, errors, warnings, seen = new Set()) {
  const nodes = sc.nodes || [];
  const edges = sc.edges || [];
  const flow = sc.flow || [];
  const ids = new Set();

  for (const n of nodes) {
    const at = `${where} [${n.id || "?"}]`;
    if (!n.id) { errors.push(`${where}: a node is missing its id`); continue; }
    if (ids.has(n.id)) errors.push(`${at}: duplicate node id`);
    ids.add(n.id);
    if (!n.label) warnings.push(`${at}: no label`);
    if (!Array.isArray(n.pos) || n.pos.length !== 2 || n.pos.some((v) => typeof v !== "number")) {
      errors.push(`${at}: pos must be [x, y] numbers`);
    }
    if (n.size && (!Array.isArray(n.size) || n.size.length !== 2 || n.size.some((v) => typeof v !== "number" || v <= 0))) {
      errors.push(`${at}: size must be [w, d] positive numbers`);
    }
    if (n.status && !VALID_STATUS.has(n.status)) {
      errors.push(`${at}: unknown status "${n.status}" (built|in-progress|planned|broken)`);
    }
    if (n.shape && !["box", "slab", "stack"].includes(n.shape)) {
      errors.push(`${at}: unknown shape "${n.shape}" (box|slab|stack)`);
    }
    if (!n.summary && !n.does) warnings.push(`${at}: no summary/does prose`);
    if (n.status === "broken" && !n.condition) warnings.push(`${at}: broken but no condition note`);
  }

  if (sc.groups) {
    const gids = new Set(sc.groups.map((g) => g.id));
    for (const n of nodes) {
      if (n.group && !gids.has(n.group)) errors.push(`${where} [${n.id}]: group "${n.group}" is not declared`);
    }
    for (const g of sc.groups) {
      if (!nodes.some((n) => (n.group || "misc") === g.id)) warnings.push(`${where}: group "${g.id}" has no members`);
    }
  }

  for (const e of edges) {
    if (!ids.has(e.from)) errors.push(`${where}: edge from unknown node "${e.from}"`);
    if (!ids.has(e.to)) errors.push(`${where}: edge to unknown node "${e.to}"`);
    if (e.status && !VALID_STATUS.has(e.status)) errors.push(`${where}: edge ${e.from}→${e.to} unknown status "${e.status}"`);
  }
  for (const f of flow) {
    if (!ids.has(f)) errors.push(`${where}: flow references unknown node "${f}"`);
  }
  if (flow.length === 1) warnings.push(`${where}: flow has a single node — nothing to trace`);

  for (const n of nodes) {
    if (n.id && !edges.some((e) => e.from === n.id || e.to === n.id)) {
      warnings.push(`${where} [${n.id}]: isolated — no wires in or out`);
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (!a.pos || !b.pos) continue;
      const as = a.size || [1.6, 1.6], bs = b.size || [1.6, 1.6];
      const overlap =
        a.pos[0] < b.pos[0] + bs[0] && b.pos[0] < a.pos[0] + as[0] &&
        a.pos[1] < b.pos[1] + bs[1] && b.pos[1] < a.pos[1] + as[1];
      if (overlap) warnings.push(`${where}: [${a.id}] and [${b.id}] footprints overlap`);
    }
  }

  for (const n of nodes) {
    if (n.steps) {
      const key = `${where}›${n.id}`;
      if (seen.has(key)) { errors.push(`${key}: cyclic steps`); continue; }
      validateScene(n.steps, key, errors, warnings, new Set([...seen, key]));
    }
  }
}

/* bp:node VAL "validator" group:engines
 * bp:does Errors on dangling refs, duplicate ids, bad statuses, malformed geometry; warns on isolation, overlaps, thin prose.
 * bp:built src/validate.mjs — validateScene(), recursive into steps scenes.
 */
