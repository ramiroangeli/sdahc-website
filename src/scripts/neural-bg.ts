// Neural background of the Company Brain hero: ONE connected network (see neural-graph.ts) drawn with curved, low-opacity filaments.
// About 40 pulses are always travelling, each along its own path of 4 to 10 edges that never doubles back and never repeats a node.
// The mouse pushes nearby nodes aside (with a spring back) and lights the filaments around it; pulses leave from the node nearest the pointer.
import { buildGraph, mulberry, walk, type Graph } from './neural-graph';

export interface BgColors { blue: string; cyan: string; white: string; amber: string }

const rgb = (hex: string) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

const PULSES = 40, RADIUS = 160, PUSH = 12;
const SPEED = [75, 135]; // px/s: half of the first version's 150 to 270
const FADE_IN = 0.4, FADE_OUT = 0.7; // seconds

export function createNeuralBg(canvas: HTMLCanvasElement, hero: HTMLElement, colors: BgColors, animate: boolean) {
  const rand = mulberry(20261129);
  const ctx = canvas.getContext('2d')!;
  const [br, bg, bb] = rgb(colors.blue);
  let w = 1, h = 1, dpr = 1;
  let g: Graph = { pts: [], edges: [], incident: [], minDist: 0 };
  let off: { x: number; y: number; vx: number; vy: number }[] = [];
  let curve: { k: number; alpha: number }[] = [];

  type Pulse = { nodes: number[]; edges: number[]; seg: number; t: number; speed: number; color: string; age: number; out: number; temp: boolean };
  let pulses: Pulse[] = [];
  let spawnCount = 0;
  const pulseColor = () => (++spawnCount % 15 === 0 ? colors.amber : rand() < 0.5 ? colors.cyan : colors.white);

  const nx = (i: number) => g.pts[i][0] + off[i].x, ny = (i: number) => g.pts[i][1] + off[i].y;
  const ctrl = (ei: number) => { const [a, b] = g.edges[ei], ax = nx(a), ay = ny(a), bx = nx(b), by = ny(b), k = curve[ei].k; return [(ax + bx) / 2 - (by - ay) * k, (ay + by) / 2 + (bx - ax) * k, ax, ay, bx, by]; };
  const at = (ei: number, from: number, t: number) => { const [cx, cy, ax, ay, bx, by] = ctrl(ei); const tt = g.edges[ei][0] === from ? t : 1 - t, u = 1 - tt; return [u * u * ax + 2 * u * tt * cx + tt * tt * bx, u * u * ay + 2 * u * tt * cy + tt * tt * by]; };
  const other = (ei: number, n: number) => (g.edges[ei][0] === n ? g.edges[ei][1] : g.edges[ei][0]);

  const pathFrom = (start: number, firstEdge = -1) => walk(g, rand, start, firstEdge);
  const head = (p: Pulse) => p.nodes[Math.min(p.seg, p.nodes.length - 1)];
  /** Where a new pulse is born: the best of a few random nodes, i.e. the one farthest from the pulses already running, so they stay spread over the whole hero. */
  const spreadStart = () => {
    let best = 0, bestD = -1;
    for (let c = 0; c < 8; c++) {
      const n = Math.floor(rand() * g.pts.length); let d = Infinity;
      for (const p of pulses) { if (p.temp) continue; const m = head(p); d = Math.min(d, (g.pts[n][0] - g.pts[m][0]) ** 2 + (g.pts[n][1] - g.pts[m][1]) ** 2); }
      if (d > bestD) { bestD = d; best = n; }
    }
    return best;
  };
  const spawn = (start: number, temp: boolean, firstEdge = -1, advance = 0) => {
    for (let tries = 0; tries < 12; tries++) {
      const path = pathFrom(tries === 0 ? start : temp ? start : spreadStart(), tries === 0 ? firstEdge : -1);
      if (!path) continue;
      const p: Pulse = { ...path, seg: 0, t: 0, speed: SPEED[0] + rand() * (SPEED[1] - SPEED[0]), color: pulseColor(), age: 0, out: -1, temp };
      if (advance) { p.seg = Math.min(path.edges.length - 1, Math.floor(advance * path.edges.length)); p.t = rand(); p.age = FADE_IN; } // the first batch is spread along its paths too
      pulses.push(p); return p;
    }
    return null;
  };

  const build = () => {
    g = buildGraph(Math.max(w, 2), Math.max(h, 2), w < 700 ? 110 : 220, 7);
    off = g.pts.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    curve = g.edges.map(() => ({ k: (rand() - 0.5) * 0.5, alpha: 0.12 + rand() * 0.06 }));
    pulses = [];
    if (animate) while (pulses.length < PULSES) { if (!spawn(spreadStart(), false, -1, rand())) break; }
  };

  let mx = -9999, my = -9999, mouseOn = false, lastMove = -Infinity, lastSpawn = -Infinity, raf = 0, last = 0, running = false;
  const nearestNode = (x: number, y: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < g.pts.length; i++) { const d = (nx(i) - x) ** 2 + (ny(i) - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };

  const draw = (dt: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const N = g.pts.length;
    if (dt > 0) for (let i = 0; i < N; i++) {
      let tx = 0, ty = 0;
      if (mouseOn) { const dx = g.pts[i][0] - mx, dy = g.pts[i][1] - my, d = Math.hypot(dx, dy); if (d < RADIUS && d > 0.001) { const f = (1 - d / RADIUS) * PUSH; tx = (dx / d) * f; ty = (dy / d) * f; } }
      const o = off[i]; o.vx += ((tx - o.x) * 180 - o.vx * 14) * dt; o.vy += ((ty - o.y) * 180 - o.vy * 14) * dt; o.x += o.vx * dt; o.y += o.vy * dt;
    }
    // filaments: quiet ones in three batches, lit ones (around the pointer) together
    const lit: number[] = []; const batches: number[][] = [[], [], []];
    for (let i = 0; i < g.edges.length; i++) {
      if (mouseOn) { const [cx, cy] = ctrl(i); if (Math.hypot(cx - mx, cy - my) < RADIUS) { lit.push(i); continue; } }
      const a = curve[i].alpha; batches[a < 0.14 ? 0 : a < 0.16 ? 1 : 2].push(i);
    }
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    const trace = (ids: number[]) => { for (const i of ids) { const [cx, cy, ax, ay, bx, by] = ctrl(i); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); } };
    batches.forEach((ids, bi) => { ctx.beginPath(); trace(ids); ctx.strokeStyle = `rgba(${br},${bg},${bb},${[0.12, 0.15, 0.18][bi]})`; ctx.stroke(); });
    if (lit.length) { ctx.beginPath(); trace(lit); ctx.strokeStyle = `rgba(${br},${bg},${bb},0.45)`; ctx.stroke(); }
    ctx.fillStyle = `rgba(${br},${bg},${bb},0.5)`; ctx.beginPath();
    for (let i = 0; i < N; i++) { ctx.moveTo(nx(i) + 1.6, ny(i)); ctx.arc(nx(i), ny(i), 1.6, 0, 6.2832); }
    ctx.fill();
    if (!animate) return;
    // pulses: each follows its path edge by edge, fades in at birth and out at the end of the path, then another is born somewhere else
    ctx.globalCompositeOperation = 'lighter';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]; p.age += dt;
      if (p.out >= 0) { p.out += dt; if (p.out >= FADE_OUT) { pulses.splice(i, 1); if (!p.temp) spawn(spreadStart(), false); continue; } }
      else {
        const ei = p.edges[p.seg], [ax, ay, bx, by] = [nx(g.edges[ei][0]), ny(g.edges[ei][0]), nx(g.edges[ei][1]), ny(g.edges[ei][1])];
        p.t += (p.speed * dt) / (Math.hypot(bx - ax, by - ay) || 1);
        if (p.t >= 1) { p.t = 0; p.seg++; if (p.seg >= p.edges.length) { p.seg = p.edges.length - 1; p.t = 1; p.out = 0; } }
      }
      const ei = p.edges[p.seg], from = p.nodes[p.seg];
      const alpha = Math.min(1, p.age / FADE_IN) * (p.out >= 0 ? 1 - p.out / FADE_OUT : 1);
      const [x, y] = at(ei, from, p.t); const [tx, ty] = at(ei, from, Math.max(0, p.t - 0.1));
      ctx.globalAlpha = alpha; const gr = ctx.createLinearGradient(x, y, tx, ty); gr.addColorStop(0, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = gr; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = p.color; ctx.globalAlpha = 0.9 * alpha; ctx.beginPath(); ctx.arc(x, y, 2.1, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 0.25 * alpha; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  let pending = 0;
  const resize = (nw: number, nh: number) => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const changed = Math.abs(nw - w) > 2 || Math.abs(nh - h) > 2 || !g.pts.length; w = Math.max(1, nw); h = Math.max(1, nh);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!changed) { if (!running) draw(0); return; }
    clearTimeout(pending); const go = () => { build(); if (!running) draw(0); }; if (!g.pts.length) go(); else pending = window.setTimeout(go, 120);
    if (g.pts.length && !running) draw(0);
  };
  const rel = (e: PointerEvent) => { const r = hero.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; [mx, my] = rel(e); mouseOn = true; lastMove = performance.now(); };
  const onLeave = () => { mouseOn = false; };
  const onDown = (e: PointerEvent) => { // a touch fires a burst of 6 pulses from that point, each leaving by a different edge when it can
    if (e.pointerType !== 'touch' || !running || !g.pts.length) return;
    const [x, y] = rel(e), n = nearestNode(x, y), inc = [...g.incident[n]].sort(() => rand() - 0.5);
    for (let i = 0; i < 6; i++) spawn(n, true, inc[i % inc.length]);
  };
  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 33) return; // ~30 fps is plenty for a background
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (mouseOn && g.pts.length && now - lastMove < 150 && now - lastSpawn > 400) { lastSpawn = now; spawn(nearestNode(mx, my), true); } // from the node nearest the pointer, while it moves
    draw(dt);
  };

  if (animate) { hero.addEventListener('pointermove', onMove); hero.addEventListener('pointerleave', onLeave); hero.addEventListener('pointerdown', onDown); }
  return {
    resize,
    start() { if (running || !animate) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
