# Blueprint — parchment isometric work-maps

A standalone, dependency-free way to draw a system as an isometric blueprint:
what exists, what is being built, and what is only planned — in one picture.

Open it:

```bash
git clone git@github.com:ameno-/blueprint.git && cd blueprint
open index.html          # macOS — or double-click; no build step, no server
```

Deliberately **not** wired into any dashboard, docs, or ticket system. It is a
plain file you can open, diff, and keep beside the work it describes.

## CLI

Zero dependencies, node ≥ 18. Install globally from the repo:

```bash
npm i -g git+https://github.com/ameno-/blueprint.git   # or: npm link  from a clone
```

```
blueprint check <file...>                          validate blueprint data
blueprint open <file...> [--port N] [--no-browser]   serve + open in browser
blueprint init <name> [--dir .]                    scaffold from the template
blueprint demo                                     serve the acidbath example
blueprint map <pack|--all> [--config p] [--stdout] scan bp: directives → data
blueprint diff <a> <b> [--out f]                   diff two blueprint files
blueprint diff --ref <gitref> --pack <name>        diff a pack across a ref
```

`check` fails CI-style (exit 1) on unknown edge/flow references, duplicate
ids, undeclared groups, bad statuses, and malformed geometry; it warns on
isolated nodes, footprint overlaps, missing prose, and `broken` nodes with no
`condition`. `open` serves any blueprint file from anywhere — no copying into
the viewer directory. Deep links: `?b=<name>&select=<NODEID>`.

---

## Small blueprints: functions, classes, modules, components

Hand-authoring is for systems. For code-level scenes — the functions of a
module, the components of a view — put **directives in source comments** and
let the CLI derive the picture:

```ts
/**
 * bp:node VAL "validate envelope" group:intake status:built
 * bp:does Rejects malformed envelopes before any spawn happens.
 * bp:condition Does not check signature expiry yet.
 */
export function validateEnvelope(env) { … }

// bp:node SPAWN "spawn worker" group:intake status:planned shape:box
// bp:edge VAL -> SPAWN : validated env
// bp:flow VAL SPAWN
export class Spawner { … }
```

Directives (only ever read from comments — strings and template literals are
ignored):

| directive | meaning |
|---|---|
| `bp:node <ID> ["label"] [group:g] [status:s] [shape:box\|slab\|stack] [pos:x,y] [height:n] [count:n]` | declare a structure; binds to the entity (class/function/const/type) declared within ~8 lines below, else the file itself as a module |
| `bp:summary` / `bp:does` / `bp:built` / `bp:condition` `<text>` | panel prose; attaches to the previous `bp:node`; repeatable |
| `bp:edge <FROM> -> <TO> [: label] [status:s]` | wire between ids |
| `bp:flow <ID> [<ID> …]` | the trace loop; derived from the wires if omitted |
| `bp:group <id> <title…>` | legend section |

Entity kinds pick default shapes: `class`/`component` → box, `function`/`type`
→ slab, `module` → stack. PascalCase functions count as components.
Provenance (`file:line — kind symbol`) is appended to `built` automatically.

### Packs

A **pack** is a named scope the tool can map. Declare packs in
`blueprint.json` at the repo root:

```json
{
  "packs": {
    "envelope": {
      "files": ["adw/envelope.ts", "adw/delegate.ts"],
      "scene": { "title": "ENVELOPE", "description": "…", "legendTitle": "the lane" }
    }
  }
}
```

`files` supports `*` and `**` globs. `scene` holds the hand-written narrative
that scanned data can't know. Then:

```bash
blueprint map envelope        # writes blueprints/envelope.blueprint.js
blueprint map --all
```

Generated files are artifacts — edit the directives, never the output.
Positions are auto-laid (longest-path ranks) unless a directive sets `pos:`.

### blueprint diff — before/after for review

```bash
blueprint diff old.blueprint.js new.blueprint.js     # two data files
blueprint diff --ref main --pack envelope            # pack at ref vs worktree
blueprint diff --ref HEAD~3 --pack envelope --out review/diff.blueprint.js
```

Diff renders a merged scene with its own vocabulary: **`+` badge = added**,
**hollow diamond = changed** (with a per-field change list in the panel),
**ghost = removed**. The header gains a **changed only** filter (key: `c`) that
hides untouched structures and their wires — that's how big PRs stay
reviewable: one pack at a time, filtered to the delta.

---

## Generate a blueprint for a repo — step by step

The fastest path is to point a coding agent at this section and say
*"blueprint this repo"* — but every step below is mechanical enough to do by
hand. Copy `blueprints/_template.blueprint.js` to start.

1. **Inventory the structures.** List the repo's moving parts: entry points,
   pipelines, stores, surfaces, external capabilities, test suites. Sources:
   the README, the package manifest, top-level directories, the test scripts.
   Target **8–25 nodes** — fewer and the picture is thin, more and it stops
   being a map.
2. **Group them.** 3–6 groups with short titles (`the shell`, `session
   intelligence`, `the plans`). Groups become the legend sections. One group
   should be the plans — work that is decided but not switched on.
3. **Assign letter keys.** Every structure gets a short id (`H`, `T`, `K`,
   `OP`). It is drawn on the block and used in edges, flow, and prose.
   Keys are stable once published — treat renames as breaking.
4. **Mark status truthfully.** `built` · `in-progress` · `planned` · `broken`.
   This is the entire point of the exercise: the picture is a plan of record,
   and it only works if the statuses are honest today, not aspirational.
5. **Draw the wires.** An edge per real data/control flow, labeled with the
   verb (`"usage events"`, `"feeds reducer"`). Planned flows get
   `status: "planned"` and render dashed.
6. **Choose ONE flow loop.** The `flow` array is the single story you would
   trace for a newcomer, in order; the renderer loops it. Side connections
   stay plain edges.
7. **Hand-lay the grid.** Set `pos` per node like composing a drawing:
   related things near each other, the loop readable left-to-right, plans
   inside a dashed `region`. Conventions: **tall = measuring**, `slab` =
   pass-through, `stack` = layered. There is no auto-layout on purpose.
8. **Write the panels.** Per node: `summary` (one honest line for hover),
   `does` (plain language), `built` (files, functions, wiring), and
   `condition` when something is currently wrong. Use `==chips==` for
   load-bearing terms.
9. **Add `steps` where execution matters.** A node with a runtime story gets a
   nested scene (`nodes`, `edges`, `flow`) — viewers drill in with
   **→ go inside**. Steps are *execution order*, not a parts list.
10. **Register and verify.** Add the file to `index.html` with a
    `<script src="blueprints/<name>.blueprint.js">` tag, open
    `index.html?b=<name>`, then: trace the whole loop with `resume the flow`,
    click every node, and check each status against reality. If the trace
    surprises you, the flow is wrong — fix the data, not the renderer.

---

## Using it during review and bug triage

The same picture doubles as a review instrument. To walk a reviewer — or a
future you — through a bug:

1. **Set the failing structure to `status: "broken"`** and write its
   `condition` as the bug story: symptom, mechanism, evidence (failing test,
   log line, Linear issue).
2. **Mark the broken wire `status: "broken"`** — it renders with a × cut —
   where the contract between two structures actually fails.
3. **Point `flow` at the failing path** so `trace one step` walks the bug
   end-to-end, selecting each structure as the pulse arrives.
4. **Add the fix as `planned`** nodes/edges, with `steps` for the execution
   plan — reviewers drill in with **→ go inside**.
5. **Share a focused link**: `blueprint open` the file and send
   `http://localhost:4319/?b=<name>&select=<NODEID>`.
6. **When the fix lands, flip statuses back.** The condition text lives in git
   history — not on the diagram.

---

## The picture

- **Header strip** — repository/title, key metrics, an auto-computed status
  tally, and the flow controls (`▶ resume the flow`, `trace one step`,
  `reset view`).
- **Left legend** — every structure, grouped, with its letter key and instance
  count. Planned rows are dashed; in-progress rows carry a `◆`; broken rows are
  struck through. Hover a row to flash its block; click to select.
- **Center canvas** — isometric wireframe blocks on a parchment grid. Solid +
  hatched = built; dashed ghost = planned; black diamond = in progress; crossed
  top = broken. Blocks can be `box`, `slab`, or `stack` (a pile of plates —
  use it for layered things). Wires run between blocks with a dot at the
  source and an arrowhead into the target; planned wires are dashed.
- **Right panel** — two tabs. **What it does** is plain language plus a
  `condition` callout (what is currently wrong). **How it's built** is the
  implementation record: prose, status/group/instances, and the connection
  list. Nothing selected → the blueprint's own overview and reading guide.
- **Footer** — the interaction grammar.

Interactions: hover to read · click to select · `→` / `enter` goes inside a
structure (its `steps`, as a scene of its own) · `←` / `esc` comes back out ·
`↓↑` move selection · drag to pan · scroll to zoom · `trace one step` walks the
flow loop node by node (selecting as it goes) · `resume the flow` runs it
continuously until you touch anything.

## Authoring reference

Blueprints are plain JS data files that register themselves, so `file://`
works with no server or fetch:

```js
// blueprints/mysystem.blueprint.js
window.BLUEPRINTS = Object.assign(window.BLUEPRINTS || {}, {
  mysystem: { /* blueprint object below */ },
});
```

### Blueprint object

| field | meaning |
|---|---|
| `title`, `subtitle` | header strip identity |
| `headLabel` | label over the title cell (default `repository`) |
| `legendTitle` | legend heading (default `the system`) |
| `heading`, `tagline` | right-panel overview title/subtitle |
| `description` | overview prose (what this is) |
| `built` | overview construction notes (how-it's-built tab) |
| `metrics` | `[{label, value}]` header cells; `structures` and `status` are auto-added |
| `groups` | `[{id, title}]` — legend sections, in order |
| `regions` | `[{label, rect:[x,y,w,d]}]` — dashed floor regions (e.g. "plans") |
| `nodes` | structures (below) |
| `edges` | `[{from, to, label?, status?}]` — wires between node ids |
| `flow` | `[nodeId, …]` — the loop the trace buttons walk (wraps around) |
| `focus` | node id selected on load (URL `?select=` overrides) |

### Node

| field | default | meaning |
|---|---|---|
| `id` | — | short letter key, drawn on the block (`"K"`) |
| `label` | — | legend/panel name |
| `group` | `misc` | one of `groups[].id` |
| `pos` | — | `[x, y]` on the grid, **hand-laid** (like the drawing it imitates) |
| `size` | `[1.6,1.6]` | footprint `[w, d]` in grid units |
| `height` | `1.6` | extrusion height (`box` only) |
| `shape` | `box` | `box` · `slab` (flat) · `stack` (plates, see `plates`) |
| `status` | `built` | `built` · `in-progress` · `planned` · `broken` |
| `count` | `1` | instance count in legend/status tally |
| `summary` | — | hover tooltip one-liner |
| `does` | — | what-it-does tab prose |
| `built` | — | how-it's-built tab prose |
| `condition` | — | what is currently wrong (renders as a callout) |
| `steps` | — | nested scene `{nodes, edges, flow, …}` — enables **go inside** |

Prose fields support `**bold**` and `==highlight chips==`. Blank lines split
paragraphs.

## Files

```
index.html                        shell (script-tag loading, ?b=name picker)
blueprint.css                     parchment theme
blueprint.js                      renderer + interactions (no dependencies)
cli.mjs                           blueprint check / open / init / demo / map / diff
src/scan.mjs                      bp: directive scanner (comment-lexed)
src/layout.mjs                    layered auto-layout
src/diff.mjs                      scene diff → delta vocabulary
src/validate.mjs                  schema validation
blueprint.json                    pack declarations (dogfood: the cli maps itself)
tests/run.mjs                     engine tests (npm test)
blueprints/
  acidbath.blueprint.js           worked example: a real package's work + plans
  cli.blueprint.js                generated: this tool drawn from its own directives
  _template.blueprint.js          starting point for your own
```

Known limits: single-elbow edge routing, hand-laid positions, no tests, no
mobile affordances.
