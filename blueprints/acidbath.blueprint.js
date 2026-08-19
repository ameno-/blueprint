/* Blueprint instance: the acidbath package itself.
 * Current work (solid), in-progress work (diamond), planned work (dashed).
 * Registers into window.BLUEPRINTS.acidbath — loaded by blueprint/index.html.
 */
window.BLUEPRINTS = Object.assign(window.BLUEPRINTS || {}, {
  acidbath: {
    title: "ACIDBATH",
    subtitle: "pi ui package",
    headLabel: "repository",
    legendTitle: "the package",
    heading: "The Presentation Layer",
    tagline: "how a pi session looks, moves, and reports itself",

    description:
      "This repository is a ==pi ui package== plus the tooling that feeds it. " +
      "A session starts, the shell paints itself around the editor, every agent " +
      "event lands in a rail, a row, or a rail again, and a pure reducer keeps " +
      "the token books. Bundled research tools give the agent eyes; the workflow " +
      "layer hands work to other agents and files the results.\n\n" +
      "The diagram is a ==loop== because a turn is one: prompt → activity → " +
      "tool rows → token books → footer → summary → next prompt. Everything in " +
      "the dashed region is planned; the diamond is being built right now — it " +
      "is this very blueprint renderer.",

    built:
      "Plain typescript extensions loaded through the ==pi.extensions== manifest, " +
      "plus two bundled capability packages (==pi-research==, ==pi-web-access==). " +
      "No build step for this blueprint: ==blueprint.js== renders the scene " +
      "straight from a declarative data file. Tests are node scripts run with " +
      "==--experimental-strip-types==.",

    metrics: [
      { label: "test suites", value: "15" },
      { label: "themes", value: "2" },
      { label: "bundled tools", value: "6" },
    ],

    groups: [
      { id: "shell", title: "the shell" },
      { id: "intel", title: "session intelligence" },
      { id: "caps", title: "capabilities" },
      { id: "work", title: "the workflow" },
      { id: "plans", title: "the plans" },
    ],

    regions: [
      { label: "plans — not switched on", rect: [8.2, -0.2, 6.9, 4.4] },
    ],

    nodes: [
      // ── the shell ──
      {
        id: "H", label: "startup header", group: "shell",
        pos: [1, 1], size: [2.6, 1.4], height: 2.4,
        summary: "Centered ACIDBATH wordmark with theme-derived gradient.",
        does: "Paints the big centered ==wordmark== at session start, derives a smooth gradient from the active theme's accent color, clips safely to narrow terminals, and falls back to plain text when ==NO_COLOR== is set.",
        built: "extensions/acidbath/ui-header.ts. Gradient from theme accent; width-aware clipping.",
      },
      {
        id: "W", label: "welcome card", group: "shell",
        pos: [4.2, 1], size: [1.8, 1.2], height: 1.1,
        summary: "Transient above-editor welcome: cwd, model card, preflight, one Stoic line.",
        does: "Shows ==cwd==, a native-cost ==model card== (name, price per million tokens, thinking level), compact preflight status, and one centered yellow ==stoic== message — then dismisses before the first turn.",
        built: "extensions/acidbath/ui-welcome.ts. Transient above-editor widget; stoic messages are curated and attributed.",
      },
      {
        id: "R", label: "activity rail", group: "shell",
        pos: [1, 3], size: [2.6, 0.8], height: 0.9,
        summary: "One transient rail above the editor for listening, reasoning, composing, tool work.",
        does: "The only animated lifecycle surface. Phase advances on ==real events==, never on a timer — every phase change piggybacks a render that was already happening.",
        built: "extensions/acidbath/ui-activity*.ts. Reduced-motion escape: PI_ACIDBATH_REDUCED_MOTION=1.",
      },
      {
        id: "E", label: "borderless editor", group: "shell",
        pos: [1, 4.4], size: [2.6, 1.8], height: 1.4,
        summary: "Borderless input with a static stylized prompt and a right-side context rail.",
        does: "Where prompts are written. Borderless frame, static ╰─› prompt, ==context rail== on the right. Fonts stay the terminal's business.",
        built: "extensions/acidbath editor wiring; prompt glyphs documented in docs/input-cursor-options.md.",
      },
      {
        id: "C", label: "context rail", group: "shell",
        pos: [4, 4.4], size: [0.8, 1.8], height: 1.1,
        summary: "Right-side rail beside the editor carrying context state.",
        does: "Rides beside the editor so ==context== state is visible without stealing the transcript.",
        built: "Part of the editor surface in extensions/acidbath.",
      },
      {
        id: "F", label: "footer rail", group: "shell",
        pos: [1, 6.8], size: [2.6, 0.8], height: 0.6, shape: "slab",
        summary: "Identity rail: gray cwd, red model, git branch, context and token usage.",
        does: "Owns identity: gray ==working directory==, red ==model name==, the current ==git branch==, plus context and token usage — in place of the less-actionable thinking label.",
        built: "extensions/acidbath footer components; usage comes from the K reducer.",
      },
      {
        id: "T", label: "tool rows", group: "shell",
        pos: [4.4, 6.2], size: [1.8, 2.2], shape: "stack", plates: 4, count: 4,
        summary: "Deterministic built-in tool rows in the native transcript.",
        does: "Renders ==read==, ==bash==, ==edit==, ==write== and friends as deliberate native rows with native expanded details. Renderer-only: external tools are ==never intercepted==.",
        built: "extensions/acidbath tool renderers. Preserves pi's tool-expansion preference instead of forcing results open.",
      },

      // ── session intelligence ──
      {
        id: "S", label: "session summary", group: "intel",
        pos: [6.4, 2.2], size: [1.6, 1.2], height: 1.6,
        summary: "Dynamic ten-word summary pinned to the active header.",
        does: "Keeps a ==ten-word== description of what the session is doing pinned in the header, so a crowded terminal still says what this pane is for.",
        built: "Dynamic label synthesis, deterministic; no model output parsing.",
      },
      {
        id: "K", label: "token reducer", group: "intel",
        pos: [7, 4.6], size: [1.6, 1.6], height: 3,
        summary: "Pure token/context lifecycle reducer with truthful unknown/final usage.",
        does: "A ==pure reducer== over the session's token lifecycle. Tells the truth about ==unknown== and ==final== usage instead of inventing numbers. The tall structures are the measuring parts.",
        built: "Pure functions; benchmarked by scripts/bench-lifecycle.mjs; tested by test-token-context.",
      },
      {
        id: "P", label: "provenance banners", group: "intel",
        pos: [6.8, 7.4], size: [2, 1.1], height: 0.5, shape: "slab",
        summary: "Backgrounded banners: local timestamp + the prompt that triggered each run.",
        does: "After a run completes, files a quiet ==provenance== banner: local timestamp and the exact prompt that triggered it, so the transcript stays accountable.",
        built: "extensions/acidbath provenance wiring on agent-output completion.",
      },

      // ── capabilities ──
      {
        id: "A", label: "agy research", group: "caps",
        pos: [10, 4.8], size: [1.6, 1.4], height: 1.8, count: 2,
        summary: "Bundled agy_web_search + agy_research from ameno-/pi-research.",
        does: "The agent's ==web research== surface: quick grounded search and deep multi-source research. Permission-gated; ==/agy-setup== is explicit and never silent.",
        built: "Bundled pi-research package, pinned by git SHA in package.json. Requires a locally authenticated AGY CLI.",
      },
      {
        id: "Q", label: "web access", group: "caps",
        pos: [11.6, 6.2], size: [1.8, 1.8], height: 1.4, count: 4,
        summary: "web_search, fetch_content, get_search_content, source_check.",
        does: "Explicit ==page and evidence retrieval==: search, readable/raw fetches for pages, PDFs, video and GitHub, and passage-level ==source checks==.",
        built: "pi-web-access 0.20.0 from npm, declared as a first-party capability in the manifest.",
      },
      {
        id: "M", label: "themes", group: "caps",
        pos: [9.8, 8.4], size: [1.8, 1.1], height: 0.5, shape: "slab", count: 2,
        summary: "acidbath + acidbath-cyberdyne-teal reusable themes.",
        does: "Two curated ==themes== ship with the package and load everywhere pi loads.",
        built: "themes/acidbath.json and themes/acidbath-cyberdyne-teal.json via the pi.themes manifest glob.",
      },

      // ── the workflow ──
      {
        id: "D", label: "adw delegation", group: "work",
        pos: [5, 9.6], size: [2.2, 1.6], height: 1.6, count: 4,
        summary: "Delegate, preflight, research, and pipeline lanes for agent-driven work.",
        does: "Hands scoped work to ==worker agents==: delegation envelopes, preflight checks, research lanes, and pipeline runs — each with its own tests.",
        built: "adw/ — agents, command, delegate, envelope, pipeline, preflight, research; tested by npm run test:adw.",
      },
      {
        id: "X", label: "test suites", group: "work",
        pos: [1.8, 9.4], size: [1.8, 1.4], height: 1.2, count: 11,
        summary: "Node strip-types test scripts guarding every ui surface.",
        does: "Eleven suites guard the surfaces: ==manifest==, ==labels==, ==token-context==, ==summary==, ==lifecycle==, ==welcome==, ==activity==, ==footer== — plus four adw suites.",
        built: "scripts/test-*.mjs and adw/tests/*.mjs, run by npm test with --experimental-strip-types.",
      },
      {
        id: "V", label: "visual explainers", group: "work",
        pos: [8.2, 9.8], size: [1.8, 1.3], height: 0.8, count: 6,
        summary: "Hand-authored html explainer pages under docs/visuals.",
        does: "Six ==hand-authored== visual pages explaining architecture, labels, adoption, and roadmap. The blueprint pattern is borrowed from them — and then generalized.",
        built: "docs/visuals/*.html, mermaid via CDN. This renderer generalizes them into data.",
      },

      // ── the plans ──
      {
        id: "B", label: "blueprint renderer", group: "plans",
        pos: [8.6, 0.6], size: [1.6, 1.4], height: 2, status: "in-progress",
        summary: "This diagram. Data-driven parchment isometric work-map.",
        does: "Turns a ==declarative blueprint== into this drawing: blocks, wires, legend, tabs, trace, drill-down. A way to represent ==the work== and ==the plans for the work== in one picture.",
        built: "blueprint/ — blueprint.js (renderer), blueprint.css (parchment theme), blueprints/*.blueprint.js (data). No build step, no dependencies.",
        condition: "First pass. Edge routing is single-elbow and ==hand-laid== positions; no auto-layout, no tests, no mobile affordances yet.",
        steps: {
          heading: "Building the renderer",
          tagline: "the steps this structure executes",
          description: "How a blueprint file becomes the drawing: ==parse== the data, lay the ==floor==, raise the ==blocks==, run the ==wires==, wire the ==trace==, then honor ==drill-down==.",
          legendTitle: "steps in execution",
          nodes: [
            { id: "1", label: "parse schema", group: "misc", pos: [0, 0], size: [1.6, 1.4], summary: "Normalize nodes, defaults, groups, flow.", does: "Reads the blueprint file, fills defaults, indexes nodes by id.", built: "prepScene() in blueprint.js." },
            { id: "2", label: "lay the floor", group: "misc", pos: [3, 0], size: [1.6, 1.4], summary: "Bounds, iso grid, dashed plan regions.", does: "Computes scene bounds and paints the parchment grid and dashed regions.", built: "renderScene() floor + region passes." },
            { id: "3", label: "raise blocks", group: "misc", pos: [6, 0], size: [1.6, 1.4], summary: "Boxes, slabs, stacks; status styling.", does: "Extrudes each structure; status picks solid, dashed, diamond, or cross.", built: "drawBox()/drawNode() with painter sort." },
            { id: "4", label: "run wires", group: "misc", pos: [0, 3], size: [1.6, 1.4], summary: "Elbow wires, dots, arrowheads, labels.", does: "Routes each edge out of a footprint, one elbow, into the target.", built: "edgePolyline() + arrowhead geometry." },
            { id: "5", label: "wire the trace", group: "misc", pos: [3, 3], size: [1.6, 1.4], summary: "Measurable hidden paths, pulse, dwell.", does: "Concatenates flow edges into measurable paths and drives the ink pulse along them.", built: "runSeg() + getPointAtLength on hidden paths." },
            { id: "6", label: "drill down", group: "misc", pos: [6, 3], size: [1.6, 1.4], summary: "Scene stack, breadcrumbs, come back out.", does: "Pushes a structure's steps as a new scene; ← comes back out.", built: "enterScene()/popToScene() over a scene stack." },
          ],
          edges: [
            { from: "1", to: "2" }, { from: "2", to: "3" }, { from: "3", to: "4" },
            { from: "4", to: "5" }, { from: "5", to: "6" },
          ],
          flow: ["1", "2", "3", "4", "5", "6"],
        },
      },
      {
        id: "G", label: "herdr-subagents", group: "plans",
        pos: [11, 0.8], size: [1.6, 1.4], height: 1.8, status: "planned",
        summary: "Local profiles, bounded spawn/fleet/message tools, result envelopes.",
        does: "Herdr will own panes, PTYs, worktrees, and lifecycle; ==herdr-subagents== adds local profiles, bounded ==spawn/fleet/message== tools, result envelopes, and a read-only viewer, with an optional event adapter back into the shell.",
        built: "Spec only. See docs/HANDOFF-next-sessions.md — local-only MVP; identities keep host/session/workspace/tab/pane fields for future transport.",
        condition: "Not started; waiting on the herdr adapter boundary.",
      },
      {
        id: "L", label: "profile gates", group: "plans",
        pos: [13.2, 2.2], size: [1.5, 1.3], height: 1.4, status: "planned",
        summary: "Capability profiles: debug/explore/eval gates, network by profile only.",
        does: "Turns the toolbox into ==capability profiles==: pi-lens only in ==debug==, network only through an explicitly selected profile, eval profile freezes motion.",
        built: "Spec in docs/PLAN.md §0 — profiles table agreed; implementation pending.",
      },
      {
        id: "N", label: "compaction continuation", group: "plans",
        pos: [9.6, 2.8], size: [1.5, 1.3], height: 1.2, status: "planned",
        summary: "Safe, bounded, deduplicated continuation between turns.",
        does: "When context compacts, continue ==safely==: bounded, deduplicated, and only ==between turns== — never mid-flight.",
        built: "Spec only; feeds the K reducer with compacted-usage events.",
      },
    ],

    edges: [
      { from: "H", to: "W", label: "session start" },
      { from: "W", to: "E", label: "dismisses into" },
      { from: "E", to: "R", label: "lifecycle events" },
      { from: "R", to: "T", label: "tool work" },
      { from: "T", to: "K", label: "usage events" },
      { from: "K", to: "F", label: "footer render" },
      { from: "K", to: "S", label: "context → header" },
      { from: "F", to: "S", label: "turn settles" },
      { from: "S", to: "E", label: "next turn", status: "planned" },
      { from: "T", to: "P", label: "completed runs" },
      { from: "M", to: "E", label: "theme tokens" },
      { from: "D", to: "A", label: "research lane" },
      { from: "D", to: "Q", label: "fetch lane" },
      { from: "D", to: "V", label: "writes runbooks" },
      { from: "X", to: "T", label: "guards" },
      { from: "V", to: "B", label: "pattern from", status: "planned" },
      { from: "G", to: "D", label: "replaces transport", status: "planned" },
      { from: "L", to: "G", label: "gates profiles", status: "planned" },
      { from: "N", to: "K", label: "feeds reducer", status: "planned" },
    ],

    flow: ["E", "R", "T", "K", "F", "S"],
  },
});
