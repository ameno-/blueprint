/* Blueprint template — copy to blueprints/<name>.blueprint.js, fill in, and
 * register with a <script> tag in index.html. Delete fields you don't need.
 * Every field is documented in README.md.
 */
window.BLUEPRINTS = Object.assign(window.BLUEPRINTS || {}, {
  mysystem: {
    title: "MYSYSTEM",
    subtitle: "one-line identity",
    heading: "The Big Idea",
    tagline: "what the system is for, in a breath",

    description:
      "Plain prose with ==highlight chips== for the load-bearing terms. " +
      "Say what the system is, then why the diagram is shaped the way it is.",

    built: "Construction notes: languages, entry points, how the pieces load.",

    metrics: [
      { label: "modules", value: "12" },
      { label: "tests", value: "34" },
    ],

    groups: [
      { id: "core", title: "the core" },
      { id: "support", title: "supporting" },
      { id: "plans", title: "the plans" },
    ],

    regions: [
      { label: "plans — not switched on", rect: [8, -0.5, 5, 4] },
    ],

    nodes: [
      {
        id: "A", label: "first structure", group: "core",
        pos: [1, 1], size: [2, 1.6], height: 2,
        summary: "One line, shown on hover.",
        does: "What it does, in plain language.",
        built: "How it's built: files, functions, wiring.",
        condition: "What is currently wrong with it. Omit if nothing.",
      },
      {
        id: "B", label: "measuring part", group: "support",
        pos: [4.5, 3], size: [1.6, 1.6], height: 3,
        summary: "Tall blocks are the measuring parts.",
        does: "…", built: "…",
      },
      {
        id: "C", label: "layered store", group: "core",
        pos: [1, 4], size: [2, 1.8], shape: "stack", plates: 4, count: 4,
        summary: "Stacks are layered things.",
        does: "…", built: "…",
      },
      {
        id: "D", label: "pass-through", group: "support",
        pos: [4.5, 5.5], size: [2, 1], shape: "slab",
        summary: "Slabs are flat pass-throughs.",
        does: "…", built: "…",
      },
      {
        id: "E", label: "planned structure", group: "plans",
        pos: [9, 0.5], size: [1.8, 1.5], status: "planned",
        summary: "Dashed ghost: not built yet.",
        does: "What it will do.", built: "Spec status, design links.",
        condition: "Why it hasn't started.",
        steps: {
          heading: "How it will run",
          description: "Execution steps, in order — ==drill-down== scene.",
          nodes: [
            { id: "1", label: "first step", group: "misc", pos: [0, 0], summary: "…", does: "…", built: "…" },
            { id: "2", label: "second step", group: "misc", pos: [3, 0], summary: "…", does: "…", built: "…" },
          ],
          edges: [{ from: "1", to: "2" }],
          flow: ["1", "2"],
        },
      },
    ],

    edges: [
      { from: "A", to: "B", label: "feeds" },
      { from: "B", to: "C", label: "writes" },
      { from: "C", to: "D" },
      { from: "D", to: "A", label: "returns", status: "planned" },
    ],

    flow: ["A", "B", "C", "D"],
  },
});
