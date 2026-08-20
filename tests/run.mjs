/* Test suite: scanner, layout, diff, validation — run with `npm test`. */
import assert from "node:assert/strict";
import { scanSource, assembleScene, scanFiles } from "../src/scan.mjs";
import { autoLayout } from "../src/layout.mjs";
import { diffScenes } from "../src/diff.mjs";
import { validateScene } from "../src/validate.mjs";

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("✓ " + name);
}

// ── scanner ──────────────────────────────────────────────────────────────

const SAMPLE = `
// bp:group engine The engine
/**
 * bp:node VAL "validate envelope" group:engine status:built
 * bp:does Rejects malformed envelopes before any spawn happens.
 * bp:condition Does not check signature expiry yet.
 */
export function validateEnvelope(env) {
  return Boolean(env);
}

// bp:node SPAWN "spawn worker" group:engine status:planned shape:box
// bp:edge VAL -> SPAWN : validated env
// bp:flow VAL SPAWN
export class Spawner {}

/** bp:node CFG group:misc */
export const loadConfig = () => ({});
`;

ok("scanner parses nodes with attrs, entity kinds, prose", () => {
  const { nodes, errors } = scanSource("adw/envelope.ts", SAMPLE);
  assert.equal(errors.length, 0);
  assert.equal(nodes.length, 3);
  const [val, spawn, cfg] = nodes;
  assert.equal(val.id, "VAL");
  assert.equal(val.label, "validate envelope");
  assert.equal(val.group, "engine");
  assert.equal(val._src.kind, "function");
  assert.equal(val._src.symbol, "validateEnvelope");
  assert.match(val.does, /Rejects malformed/);
  assert.match(val.condition, /signature expiry/);
  assert.equal(spawn._src.kind, "class");
  assert.equal(spawn.status, "planned");
  assert.equal(spawn.shape, "box");
  assert.equal(cfg._src.kind, "function"); // lowercase arrow
  assert.equal(cfg.label, "load config"); // humanized
});

ok("scanner parses edges, flow, groups", () => {
  const { edges, flow, groups } = scanSource("a.ts", SAMPLE);
  assert.deepEqual(edges, [{ from: "VAL", to: "SPAWN", label: "validated env" }]);
  assert.deepEqual(flow, ["VAL", "SPAWN"]);
  assert.deepEqual(groups, [{ id: "engine", title: "The engine" }]);
});

ok("scanner flags PascalCase functions as components, no-entity as module", () => {
  const src = "// bp:node BTN\nexport function Button() {}\n// bp:node MOD\n";
  const { nodes } = scanSource("ui.tsx", src);
  assert.equal(nodes[0]._src.kind, "component");
  assert.equal(nodes[1]._src.kind, "module");
});

ok("entity binding ignores declarations inside docs and supports inline block directives", () => {
  const src = [
    "/** bp:node DOC group:g",
    " * class FakeFromDocs {}",
    " */",
    "const text = 'function FakeFromString() {}';",
    "/* bp:node INLINE group:g */ function realInline() {}",
  ].join("\n");
  const { nodes } = scanSource("module.ts", src);
  assert.equal(nodes[0]._src.kind, "module");
  assert.equal(nodes[1]._src.kind, "function");
  assert.equal(nodes[1]._src.symbol, "realInline");
});

ok("scanner reports bad directives", () => {
  const { errors, warnings } = scanSource("x.ts", "// bp:edge A B\n// bp:does orphan text\n");
  assert.equal(errors.length, 1);
  assert.equal(warnings.length, 1);
});

ok("assembleScene dedupes ids, defaults shape by kind, derives flow", () => {
  const parts = [
    scanSource("a.ts", "// bp:node A\nexport function a() {}\n// bp:edge A -> B : goes\n"),
    scanSource("b.ts", "// bp:node B\nexport class B {}\n// bp:node A\nexport function dup() {}\n"),
  ];
  const { scene, errors } = assembleScene(parts);
  assert.equal(errors.length, 1); // duplicate A
  assert.equal(scene.nodes.length, 2);
  assert.equal(scene.nodes[0].shape, "slab");  // function
  assert.equal(scene.nodes[1].shape, "box");   // class
  assert.deepEqual(scene.flow, ["A", "B"]);    // derived
  assert.match(scene.nodes[0].built, /a\.ts:2 — function a/); // provenance
});

ok("scanner ignores bp: inside strings and template literals", () => {
  const src = [
    'const msg = "bad bp:edge (want A -> B)";',
    "const tpl = `// bp:node FAKE",
    "still template bp:node FAKE2",
    "`;",
    "// bp:node REAL",
    "export function real() {}",
    "const s = 'bp:node ALSOFAKE'; // bp:edge REAL -> REAL : self",
  ].join("\n");
  const { nodes, edges } = scanSource("x.ts", src);
  assert.deepEqual(nodes.map((n) => n.id), ["REAL"]);
  assert.deepEqual(edges.map((e) => e.from + ">" + e.to), ["REAL>REAL"]);
});

// ── layout ───────────────────────────────────────────────────────────────

ok("layout assigns collision-free positions, respects explicit pos", () => {
  const { scene } = scanFiles([
    { file: "a.ts", text: "// bp:node A\n// bp:node B\n// bp:node C pos:9,9\n// bp:node D\n// bp:edge A -> B\n// bp:edge B -> D\n// bp:flow A B D\n" },
  ]);
  autoLayout(scene.nodes, scene.edges);
  const poses = scene.nodes.map((n) => n.pos.join(","));
  assert.ok(scene.nodes.every((n) => Array.isArray(n.pos)));
  assert.equal(new Set(poses).size, poses.length); // no collisions
  const c = scene.nodes.find((n) => n.id === "C");
  assert.equal(c.pos.join(","), "9,9"); // explicit kept
  const a = scene.nodes.find((n) => n.id === "A");
  const d = scene.nodes.find((n) => n.id === "D");
  assert.ok(d.pos[1] > a.pos[1]); // downstream is lower
});

// ── diff ─────────────────────────────────────────────────────────────────

ok("diff marks added / removed / changed / unchanged", () => {
  const before = {
    nodes: [
      { id: "A", label: "a", pos: [0, 0], status: "built" },
      { id: "B", label: "b", pos: [2, 0], status: "built", does: "old" },
      { id: "C", label: "c", pos: [4, 0], status: "built" },
    ],
    edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }],
    flow: ["A", "B", "C"],
  };
  const after = {
    nodes: [
      { id: "A", label: "a", pos: [0, 0], status: "built" },
      { id: "B", label: "b", pos: [2, 0], status: "broken", does: "old" },
      { id: "D", label: "d", pos: [6, 0], status: "planned" },
    ],
    edges: [{ from: "A", to: "B" }],
    flow: ["A", "B"],
    groups: [{ id: "g", title: "G" }],
  };
  const d = diffScenes(before, after);
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  assert.equal(byId.A.delta, undefined);
  assert.equal(byId.B.delta, "changed");
  assert.deepEqual(byId.B.changes, ["status: built → broken"]);
  assert.equal(byId.C.delta, "removed");
  assert.equal(byId.D.delta, "added");
  const ab = d.edges.find((e) => e.from === "A");
  const bc = d.edges.find((e) => e.from === "B");
  assert.equal(ab.delta, undefined);
  assert.equal(bc.delta, "removed");
  assert.equal(d._hasDelta, true);
  assert.deepEqual(d.flow, ["A", "B"]); // removed node filtered out
  assert.match(d.description, /1 added/);
  assert.match(d.description, /1 removed/);
  assert.match(d.description, /1 changed/);
});

ok("diff of identical scenes reports no structural changes", () => {
  const s = { nodes: [{ id: "A", pos: [0, 0], label: "a" }], edges: [] };
  const d = diffScenes(s, s);
  assert.equal(d.nodes[0].delta, undefined);
  assert.match(d.description, /no structural changes/);
});

// ── validation of generated scenes ───────────────────────────────────────

ok("scanned + laid-out scene passes validateScene clean", () => {
  const { scene } = scanFiles([
    { file: "m.ts", text: "// bp:group g The group\n// bp:node A group:g\n// bp:does does things\nexport function a() {}\n// bp:node B group:g\n// bp:does other things\nexport function b() {}\n// bp:edge A -> B : calls\n// bp:flow A B\n" },
  ]);
  autoLayout(scene.nodes, scene.edges);
  const errors = [], warnings = [];
  validateScene(scene, "test", errors, warnings);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

console.log(`\n${passed} passed`);

/* bp:node TST "engine tests" group:guards shape:box
 * bp:does Nine assertions across scanner, layout, diff, and validation.
 * bp:built tests/run.mjs — node:assert, run by npm test.
 * bp:edge TST -> SCAN : guards
 * bp:edge TST -> DIFF : guards
 */
