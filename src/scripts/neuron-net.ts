// The organic network behind the Company Brain hero: a handful of neurons spread over the whole hero (Poisson-disk), each with a soma and 4 to 7
// branching dendrites, joined by long curved axons that end on a dendrite tip of another neuron. The neurons form ONE connected network
// (minimum spanning tree plus extras). Pure geometry, no DOM, so scripts/test-neuron-net.mjs can check it.

export type Rand = () => number;
export const mulberry = (seed: number): Rand => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export const AXON_MIN = 260, AXON_MAX = 520;
const DEPTH = 3, SPREAD = (35 * Math.PI) / 180, SHRINK = 0.7, WIDTHS = [2, 1.35, 0.85, 0.4];

export interface Seg { n: number; parent: number; depth: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; width: number; amp: number; wx: number; wy: number; px: number; py: number }
export interface Neuron { x: number; y: number; r: number; alpha: number; segs: number[]; tips: number[]; out: Axon[] }
/** `lat` are the sideways bulges of the two bezier control points, as fractions of the chord. */
export interface Axon { from: number; to: number; tip: number; lat1: number; lat2: number; length: number; born: number; state: 'grow' | 'live' | 'fade'; k: number }
export interface Net { w: number; h: number; neurons: Neuron[]; segs: Seg[]; axons: Axon[] }

/** Bridson's Poisson-disk sampling: no two points closer than r. */
export function poisson(w: number, h: number, r: number, rand: Rand, k = 30): [number, number][] {
  const cell = r / Math.SQRT2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1); const pts: [number, number][] = []; const active: number[] = [];
  const add = (x: number, y: number) => { pts.push([x, y]); grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = pts.length - 1; active.push(pts.length - 1); };
  const ok = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = Math.max(0, cy - 2); j <= Math.min(gh - 1, cy + 2); j++) for (let i = Math.max(0, cx - 2); i <= Math.min(gw - 1, cx + 2); i++) { const n = grid[j * gw + i]; if (n >= 0 && (pts[n][0] - x) ** 2 + (pts[n][1] - y) ** 2 < r * r) return false; }
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

const bezier = (x0: number, y0: number, x1: number, y1: number, lat1: number, lat2: number, t: number): [number, number] => {
  const dx = x1 - x0, dy = y1 - y0, nx = -dy, ny = dx; // chord and its normal (chord length times the unit normal)
  const c1x = x0 + dx * 0.33 + nx * lat1, c1y = y0 + dy * 0.33 + ny * lat1, c2x = x0 + dx * 0.66 + nx * lat2, c2y = y0 + dy * 0.66 + ny * lat2, u = 1 - t;
  return [u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1];
};
/** Point on an axon at t, between a soma at (x0,y0) and a tip at (x1,y1). */
export const axonPoint = (x0: number, y0: number, x1: number, y1: number, a: Pick<Axon, 'lat1' | 'lat2'>, t: number) => bezier(x0, y0, x1, y1, a.lat1, a.lat2, t);
const curveLength = (x0: number, y0: number, x1: number, y1: number, lat1: number, lat2: number) => { let len = 0, [px, py] = [x0, y0]; for (let i = 1; i <= 24; i++) { const [x, y] = bezier(x0, y0, x1, y1, lat1, lat2, i / 24); len += Math.hypot(x - px, y - py); px = x; py = y; } return len; };

/** Builds an axon from neuron `from` to the dendrite tip of `to` nearest to it, bulging sideways until it is at least AXON_MIN long. Null when the neurons are too far apart. */
export function makeAxon(net: Net, from: number, to: number, rand: Rand, born = 0, strict = true): Axon | null {
  const a = net.neurons[from], b = net.neurons[to];
  // the tip is one of the nearest that are at least 110 px away: dendrites of neighbours intertwine, and an axon that short would not be an axon
  const cands = b.tips.map((t) => ({ t, d: Math.hypot(net.segs[t].x1 - a.x, net.segs[t].y1 - a.y) })).filter((c) => c.d >= 110 && c.d <= AXON_MAX * 0.9).sort((p, q) => p.d - q.d).slice(0, 4);
  // (best effort, used only to keep the network in one piece: the farthest tip, whatever its distance)
  const far = b.tips.map((t) => ({ t, d: Math.hypot(net.segs[t].x1 - a.x, net.segs[t].y1 - a.y) })).sort((p, q) => q.d - p.d)[0];
  if (!cands.length && strict) return null;
  const pick = cands.length ? cands[Math.floor(rand() * cands.length)] : far, tip = pick.t, s = net.segs[tip], chord = pick.d;
  // a random S-shaped bulge, scaled (bisection) until the axon has a length drawn from the 260 to 520 range, and at least the chord
  const s1 = (0.5 + rand() * 0.5) * (rand() < 0.5 ? -1 : 1), s2 = -(0.5 + rand() * 0.5) * Math.sign(s1) * (rand() < 0.3 ? -1 : 1);
  const want = Math.max(AXON_MIN + rand() * (AXON_MAX - AXON_MIN) * 0.75, chord * 1.04);
  let lo = 0, hi = 8, len = chord;
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; len = curveLength(a.x, a.y, s.x1, s.y1, s1 * m * 0.5, s2 * m * 0.5); if (len < want) lo = m; else hi = m; }
  const m = (lo + hi) / 2, lat1 = s1 * m * 0.5, lat2 = s2 * m * 0.5; len = curveLength(a.x, a.y, s.x1, s.y1, lat1, lat2);
  if (strict && (len < AXON_MIN * 0.97 || len > AXON_MAX * 1.03)) return null;
  return { from, to, tip, lat1, lat2, length: len, born, state: 'live', k: 0 };
}

const grow = (net: Net, n: number, x: number, y: number, rand: Rand) => {
  const nd = 4 + Math.floor(rand() * 4), neuron = net.neurons[n], base = rand() * Math.PI * 2;
  const branch = (parent: number, x0: number, y0: number, ang: number, len: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len, bend = (rand() - 0.5) * 0.5 * len; // curved with noise
    const seg: Seg = { n, parent, depth, x0, y0, x1, y1, cx: (x0 + x1) / 2 - Math.sin(ang) * bend, cy: (y0 + y1) / 2 + Math.cos(ang) * bend, width: WIDTHS[depth], amp: (2 + rand() * 2) / (DEPTH + 1), wx: (Math.PI * 2) / (6 + rand() * 6), wy: (Math.PI * 2) / (6 + rand() * 6), px: rand() * 6.28, py: rand() * 6.28 };
    const id = net.segs.push(seg) - 1; neuron.segs.push(id);
    if (depth < DEPTH) { branch(id, x1, y1, ang - SPREAD * (0.8 + rand() * 0.4), len * SHRINK, depth + 1); branch(id, x1, y1, ang + SPREAD * (0.8 + rand() * 0.4), len * SHRINK, depth + 1); } else neuron.tips.push(id);
  };
  for (let d = 0; d < nd; d++) branch(-1, x, y, base + (Math.PI * 2 * d) / nd + (rand() - 0.5) * 0.5, 45 + rand() * 35, 0);
};

/** Weakly connected: every neuron reaches every other along axons taken in either direction. */
export function neuronsConnected(net: Pick<Net, 'neurons'> & { axons: { from: number; to: number; state?: string }[] }, ignore?: unknown, extra?: { from: number; to: number }) {
  const n = net.neurons.length; const parent = Array.from({ length: n }, (_, i) => i); const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const link = (a: number, b: number) => { parent[find(a)] = find(b); };
  net.axons.forEach((ax) => { if (ax !== ignore && ax.state !== 'fade') link(ax.from, ax.to); }); if (extra) link(extra.from, extra.to);
  const root = find(0); for (let i = 1; i < n; i++) if (find(i) !== root) return false; return true;
}
export function assertNeuronsConnected(net: Net) { if (!neuronsConnected(net)) throw new Error('neuron network is not connected'); }

/** `target` neurons over a w x h hero. */
export function buildNet(w: number, h: number, target: number, seed = 1): Net {
  const rand = mulberry(seed); const net: Net = { w, h, neurons: [], segs: [], axons: [] };
  let r = Math.sqrt((w * h) / target) * 0.9, pts = poisson(w, h, r, rand);
  for (let i = 0; i < 60 && pts.length < target; i++) { r *= 0.97; pts = poisson(w, h, r, rand); }
  pts.forEach(([x, y], i) => { net.neurons.push({ x, y, r: 3 + rand() * 2, alpha: 0.18 + rand() * 0.1, segs: [], tips: [], out: [] }); grow(net, i, x, y, rand); });
  const n = net.neurons.length;
  // minimum spanning tree over every pair (Kruskal): always connected, then oriented so that no neuron sends more than 2 axons
  const pairs: [number, number, number][] = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j, Math.hypot(net.neurons[i].x - net.neurons[j].x, net.neurons[i].y - net.neurons[j].y)]);
  pairs.sort((a, b) => a[2] - b[2]);
  const parent = Array.from({ length: n }, (_, i) => i); const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const linked = new Set<string>(); const outCount = new Array(n).fill(0);
  const add = (a: number, b: number, strict = true) => {
    const ax = makeAxon(net, a, b, rand, 0, strict); if (!ax) return false;
    net.axons.push(ax); net.neurons[a].out.push(ax); outCount[a]++; linked.add(a < b ? `${a}-${b}` : `${b}-${a}`); return true;
  };
  const mst: [number, number][] = [];
  for (const [a, b] of pairs) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; mst.push([a, b]); } }
  // orient the tree from a root: a parent may send down to a child while it has sent fewer than 2, otherwise the child sends up. Nobody ends with more than 2.
  const adj: number[][] = Array.from({ length: n }, () => []); mst.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const seen = new Uint8Array(n); const queue = [Math.floor(rand() * n)]; seen[queue[0]] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    for (const c of adj[p]) {
      if (seen[c]) continue; seen[c] = 1; queue.push(c);
      const down = rand() < 0.5 && outCount[p] < 2; const [s, d] = down ? [p, c] : [c, p];
      // an edge that cannot make a proper axon is still linked, best effort, so the network never splits
      if (!add(s, d)) add(s, d, false);
    }
  }
  // every neuron sends 1 or 2 axons: those with none get one to their nearest neighbour, a few get a second one
  const order = net.neurons.map((_, i) => i);
  for (const i of order) {
    const near = pairs.filter((p) => p[0] === i || p[1] === i).map((p) => (p[0] === i ? p[1] : p[0]));
    const want = outCount[i] === 0 ? 1 : rand() < 0.4 ? 1 : 0;
    for (let k = 0, added = 0; added < want && k < near.length; k++) { const j = near[k], key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!linked.has(key) && outCount[i] < 2 && add(i, j)) added++; }
    if (outCount[i] === 0) { const j = near.find((q) => !linked.has(i < q ? `${i}-${q}` : `${q}-${i}`)) ?? near[0]; add(i, j, false); }
  }
  assertNeuronsConnected(net);
  return net;
}

/** Picks an axon to retire and a new neuron for it to grow toward, so that the network stays connected and the new axon is a new path. Null when none qualifies. */
export function pickRegrow(net: Net, rand: Rand): { old: Axon; to: number; fresh: Axon } | null {
  const live = net.axons.filter((a) => a.state === 'live'); const n = net.neurons.length;
  for (let tries = 0; tries < 40; tries++) {
    const old = live[Math.floor(rand() * live.length)]; if (!old) return null;
    const to = Math.floor(rand() * n); if (to === old.from || to === old.to) continue;
    if (net.axons.some((a) => a.from === old.from && a.to === to && a.state !== 'fade')) continue;
    if (!neuronsConnected(net, old, { from: old.from, to })) continue; // the network must stay in one piece without the old axon and with the new one
    const fresh = makeAxon(net, old.from, to, rand); if (!fresh) continue; fresh.state = 'grow';
    return { old, to, fresh };
  }
  return null;
}
