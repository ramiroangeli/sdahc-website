// Organic neural background of the Company Brain hero (see neuron-net.ts for the geometry): neurons with branching dendrites that sway, long axons,
// and action potentials that only ever travel forward: soma, axon, destination neuron, which may fire in turn.
// The pointer pushes nearby branches aside (with a spring back); a click or touch fires a strong chain from that point.
import { axonPoint, buildNet, mulberry, pickRegrow, type Axon, type Net } from './neuron-net';

export interface BgColors { blue: string; ice: string }
const rgb = (hex: string) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

const RADIUS = 180, PUSH = 14, SPEED = 120, TRAIL = 40, MAX_ACTIVE = 30, STRONG_GENERATIONS = 6;

type Pulse = { ax: Axon; d: number; gen: number; strong: boolean };
type Fire = { at: number; n: number; strong: boolean; gen: number };
type Rect = { x: number; y: number; w: number; h: number };

export function createNeuralBg(canvas: HTMLCanvasElement, hero: HTMLElement, colors: BgColors, animate: boolean) {
  const rand = mulberry(20261201);
  const ctx = canvas.getContext('2d')!;
  const [br, bg, bb] = rgb(colors.blue), [ir, ig, ib] = rgb(colors.ice);
  let w = 1, h = 1, dpr = 1, net: Net | null = null, text: Rect | null = null;
  // dynamic state of every dendrite segment (flat arrays, parents always before their children)
  let S = 0, ox = new Float32Array(0), oy = ox, vx = ox, vy = ox, ax_ = ox, ay_ = ox, p0x = ox, p0y = ox, p1x = ox, p1y = ox, pcx = ox, pcy = ox;
  let buckets: number[][] = [];
  const flash: number[] = [];
  let pulses: Pulse[] = [], queue: Fire[] = [];
  let mx = -9999, my = -9999, mouseOn = false, lastMove = -Infinity, lastMouseFire = -Infinity, nextSpont = 0, nextRegrow = 0, raf = 0, last = 0, running = false, clock = 0;

  // soma sprites: a soft halo (3 to 5 px soma)
  const sprites = [3, 4, 5].map((r) => {
    const c = document.createElement('canvas'), R = Math.ceil(r * 3); c.width = c.height = R * 2;
    const g = c.getContext('2d')!, gr = g.createRadialGradient(R, R, 0, R, R, R); gr.addColorStop(0, `rgba(${br},${bg},${bb},0.55)`); gr.addColorStop(1, `rgba(${br},${bg},${bb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2); g.fillStyle = `rgba(${ir},${ig},${ib},0.85)`; g.beginPath(); g.arc(R, R, r * 0.6, 0, 6.2832); g.fill(); return { c, R };
  });

  const build = () => {
    net = buildNet(Math.max(w, 2), Math.max(h, 2), w < 700 ? 22 : 45, 11); S = net.segs.length;
    const f = () => new Float32Array(S); [ox, oy, vx, vy, ax_, ay_, p0x, p0y, p1x, p1y, pcx, pcy] = [f(), f(), f(), f(), f(), f(), f(), f(), f(), f(), f(), f()];
    buckets = Array.from({ length: 8 }, () => []); net.segs.forEach((s, i) => buckets[s.depth * 2 + (net!.neurons[s.n].alpha >= 0.23 ? 1 : 0)].push(i));
    flash.length = 0; net.neurons.forEach(() => flash.push(0)); pulses = []; queue = []; nextSpont = clock + 0.4 + rand() * 0.8; nextRegrow = clock + 20 + rand() * 20;
    layout(0);
  };

  /** Positions of every segment for time t: sway (2 to 4 px, 6 to 12 s periods) plus the pointer's spring, accumulated from the soma outwards. */
  const layout = (dt: number) => {
    if (!net) return; const segs = net.segs;
    for (let i = 0; i < S; i++) {
      const s = segs[i]; let sx = 0, sy = 0, tx = 0, ty = 0;
      if (animate) {
        sx = s.amp * Math.sin(clock * s.wx + s.px); sy = s.amp * Math.cos(clock * s.wy + s.py);
        if (mouseOn) { const dx = s.x1 - mx, dy = s.y1 - my, d = Math.hypot(dx, dy); if (d < RADIUS && d > 0.001) { const k = (1 - d / RADIUS) * PUSH; tx = (dx / d) * k; ty = (dy / d) * k; } }
        if (dt > 0) { vx[i] += ((tx - ox[i]) * 160 - vx[i] * 12) * dt; vy[i] += ((ty - oy[i]) * 160 - vy[i] * 12) * dt; ox[i] += vx[i] * dt; oy[i] += vy[i] * dt; }
      }
      const px = s.parent >= 0 ? ax_[s.parent] : 0, py = s.parent >= 0 ? ay_[s.parent] : 0;
      ax_[i] = px + sx + ox[i]; ay_[i] = py + sy + oy[i];
      p0x[i] = s.x0 + px; p0y[i] = s.y0 + py; p1x[i] = s.x1 + ax_[i]; p1y[i] = s.y1 + ay_[i]; pcx[i] = s.cx + (px + ax_[i]) / 2; pcy[i] = s.cy + (py + ay_[i]) / 2;
    }
  };

  const tipOf = (a: Axon) => [p1x[a.tip], p1y[a.tip]] as const;
  const fire = (n: number, strong: boolean, gen: number) => {
    if (!net) return; flash[n] = 1;
    for (const a of net.neurons[n].out) if (a.state === 'live' && (pulses.length < MAX_ACTIVE || strong) && pulses.length < MAX_ACTIVE + 8) pulses.push({ ax: a, d: 0, gen, strong });
  };
  const nearest = (x: number, y: number) => { let bi = 0, bd = Infinity; net!.neurons.forEach((nu, i) => { const d = (nu.x - x) ** 2 + (nu.y - y) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };

  const draw = (dt: number) => {
    if (!net) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    // dendrites: 4 widths (2 px at the soma down to 0.4 px), 2 opacities (18 to 28 %)
    ctx.lineCap = 'round';
    buckets.forEach((ids, b) => {
      if (!ids.length) return; ctx.beginPath();
      for (const i of ids) { ctx.moveTo(p0x[i], p0y[i]); ctx.quadraticCurveTo(pcx[i], pcy[i], p1x[i], p1y[i]); }
      ctx.lineWidth = net!.segs[ids[0]].width; ctx.strokeStyle = `rgba(${br},${bg},${bb},${b % 2 ? 0.27 : 0.19})`; ctx.stroke();
    });
    // axons
    const now = clock;
    for (const a of net.axons) {
      const s = net.neurons[a.from], [tx, ty] = tipOf(a); let alpha = 0.24, upTo = 1;
      if (a.state === 'grow') { upTo = Math.min(1, (now - a.born) / 2); upTo = upTo * upTo * (3 - 2 * upTo); } else if (a.state === 'fade') alpha *= Math.max(0, 1 - (now - a.born));
      ctx.strokeStyle = `rgba(${br},${bg},${bb},${alpha})`; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(s.x, s.y);
      for (let k = 1; k <= 22; k++) { const t = (k / 22) * upTo, [x, y] = axonPoint(s.x, s.y, tx, ty, a, t); ctx.lineTo(x, y); }
      ctx.stroke();
      if (a.state === 'grow' && upTo < 1) { const [x, y] = axonPoint(s.x, s.y, tx, ty, a, upTo); ctx.fillStyle = `rgba(${ir},${ig},${ib},0.8)`; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.2832); ctx.fill(); }
    }
    // somas
    net.neurons.forEach((nu, i) => {
      const sp = sprites[Math.min(2, Math.max(0, Math.round(nu.r) - 3))]; ctx.drawImage(sp.c, nu.x - sp.R, nu.y - sp.R);
      if (flash[i] > 0.02) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash[i]; ctx.drawImage(sp.c, nu.x - sp.R * 2, nu.y - sp.R * 2, sp.R * 4, sp.R * 4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; flash[i] *= Math.exp(-4 * dt); }
    });
    // action potentials: a white-cyan head with a 40 px trail
    if (animate && pulses.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of pulses) {
        const a = p.ax, s = net.neurons[a.from], [tx, ty] = tipOf(a), t = Math.min(1, p.d / a.length), t0 = Math.max(0, (p.d - TRAIL) / a.length);
        const [x, y] = axonPoint(s.x, s.y, tx, ty, a, t), [x0, y0] = axonPoint(s.x, s.y, tx, ty, a, t0);
        const gr = ctx.createLinearGradient(x, y, x0, y0); gr.addColorStop(0, `rgba(${ir},${ig},${ib},0.95)`); gr.addColorStop(1, `rgba(${ir},${ig},${ib},0)`);
        ctx.strokeStyle = gr; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0);
        for (let k = 1; k <= 5; k++) { const [qx, qy] = axonPoint(s.x, s.y, tx, ty, a, t0 + ((t - t0) * k) / 5); ctx.lineTo(qx, qy); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(x, y, 2.3, 0, 6.2832); ctx.fill(); ctx.fillStyle = `rgba(${ir},${ig},${ib},0.3)`; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // legibility: behind the text column the network is at half strength
    if (text) {
      const a = 0.5, f = 56, { x, y, w: rw, h: rh } = text; ctx.globalCompositeOperation = 'destination-out';
      const strip = (x0: number, y0: number, x1: number, y1: number, gx0: number, gy0: number, gx1: number, gy1: number) => { const gr = ctx.createLinearGradient(gx0, gy0, gx1, gy1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = gr; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); };
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, y, rw, rh);
      strip(x - f, y, x, y + rh, x - f, 0, x, 0); strip(x + rw, y, x + rw + f, y + rh, x + rw + f, 0, x + rw, 0);
      strip(x, y - f, x + rw, y, 0, y - f, 0, y); strip(x, y + rh, x + rw, y + rh + f, 0, y + rh + f, 0, y + rh);
      [[x, y, -1, -1], [x + rw, y, 1, -1], [x, y + rh, -1, 1], [x + rw, y + rh, 1, 1]].forEach(([cx, cy, sx, sy]) => { const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, f); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(sx < 0 ? cx - f : cx, sy < 0 ? cy - f : cy, f, f); });
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  const step = (dt: number) => {
    clock += dt;
    layout(dt);
    // potentials move forward only; on arrival the destination neuron fires with probability 0.6 after 150 to 400 ms (a strong chain: always, after 120 to 250 ms)
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]; p.d += SPEED * dt;
      if (p.ax.state === 'fade' && clock - p.ax.born > 1) { pulses.splice(i, 1); continue; }
      if (p.d >= p.ax.length) {
        pulses.splice(i, 1);
        if (p.strong ? p.gen < STRONG_GENERATIONS : rand() < 0.6) queue.push({ at: clock + (p.strong ? 0.12 + rand() * 0.13 : 0.15 + rand() * 0.25), n: p.ax.to, strong: p.strong, gen: p.gen + 1 });
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= clock) { const f = queue.splice(i, 1)[0]; fire(f.n, f.strong, f.gen); }
    if (clock >= nextSpont) { nextSpont = clock + 0.4 + rand() * 0.8; if (pulses.length < MAX_ACTIVE && net) fire(Math.floor(rand() * net.neurons.length), false, 0); }
    if (mouseOn && net && performance.now() - lastMove < 150 && clock - lastMouseFire > 0.5) { lastMouseFire = clock; fire(nearest(mx, my), false, 0); }
    // every 20 to 40 s one axon fades and another grows (2 s) toward a different neuron: the shape never repeats and the network stays connected
    if (net) {
      for (const a of [...net.axons]) if (a.state === 'grow' && clock - a.born >= 2) a.state = 'live'; else if (a.state === 'fade' && clock - a.born >= 1) { net.axons.splice(net.axons.indexOf(a), 1); const o = net.neurons[a.from].out; o.splice(o.indexOf(a), 1); }
      if (clock >= nextRegrow) {
        nextRegrow = clock + 20 + rand() * 20; const g = pickRegrow(net, rand);
        if (g) { g.old.state = 'fade'; g.old.born = clock; g.fresh.born = clock; net.axons.push(g.fresh); net.neurons[g.fresh.from].out.push(g.fresh); }
      }
    }
  };

  let pending = 0;
  const resize = (nw: number, nh: number) => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const changed = Math.abs(nw - w) > 2 || Math.abs(nh - h) > 2 || !net; w = Math.max(1, nw); h = Math.max(1, nh);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!net) build(); else if (changed) { clearTimeout(pending); pending = window.setTimeout(() => { build(); if (!running) draw(0); }, 120); }
    if (!running) draw(0);
  };
  const rel = (e: PointerEvent) => { const r = hero.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; [mx, my] = rel(e); mouseOn = true; lastMove = performance.now(); };
  const onLeave = () => { mouseOn = false; };
  const onDown = (e: PointerEvent) => { if (!running || !net || (e.target as Element | null)?.closest?.('[data-brain]')) return; const [x, y] = rel(e); fire(nearest(x, y), true, 0); }; // a click or touch: a strong chain from the neuron nearest that point
  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 33) return; // ~30 fps is plenty for a background
    const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); draw(dt);
  };
  if (animate) { hero.addEventListener('pointermove', onMove); hero.addEventListener('pointerleave', onLeave); hero.addEventListener('pointerdown', onDown); }
  return {
    resize,
    setTextRect(r: Rect | null) { text = r; if (!running && net) draw(0); },
    start() { if (running || !animate) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
