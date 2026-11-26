// The network behind the Company Brain hero: Poisson-disk nodes over the whole hero, a Delaunay triangulation of all of them, long edges trimmed,
// the minimum spanning tree always kept, so the network is ONE connected component. Pure (no DOM), so scripts/test-neural-graph.mjs can check it.
import Delaunator from 'delaunator';

export type Rand = () => number;
export interface Graph { pts: [number, number][]; edges: [number, number][]; incident: number[][]; minDist: number }

export const mulberry = (seed: number): Rand => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Bridson's Poisson-disk sampling: no two points closer than r. */
export function poisson(w: number, h: number, r: number, rand: Rand, k = 30): [number, number][] {
  const cell = r / Math.SQRT2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1); const pts: [number, number][] = []; const active: number[] = [];
  const add = (x: number, y: number) => { pts.push([x, y]); grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = pts.length - 1; active.push(pts.length - 1); };
  const ok = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = Math.max(0, cy - 2); j <= Math.min(gh - 1, cy + 2); j++) for (let i = Math.max(0, cx - 2); i <= Math.min(gw - 1, cx + 2); i++) {
      const n = grid[j * gw + i]; if (n >= 0 && (pts[n][0] - x) ** 2 + (pts[n][1] - y) ** 2 < r * r) return false;
    }
    return true;
  };
  add(rand() * w, rand() * h);
  while (active.length) {
    const ai = Math.floor(rand() * active.length), [px, py] = pts[active[ai]]; let found = false;
    for (let n = 0; n < k; n++) { const a = rand() * Math.PI * 2, d = r * (1 + rand()); const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d; if (ok(x, y)) { add(x, y); found = true; break; } }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

/** `target` nodes over a w x h hero. The minimum distance is 70 px, or less where that cannot give the target count (a phone). */
export function buildGraph(w: number, h: number, target: number, seed = 1, rmax = 70): Graph {
  const rand = mulberry(seed);
  let r = rmax, pts = poisson(w, h, r, rand);
  for (let i = 0; i < 60 && pts.length < target; i++) { r *= 0.975; pts = poisson(w, h, r, rand); }
  const n = pts.length;
  const del = new Delaunator(Float64Array.from(pts.flat()));
  const seen = new Set<number>(); const all: [number, number, number][] = [];
  const t = del.triangles;
  for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = t[i + j], b = t[i + ((j + 1) % 3)], lo = Math.min(a, b), hi = Math.max(a, b), key = lo * n + hi;
    if (!seen.has(key)) { seen.add(key); all.push([lo, hi, Math.hypot(pts[lo][0] - pts[hi][0], pts[lo][1] - pts[hi][1])]); }
  }
  const lens = all.map((e) => e[2]).sort((a, b) => a - b), median = lens[Math.floor(lens.length / 2)];
  // minimum spanning tree (Kruskal): these edges are never trimmed
  const parent = Array.from({ length: n }, (_, i) => i); const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const mst = new Set<number>();
  [...all].sort((a, b) => a[2] - b[2]).forEach(([a, b]) => { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; mst.add(a * n + b); } });
  const edges = all.filter(([a, b, len]) => len <= 1.8 * median || mst.has(a * n + b)).map(([a, b]) => [a, b] as [number, number]);
  const incident: number[][] = Array.from({ length: n }, () => []); edges.forEach(([a, b], i) => { incident[a].push(i); incident[b].push(i); });
  const g = { pts, edges, incident, minDist: r };
  assertConnected(g); // never ship a network with an isolated node or group
  return g;
}

/** Throws unless every node can reach every other one. */
export function assertConnected(g: Pick<Graph, 'pts' | 'edges'>) {
  const n = g.pts.length; const adj: number[][] = Array.from({ length: n }, () => []); g.edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const seen = new Uint8Array(n); const stack = [0]; seen[0] = 1; let count = 1;
  while (stack.length) for (const m of adj[stack.pop()!]) if (!seen[m]) { seen[m] = 1; count++; stack.push(m); }
  if (count !== n) throw new Error(`neural network is not connected: ${count} of ${n} nodes reachable`);
}

/** A pulse's path: 4 to 10 edges from `start`. At each node it takes a random edge other than the one just used, never to a node already on the path.
 *  Returns null when the start cannot give at least 4 edges (the caller picks another start). */
export function walk(g: Pick<Graph, 'edges' | 'incident'>, rand: Rand, start: number, firstEdge = -1): { nodes: number[]; edges: number[] } | null {
  const want = 4 + Math.floor(rand() * 7); const nodes = [start], edges: number[] = [], seen = new Set([start]);
  const other = (e: number, n: number) => (g.edges[e][0] === n ? g.edges[e][1] : g.edges[e][0]);
  while (edges.length < want) {
    const cur = nodes[nodes.length - 1], last = edges[edges.length - 1];
    const options = (edges.length === 0 && firstEdge >= 0 ? [firstEdge] : g.incident[cur]).filter((e) => e !== last && !seen.has(other(e, cur)));
    if (!options.length) break;
    const e = options[Math.floor(rand() * options.length)], nxt = other(e, cur);
    edges.push(e); nodes.push(nxt); seen.add(nxt);
  }
  return edges.length >= 4 ? { nodes, edges } : null;
}
