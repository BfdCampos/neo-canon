'use strict';

// The World Map's layout, projection and hit test (map.js), run through vm
// with no canvas (docs/semantics/IDE.md §5).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({ performance });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'map.js'), 'utf8'), context);
const NeoMap = context.NeoMap;

const KINDS = ['person', 'creature', 'place', 'thing', 'group', 'rule', 'other'];
// a world of n entries: a few hubs, links between them, some together
function world(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: 'e' + i, name: 'Entry ' + i, kind: KINDS[i % KINDS.length], mentions: (i * 7) % 40 }));
  const edges = [];
  for (let i = 1; i < n; i++) edges.push({ a: 'e' + i, b: 'e' + Math.floor(Math.sqrt(i * 13) % i), why: 'fact', n: 1 });
  for (let i = 3; i < n; i += 5) edges.push({ a: 'e' + i, b: 'e' + (i - 2), why: 'together', n: 3 });
  return { nodes, edges };
}
const small = {
  nodes: [{ id: 'tamsin', kind: 'person' }, { id: 'bramble', kind: 'creature' }, { id: 'rook', kind: 'creature' }, { id: 'corwick', kind: 'place' }, { id: 'laws', kind: 'rule' }],
  edges: [{ a: 'bramble', b: 'tamsin', why: 'fact' }, { a: 'laws', b: 'corwick', why: 'words' }, { a: 'tamsin', b: 'rook', why: 'together' }]
};

test('the layout is the same for the same world, every time (the map sorts its nodes by id first)', () => {
  const a = NeoMap.layout(small.nodes, small.edges);
  assert.deepEqual(JSON.stringify(NeoMap.layout(small.nodes, small.edges)), JSON.stringify(a));
  // linked nodes end up nearer each other than unlinked ones, on average
  const d = (p, q) => Math.hypot(a[p].x - a[q].x, a[p].y - a[q].y, a[p].z - a[q].z);
  assert.ok(d('bramble', 'tamsin') < d('bramble', 'laws'));
});

test('300 entries settle in 300 steps in under 200 ms', () => {
  const g = world(300);
  const t0 = performance.now();
  const pos = NeoMap.layout(g.nodes, g.edges, { steps: 300 });
  const ms = performance.now() - t0;
  assert.ok(ms < 200, ms + ' ms');
  assert.equal(Object.keys(pos).length, 300);
  for (const p of Object.values(pos)) assert.ok(Number.isFinite(p.x + p.y + p.z));
});

test('2D gives z = 0', () => {
  const pos = NeoMap.layout(small.nodes, small.edges, { dims: 2 });
  for (const p of Object.values(pos)) assert.equal(p.z, 0);
  const flat = NeoMap.layout(small.nodes, small.edges, { dims: 2, from: NeoMap.layout(small.nodes, small.edges), steps: 50 });
  for (const p of Object.values(flat)) assert.equal(p.z, 0);
});

test('projecting a node and hit-testing that point gives the node back, in 2D and 3D', () => {
  const pos = NeoMap.layout(small.nodes, small.edges);
  for (const v of [{ yaw: 0, pitch: 0, zoom: 2, cx: 0, cy: 0, cz: 0, panX: 0, panY: 0, persp: 0 }, { yaw: 0.8, pitch: -0.4, zoom: 2, cx: 10, cy: 0, cz: 5, panX: 30, panY: -20, persp: 1 }]) {
    const drawn = small.nodes.map((d) => ({ id: d.id, r: 8, ...NeoMap.project(pos[d.id], v, 800, 600) }));
    for (const d of drawn) assert.equal(NeoMap.hitTest(drawn, d.x + 2, d.y - 2), d.id);
    assert.equal(NeoMap.hitTest(drawn, -500, -500), null);
  }
  // turning changes where things are drawn
  const a = NeoMap.project(pos.bramble, { yaw: 0, pitch: 0, zoom: 1, cx: 0, cy: 0, cz: 0, panX: 0, panY: 0, persp: 1 }, 800, 600);
  const b = NeoMap.project(pos.bramble, { yaw: 0.5, pitch: 0.2, zoom: 1, cx: 0, cy: 0, cz: 0, panX: 0, panY: 0, persp: 1 }, 800, 600);
  assert.notEqual(a.x, b.x);
  // and the front one wins where two overlap
  assert.equal(NeoMap.hitTest([{ id: 'back', x: 10, y: 10, r: 8, depth: 50 }, { id: 'front', x: 12, y: 10, r: 8, depth: -50 }], 11, 10), 'front');
});

test('hidden kinds drop their nodes and edges; appearing together only when asked', () => {
  const g = NeoMap.filterGraph(small, ['creature']);
  assert.equal(g.nodes.map((d) => d.id).join(), 'tamsin,corwick,laws');
  assert.equal(g.edges.map((e) => e.a + '-' + e.b).join(), 'laws-corwick');
  assert.equal(NeoMap.filterGraph(small, [], true).edges.length, 3);
  assert.equal(NeoMap.filterGraph(small, []).edges.length, 2);
  assert.equal(NeoMap.neighbourhood(small, 'tamsin').nodes.map((d) => d.id).join(), 'tamsin,bramble,rook');
});
