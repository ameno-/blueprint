#!/usr/bin/env node
/* blueprint — CLI for parchment isometric work-maps.
 * Zero dependencies. Commands:
 *   blueprint check <file...>                      validate blueprint data files
 *   blueprint open <file...> [--port N] [--no-browser]
 *   blueprint init <name> [--dir .]                scaffold a new blueprint from the template
 *   blueprint demo [--port N]                      serve the bundled acidbath example
 *   blueprint map <pack|--all> [--config path] [--stdout] [--out dir]
 *                                                  scan bp: directives in a pack's files -> blueprint data
 *   blueprint diff <a.blueprint.js> <b.blueprint.js> [--out file] [--no-browser]
 *   blueprint diff --ref <gitref> --pack <name> [--config path] [--out file] [--no-browser]
 *                                                  before = pack scanned at <gitref>, after = worktree
 */
import http from "node:http";
import os from "node:os";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateScene } from "./src/validate.mjs";
import { scanSource, assembleScene } from "./src/scan.mjs";
import { autoLayout } from "./src/layout.mjs";
import { diffScenes } from "./src/diff.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ── loading / serializing blueprint data ─────────────────────────────────

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

function serializeScene(name, scene, banner) {
  const head = banner || `/* ${name} — blueprint data. See README.md for the schema. */`;
  return `${head}\nwindow.BLUEPRINTS = Object.assign(window.BLUEPRINTS || {}, {\n  ${JSON.stringify(name)}: ${JSON.stringify(scene, null, 2)},\n});\n`;
}

// ── check ────────────────────────────────────────────────────────────────

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
      validateScene(bp, name, errors, warnings);
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

// ── serve / open ─────────────────────────────────────────────────────────

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
  console.log(`next: edit the data, then \`blueprint open ${out}\``);
}

// ── packs / map ──────────────────────────────────────────────────────────

async function loadConfig(configPath) {
  const file = configPath || path.join(process.cwd(), "blueprint.json");
  try {
    return { file, config: JSON.parse(await readFile(file, "utf8")) };
  } catch (err) {
    throw new Error(`cannot read pack config ${file} — ${err.message}`);
  }
}

async function listPacks(opts) {
  const { file, config } = await loadConfig(opts.config);
  const packs = config.packs || {};
  const names = Object.keys(packs);
  if (!names.length) {
    console.log(`no packs declared in ${file}`);
    return;
  }
  for (const name of names) {
    const files = packs[name].files || [];
    console.log(`${name}\t${files.join(", ")}`);
  }
}

// micro-glob: supports * (within a segment) and ** (any depth)
async function resolveGlob(pattern, cwd) {
  if (!pattern.includes("*")) return [pattern];
  const base = pattern.split("*")[0].replace(/[/][^/]*$/, "") || ".";
  const re = new RegExp(
    "^" + pattern.split(/(\*\*|\*)/).map((p) =>
      p === "**" ? ".*" : p === "*" ? "[^/]*" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).join("") + "$"
  );
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = path.relative(cwd, path.join(dir, e.name));
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) await walk(path.join(dir, e.name));
      } else if (re.test(rel)) out.push(rel);
    }
  }
  await walk(path.resolve(cwd, base));
  return out.sort();
}

async function packFiles(pack, cwd) {
  const files = [];
  for (const pattern of pack.files || []) {
    files.push(...await resolveGlob(pattern, cwd));
  }
  return [...new Set(files)];
}

async function scanPack(pack, cwd, readText) {
  const files = await packFiles(pack, cwd);
  if (!files.length) throw new Error(`pack matched no files: ${(pack.files || []).join(", ")}`);
  const read = readText || ((f) => readFile(path.join(cwd, f), "utf8"));
  const parts = [];
  for (const f of files) {
    let text;
    try { text = await read(f); } catch { continue; } // file absent in this ref — contributes nothing
    parts.push(scanSource(f, text));
  }
  return { files, ...assembleScene(parts, pack.scene || {}) };
}

const GEN_BANNER = "/* GENERATED by `blueprint map` from bp: directives in source.\n * Edit the directives, not this file. Regenerate with: blueprint map <pack> */";

async function mapCmd(packNames, opts) {
  const { file, config } = await loadConfig(opts.config);
  const cwd = path.dirname(file);
  const names = opts.all ? Object.keys(config.packs || {}) : packNames;
  if (!names.length) throw new Error("no packs declared in " + file);
  for (const name of names) {
    const pack = (config.packs || {})[name];
    if (!pack) throw new Error(`unknown pack "${name}" in ${file}`);
    const { scene, errors, warnings, files } = await scanPack(pack, cwd);
    autoLayout(scene.nodes, scene.edges);
    const warn = opts.stdout ? console.error : console.log;
    for (const w of warnings) warn(`  ⚠ ${w}`);
    if (errors.length) {
      for (const e of errors) console.error(`  ✗ ${e}`);
      throw new Error(`pack "${name}" has ${errors.length} scan errors`);
    }
    const verrors = [], vwarnings = [];
    validateScene(scene, name, verrors, vwarnings);
    if (verrors.length) {
      for (const e of verrors) console.error(`  ✗ ${e}`);
      throw new Error(`pack "${name}" produced an invalid scene`);
    }
    for (const w of vwarnings) warn(`  ⚠ ${w}`);
    const text = serializeScene(name, scene, GEN_BANNER);
    if (opts.stdout) {
      process.stdout.write(text);
    } else {
      const outDir = opts.out || path.join(cwd, "blueprints");
      await mkdir(outDir, { recursive: true });
      const out = path.join(outDir, `${name}.blueprint.js`);
      await writeFile(out, text);
      console.log(`✓ ${name}: ${scene.nodes.length} structures, ${scene.edges.length} wires from ${files.length} files → ${out}`);
    }
  }
}

// ── diff ─────────────────────────────────────────────────────────────────

function gitReader(ref, repoRoot) {
  return async (relPath) => {
    try {
      return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    }
  };
}

async function diffCmd(args, opts) {
  let before, after, name;

  if (opts.ref) {
    const { file, config } = await loadConfig(opts.config);
    const cwd = path.dirname(file);
    const pack = (config.packs || {})[opts.pack];
    if (!opts.pack || !pack) throw new Error(`diff --ref needs --pack <name> (packs in ${file}: ${Object.keys(config.packs || {}).join(", ") || "none"})`);
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
    const readAtRef = gitReader(opts.ref, repoRoot);
    const beforeScan = await scanPack(pack, repoRoot, async (f) => readAtRef(f));
    const afterScan = await scanPack(pack, repoRoot);
    for (const [label, result] of [[opts.ref, beforeScan], ["worktree", afterScan]]) {
      if (result.errors.length) throw new Error(`${label} pack has ${result.errors.length} scan errors: ${result.errors.join("; ")}`);
    }
    before = beforeScan.scene; after = afterScan.scene; name = opts.pack;
    if (!before.nodes.length && !after.nodes.length) throw new Error(`pack "${opts.pack}" has no directives at ${opts.ref} or in the worktree`);
  } else {
    if (args.length < 2) throw new Error("diff needs two blueprint files (or --ref <gitref> --pack <name>)");
    const a = await loadBlueprints(args[0]);
    const b = await loadBlueprints(args[1]);
    name = Object.keys(b)[0];
    before = a[Object.keys(a)[0]];
    after = b[name];
  }

  autoLayout(before.nodes, before.edges);
  autoLayout(after.nodes, after.edges);
  const scene = diffScenes(before, after);
  const text = serializeScene(`${name}.diff`, scene, "/* GENERATED by `blueprint diff`. */");

  if (opts.out) {
    await writeFile(opts.out, text);
    console.log(`✓ diff written to ${opts.out}`);
    return;
  }
  const tmp = path.join(os.tmpdir(), `blueprint-diff-${Date.now()}.blueprint.js`);
  await writeFile(tmp, text);
  console.log(`diff: ${scene.tagline}`);
  await openCmd([tmp], opts);
}

// ── args / dispatch ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = [], opts = { port: 4319, noBrowser: false, dir: ".", config: null, out: null, stdout: false, ref: null, pack: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--no-browser") opts.noBrowser = true;
    else if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--config") opts.config = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--stdout") opts.stdout = true;
    else if (a === "--ref") opts.ref = argv[++i];
    else if (a === "--pack") opts.pack = argv[++i];
    else if (a === "--all") opts.all = true;
    else args.push(a);
  }
  return { args, opts };
}

const HELP = `blueprint — parchment isometric work-maps

  blueprint check <file...>                          validate blueprint data
  blueprint open <file...> [--port N] [--no-browser] serve + open in browser
  blueprint init <name> [--dir .]                    scaffold from the template
  blueprint demo [--port N]                          serve the acidbath example
  blueprint packs [--config p]                         list declared packs
  blueprint map <pack|--all> [--config p] [--stdout] scan bp: directives -> data
  blueprint diff <a> <b> [--out f]                   diff two blueprint files
  blueprint diff --ref <gitref> --pack <name>        diff a pack across a ref
`;

async function main() {
  const { args, opts } = parseArgs(process.argv.slice(2));
  const cmd = args.shift();
  if (cmd === "check" && args.length) return check(args);
  if (cmd === "open" && args.length) return openCmd(args, opts);
  if (cmd === "init" && args.length) return init(args[0], opts.dir);
  if (cmd === "demo") return openCmd([path.join(ROOT, "blueprints", "acidbath.blueprint.js")], opts);
  if (cmd === "packs") return listPacks(opts);
  if (cmd === "map" && (args.length || opts.all)) return mapCmd(args, opts);
  if (cmd === "diff") return diffCmd(args, opts);
  process.stdout.write(HELP);
  process.exit(cmd === "help" || cmd === "--help" || !cmd ? 0 : 1);
}

main().catch((err) => { console.error("✗ " + err.message); process.exit(1); });

/* ── blueprint directives ─────────────────────────────────────────────────
 * bp:group the-cli The CLI
 * bp:group engines Engines
 * bp:group the-viewer The viewer
 * bp:group guards Guards
 * bp:group plans The plans
 * bp:node CLI "command dispatch" group:the-cli
 * bp:does Parses argv and dispatches: ==check==, ==open==, ==init==, ==demo==, ==map==, ==diff==.
 * bp:built cli.mjs — zero-dep node ESM entry; serves the viewer over http.
 * bp:flow CLI SCAN LAY
 * bp:edge CLI -> SCAN : map · diff --ref
 * bp:edge CLI -> VAL : check
 * bp:edge CLI -> DIFF : file / ref diff
 * bp:edge CLI -> REND : serves the viewer
 * bp:node WATCH "watch mode" group:plans status:planned pos:-4.5,1.5
 * bp:does Re-map packs when sources change; keep the picture live during a session.
 * bp:condition Not started; needs a debounce and a served-page reload channel.
 * bp:edge WATCH -> CLI : re-runs map status:planned
 * bp:node PNG "snapshot export" group:plans status:planned pos:5,6.5
 * bp:does Export the scene as SVG/PNG for Linear comments and docs.
 * bp:edge REND -> PNG : export status:planned
 */
