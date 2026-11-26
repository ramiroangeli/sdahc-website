// Checks the hero's background network: one connected component for every size and seed, no isolated node, minimum distance kept, node counts near the targets.
import assert from 'node:assert/strict';
import { buildGraph, assertConnected, walk, mulberry } from '../src/scripts/neural-graph.ts';

const sizes = [[1440, 900, 220], [1920, 1080, 220], [2560, 1300, 220], [1100, 800, 220], [768, 1024, 150], [390, 844, 110], [360, 640, 110], [320, 568, 110]];
let checked = 0;
for (const [w, h, target] of sizes) for (let seed = 1; seed <= 25; seed++) {
  const g = buildGraph(w, h, target, seed); // throws if not connected
  assertConnected(g);
  assert.ok(g.incident.every((e) => e.length >= 1), `isolated node at ${w}x${h} seed ${seed}`);
  assert.ok(g.edges.length >= g.pts.length - 1, 'fewer edges than a spanning tree');
  let min = Infinity; for (let i = 0; i < g.pts.length; i++) for (let j = i + 1; j < g.pts.length; j++) min = Math.min(min, Math.hypot(g.pts[i][0] - g.pts[j][0], g.pts[i][1] - g.pts[j][1]));
  assert.ok(min >= g.minDist - 1e-6 && g.minDist <= 70, `minimum distance ${min} below ${g.minDist} at ${w}x${h}`);
  assert.ok(g.pts.length >= target * 0.9 && (w * h > 2.2e6 || g.pts.length <= target * 1.6), `${g.pts.length} nodes for a target of ${target} at ${w}x${h}`);
  if (seed === 1) console.log(`  ${w}x${h}: ${g.pts.length} nodes, ${g.edges.length} edges, min distance ${g.minDist.toFixed(0)} px`);
  checked++;
}
// pulse paths: 4 to 10 edges, no node twice, never straight back along the edge just used
{
  const g = buildGraph(1440, 900, 220, 7); const rand = mulberry(99); let paths = 0;
  for (let i = 0; i < 4000; i++) {
    const p = walk(g, rand, Math.floor(rand() * g.pts.length)); if (!p) continue; paths++;
    assert.ok(p.edges.length >= 4 && p.edges.length <= 10, `path of ${p.edges.length} edges`);
    assert.equal(new Set(p.nodes).size, p.nodes.length, 'a node repeats in a path');
    assert.equal(p.nodes.length, p.edges.length + 1);
    p.edges.forEach((e, k) => { assert.ok(g.edges[e].includes(p.nodes[k]) && g.edges[e].includes(p.nodes[k + 1]), 'edge does not join consecutive nodes'); if (k) assert.notEqual(e, p.edges[k - 1], 'doubles back'); });
  }
  assert.ok(paths > 3500, `only ${paths} of 4000 starts gave a path`);
  console.log(`  pulse paths: ${paths} checked, 4 to 10 edges, no repeated node, no doubling back`);
}
// a deliberately broken network must be refused
assert.throws(() => assertConnected({ pts: [[0, 0], [1, 1], [9, 9]], edges: [[0, 1]] }), /not connected/);
console.log(`neural graph: ${checked} networks connected, no isolated nodes, spacing and counts as specified`);
