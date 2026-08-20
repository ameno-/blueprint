#!/usr/bin/env node
/* blueprint — CLI for parchment isometric work-maps.
 * Zero dependencies. Commands:
 *   blueprint check <file...>            validate blueprint data files
 *   blueprint open <file...> [--port N] [--no-browser]
 *   blueprint init <name> [--dir .]      scaffold a new blueprint from the template
 *   blueprint demo [--port N]            serve the bundled acidbath example
 */
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VALID_STATUS = new Set(["built", "in-progress", "planned", "broken"]);

// ── loading ──────────────────────────────────────────────────────────────

async function loadBlueprints(file) {
  const src = await readFile(file, "utf8");
  let registry;
  try {
    registry = new Function("window", src + "\n;return window.BLUEPRINTS || {};")({});
  } catch (err) {
    throw new Error(`${file}: does not evaluate — ${err.message}`);
  }
  if (!Object.keys(registry).length) {
    throw new Error(`${file}: registers nothing into window.BLUEPRINTS`);
  }
  return registry;
}

// ── validation ───────────────────────────────────────────────────────────

function validateScene(sc, where, errors, warnings, seen) {
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

async function check(files) {
  let failed = false;
  for (const file of files) {
    let registry;
    try {
      registry = await loadBlueprints(file);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      failed = true;
      continue;
    }
    for (const [name, bp] of Object.entries(registry)) {
      const errors = [], warnings = [];
      validateScene(bp, name, errors, warnings, new Set());
      if (!bp.title) warnings.push(`${name}: no title`);
      for (const w of warnings) console.log(`  ⚠ ${w}`);
      for (const e of errors) console.log(`  ✗ ${e}`);
      const ok = errors.length === 0;
      failed = failed || !ok;
      console.log(`${ok ? "✓" : "✗"} ${name} (${file}) — ${errors.length} errors, ${warnings.length} warnings`);
    }
  }
  process.exit(failed ? 1 : 0);
}

// ── serving ──────────────────────────────────────────────────────────────

function page(scriptTags) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Blueprint</title>
<link rel="stylesheet" href="/blueprint.css"/></head>
<body><div id="app"></div>
<script src="/blueprint.js"></script>
${scriptTags}
<script>
  (function () {
    var reg = window.BLUEPRINTS || {};
    var q = new URLSearchParams(location.search);
    var bp = reg[q.get("b")] || reg[Object.keys(reg)[0]];
    if (!bp) { document.getElementById("app").textContent = "No blueprint registered."; return; }
    document.title = "Blueprint — " + (bp.title || "").toLowerCase();
    Blueprint.render(document.getElementById("app"), bp);
  })();
</script></body></html>`;
}

async function serve(files, port) {
  const routes = new Map(files.map((f, i) => [`/data/${i}.js`, path.resolve(f)]));
  const scriptTags = files.map((_, i) => `<script src="/data/${i}.js"></script>`).join("\n");

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    try {
      if (u.pathname === "/" || u.pathname === "/index.html") {
        res.setHeader("content-type", "text/html");
        res.end(page(scriptTags));
      } else if (u.pathname === "/blueprint.js" || u.pathname === "/blueprint.css") {
        res.setHeader("content-type", u.pathname.endsWith(".css") ? "text/css" : "text/javascript");
        res.end(await readFile(path.join(ROOT, u.pathname.slice(1))));
      } else if (routes.has(u.pathname)) {
        res.setHeader("content-type", "text/javascript");
        res.end(await readFile(routes.get(u.pathname)));
      } else {
        res.statusCode = 404;
        res.end("not found");
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  for (let p = port; p < port + 20; p++) {
    const ok = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(p, () => resolve(true));
    });
    if (ok) return { server, port: p };
  }
  throw new Error("no free port in range");
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
  child.on("error", () => {});
  child.unref();
}

async function openCmd(files, opts) {
  for (const f of files) await loadBlueprints(f); // fail fast on bad data
  const { port } = await serve(files, opts.port);
  const url = `http://localhost:${port}/`;
  console.log(`blueprint serving ${files.length} file(s) at ${url}`);
  console.log("ctrl-c to stop");
  if (!opts.noBrowser) openBrowser(url);
}

// ── init ─────────────────────────────────────────────────────────────────

async function init(name, dir) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("name must be lowercase letters, digits, dashes");
  const tpl = await readFile(path.join(ROOT, "blueprints", "_template.blueprint.js"), "utf8");
  const outDir = path.join(dir, "blueprints");
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${name}.blueprint.js`);
  await writeFile(out, tpl.replace(/mysystem/g, name.replace(/-/g, "_")));
  console.log(`wrote ${out}`);
  console.log("next: edit the data, then `blueprint open " + out + "`");
}

// ── arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = [], opts = { port: 4319, noBrowser: false, dir: "." };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--no-browser") opts.noBrowser = true;
    else if (a === "--dir") opts.dir = argv[++i];
    else args.push(a);
  }
  return { args, opts };
}

const HELP = `blueprint — parchment isometric work-maps

  blueprint check <file...>                       validate blueprint data
  blueprint open <file...> [--port N] [--no-browser]   serve + open in browser
  blueprint init <name> [--dir .]                 scaffold from the template
  blueprint demo [--port N]                       serve the acidbath example
`;

async function main() {
  const { args, opts } = parseArgs(process.argv.slice(2));
  const cmd = args.shift();
  if (cmd === "check" && args.length) return check(args);
  if (cmd === "open" && args.length) return openCmd(args, opts);
  if (cmd === "init" && args.length) return init(args[0], opts.dir);
  if (cmd === "demo") return openCmd([path.join(ROOT, "blueprints", "acidbath.blueprint.js")], opts);
  process.stdout.write(HELP);
  process.exit(cmd === "help" || cmd === "--help" || !cmd ? 0 : 1);
}

main().catch((err) => { console.error("✗ " + err.message); process.exit(1); });
