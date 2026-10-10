// NEO — the World Map (docs/semantics/IDE.md §5)
//
// Canon's entries as a graph you can turn in your hands: a seeded force
// layout in 3D (or flattened to 2D), drawn on one canvas with arc() and
// lineTo(). No library, nothing fetched, no loop while it stands still.
// The layout, the projection and the hit test are plain functions the
// tests run without a canvas (scripts/map.test.js); `create` draws.
// Loaded by the window as window.NeoMap. It holds no writer-visible
// strings: app.js passes its words in.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeoMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- the layout ---------- */

  // the same id always starts in the same place: nothing to save or sync
  function seedOf(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fruchterman–Reingold in 2 or 3 dimensions: every pair pushes apart
  // (O(n²), fine for a few hundred entries), links pull together (appearing
  // together pulls gently), and a little gravity keeps islands near the
  // middle. `from` starts from positions already there (2D from 3D, or
  // settling after a drag); `pinned` ids don't move.
  const SPACING = 60;
  function layout(nodes, edges, opts = {}) {
    const dims = opts.dims === 2 ? 2 : 3;
    const steps = opts.steps == null ? 300 : opts.steps;
    const n = nodes.length;
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    const Z = new Float64Array(n);
    const at = new Map(nodes.map((d, i) => [d.id, i]));
    const spread = SPACING * Math.cbrt(Math.max(n, 1)) * 1.4;
    nodes.forEach((d, i) => {
      const was = opts.from && opts.from[d.id];
      if (was) { X[i] = was.x; Y[i] = was.y; Z[i] = dims === 3 ? was.z || 0 : 0; return; }
      const r = rng(seedOf(String(d.id)) ^ (opts.seed || 0));
      X[i] = (r() - 0.5) * spread;
      Y[i] = (r() - 0.5) * spread;
      Z[i] = dims === 3 ? (r() - 0.5) * spread : 0;
    });
    const links = [];
    for (const e of edges) {
      const a = at.get(e.a);
      const b = at.get(e.b);
      if (a != null && b != null && a !== b) links.push(a, b, e.why === 'together' ? 0.18 : 1);
    }
    const fixed = new Uint8Array(n);
    for (const id of opts.pinned || []) if (at.has(id)) fixed[at.get(id)] = 1;
    const k = SPACING;
    const k2 = k * k;
    const FX = new Float64Array(n);
    const FY = new Float64Array(n);
    const FZ = new Float64Array(n);
    const t0 = opts.heat == null ? k * 2.2 : opts.heat;
    for (let step = 0; step < steps; step++) {
      FX.fill(0); FY.fill(0); FZ.fill(0);
      for (let i = 0; i < n; i++) {
        const xi = X[i];
        const yi = Y[i];
        const zi = Z[i];
        for (let j = i + 1; j < n; j++) {
          const dx = xi - X[j];
          const dy = yi - Y[j];
          const dz = zi - Z[j];
          const d2 = dx * dx + dy * dy + dz * dz + 0.01;
          const f = k2 / d2;
          FX[i] += dx * f; FY[i] += dy * f; FZ[i] += dz * f;
          FX[j] -= dx * f; FY[j] -= dy * f; FZ[j] -= dz * f;
        }
      }
      for (let l = 0; l < links.length; l += 3) {
        const a = links[l];
        const b = links[l + 1];
        const dx = X[b] - X[a];
        const dy = Y[b] - Y[a];
        const dz = Z[b] - Z[a];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const f = (d / k) * links[l + 2];
        FX[a] += dx * f; FY[a] += dy * f; FZ[a] += dz * f;
        FX[b] -= dx * f; FY[b] -= dy * f; FZ[b] -= dz * f;
      }
      const heat = t0 * (1 - step / steps) + 0.5;
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const fx = FX[i] - X[i] * 0.06;
        const fy = FY[i] - Y[i] * 0.06;
        const fz = dims === 3 ? FZ[i] - Z[i] * 0.06 : 0;
        const len = Math.sqrt(fx * fx + fy * fy + fz * fz) + 1e-9;
        const move = Math.min(len, heat) / len;
        X[i] += fx * move;
        Y[i] += fy * move;
        Z[i] = dims === 3 ? Z[i] + fz * move : 0;
      }
    }
    const out = {};
    nodes.forEach((d, i) => { out[d.id] = { x: X[i], y: Y[i], z: Z[i] }; });
    return out;
  }

  // the graph without the kinds the writer hid, and without appearing
  // together unless it's asked for
  function filterGraph(graph, hidden = [], together = false) {
    const off = new Set(hidden);
    const nodes = graph.nodes.filter((d) => !off.has(d.kind));
    const on = new Set(nodes.map((d) => d.id));
    const edges = graph.edges.filter((e) => on.has(e.a) && on.has(e.b) && (together || e.why !== 'together'));
    return { nodes, edges };
  }

  // one entry and those one step from it
  function neighbourhood(graph, id) {
    const near = new Set([id]);
    for (const e of graph.edges) {
      if (e.a === id) near.add(e.b);
      if (e.b === id) near.add(e.a);
    }
    return { nodes: graph.nodes.filter((d) => near.has(d.id)), edges: graph.edges.filter((e) => near.has(e.a) && near.has(e.b)) };
  }

  /* ---------- seeing it ---------- */

  // A point to the screen. The view turns about its centre (cx, cy, cz) by
  // yaw then pitch; `persp` 0 is flat (2D), 1 full perspective (3D).
  const EYE = 900;
  function project(p, v, w, h) {
    let x = p.x - v.cx;
    let y = p.y - v.cy;
    let z = p.z - v.cz;
    const cy = Math.cos(v.yaw);
    const sy = Math.sin(v.yaw);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    const cp = Math.cos(v.pitch);
    const sp = Math.sin(v.pitch);
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    const f = v.persp ? EYE / Math.max(EYE * 0.25, EYE + z * v.persp) : 1;
    const s = f * v.zoom;
    return { x: w / 2 + v.panX + x * s, y: h / 2 + v.panY + y * s, depth: z, f };
  }
  // the node under a point: the nearest within its circle (and a little
  // more), the front one when two overlap
  function hitTest(drawn, x, y, slack = 4) {
    let best = null;
    for (const d of drawn) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist > d.r + slack) continue;
      if (!best || d.depth < best.depth - 1 || (Math.abs(d.depth - best.depth) <= 1 && dist < best.dist)) best = { ...d, dist };
    }
    return best ? best.id : null;
  }
  const radius = (mentions, compact) => (compact ? 0.72 : 1) * Math.min(20, Math.max(6, 5 + Math.sqrt(mentions || 0) * 1.8));

  /* ---------- the canvas ---------- */

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function rgb(css) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(css).trim());
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)];
    const r = /rgba?\(([^)]+)\)/.exec(css);
    return r ? r[1].split(',').slice(0, 3).map(Number) : [180, 175, 165];
  }

  // opts: { colour(kind) → css, theme() → 'dark' | 'light', compact,
  //   mode '2d' | '3d', onPick(id), onHover(id), kindName(kind), font }
  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const st = {
      graph: { nodes: [], edges: [] }, pos3: {}, pos2: {}, mix: opts.mode === '2d' ? 0 : 1, mode: opts.mode === '2d' ? '2d' : '3d',
      v: { yaw: 0.55, pitch: -0.32, zoom: 1, cx: 0, cy: 0, cz: 0, panX: 0, panY: 0, persp: 1 }, fit: 1, user: 1,
      hover: null, focus: null, pulse: null, pinned: new Set(), drawn: [], spin: { yaw: 0, pitch: 0 },
      anims: [], settle: 0, raf: 0, w: 0, h: 0, dpr: 1, sprites: new Map(), bg: null, frames: [], dead: false
    };
    if (st.mode === '2d') { st.v.yaw = 0; st.v.pitch = 0; st.v.persp = 0; }

    // a kind's colour, read once a frame (the page's tokens can change with the theme)
    let pal = new Map();
    const colour = (kind) => {
      if (!pal.has(kind)) { const css = opts.colour ? opts.colour(kind) : '#b3ada3'; pal.set(kind, { css, rgb: rgb(css) }); }
      return pal.get(kind).css;
    };
    const rgbOf = (kind) => { colour(kind); return pal.get(kind).rgb; };
    const light = () => (opts.theme ? opts.theme() === 'light' : false);
    // a node's look, drawn once per colour: a soft glow and a lit sphere
    function sprite(css) {
      const key = css + (light() ? 'L' : 'D');
      if (st.sprites.has(key)) return st.sprites.get(key);
      const S = 96;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d');
      const [r, gr, b] = rgb(css);
      const glow = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
      glow.addColorStop(0, `rgba(${r},${gr},${b},${light() ? 0.26 : 0.55})`);
      glow.addColorStop(0.42, `rgba(${r},${gr},${b},${light() ? 0.1 : 0.17})`);
      glow.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = glow;
      g.fillRect(0, 0, S, S);
      const core = g.createRadialGradient(S * 0.44, S * 0.42, 1, S / 2, S / 2, S * 0.2);
      const lift = (v) => Math.round(v + (255 - v) * 0.55);
      core.addColorStop(0, `rgb(${lift(r)},${lift(gr)},${lift(b)})`);
      core.addColorStop(0.55, `rgb(${r},${gr},${b})`);
      core.addColorStop(1, `rgb(${Math.round(r * 0.72)},${Math.round(gr * 0.72)},${Math.round(b * 0.72)})`);
      g.fillStyle = core;
      g.beginPath();
      g.arc(S / 2, S / 2, S * 0.2, 0, Math.PI * 2);
      g.fill();
      st.sprites.set(key, c);
      return c;
    }

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      if (r.width === st.w && r.height === st.h && dpr === st.dpr) return;
      st.w = r.width;
      st.h = r.height;
      st.dpr = dpr;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      st.bg = null;
      fitView();
    }
    // the world fills the canvas, centred, with room for names beside it
    function fitFor(flat, turn) {
      const pts = Object.values(flat ? st.pos2 : st.pos3);
      if (!pts.length) return null;
      let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const p of pts) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      }
      // (the full view keeps clear of its controls on the right)
      const side = opts.compact ? 0 : Math.min(260, st.w * 0.2);
      const mx = (opts.compact ? 44 : 110) + side / 2;
      const my = opts.compact ? 34 : 80;
      const ex = Math.max(SPACING / 2, (x1 - x0) / 2);
      const ey = Math.max(SPACING / 2, (y1 - y0) / 2);
      // (turning brings any side to the front: in 3D the widest reach counts)
      const far = flat ? null : Math.max(ex, ey, (z1 - z0) / 2) * 1.08;
      const fit = flat ? Math.min((st.w / 2 - mx) / ex, (st.h / 2 - my) / ey) : Math.min(st.w / 2 - mx, st.h / 2 - my) / far;
      const out = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: flat ? 0 : (z0 + z1) / 2, fit: Math.max(0.05, fit), panX: -side / 2, panY: 0 };
      if (!flat) {
        // turned, the world's middle on screen isn't its middle in space:
        // centre what is drawn, and fill the room with it
        const v = { yaw: turn ? turn.yaw : st.v.yaw, pitch: turn ? turn.pitch : st.v.pitch, zoom: out.fit, cx: out.cx, cy: out.cy, cz: out.cz, panX: 0, panY: 0, persp: 1 };
        let [a0, b0, a1, b1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const p of pts) {
          const q = project(p, v, st.w, st.h);
          a0 = Math.min(a0, q.x); a1 = Math.max(a1, q.x);
          b0 = Math.min(b0, q.y); b1 = Math.max(b1, q.y);
        }
        const k = Math.min(1.6, (st.w - 2 * mx) / Math.max(1, a1 - a0), (st.h - 2 * my) / Math.max(1, b1 - b0));
        out.fit *= k;
        out.panX += (st.w / 2 - (a0 + a1) / 2) * k;
        out.panY = (st.h / 2 - (b0 + b1) / 2) * k;
      }
      return out;
    }
    function fitView() {
      const f = fitFor(st.mix <= 0.5);
      if (!f) return;
      Object.assign(st.v, { cx: f.cx, cy: f.cy, cz: f.cz, panX: f.panX, panY: f.panY });
      st.fit = f.fit;
      st.v.zoom = st.fit * st.user;
    }
    const posOf = (id) => {
      const a = st.pos2[id] || st.pos3[id];
      const b = st.pos3[id] || a;
      const t = st.mix;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: b.z * t };
    };

    function setGraph(graph, keep) {
      const old = { ...st.pos3 };
      // (in id order: the same world lays out the same way whatever order it came in)
      graph = { nodes: graph.nodes.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), edges: graph.edges };
      st.graph = graph;
      const from = keep ? old : null;
      st.pos3 = layout(graph.nodes, graph.edges, { dims: 3, from, steps: from && graph.nodes.every((d) => from[d.id]) ? 0 : 300 });
      st.pos2 = layout(graph.nodes, graph.edges, { dims: 2, from: st.pos3, steps: 160, heat: SPACING });
      st.pinned = new Set([...st.pinned].filter((id) => st.pos3[id]));
      if (st.focus && !st.pos3[st.focus]) st.focus = null;
      if (st.hover && !st.pos3[st.hover]) st.hover = null;
      st.w = 0;
      size();
      fitView();
      draw();
    }

    function setMode(mode) {
      if (mode === st.mode) return;
      st.mode = mode;
      const flat = mode === '2d';
      const aim = fitFor(flat, flat ? null : { yaw: 0.55, pitch: -0.32 }) || { cx: 0, cy: 0, cz: 0, fit: st.fit };
      const from = { mix: st.mix, yaw: st.v.yaw, pitch: st.v.pitch, persp: st.v.persp, cx: st.v.cx, cy: st.v.cy, cz: st.v.cz, panX: st.v.panX, panY: st.v.panY, fit: st.fit };
      const to = { mix: flat ? 0 : 1, yaw: flat ? 0 : 0.55, pitch: flat ? 0 : -0.32, persp: flat ? 0 : 1, panX: 0, panY: 0, ...aim };
      st.spin.yaw = st.spin.pitch = 0;
      // the world folds flat (or opens out) in one smooth move
      animate(700, (t) => {
        const at = (k) => from[k] + (to[k] - from[k]) * t;
        st.mix = at('mix');
        Object.assign(st.v, { yaw: at('yaw'), pitch: at('pitch'), persp: at('persp'), cx: at('cx'), cy: at('cy'), cz: at('cz'), panX: at('panX'), panY: at('panY') });
        st.fit = at('fit');
        st.v.zoom = st.fit * st.user;
      });
    }

    function animate(ms, step, done) {
      st.anims.push({ start: now(), ms, step, done });
      kick();
    }
    function kick() { if (!st.raf && !st.dead && typeof requestAnimationFrame !== 'undefined') st.raf = requestAnimationFrame(frame); }
    function frame() {
      st.raf = 0;
      if (st.dead) return;
      const t = now();
      st.anims = st.anims.filter((a) => {
        const k = Math.min(1, (t - a.start) / a.ms);
        a.step(ease(k));
        if (k >= 1 && a.done) a.done();
        return k < 1;
      });
      // a turn that was let go of keeps going a little, slowing
      if (Math.abs(st.spin.yaw) + Math.abs(st.spin.pitch) > 0.0004 && !drag) {
        st.v.yaw += st.spin.yaw;
        st.v.pitch = Math.max(-1.45, Math.min(1.45, st.v.pitch + st.spin.pitch));
        st.spin.yaw *= 0.93;
        st.spin.pitch *= 0.93;
      } else if (!drag) st.spin.yaw = st.spin.pitch = 0;
      // after a node is dragged, its neighbours follow, gently
      if (st.settle > 0) {
        st.settle--;
        const key = st.mode === '2d' ? 'pos2' : 'pos3';
        st[key] = layout(st.graph.nodes, st.graph.edges, { dims: st.mode === '2d' ? 2 : 3, from: st[key], steps: 1, heat: 3 + st.settle / 10, pinned: st.pinned });
      }
      draw();
      if (st.anims.length || st.settle > 0 || st.pulse || drag || Math.abs(st.spin.yaw) + Math.abs(st.spin.pitch) > 0) kick();
    }

    function background() {
      if (st.bg && st.bg.light === light()) return st.bg.img;
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d');
      const W = c.width;
      const H = c.height;
      const grad = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
      if (light()) { grad.addColorStop(0, '#fbfaf6'); grad.addColorStop(1, '#ebe7de'); }
      else { grad.addColorStop(0, '#1f1e1c'); grad.addColorStop(0.6, '#161615'); grad.addColorStop(1, '#0e0e0e'); }
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // a little dust, the same every time
      if (!opts.compact) {
        const r = rng(7);
        for (let i = 0; i < (W * H) / 9000; i++) {
          g.fillStyle = light() ? `rgba(120,110,95,${0.05 + r() * 0.08})` : `rgba(255,248,235,${0.03 + r() * 0.09})`;
          g.beginPath();
          g.arc(r() * W, r() * H, (0.4 + r() * 0.8) * st.dpr, 0, Math.PI * 2);
          g.fill();
        }
      }
      st.bg = { light: light(), img: c };
      return c;
    }

    function draw() {
      if (st.dead) return;
      const t0 = now();
      pal = new Map();
      size();
      const { w, h } = st;
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.drawImage(background(), 0, 0, w, h);
      const v = st.v;
      const drawn = st.graph.nodes.map((d) => {
        const p = project(posOf(d.id), v, w, h);
        return { id: d.id, kind: d.kind, name: d.name, x: p.x, y: p.y, depth: p.depth * st.mix, f: p.f, r: radius(d.mentions, opts.compact) * Math.sqrt(p.f) * Math.min(1.6, Math.max(0.7, st.user ** 0.35)) };
      });
      const by = new Map(drawn.map((d) => [d.id, d]));
      // how near each node is, 0 (far) to 1 (near), for depth in 3D
      let dmin = Infinity;
      let dmax = -Infinity;
      for (const d of drawn) { dmin = Math.min(dmin, d.depth); dmax = Math.max(dmax, d.depth); }
      const near = (d) => (dmax - dmin < 1 ? 1 : 1 - (d.depth - dmin) / (dmax - dmin));
      const lit = st.hover || st.focus;
      const ring = new Set(lit ? [lit] : []);
      if (lit) for (const e of st.graph.edges) { if (e.a === lit) ring.add(e.b); if (e.b === lit) ring.add(e.a); }
      const fade = (id) => (!lit || ring.has(id) ? 1 : 0.24);
      // the links first, behind everything
      ctx.lineCap = 'round';
      for (const e of st.graph.edges) {
        const a = by.get(e.a);
        const b = by.get(e.b);
        if (!a || !b) continue;
        const on = lit && (e.a === lit || e.b === lit);
        const depth = 0.35 + 0.65 * ((near(a) + near(b)) / 2) ** 1.2;
        const together = e.why === 'together';
        let alpha = (together ? 0.16 : 0.5) * (st.mix > 0 ? depth : 1);
        if (lit) alpha = on ? (together ? 0.45 : 0.9) : alpha * 0.25;
        const [r1, g1, b1] = rgbOf(a.kind);
        const [r2, g2, b2] = rgbOf(b.kind);
        // one kind's colour fading into the other's (a plain blend when the
        // world is large: a gradient a line costs too much a frame)
        if (st.graph.nodes.length <= 120 || on) {
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          grad.addColorStop(0, `rgba(${r1},${g1},${b1},${alpha})`);
          grad.addColorStop(1, `rgba(${r2},${g2},${b2},${alpha})`);
          ctx.strokeStyle = grad;
        } else ctx.strokeStyle = `rgba(${(r1 + r2) >> 1},${(g1 + g2) >> 1},${(b1 + b2) >> 1},${alpha.toFixed(2)})`;
        ctx.lineWidth = (together ? 0.8 : on ? 1.8 : 1.1) * Math.sqrt((a.f + b.f) / 2);
        ctx.setLineDash(together ? [2, 4] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // the nodes, far ones first
      const order = drawn.slice().sort((a, b) => b.depth - a.depth);
      for (const d of order) {
        // (the lit node and its neighbours stand out whatever their depth)
        const n = st.mix > 0 ? (d.id === lit ? 1 : lit && ring.has(d.id) ? 0.85 : 0.45 + 0.55 * near(d) ** 1.3) : 1;
        ctx.globalAlpha = Math.min(1, n * fade(d.id));
        const img = sprite(colour(d.kind));
        // (a smaller halo when the world is large: there's less room, and less time)
        const R = d.r * (st.graph.nodes.length > 120 ? 1.7 : 2.4) * (d.id === lit ? 1.15 : 1);
        ctx.drawImage(img, d.x - R, d.y - R, R * 2, R * 2);
        if (st.pinned.has(d.id)) {
          ctx.strokeStyle = light() ? 'rgba(60,55,45,0.5)' : 'rgba(255,250,240,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // a pulse where Find put the eye
      if (st.pulse) {
        const d = by.get(st.pulse.id);
        const k = (now() - st.pulse.start) / 1400;
        if (!d || k >= 1) st.pulse = null;
        else {
          for (const off of [0, 0.35]) {
            const q = (k + off) % 1;
            ctx.strokeStyle = `rgba(${rgbOf(d.kind).join(',')},${(1 - q) * 0.8})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r + 4 + q * 28, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      st.drawn = drawn;
      labels(drawn, order, ring, lit, near);
      st.frames.push(now() - t0);
      if (st.frames.length > 240) st.frames.shift();
    }

    // Names beside nodes: the hovered one and its neighbours, the open one,
    // then the larger nodes, largest first, each only where it doesn't
    // cover a name already placed
    function labels(drawn, order, ring, lit, near) {
      const font = opts.font || '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
      const placed = [];
      const big = drawn.slice().sort((a, b) => b.r - a.r);
      const limit = opts.compact ? (st.focus ? 9 : 5) : Math.max(12, Math.round((st.w * st.h) / 26000));
      const want = [];
      if (lit) want.push(...drawn.filter((d) => ring.has(d.id)).sort((a, b) => (a.id === lit ? -1 : b.id === lit ? 1 : b.r - a.r)));
      for (const d of big) {
        if (want.length >= limit + ring.size) break;
        if (ring.has(d.id)) continue;
        if (opts.compact || d.r >= 6 || drawn.length <= 30) want.push(d);
      }
      ctx.textBaseline = 'middle';
      let hoverX = null;
      for (const d of want) {
        const strong = d.id === lit;
        const size = opts.compact ? 10.5 : strong ? 13.5 : 12;
        ctx.font = `${strong ? 600 : 500} ${size}px ${font}`;
        const text = d.name;
        const tw = ctx.measureText(text).width;
        // beside the node on the right, or else on the left (in the small
        // map, under it or else over it)
        const fits = ([x, y]) => {
          const b = [x - 2, y - size * 0.7, x + tw + 2, y + size * 0.7];
          return b[0] >= 2 && b[2] <= st.w - 2 && b[1] >= 2 && b[3] <= st.h - 2 && !placed.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) ? b : null;
        };
        const spots = opts.compact ? [[d.x - tw / 2, d.y + d.r + 8], [d.x - tw / 2, d.y - d.r - 8]] : [[d.x + d.r + 6, d.y], [d.x - d.r - 6 - tw, d.y]];
        let at = spots.find(fits);
        if (!at && !strong) continue;
        if (!at) at = [Math.max(4, Math.min(spots[0][0], st.w - tw - 4)), spots[0][1]];
        const [x, y] = at;
        placed.push(fits(at) || [x, y, x, y]);
        if (d.id === st.hover) hoverX = x;
        const a = (lit && !ring.has(d.id) ? 0.25 : 1) * (st.mix > 0 ? 0.55 + 0.45 * near(d) : 1);
        ctx.globalAlpha = a;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = light() ? 'rgba(246,244,238,0.92)' : 'rgba(18,18,17,0.88)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = light() ? (strong ? '#1f1d1a' : '#4a463f') : (strong ? '#fbf7ee' : '#d8d3c8');
        ctx.fillText(text, x, y);
      }
      ctx.globalAlpha = 1;
      // the hovered node's kind, quietly under its name
      if (lit && st.hover && opts.kindName && hoverX != null) {
        const d = drawn.find((x) => x.id === st.hover);
        if (d) {
          const kind = opts.kindName(d.kind).toUpperCase();
          ctx.font = `500 10px ${font}`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = light() ? 'rgba(246,244,238,0.92)' : 'rgba(18,18,17,0.88)';
          ctx.strokeText(kind, hoverX, d.y + 15);
          ctx.fillStyle = light() ? 'rgba(80,74,64,0.8)' : 'rgba(220,214,202,0.62)';
          ctx.fillText(kind, hoverX, d.y + 15);
        }
      }
    }

    /* ---------- hands ---------- */
    let drag = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function hoverAt(p) {
      const id = hitTest(st.drawn, p.x, p.y);
      canvas.style.cursor = id ? 'pointer' : st.mode === '2d' ? 'grab' : 'move';
      if (id === st.hover) return;
      st.hover = id;
      if (opts.onHover) opts.onHover(id);
      draw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = local(e);
      const id = hitTest(st.drawn, p.x, p.y);
      drag = { id, x0: p.x, y0: p.y, x: p.x, y: p.y, t: now(), moved: false };
      st.spin.yaw = st.spin.pitch = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!drag) { hoverAt(p); return; }
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 4) drag.moved = true;
      if (!drag.moved) return;
      drag.x = p.x;
      drag.y = p.y;
      if (drag.id && !opts.compact) {
        // a node dragged: moved on screen, pinned until the view closes
        const key = st.mode === '2d' ? 'pos2' : 'pos3';
        const q = st[key][drag.id];
        const pr = project(posOf(drag.id), st.v, st.w, st.h);
        const s = pr.f * st.v.zoom;
        // screen motion back into the world (the inverse of the turn)
        const cy = Math.cos(st.v.yaw);
        const sy = Math.sin(st.v.yaw);
        const cp = Math.cos(st.v.pitch);
        const sp = Math.sin(st.v.pitch);
        const wx = dx / s;
        const wy = dy / s;
        const vy = wy * cp;
        const vz = -wy * sp;
        st[key][drag.id] = { x: q.x + wx * cy - vz * sy, y: q.y + vy, z: key === 'pos3' ? q.z + wx * sy + vz * cy : 0 };
        st.pinned.add(drag.id);
        st.settle = 70;
        kick();
      } else if (st.mode === '2d') {
        st.v.panX += dx;
        st.v.panY += dy;
        draw();
      } else {
        st.spin.yaw = dx * 0.008;
        st.spin.pitch = dy * 0.008;
        st.v.yaw += st.spin.yaw;
        st.v.pitch = Math.max(-1.45, Math.min(1.45, st.v.pitch + st.spin.pitch));
        draw();
      }
    });
    const up = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      if (!d.moved) {
        const p = local(e);
        const id = hitTest(st.drawn, p.x, p.y);
        if (id && opts.onPick) opts.onPick(id, e);
        return;
      }
      if (now() - d.t > 40) kick(); // let a turn carry on
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (!drag && st.hover) { st.hover = null; if (opts.onHover) opts.onHover(null); draw(); } });
    canvas.addEventListener('wheel', (e) => {
      if (opts.compact) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      const user = Math.max(0.25, Math.min(6, st.user * k));
      const p = local(e);
      // in 2D the point under the pointer stays put
      if (st.mode === '2d') {
        const r = user / st.user;
        st.v.panX = (st.v.panX - (p.x - st.w / 2)) * r + (p.x - st.w / 2);
        st.v.panY = (st.v.panY - (p.y - st.h / 2)) * r + (p.y - st.h / 2);
      }
      st.user = user;
      st.v.zoom = st.fit * st.user;
      draw();
    }, { passive: false });

    // Find on the map: the eye moves to the node, which pulses
    function focusOn(id, pulse = true) {
      if (!st.pos3[id]) return false;
      const p = posOf(id);
      const from = { cx: st.v.cx, cy: st.v.cy, cz: st.v.cz, panX: st.v.panX, panY: st.v.panY };
      animate(700, (t) => {
        st.v.cx = from.cx + (p.x - from.cx) * t;
        st.v.cy = from.cy + (p.y - from.cy) * t;
        st.v.cz = from.cz + (p.z - from.cz) * t;
        st.v.panX = from.panX * (1 - t);
        st.v.panY = from.panY * (1 - t);
      });
      if (pulse) st.pulse = { id, start: now() };
      kick();
      return true;
    }

    return {
      setGraph,
      setMode,
      mode: () => st.mode,
      setFocus(id) { st.focus = id || null; draw(); },
      focusOn,
      draw,
      resize() { st.w = 0; draw(); },
      nodes: () => st.graph.nodes.slice(),
      // where a node is drawn, in the window's coordinates
      screenPos(id) {
        const d = st.drawn.find((x) => x.id === id);
        if (!d) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.left + d.x, y: r.top + d.y, r: d.r };
      },
      turn(dyaw, dpitch = 0) { st.v.yaw += dyaw; st.v.pitch = Math.max(-1.45, Math.min(1.45, st.v.pitch + dpitch)); draw(); },
      frameTimes: () => st.frames.slice(),
      busy: () => !!(st.raf || st.anims.length),
      destroy() { st.dead = true; if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }
    };
  }

  const api = { seedOf, layout, filterGraph, neighbourhood, project, hitTest, radius, create, active: null };
  // the full view's map (the e2e test asks it where things are)
  api.nodes = () => (api.active ? api.active.nodes() : []);
  api.screenPos = (id) => (api.active ? api.active.screenPos(id) : null);
  return api;
});
