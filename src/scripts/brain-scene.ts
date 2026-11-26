// Procedural, generic "company brain" for the Company Brain page hero. No real data: a glowing core, ~120 nodes in three
// layers and thin edges with light pulses travelling along some of them. Seeded, so the static fallback image is the same render.
import {
  AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight,
  Euler, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MathUtils, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, Points, PointsMaterial, Quaternion, Scene, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry, Vector3, WebGLRenderer,
} from 'three';

export interface BrainColors { core: string; teal: string; violet: string; orange: string; steel: string; edge: string; pulse: string }
export interface BrainOptions { static?: boolean; rotation?: number; width?: number; height?: number }

const ROTATION_SPEED = 0.05; // rad/s
const PARALLAX = 0.14; // radians of tilt at the edge of the window
const TILT = 0.3;
const NODE = 0.74; // node size, kept small so the word behind the brain stays readable

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const glowTexture = () => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128); return new CanvasTexture(c);
};

/** Evenly spread directions on a sphere (Fibonacci), jittered a little so the layers do not look machined. */
const directions = (n: number, rand: () => number, offset: number) => Array.from({ length: n }, (_, i) => {
  const k = (i + 0.5 + offset) / n; const phi = Math.acos(1 - 2 * k); const theta = Math.PI * (1 + Math.sqrt(5)) * (i + offset);
  return new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).add(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.18)).normalize();
});

export function createBrainScene(canvas: HTMLCanvasElement, colors: BrainColors, opts: BrainOptions = {}) {
  const rand = rng(20261126);
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: !!opts.static });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  const world = new Group(); scene.add(world);

  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 2.2); key.position.set(4, 5, 6); scene.add(key);
  const rim = new DirectionalLight(new Color(colors.teal), 1.2); rim.position.set(-5, -2, -4); scene.add(rim);

  // core: a small bright sphere with a soft glow, kept modest so the word behind it stays readable
  const glow = glowTexture();
  world.add(new Mesh(new SphereGeometry(0.42, 32, 32), new MeshBasicMaterial({ color: new Color(colors.core) })));
  const halo = new Sprite(new SpriteMaterial({ map: glow, color: new Color(colors.core), transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(3.2); world.add(halo);

  const SHELL = [1.9, 2.9, 3.9]; const SQUASH = new Vector3(1.12, 0.9, 1);
  type Spec = { name: string; layer: number; count: number; geo: BufferGeometry; color: string; scale: number };
  const specs: Spec[] = [
    { name: 'role', layer: 0, count: 22, geo: new TorusGeometry(0.17, 0.06, 10, 22), color: colors.teal, scale: 1.1 },
    { name: 'system', layer: 1, count: 30, geo: new CylinderGeometry(0.17, 0.17, 0.32, 6), color: colors.violet, scale: 1 },
    { name: 'process-a', layer: 1, count: 20, geo: new SphereGeometry(0.13, 16, 16), color: colors.steel, scale: 1 },
    { name: 'process-b', layer: 2, count: 20, geo: new SphereGeometry(0.13, 16, 16), color: colors.steel, scale: 1 },
    { name: 'capability', layer: 2, count: 28, geo: new IcosahedronGeometry(0.18, 0), color: colors.orange, scale: 1 },
  ];
  const nodes: { layer: number; pos: Vector3 }[] = [];
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3();
  specs.forEach((spec, si) => {
    const mat = new MeshStandardMaterial({ color: new Color(spec.color), emissive: new Color(spec.color), emissiveIntensity: 0.22, roughness: 0.42, metalness: 0.18 });
    const mesh = new InstancedMesh(spec.geo, mat, spec.count);
    directions(spec.count, rand, si * 0.37).forEach((dir, i) => {
      const r = SHELL[spec.layer] + (rand() - 0.5) * 0.5;
      const p = dir.clone().multiply(SQUASH).multiplyScalar(r);
      q.setFromEuler(new Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      s.setScalar(NODE * spec.scale * (0.8 + rand() * 0.5));
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
      nodes.push({ layer: spec.layer, pos: p });
    });
    world.add(mesh);
  });

  // edges: every inner node to the core, every outer node to its nearest node one layer in, plus a few cross links
  const core = new Vector3();
  const segs: [Vector3, Vector3][] = [];
  const nearest = (from: Vector3, pool: { pos: Vector3 }[], skip = 0) => pool.map((n) => n).sort((a, b) => a.pos.distanceToSquared(from) - b.pos.distanceToSquared(from))[skip].pos;
  const byLayer = [0, 1, 2].map((l) => nodes.filter((n) => n.layer === l));
  byLayer[0].forEach((n) => segs.push([core, n.pos]));
  byLayer[1].forEach((n) => { segs.push([nearest(n.pos, byLayer[0]), n.pos]); if (rand() < 0.4) segs.push([nearest(n.pos, byLayer[0], 1), n.pos]); });
  byLayer[2].forEach((n) => { segs.push([nearest(n.pos, byLayer[1]), n.pos]); if (rand() < 0.35) segs.push([nearest(n.pos, byLayer[2], 1), n.pos]); });
  const lineArr = new Float32Array(segs.length * 6);
  segs.forEach(([a, b], i) => { lineArr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); });
  const lineGeo = new BufferGeometry(); lineGeo.setAttribute('position', new BufferAttribute(lineArr, 3));
  world.add(new LineSegments(lineGeo, new LineBasicMaterial({ color: new Color(colors.edge), transparent: true, opacity: 0.25, depthWrite: false })));

  // pulses: small lights travelling along some edges
  const PULSES = 16;
  const pulse = Array.from({ length: PULSES }, () => ({ edge: Math.floor(rand() * segs.length), t: rand(), speed: 0.18 + rand() * 0.3 }));
  const pArr = new Float32Array(PULSES * 3);
  const pGeo = new BufferGeometry(); pGeo.setAttribute('position', new BufferAttribute(pArr, 3));
  world.add(new Points(pGeo, new PointsMaterial({ size: 0.28, map: glow, color: new Color(colors.pulse), transparent: true, blending: AdditiveBlending, depthWrite: false })));
  const placePulses = () => pulse.forEach((p, i) => { const [a, b] = segs[p.edge]; pArr[i * 3] = MathUtils.lerp(a.x, b.x, p.t); pArr[i * 3 + 1] = MathUtils.lerp(a.y, b.y, p.t); pArr[i * 3 + 2] = MathUtils.lerp(a.z, b.z, p.t); pGeo.attributes.position.needsUpdate = true; });

  // frame
  let w = opts.width || 1, h = opts.height || 1, angle = opts.rotation ?? 0.6, px = 0, py = 0, tx = 0, ty = 0, raf = 0, last = 0, running = false;
  const fit = () => {
    camera.aspect = w / h;
    const R = 4.6, vHalf = MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    camera.position.set(0, 0, R / Math.sin(Math.min(vHalf, hHalf)));
    camera.updateProjectionMatrix();
  };
  const resize = (nw: number, nh: number) => { w = Math.max(1, nw); h = Math.max(1, nh); renderer.setSize(w, h, false); fit(); };
  const pose = () => { world.rotation.set(TILT + py * PARALLAX, angle, px * PARALLAX * 0.5); };
  const render = () => { pose(); renderer.render(scene, camera); };
  const tick = (now: number) => {
    if (!running) return;
    if (now - last < 32) { raf = requestAnimationFrame(tick); return; }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    angle += ROTATION_SPEED * dt;
    px += (tx - px) * Math.min(1, dt * 3); py += (ty - py) * Math.min(1, dt * 3);
    pulse.forEach((p) => { p.t += p.speed * dt; if (p.t >= 1) { p.t = 0; p.edge = Math.floor(rand() * segs.length); } });
    placePulses(); render(); raf = requestAnimationFrame(tick);
  };
  resize(opts.width || canvas.clientWidth || 1, opts.height || canvas.clientHeight || 1);
  placePulses(); render();
  return {
    resize,
    /** Pointer position in the window, -1 to 1 on each axis. */
    look: (x: number, y: number) => { tx = x; ty = y; },
    start() { if (running || opts.static) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() { running = false; cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
