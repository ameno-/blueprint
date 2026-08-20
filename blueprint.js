/* Blueprint — parchment isometric work-map renderer.
 * Dependency-free. Renders a declarative blueprint (see README.md for the schema)
 * into the full diagram behavior: hover-to-read, what-it-does / how-it's-built tabs,
 * condition notes, flow tracing, and drill-down into a structure's steps.
 *
 * Data files register themselves:  window.BLUEPRINTS["name"] = { ... }
 * Entry point: Blueprint.render(rootEl, blueprint)
 */
(function () {
  "use strict";

  // ── isometric projection ────────────────────────────────────────────────
  const TW = 34;          // tile half-width  (screen px per grid unit, x axis)
  const TH = 17;          // tile half-height (screen px per grid unit, y axis)
  const ZH = 26;          // screen px per height unit

  function iso(x, y, z) {
    return [(x - y) * TW, (x + y) * TH - (z || 0) * ZH];
  }

  const STATUS_TEXT = {
    "built": "built",
    "in-progress": "in progress",
    "planned": "planned",
    "broken": "broken",
  };

  // ── tiny helpers ────────────────────────────────────────────────────────
  const SVGNS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(n);
    return n;
  }

  function html(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function pts(list) { return list.map((p) => p.join(",")).join(" "); }

  // markdown-lite: ==chip==, **bold**, paragraphs on blank lines
  function mdLite(text) {
    const esc = String(text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rich = esc
      .replace(/==([^=]+)==/g, '<span class="bp-chip">$1</span>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return rich.split(/\n\s*\n/).map((p) => "<p>" + p.replace(/\n/g, " ") + "</p>").join("");
  }

  function normalizeNode(n) {
    return Object.assign({
      size: [1.6, 1.6], height: 1.6, shape: "box",
      status: "built", count: 1, group: "misc",
    }, n);
  }

  // ═══════════════════════════════════════════════════════════════════════
  function render(root, bp) {
    root.innerHTML = "";
    root.classList.add("bp-root");
    root.style.display = ""; // let grid from class apply

    const state = {
      sceneStack: [],        // [{scene, name}]
      selected: null,        // node id
      tab: "does",
      view: { tx: 0, ty: 0, k: 1 },
      trace: { mode: null, seg: 0, t: 0, raf: 0, dwellUntil: 0 },
    };

    // ── chrome ──────────────────────────────────────────────────────────
    const header = html("div", "bp-header", root);
    const legend = html("div", "bp-legend", root);
    const canvas = html("div", "bp-canvas", root);
    const panel = html("div", "bp-panel", root);
    const footer = html("div", "bp-footer", root);
    footer.innerHTML =
      "<span>→ go inside</span><span>← come back out</span><span>↓↑ move</span>" +
      "<span>hover to read</span><span>drag to pan</span><span>scroll to zoom</span>";

    const tooltip = html("div", "bp-tooltip", canvas);
    const svgEl = svg("svg", {}, canvas);
    const defs = svg("defs", {}, svgEl);

    defs.innerHTML =
      '<pattern id="bp-hatchL" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="3.4" height="3.4" fill="#cfc6a4"/>' +
      '<line x1="0" y1="0" x2="0" y2="3.4" stroke="#2b2517" stroke-width="0.7"/></pattern>' +
      '<pattern id="bp-hatchR" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">' +
      '<rect width="5" height="5" fill="#ddd5b7"/>' +
      '<line x1="0" y1="0" x2="0" y2="5" stroke="#2b2517" stroke-width="0.5" stroke-opacity="0.55"/></pattern>';

    const viewport = svg("g", {}, svgEl);
    const floorG = svg("g", {}, viewport);
    const regionG = svg("g", {}, viewport);
    const edgeG = svg("g", {}, viewport);
    const nodeG = svg("g", {}, viewport);
    const fxG = svg("g", {}, viewport);

    const zoomBox = html("div", "bp-zoom", canvas);
    const zoomIn = html("button", "", zoomBox, "+");
    const zoomOut = html("button", "", zoomBox, "−");

    function scene() { return state.sceneStack[state.sceneStack.length - 1].scene; }
    function nodeById(id) { return scene()._nodes[id]; }

    // ── scene preparation ───────────────────────────────────────────────
    function prepScene(sc) {
      sc._nodes = {};
      sc._edges = [];
      (sc.nodes || []).forEach((raw) => {
        const n = normalizeNode(raw);
        sc._nodes[n.id] = n;
      });
      (sc.edges || []).forEach((e) => {
        sc._edges.push(Object.assign({ status: "built" }, e));
      });
      sc._autoGroups = !(sc.groups && sc.groups.length);
      sc._groups = sc._autoGroups
        ? [{ id: "misc", title: sc.stepScene ? "STEPS IN EXECUTION" : "THE SYSTEM" }]
        : sc.groups;
      sc._flow = (sc.flow || []).filter((id) => sc._nodes[id]);
      return sc;
    }

    // ── geometry ────────────────────────────────────────────────────────
    function center(n) { return [n.pos[0] + n.size[0] / 2, n.pos[1] + n.size[1] / 2]; }

    function nodeHeight(n) {
      if (n.shape === "slab") return 0.42;
      if (n.shape === "stack") {
        const plates = Math.min(n.plates || 4, 6);
        return plates * 0.30 + (plates - 1) * 0.16 + 0.28;
      }
      return n.height;
    }

    // exit/entry anchors on the ground plane, offset out of the footprints
    function anchors(a, b) {
      const ca = center(a), cb = center(b);
      const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
      const exit = ca.slice(), entry = cb.slice();
      if (Math.abs(dx) >= Math.abs(dy)) {
        const s = Math.sign(dx) || 1;
        exit[0] += s * (a.size[0] / 2 + 0.25);
        entry[0] -= s * (b.size[0] / 2 + 0.25);
      } else {
        const s = Math.sign(dy) || 1;
        exit[1] += s * (a.size[1] / 2 + 0.25);
        entry[1] -= s * (b.size[1] / 2 + 0.25);
      }
      return { exit, entry };
    }

    function edgePolyline(e) {
      const a = scene()._nodes[e.from], b = scene()._nodes[e.to];
      if (!a || !b) return null;
      const { exit, entry } = anchors(a, b);
      const elbow = [exit[0], entry[1]];
      return [iso(exit[0], exit[1], 0), iso(elbow[0], elbow[1], 0), iso(entry[0], entry[1], 0)];
    }

    // ── shapes ──────────────────────────────────────────────────────────
    function faceFills(n) {
      if (n.status === "planned") return { top: "#d6cdae", left: "#d6cdae", right: "#d6cdae", op: 0.25 };
      return { top: "#e4ddc4", left: "url(#bp-hatchL)", right: "url(#bp-hatchR)", op: 1 };
    }

    function drawBox(g, n, x, y, w, d, h, z0, letter) {
      const f = faceFills(n);
      const t0 = iso(x, y, z0 + h), t1 = iso(x + w, y, z0 + h),
            t2 = iso(x + w, y + d, z0 + h), t3 = iso(x, y + d, z0 + h);
      const b1 = iso(x + w, y, z0), b2 = iso(x + w, y + d, z0), b3 = iso(x, y + d, z0);

      const right = svg("polygon", { points: pts([t1, t2, b2, b1]), class: "face", fill: f.right, "fill-opacity": f.op }, g);
      const left = svg("polygon", { points: pts([t3, t2, b2, b3]), class: "face", fill: f.left, "fill-opacity": f.op }, g);
      const top = svg("polygon", { points: pts([t0, t1, t2, t3]), class: "face", fill: f.top, "fill-opacity": f.op }, g);

      // hover tint over the whole silhouette
      svg("polygon", { points: pts([t0, t1, b1, b2, b3, t3]), class: "hovertint" }, g);

      if (n.status === "broken") {
        svg("line", { x1: t0[0], y1: t0[1], x2: t2[0], y2: t2[1], class: "edge" }, g);
        svg("line", { x1: t1[0], y1: t1[1], x2: t3[0], y2: t3[1], class: "edge" }, g);
      }
      if (n.status === "in-progress") {
        const m = iso(x + w * 0.5, y + d * 0.5, z0 + h);
        const s = 5.5;
        svg("polygon", { points: pts([[m[0], m[1] - s], [m[0] + s, m[1]], [m[0], m[1] + s], [m[0] - s, m[1]]]), fill: "#1d1a10" }, g);
      }
      if (letter) {
        const m = iso(x + w / 2, y + d / 2, z0 + h);
        const off = n.status === "in-progress" ? 11 : 0;
        const t = svg("text", {
          x: m[0], y: m[1] + 1 - off, "text-anchor": "middle",
          "dominant-baseline": "central", "font-size": 13, "font-weight": 700,
        }, g);
        t.textContent = n.id;
      }
      return [right, left, top];
    }

    function drawNode(n) {
      const g = svg("g", { class: "bp-node", "data-id": n.id, "data-status": n.status }, nodeG);
      const [x, y] = n.pos, [w, d] = n.size;
      if (n.shape === "stack") {
        const plates = Math.min(n.plates || 4, 6);
        for (let i = 0; i < plates; i++) {
          const z0 = i * (0.30 + 0.16);
          drawBox(g, n, x, y, w, d, 0.28, z0, i === plates - 1);
        }
      } else {
        drawBox(g, n, x, y, w, d, nodeHeight(n), 0, true);
      }
      if (state.selected === n.id) {
        g.classList.add("sel");
        drawSelRing(n);
      }
      return g;
    }

    function drawSelRing(n) {
      const p = 0.35;
      const [x, y] = n.pos, [w, d] = n.size;
      const ring = [iso(x - p, y - p, 0), iso(x + w + p, y - p, 0), iso(x + w + p, y + d + p, 0), iso(x, y + d + p, 0)];
      svg("polygon", {
        points: pts(ring), fill: "none", stroke: "#2b2517",
        "stroke-width": 1.6, "stroke-dasharray": "7 5", class: "bp-selring",
      }, fxG);
    }

    // ── scene render ────────────────────────────────────────────────────
    function renderScene() {
      const sc = scene();
      floorG.innerHTML = ""; regionG.innerHTML = ""; edgeG.innerHTML = "";
      nodeG.innerHTML = ""; fxG.innerHTML = "";

      // bounds
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      Object.values(sc._nodes).forEach((n) => {
        minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]);
        maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1]);
      });
      (sc.regions || []).forEach((r) => {
        minX = Math.min(minX, r.rect[0]); minY = Math.min(minY, r.rect[1]);
        maxX = Math.max(maxX, r.rect[0] + r.rect[2]); maxY = Math.max(maxY, r.rect[1] + r.rect[3]);
      });
      const pad = 2.5;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      sc._bounds = [minX, minY, maxX, maxY];

      // floor grid
      const grid = svg("g", { stroke: "#2b2517", "stroke-opacity": 0.10, "stroke-width": 0.7 }, floorG);
      for (let gx = Math.ceil(minX); gx <= maxX; gx++) {
        const a = iso(gx, minY, 0), b = iso(gx, maxY, 0);
        svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-opacity": gx % 5 === 0 ? 0.2 : null }, grid);
      }
      for (let gy = Math.ceil(minY); gy <= maxY; gy++) {
        const a = iso(minX, gy, 0), b = iso(maxX, gy, 0);
        svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-opacity": gy % 5 === 0 ? 0.2 : null }, grid);
      }

      // dashed regions
      (sc.regions || []).forEach((r) => {
        const [x, y, w, d] = r.rect;
        const c = [iso(x, y, 0), iso(x + w, y, 0), iso(x + w, y + d, 0), iso(x, y + d, 0)];
        svg("polygon", {
          points: pts(c), fill: "none", stroke: "#2b2517", "stroke-opacity": 0.45,
          "stroke-width": 1, "stroke-dasharray": "8 6",
        }, regionG);
        if (r.label) {
          const t = svg("text", {
            x: c[0][0], y: c[0][1] - 8, "font-size": 9.5, "letter-spacing": 2,
            fill: "#8a8167", "text-anchor": "middle",
          }, regionG);
          t.textContent = r.label.toUpperCase();
        }
      });

      // edges
      sc._edgePaths = {};
      sc._edges.forEach((e) => {
        const p = edgePolyline(e);
        if (!p) return;
        const g = svg("g", {}, edgeG);
        svg("polyline", { points: pts(p), class: "bp-wire", "data-status": e.status }, g);
        svg("circle", { cx: p[0][0], cy: p[0][1], r: 2.6, fill: "#2b2517" }, g);
        if (e.status === "broken") {
          const m = p[1];
          svg("line", { x1: m[0] - 4.5, y1: m[1] - 4.5, x2: m[0] + 4.5, y2: m[1] + 4.5, stroke: "#2b2517", "stroke-width": 1.8 }, g);
          svg("line", { x1: m[0] - 4.5, y1: m[1] + 4.5, x2: m[0] + 4.5, y2: m[1] - 4.5, stroke: "#2b2517", "stroke-width": 1.8 }, g);
        }
        // arrowhead into target
        const [q1, q2] = [p[p.length - 2], p[p.length - 1]];
        const ang = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]);
        const s = 7, wdt = 4;
        const tip = q2, l = [q2[0] - s * Math.cos(ang) + wdt * Math.sin(ang), q2[1] - s * Math.sin(ang) - wdt * Math.cos(ang)];
        const r = [q2[0] - s * Math.cos(ang) - wdt * Math.sin(ang), q2[1] - s * Math.sin(ang) + wdt * Math.cos(ang)];
        svg("polygon", { points: pts([tip, l, r]), fill: "#2b2517" }, g);
        if (e.label) {
          const mid = p[1];
          const t = svg("text", {
            x: mid[0], y: mid[1] - 5, "font-size": 9, "text-anchor": "middle",
            class: "bp-wire-label", "letter-spacing": 1,
            stroke: "#d6cdae", "stroke-width": 3, "paint-order": "stroke",
          }, g);
          t.textContent = e.label;
        }
        // hidden measurable path for the trace pulse
        const d = "M" + p.map((q) => q.join(" ")).join(" L");
        sc._edgePaths[e.from + ">" + e.to] = svg("path", {
          d, fill: "none", stroke: "none", visibility: "hidden", "pointer-events": "none",
        }, fxG);
      });

      // nodes, painter sorted (far to near)
      Object.values(sc._nodes)
        .sort((a, b) => (a.pos[0] + a.pos[1] + a.size[0] / 2 + a.size[1] / 2) - (b.pos[0] + b.pos[1] + b.size[0] / 2 + b.size[1] / 2))
        .forEach(drawNode);

      // trace path segments between consecutive flow nodes (loops)
      sc._segs = [];
      for (let i = 0; i < sc._flow.length; i++) {
        const from = sc._flow[i], to = sc._flow[(i + 1) % sc._flow.length];
        let path = sc._edgePaths[from + ">" + to];
        if (!path) {
          const a = sc._nodes[from], b = sc._nodes[to];
          const { exit, entry } = anchors(a, b);
          const p1 = iso(exit[0], exit[1], 0), p2 = iso(entry[0], entry[1], 0);
          path = svg("path", {
            d: `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`,
            fill: "none", stroke: "none", visibility: "hidden", "pointer-events": "none",
          }, fxG);
        }
        sc._segs.push({ from, to, path, len: path.getTotalLength() });
      }

      // trace pulse
      sc._pulse = svg("circle", { r: 5, fill: "#1d1a10", stroke: "#d6cdae", "stroke-width": 1.5, visibility: "hidden" }, fxG);

      fitView();
      renderHeader();
      renderLegend();
      renderPanel();
    }

    // ── header ──────────────────────────────────────────────────────────
    function renderHeader() {
      const sc = scene();
      header.innerHTML = "";
      const titleCell = html("div", "bp-head-cell bp-head-title", header);
      html("div", "k", titleCell, bp.headLabel || "repository");
      html("div", "v", titleCell, bp.title + (bp.subtitle ? " · " + bp.subtitle : ""));

      const metrics = (sc.metrics || bp.metrics || []).slice();
      const nodes = Object.values(sc._nodes);
      if (!metrics.some((m) => /status/i.test(m.label))) {
        const tally = {};
        nodes.forEach((n) => { tally[n.status] = (tally[n.status] || 0) + n.count; });
        const str = Object.keys(tally).map((k) => tally[k] + " " + STATUS_TEXT[k]).join(" · ");
        metrics.push({ label: "status", value: str });
      }
      if (!metrics.some((m) => /nodes|structures/i.test(m.label))) {
        metrics.unshift({ label: "structures", value: String(nodes.length) });
      }
      metrics.forEach((m) => {
        const c = html("div", "bp-head-cell", header);
        html("div", "k", c, m.label);
        html("div", "v", c, m.value);
      });

      if (state.sceneStack.length > 1) {
        const crumb = html("div", "bp-crumb", header);
        state.sceneStack.forEach((frame, i) => {
          if (i > 0) html("span", "", crumb, "›");
          if (i < state.sceneStack.length - 1) {
            const b = html("button", "", crumb, frame.name);
            b.onclick = () => { popToScene(i); };
          } else {
            html("span", "cur", crumb, frame.name);
          }
        });
      }

      const actions = html("div", "bp-head-actions", header);
      const flowBtn = html("button", "bp-btn" + (state.trace.mode === "run" ? " active" : ""), actions,
        state.trace.mode === "run" ? "❚❚ pause the flow" : "▶ resume the flow");
      flowBtn.onclick = toggleFlow;
      const stepBtn = html("button", "bp-btn", actions, "trace one step");
      stepBtn.disabled = !sc._segs.length;
      stepBtn.onclick = traceStep;
      flowBtn.disabled = !sc._segs.length;
      const resetBtn = html("button", "bp-btn", actions, "reset view");
      resetBtn.onclick = resetView;
    }

    // ── legend ──────────────────────────────────────────────────────────
    function renderLegend() {
      const sc = scene();
      legend.innerHTML = "";
      html("h3", "", legend, sc.legendTitle || bp.legendTitle || "the system");
      sc._groups.forEach((g) => {
        const members = Object.values(sc._nodes).filter((n) => n.group === g.id);
        if (!members.length) return;
        if (!sc._autoGroups) html("h3", "", legend, g.title);
        members.forEach((n) => {
          const row = html("div", "bp-leg-row", legend);
          row.dataset.status = n.status;
          row.dataset.id = n.id;
          if (state.selected === n.id) row.classList.add("sel");
          html("span", "key", row, n.id);
          html("span", "name", row, n.label);
          html("span", "n", row, String(n.count));
          row.onclick = () => select(n.id);
          row.onmouseenter = () => hlNode(n.id, true);
          row.onmouseleave = () => hlNode(n.id, false);
        });
      });
    }

    function hlNode(id, on) {
      const g = nodeG.querySelector('.bp-node[data-id="' + id + '"]');
      if (g) g.classList.toggle("hl", on);
    }

    // ── right panel ─────────────────────────────────────────────────────
    function renderPanel() {
      const sc = scene();
      panel.innerHTML = "";
      const tabs = html("div", "bp-tabs", panel);
      const bDoes = html("button", state.tab === "does" ? "on" : "", tabs, "what it does");
      const bBuilt = html("button", state.tab === "built" ? "on" : "", tabs, "how it's built");
      bDoes.onclick = () => { state.tab = "does"; renderPanel(); };
      bBuilt.onclick = () => { state.tab = "built"; renderPanel(); };
      const body = html("div", "bp-panel-body", panel);
      const n = state.selected ? nodeById(state.selected) : null;

      if (!n) {
        html("div", "bp-eyebrow", body, bp.title.toLowerCase());
        html("h1", "", body, sc.heading || bp.heading || bp.title);
        html("p", "sub", body, sc.tagline || bp.tagline || bp.subtitle || "");
        if (state.tab === "does") {
          html("div", "bp-sec", body, "what this is");
          const d = html("div", "", body);
          d.innerHTML = mdLite(sc.description || bp.description || "No description yet.");
          html("div", "bp-sec", body, "how to read it");
          const h = html("div", "", body);
          h.innerHTML = mdLite(
            "Hover anything for a plain description; the **how it's built** tab gives the " +
            "implementation, and ==condition== lists what is currently wrong with it. " +
            "**→ goes inside** a structure to see its steps in execution. " +
            "Solid blocks are built; dashed blocks are ==planned==; a black diamond marks work ==in progress==; crossed tops are ==broken==."
          );
        } else {
          html("div", "bp-sec", body, "construction");
          const d = html("div", "", body);
          d.innerHTML = mdLite(sc.built || bp.built || "No construction notes yet.");
        }
        return;
      }

      html("div", "bp-eyebrow", body, (groupTitle(sc, n.group) + " · " + STATUS_TEXT[n.status]).toLowerCase());
      html("h1", "", body, "[" + n.id + "] " + titleCase(n.label));
      html("p", "sub", body, n.summary || "");

      if (state.tab === "does") {
        html("div", "bp-sec", body, "what it does");
        const d = html("div", "", body);
        d.innerHTML = mdLite(n.does || n.summary || "—");
        if (n.condition) {
          const c = html("div", "bp-condition", body);
          html("span", "tag", c, "condition");
          const cd = html("div", "", c);
          cd.innerHTML = mdLite(n.condition);
        }
      } else {
        html("div", "bp-sec", body, "how it's built");
        const d = html("div", "", body);
        d.innerHTML = mdLite(n.built || "—");
        html("div", "bp-sec", body, "record");
        const t = html("table", "bp-meta", body);
        [["status", STATUS_TEXT[n.status]], ["group", groupTitle(sc, n.group)],
         ["instances", String(n.count)], ["shape", n.shape]].forEach(([k, v]) => {
          const tr = html("tr", "", t);
          html("td", "", tr, k); html("td", "", tr, v);
        });
        const conns = connections(sc, n);
        if (conns.length) {
          html("div", "bp-sec", body, "connections");
          const c = html("div", "bp-conn", body);
          conns.forEach((line) => html("div", "", c, line));
        }
      }

      if (n.steps) {
        const b = html("button", "bp-btn bp-inside", body, "→ go inside — steps in execution");
        b.onclick = () => enterScene(n);
      }
    }

    function groupTitle(sc, gid) {
      const g = sc._groups.find((x) => x.id === gid);
      return g ? g.title : gid;
    }

    function titleCase(s) {
      return s.toLowerCase().replace(/(^|\s|\/)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    }

    function connections(sc, n) {
      const out = [];
      sc._edges.forEach((e) => {
        if (e.from === n.id) out.push("[" + e.from + "] → [" + e.to + "]" + (e.label ? "  " + e.label : ""));
        if (e.to === n.id) out.push("[" + e.from + "] → [" + e.to + "]" + (e.label ? "  " + e.label : ""));
      });
      return out;
    }

    // ── selection ───────────────────────────────────────────────────────
    function select(id) {
      state.selected = id;
      state.tab = "does";
      nodeG.querySelectorAll(".bp-node").forEach((g) => g.classList.toggle("sel", g.dataset.id === id));
      fxG.querySelectorAll(".bp-selring").forEach((r) => r.remove());
      if (id) drawSelRing(nodeById(id));
      legend.querySelectorAll(".bp-leg-row").forEach((r) => r.classList.toggle("sel", r.dataset.id === id));
      renderPanel();
    }

    // ── drill-down ──────────────────────────────────────────────────────
    function enterScene(n) {
      stopTrace();
      const child = prepScene(Object.assign({ stepScene: true }, n.steps));
      state.sceneStack.push({ scene: child, name: n.label });
      state.selected = null;
      renderScene();
    }

    function popToScene(i) {
      stopTrace();
      state.sceneStack.length = i + 1;
      state.selected = null;
      renderScene();
    }

    // ── trace ───────────────────────────────────────────────────────────
    function stopTrace() {
      cancelAnimationFrame(state.trace.raf);
      state.trace.mode = null;
      scene()._pulse.setAttribute("visibility", "hidden");
      renderHeader();
    }

    function resetTrace() {
      stopTrace();
      state.trace.seg = 0;
    }

    function toggleFlow() {
      if (state.trace.mode === "run") { stopTrace(); return; }
      state.trace.mode = "run";
      runSeg();
      renderHeader();
    }

    function traceStep() {
      stopTrace();
      state.trace.mode = "step";
      runSeg();
    }

    function runSeg() {
      const sc = scene();
      if (!sc._segs.length) return;
      const seg = sc._segs[state.trace.seg % sc._segs.length];
      const pulse = sc._pulse;
      pulse.setAttribute("visibility", "visible");
      const speed = 240; // world px/sec
      const dur = Math.max(seg.len / speed, 0.15) * 1000;
      const t0 = performance.now();

      function frame(now) {
        const t = Math.min((now - t0) / dur, 1);
        const pt = seg.path.getPointAtLength(t * seg.len);
        pulse.setAttribute("cx", pt.x);
        pulse.setAttribute("cy", pt.y);
        if (t < 1) {
          state.trace.raf = requestAnimationFrame(frame);
        } else {
          arrive(seg.to);
          state.trace.seg = (state.trace.seg + 1) % sc._segs.length;
          if (state.trace.mode === "run") {
            setTimeout(() => { if (state.trace.mode === "run") runSeg(); }, 650);
          } else {
            state.trace.mode = null;
            renderHeader();
          }
        }
      }
      state.trace.raf = requestAnimationFrame(frame);
    }

    function arrive(nodeId) {
      const n = nodeById(nodeId);
      if (!n) return;
      const c = center(n);
      const m = iso(c[0], c[1], nodeHeight(n));
      const ring = svg("circle", { cx: m[0], cy: m[1], r: 6, class: "bp-pulse-ring" }, fxG);
      const t0 = performance.now();
      (function grow(now) {
        const t = (now - t0) / 900;
        if (t >= 1) { ring.remove(); return; }
        ring.setAttribute("r", 6 + t * 26);
        requestAnimationFrame(grow);
      })(t0);
      select(nodeId);
    }

    // ── view transform ──────────────────────────────────────────────────
    function applyView() {
      const v = state.view;
      viewport.setAttribute("transform", "translate(" + v.tx + "," + v.ty + ") scale(" + v.k + ")");
    }

    function fitView() {
      const sc = scene();
      const [minX, minY, maxX, maxY] = sc._bounds;
      const corners = [iso(minX, minY, 0), iso(maxX, minY, 0), iso(maxX, maxY, 0), iso(minX, maxY, 0)];
      let hMax = 0;
      Object.values(sc._nodes).forEach((n) => { hMax = Math.max(hMax, nodeHeight(n)); });
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const bx0 = Math.min.apply(null, xs), bx1 = Math.max.apply(null, xs);
      const by1 = Math.max.apply(null, ys), by0 = Math.min.apply(null, ys) - hMax * ZH - 30;
      const cw = canvas.clientWidth || 800, ch = canvas.clientHeight || 600;
      const k = Math.min((cw - 90) / (bx1 - bx0), (ch - 90) / (by1 - by0), 1.5);
      state.view.k = k;
      state.view.tx = cw / 2 - k * (bx0 + bx1) / 2;
      state.view.ty = ch / 2 - k * (by0 + by1) / 2;
      applyView();
    }

    function resetView() {
      resetTrace();
      state.selected = null;
      fitView();
      renderLegend();
      renderPanel();
    }

    function zoomBy(f, cx, cy) {
      const v = state.view;
      const k2 = Math.min(Math.max(v.k * f, 0.3), 3);
      const rect = canvas.getBoundingClientRect();
      const px = (cx == null ? rect.width / 2 : cx - rect.left);
      const py = (cy == null ? rect.height / 2 : cy - rect.top);
      v.tx = px - (px - v.tx) * (k2 / v.k);
      v.ty = py - (py - v.ty) * (k2 / v.k);
      v.k = k2;
      applyView();
    }

    zoomIn.onclick = () => zoomBy(1.25);
    zoomOut.onclick = () => zoomBy(0.8);

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomBy(Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY);
    }, { passive: false });

    // pan + click discrimination
    let drag = null;
    svgEl.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      svgEl.setPointerCapture(e.pointerId);
    });
    svgEl.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        svgEl.classList.add("dragging");
        hideTip();
      }
      if (drag.moved) {
        state.view.tx += dx; state.view.ty += dy;
        drag.x = e.clientX; drag.y = e.clientY;
        applyView();
        if (state.trace.mode === "run") stopTrace();
      }
    });
    svgEl.addEventListener("pointerup", (e) => {
      const wasDrag = drag && drag.moved;
      drag = null;
      svgEl.classList.remove("dragging");
      if (wasDrag) return;
      const g = e.target.closest && e.target.closest(".bp-node");
      select(g ? g.dataset.id : null);
    });

    // tooltip
    function showTip(e, n) {
      const rect = canvas.getBoundingClientRect();
      tooltip.innerHTML =
        '<div class="tt-status">' + STATUS_TEXT[n.status] + '</div>' +
        '<div class="tt-key">[' + n.id + "] " + n.label + "</div>" +
        "<div>" + (n.summary || "") + "</div>";
      tooltip.style.opacity = 1;
      const x = e.clientX - rect.left + 16, y = e.clientY - rect.top + 14;
      tooltip.style.left = Math.min(x, rect.width - 280) + "px";
      tooltip.style.top = Math.min(y, rect.height - 110) + "px";
    }
    function hideTip() { tooltip.style.opacity = 0; }

    svgEl.addEventListener("mousemove", (e) => {
      if (drag) return;
      const g = e.target.closest && e.target.closest(".bp-node");
      if (g) {
        const n = nodeById(g.dataset.id);
        showTip(e, n);
        const row = legend.querySelector('.bp-leg-row[data-id="' + n.id + '"]');
        if (row) row.classList.add("hl");
        tooltip._row = row;
      } else {
        hideTip();
        if (tooltip._row) { tooltip._row.classList.remove("hl"); tooltip._row = null; }
      }
    });
    svgEl.addEventListener("mouseleave", hideTip);

    // keyboard
    document.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const sc = scene();
      const order = [];
      sc._groups.forEach((g) => {
        Object.values(sc._nodes).forEach((n) => { if (n.group === g.id) order.push(n.id); });
      });
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!order.length) return;
        let i = order.indexOf(state.selected);
        i = i === -1 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + order.length) % order.length;
        select(order[i]);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        const n = state.selected && nodeById(state.selected);
        if (n && n.steps) enterScene(n);
      } else if (e.key === "ArrowLeft" || e.key === "Escape") {
        if (state.sceneStack.length > 1) popToScene(state.sceneStack.length - 2);
        else select(null);
      }
    });

    // ── boot ────────────────────────────────────────────────────────────
    const rootScene = prepScene(Object.assign({}, bp, { stepScene: false }));
    state.sceneStack.push({ scene: rootScene, name: bp.title });
    renderScene();
    const wanted = new URLSearchParams(location.search).get("select") || bp.focus;
    if (wanted && rootScene._nodes[wanted]) select(wanted);
    window.addEventListener("resize", () => { /* keep view; user can reset */ });
  }

  window.Blueprint = { render };
})();
