/* scan.mjs — directive scanner.
 * Scans source files for `bp:` comment directives and assembles a blueprint
 * scene: nodes (with file/line/symbol/kind metadata), edges, flow, groups.
 * Directives are only honored inside comments — a tiny lexer tracks line
 * comments, block comments, strings, and template literals, so fixture text
 * and error messages containing "bp:" are ignored.
 *
 * Directives (inside any comment; written here with a space so this header
 * does not parse itself — real directives have no space):
 *   bp: node <ID> ["<label>"] [group:<g>] [status:<s>] [shape:box|slab|stack]
 *        [pos:<x>,<y>] [height:<n>] [count:<n>]
 *   bp: summary|does|built|condition <text>  (attaches to previous bp: node)
 *   bp: edge <FROM> -> <TO> [: <label>] [status:<s>]
 *   bp: flow <ID> [<ID> ...]                 (space/comma separated)
 *   bp: group <id> <title...>
 */

// Returns Map<lineIdx, Array<[startCol, endCol]>> of comment regions.
function commentSpans(text) {
  const spans = new Map();
  let state = "code", quote = null, line = 0, col = 0, start = -1;
  const push = (l, s, e) => {
    if (!spans.has(l)) spans.set(l, []);
    spans.get(l).push([s, e]);
  };
  let spanLine = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === "\n") {
      if (state === "line") { push(spanLine, start, col); state = "code"; }
      else if (state === "block") push(spanLine, start, col);
      line++; col = 0;
      if (state === "block") { start = 0; spanLine = line; }
      continue;
    }
    if (state === "line") { col++; continue; }
    if (state === "block") {
      if (c === "*" && next === "/") { push(line, start, col + 2); state = "code"; i++; col += 2; continue; }
      col++; continue;
    }
    if (state === "string" || state === "template") {
      if (c === "\\") { i++; col += 2; continue; }
      if (c === quote) state = "code";
      col++; continue;
    }
    // code
    if (c === "/" && next === "/") { state = "line"; start = col; spanLine = line; i++; col += 2; continue; }
    if (c === "/" && next === "*") { state = "block"; start = col; spanLine = line; i++; col += 2; continue; }
    if (c === "'" || c === '"') { state = "string"; quote = c; col++; continue; }
    if (c === "`") { state = "template"; quote = c; col++; continue; }
    col++;
  }
  if (state === "line" || state === "block") push(spanLine, start, col);
  return spans;
}

function inComment(spans, lineIdx, colIdx) {
  const regions = spans.get(lineIdx);
  return !!regions && regions.some(([s, e]) => colIdx >= s && colIdx < e);
}

const ENTITY_PATTERNS = [
  { kind: "class", re: /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/ },
  { kind: "function", re: /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/ },
  { kind: "function", re: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z0-9_$]+\s*=>)/ },
  { kind: "type", re: /(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/ },
];

const KIND_SHAPE = { module: "stack", class: "box", component: "box", function: "slab", type: "slab" };

function findEntity(lines, fromIdx, maxAhead = 8) {
  for (let i = fromIdx; i < Math.min(lines.length, fromIdx + maxAhead); i++) {
    const line = lines[i];
    if (/bp:node/.test(line) && i !== fromIdx) break; // hit the next directive
    for (const { kind, re } of ENTITY_PATTERNS) {
      const m = line.match(re);
      if (m) {
        let k = kind;
        if (kind === "function" && /^[A-Z]/.test(m[1])) k = "component"; // PascalCase fn ≈ component
        return { symbol: m[1], kind: k, line: i + 1 };
      }
    }
  }
  return null;
}

function parseAttrs(rest) {
  const attrs = {};
  const labelMatch = rest.match(/"([^"]+)"/);
  const noLabel = rest.replace(/"[^"]*"/, "");
  for (const m of noLabel.matchAll(/(\w+):([^\s]+)/g)) attrs[m[1]] = m[2];
  return { label: labelMatch ? labelMatch[1] : null, attrs };
}

function humanize(sym) {
  return sym
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/** Scan one file's source text. Returns partial scene parts + errors/warnings. */
export function scanSource(file, text) {
  const out = { nodes: [], edges: [], flow: [], groups: [], errors: [], warnings: [] };
  const lines = text.split("\n");
  const spans = commentSpans(text);
  let lastNode = null;

  lines.forEach((line, idx) => {
    let dm = null;
    for (const cand of line.matchAll(/bp:[a-z]+/g)) {
      if (!inComment(spans, idx, cand.index)) continue;
      dm = line.slice(cand.index).match(/^bp:([a-z]+)\s*(.*)$/);
      break;
    }
    if (!dm) return;
    const [, directive, raw] = dm;
    const rest = raw.replace(/\*\/\s*$/, "").trim();

    if (directive === "node") {
      const idMatch = rest.match(/^(\S+)\s*(.*)$/);
      if (!idMatch) { out.errors.push(`${file}:${idx + 1}: bp:node missing ID`); return; }
      const [, id, tail] = idMatch;
      const { label, attrs } = parseAttrs(tail);
      const entity = findEntity(lines, idx + 1);
      const node = {
        id,
        label: label || (entity ? humanize(entity.symbol) : id),
        group: attrs.group,
        status: attrs.status,
        shape: attrs.shape,
        does: "", built: "", summary: "", condition: "",
        _src: entity
          ? { file, line: entity.line, symbol: entity.symbol, kind: entity.kind }
          : { file, line: idx + 1, symbol: null, kind: "module" },
      };
      if (attrs.pos) {
        const p = attrs.pos.split(",").map(Number);
        if (p.length === 2 && p.every((v) => Number.isFinite(v))) node.pos = p;
        else out.errors.push(`${file}:${idx + 1}: bad pos "${attrs.pos}" (want x,y)`);
      }
      if (attrs.height) node.height = Number(attrs.height);
      if (attrs.count) node.count = Number(attrs.count);
      out.nodes.push(node);
      lastNode = node;
    } else if (["summary", "does", "built", "condition"].includes(directive)) {
      if (!lastNode) { out.warnings.push(`${file}:${idx + 1}: bp:${directive} before any bp:node — dropped`); return; }
      lastNode[directive] = lastNode[directive] ? lastNode[directive] + "\n" + rest : rest;
    } else if (directive === "edge") {
      const em = rest.match(/^(\S+)\s*->\s*(\S+)\s*(.*)$/);
      if (!em) { out.errors.push(`${file}:${idx + 1}: bad bp:edge "${rest}" (want A -> B : label)`); return; }
      const [, from, to, tailRaw] = em;
      let tail = tailRaw.trim();
      let status;
      const sm = tail.match(/status:(\S+)/);
      if (sm) { status = sm[1]; tail = tail.replace(/status:\S+/, "").trim(); }
      const label = tail.replace(/^:\s*/, "").trim();
      out.edges.push(Object.assign({ from, to }, label ? { label } : {}, status ? { status } : {}));
    } else if (directive === "flow") {
      out.flow.push(...rest.split(/[\s,]+/).filter((t) => t && t !== "->" && t !== "→"));
    } else if (directive === "group") {
      const gm = rest.match(/^(\S+)\s+(.*)$/);
      if (gm) out.groups.push({ id: gm[1], title: gm[2].trim() });
    }
  });

  return out;
}

/** Merge scanned parts into one scene. Applies kind→shape defaults and src provenance. */
export function assembleScene(parts, sceneMeta = {}) {
  const scene = Object.assign({ nodes: [], edges: [], flow: [], groups: [] }, sceneMeta);
  const errors = [], warnings = [];
  const seen = new Map();

  for (const part of parts) {
    errors.push(...part.errors);
    warnings.push(...part.warnings);
    scene.edges.push(...part.edges);
    scene.flow.push(...part.flow);
    for (const g of part.groups) {
      if (!scene.groups.some((x) => x.id === g.id)) scene.groups.push(g);
    }
    for (const n of part.nodes) {
      if (seen.has(n.id)) {
        errors.push(`duplicate node id "${n.id}" (${seen.get(n.id)} and ${n._src.file}:${n._src.line})`);
        continue;
      }
      seen.set(n.id, `${n._src.file}:${n._src.line}`);
      if (!n.shape) n.shape = KIND_SHAPE[n._src.kind] || "box";
      const prov = `${n._src.file}:${n._src.line}` + (n._src.symbol ? ` — ${n._src.kind} ${n._src.symbol}` : " — module");
      n.built = n.built ? n.built + "\n\n" + prov : prov;
      delete n._src;
      scene.nodes.push(n);
    }
  }

  // groups referenced only via group: attr
  for (const n of scene.nodes) {
    if (n.group && !scene.groups.some((g) => g.id === n.group)) {
      scene.groups.push({ id: n.group, title: n.group });
    }
  }
  // derive a flow from the wires when none was declared
  if (!scene.flow.length && scene.edges.length) {
    const ids = scene.nodes.map((n) => n.id);
    const hasIn = new Set(scene.edges.map((e) => e.to));
    const start = ids.find((id) => !hasIn.has(id)) || ids[0];
    const next = {}; scene.edges.forEach((e) => { if (!(e.from in next)) next[e.from] = e.to; });
    const chain = [start];
    while (next[chain[chain.length - 1]] && !chain.includes(next[chain[chain.length - 1]])) {
      chain.push(next[chain[chain.length - 1]]);
    }
    scene.flow = chain;
  }
  return { scene, errors, warnings };
}

/** Scan a list of {file, text} inputs into one scene. */
export function scanFiles(inputs, sceneMeta) {
  return assembleScene(inputs.map(({ file, text }) => scanSource(file, text)), sceneMeta);
}

/* bp:node SCAN "directive scanner" group:engines
 * bp:does Reads ==bp:== comments and assembles scenes: nodes with inferred kind and shape, edges, flow, groups.
 * bp:built src/scan.mjs — regex entity detection (class/function/const/type); PascalCase ⇒ component.
 * bp:edge SCAN -> LAY : unordered scene
 */
