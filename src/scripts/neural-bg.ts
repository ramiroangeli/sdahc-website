// Neural background of the Company Brain hero: ~180 nodes joined by ~400 curved filaments, with pulses travelling along them.
// A separate 2D canvas behind everything. The mouse pushes nearby nodes aside (with a spring back) and lights the filaments around it.
export interface BgColors { blue: string; cyan: string; white: string; amber: string }

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rgb = (hex: string) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

const NODES = 180, EDGES = 400, PULSES = 40, RADIUS = 160, PUSH = 12;

export function createNeuralBg(canvas: HTMLCanvasElement, hero: HTMLElement, colors: BgColors, animate: boolean) {
  const rand = rng(20261128);
  const ctx = canvas.getContext('2d')!;
  const [br, bg, bb] = rgb(colors.blue);
  const pulseColors = { cyan: colors.cyan, white: colors.white, amber: colors.amber };
  let w = 1, h = 1, dpr = 1;

  // graph, in unit coordinates so a resize only rescales it
  const base = Array.from({ length: NODES }, () => ({ x: rand(), y: rand() }));
  const off = base.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
  const edges: { a: number; b: number; k: number; alpha: number }[] = [];
  const seen = new Set<string>();
  const order = base.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) {
    const near = base.map((n, j) => ({ j, d: (n.x - base[i].x) ** 2 * 2.2 + (n.y - base[i].y) ** 2 })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 3);
    for (const { j } of near) { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(key) && edges.length < EDGES) { seen.add(key); edges.push({ a: i, b: j, k: (rand() - 0.5) * 0.5, alpha: 0.12 + rand() * 0.06 }); } }
  }
  const incident: number[][] = base.map(() => []);
  edges.forEach((e, i) => { incident[e.a].push(i); incident[e.b].push(i); });

  const nx = (i: number) => base[i].x * w + off[i].x, ny = (i: number) => base[i].y * h + off[i].y;
  // quadratic bezier control point of an edge: the midpoint pushed sideways
  const ctrl = (e: { a: number; b: number; k: number }) => { const ax = nx(e.a), ay = ny(e.a), bx = nx(e.b), by = ny(e.b); return [(ax + bx) / 2 - (by - ay) * e.k, (ay + by) / 2 + (bx - ax) * e.k, ax, ay, bx, by]; };
  const at = (e: { a: number; b: number; k: number }, t: number) => { const [cx, cy, ax, ay, bx, by] = ctrl(e); const u = 1 - t; return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]; };

  type Pulse = { e: number; from: number; t: number; speed: number; color: string; temp: number };
  let spawnCount = 0;
  const pulseColor = () => (++spawnCount % 15 === 0 ? pulseColors.amber : rand() < 0.5 ? pulseColors.cyan : pulseColors.white);
  const newPulse = (node = Math.floor(rand() * NODES), temp = 0): Pulse | null => {
    const inc = incident[node]; if (!inc.length) return null;
    return { e: inc[Math.floor(rand() * inc.length)], from: node, t: 0, speed: 150 + rand() * 120, color: pulseColor(), temp };
  };
  const pulses: Pulse[] = [];
  const seed = () => { while (pulses.length < PULSES) { const p = newPulse(); if (!p) break; p.t = rand(); pulses.push(p); } };

  let mx = -9999, my = -9999, mouseOn = false, lastMove = -Infinity, lastSpawn = -Infinity, raf = 0, last = 0, running = false;
  const nearestNode = (x: number, y: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < NODES; i++) { const d = (nx(i) - x) ** 2 + (ny(i) - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };

  const draw = (dt: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    // spring the nodes away from the pointer and back
    if (dt > 0) for (let i = 0; i < NODES; i++) {
      let tx = 0, ty = 0;
      if (mouseOn) { const dx = base[i].x * w - mx, dy = base[i].y * h - my, d = Math.hypot(dx, dy); if (d < RADIUS && d > 0.001) { const f = (1 - d / RADIUS) * PUSH; tx = (dx / d) * f; ty = (dy / d) * f; } }
      const o = off[i]; o.vx += ((tx - o.x) * 180 - o.vx * 14) * dt; o.vy += ((ty - o.y) * 180 - o.vy * 14) * dt; o.x += o.vx * dt; o.y += o.vy * dt;
    }
    // filaments: quiet ones in three batches, lit ones (around the pointer) one by one
    const lit: number[] = []; const batches: number[][] = [[], [], []];
    edges.forEach((e, i) => {
      if (mouseOn) { const [cx, cy] = ctrl(e); if (Math.hypot(cx - mx, cy - my) < RADIUS) { lit.push(i); return; } }
      batches[e.alpha < 0.14 ? 0 : e.alpha < 0.16 ? 1 : 2].push(i);
    });
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    const trace = (ids: number[]) => { for (const i of ids) { const e = edges[i]; const [cx, cy, ax, ay, bx, by] = ctrl(e); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); } };
    batches.forEach((ids, bi) => { ctx.beginPath(); trace(ids); ctx.strokeStyle = `rgba(${br},${bg},${bb},${[0.12, 0.15, 0.18][bi]})`; ctx.stroke(); });
    if (lit.length) { ctx.beginPath(); trace(lit); ctx.strokeStyle = `rgba(${br},${bg},${bb},0.45)`; ctx.stroke(); }
    // nodes
    ctx.fillStyle = `rgba(${br},${bg},${bb},0.5)`; ctx.beginPath();
    for (let i = 0; i < NODES; i++) { ctx.moveTo(nx(i) + 1.6, ny(i)); ctx.arc(nx(i), ny(i), 1.6, 0, 6.2832); }
    ctx.fill();
    // pulses
    if (animate) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], e = edges[p.e], len = Math.hypot(nx(e.b) - nx(e.a), ny(e.b) - ny(e.a)) || 1;
        p.t += (p.speed * dt) / len;
        if (p.t >= 1) {
          const end = p.from === e.a ? e.b : e.a;
          if (p.temp > 0 && --p.temp === 0) { pulses.splice(i, 1); continue; }
          const inc = incident[end]; p.from = end; p.e = inc[Math.floor(rand() * inc.length)]; p.t = 0; continue;
        }
        const tt = p.from === e.a ? p.t : 1 - p.t; const [x, y] = at(e, tt); const [tx, ty] = at(e, p.from === e.a ? Math.max(0, tt - 0.08) : Math.min(1, tt + 0.08));
        const g = ctx.createLinearGradient(x, y, tx, ty); g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = p.color; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(x, y, 2.1, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  const resize = (nw: number, nh: number) => { dpr = Math.min(window.devicePixelRatio || 1, 2); w = Math.max(1, nw); h = Math.max(1, nh); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); if (!running) draw(0); };
  const rel = (e: PointerEvent) => { const r = hero.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; [mx, my] = rel(e); mouseOn = true; lastMove = performance.now(); };
  const onLeave = () => { mouseOn = false; };
  const onDown = (e: PointerEvent) => { if (e.pointerType !== 'touch' || !running) return; const [x, y] = rel(e); const n = nearestNode(x, y); for (let i = 0; i < 6; i++) { const p = newPulse(n, 3); if (p) pulses.push(p); } };
  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 33) return; // ~30 fps is plenty for a background
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (mouseOn && now - lastMove < 150 && now - lastSpawn > 400) { lastSpawn = now; const p = newPulse(nearestNode(mx, my), 2); if (p) pulses.push(p); } // a pulse from the node nearest the pointer, while it moves
    draw(dt);
  };

  seed();
  if (animate) { hero.addEventListener('pointermove', onMove); hero.addEventListener('pointerleave', onLeave); hero.addEventListener('pointerdown', onDown); }
  return {
    resize,
    start() { if (running || !animate) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
