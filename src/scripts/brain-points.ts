// Procedural anatomical "brain" for the Company Brain hero, drawn as a point cloud. No models, no real data, seeded so the static fallback is the same render.
// Two hemispheres (folded with simplex noise), a cerebellum with horizontal striations and a brainstem; ~8,000 surface points and 1,500 inside,
// 300 of them joined to their 3 nearest neighbours with light pulses running along the connections, and 12 highlighted nodes using the app's shapes.
import {
  AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight, Euler, Group, IcosahedronGeometry,
  InstancedMesh, LineSegments, Matrix4, MathUtils, MeshStandardMaterial, PerspectiveCamera, Points, Quaternion, Scene,
  ShaderMaterial, TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';

export interface BrainColors { blue: string; sky: string; white: string; amber: string; teal: string; violet: string; orange: string }
export interface BrainOptions { static?: boolean; rotation?: number; width?: number; height?: number }

const AUTO_SPEED = 0.08; // rad/s
const IDLE_MS = 3000; // after this long without touching it, it turns by itself again
const TILT = 0.2;

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** 3D simplex noise (Gustavson), seeded. */
const makeNoise = (rand: () => number) => {
  const grad = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return (xin: number, yin: number, zin: number) => {
    const s = (xin + yin + zin) * F3; const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3; const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3, x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3, x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const corner = (x: number, y: number, z: number, gi: number) => { let tt = 0.6 - x * x - y * y - z * z; if (tt < 0) return 0; tt *= tt; const g = grad[gi]; return tt * tt * (g[0] * x + g[1] * y + g[2] * z); };
    return 32 * (corner(x0, y0, z0, pm12[ii + perm[jj + perm[kk]]]) + corner(x1, y1, z1, pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]) + corner(x2, y2, z2, pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]) + corner(x3, y3, z3, pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]));
  };
};

const unit = (rand: () => number) => { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u); return new Vector3(r * Math.cos(a), u, r * Math.sin(a)); };
const smooth = (a: number, b: number, x: number) => { const t = MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Whole brain half-extents (1.0, 0.78, 1.3): each hemisphere is half the width, 0.06 apart.
const FISSURE = 0.06, RX = (1.0 - FISSURE / 2) / 2, RY = 0.78, RZ = 1.3;
const HEMI_X = FISSURE / 2 + RX;
const CB = { c: new Vector3(0, -0.5, -0.86), r: new Vector3(0.58, 0.27, 0.36) }; // cerebellum: behind and below

/** A point on an ellipsoid with centre c and radii r, in direction u. */
const onEllipsoid = (c: Vector3, r: Vector3, u: Vector3) => new Vector3(c.x + r.x * u.x, c.y + r.y * u.y, c.z + r.z * u.z);
const ellNormal = (r: Vector3, u: Vector3) => new Vector3(u.x / r.x, u.y / r.y, u.z / r.z).normalize();

export function createBrainPoints(canvas: HTMLCanvasElement, host: HTMLElement, colors: BrainColors, opts: BrainOptions = {}) {
  const rand = rng(20261127);
  const noise = makeNoise(rand);
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: !!opts.static });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 50);
  const world = new Group(); scene.add(world);
  scene.add(new AmbientLight(0xffffff, 1.2));
  const key = new DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);

  // ---- the cloud: surface and interior ----
  const pos: number[] = [], col: number[] = [], size: number[] = [];
  const cBlue = new Color(colors.blue), cSky = new Color(colors.sky), cWhite = new Color(colors.white), cAmber = new Color(colors.amber);
  const push = (p: Vector3, surface: boolean) => {
    pos.push(p.x, p.y, p.z);
    const r = rand(); const c = r < 0.03 ? cAmber : r < 0.2 ? cWhite : r < 0.52 ? cSky : cBlue;
    col.push(c.r, c.g, c.b);
    size.push(surface ? 1 + rand() * 1.5 : 1 + rand() * 0.8);
  };
  const fold = (p: Vector3, n: Vector3, k = 1) => {
    // gyri (broad swells) and sulci (grooves where the noise crosses zero)
    const gyri = noise(p.x * 1.6 + 7, p.y * 1.6, p.z * 1.6) * 0.05;
    const groove = -0.075 * (1 - smooth(0, 0.2, Math.abs(noise(p.x * 3.3, p.y * 3.3 + 3, p.z * 3.3))));
    return p.addScaledVector(n, (gyri + groove) * k);
  };
  const hemi = (sx: number, count: number) => {
    const c = new Vector3(sx * HEMI_X, 0, 0), r = new Vector3(RX, RY, RZ);
    for (let i = 0; i < count; i++) {
      const u = unit(rand);
      if (u.x * -sx > 0.55 && rand() < 0.85) { i--; continue; } // the medial face is mostly hidden: keep it sparse
      let p = onEllipsoid(c, r, u);
      if (p.y < -0.4 * RY) p.y = -0.4 * RY + (p.y + 0.4 * RY) * 0.3; // flattened underneath
      p = fold(p, ellNormal(r, u));
      push(p, true);
    }
    for (let i = 0; i < 750; i++) { const u = unit(rand).multiplyScalar(Math.cbrt(rand()) * 0.88); const p = onEllipsoid(c, r, u); if (p.y < -0.4 * RY) p.y = -0.4 * RY + (p.y + 0.4 * RY) * 0.3; push(p, false); }
  };
  hemi(1, 3300); hemi(-1, 3300);
  for (let i = 0; i < 900; i++) { // cerebellum, with horizontal striations
    const u = unit(rand); const p = onEllipsoid(CB.c, CB.r, u); const n = ellNormal(CB.r, u);
    p.addScaledVector(n, 0.022 * Math.sin((p.y - CB.c.y) * 70) + 0.01 * noise(p.x * 4, p.y * 4, p.z * 4)); push(p, true);
  }
  for (let i = 0; i < 500; i++) { // brainstem: a narrowing cone
    const t = rand(), a = rand() * Math.PI * 2, r = MathUtils.lerp(0.2, 0.11, t);
    push(new Vector3(Math.cos(a) * r, MathUtils.lerp(-0.42, -1.18, t), MathUtils.lerp(-0.34, -0.52, t) + Math.sin(a) * r), true);
  }
  const surfaceCount = pos.length / 3;
  const cloudGeo = new BufferGeometry();
  cloudGeo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  cloudGeo.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 3));
  cloudGeo.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));

  const uniforms = { uMouse: { value: new Vector2(-999, -999) }, uRes: { value: new Vector2(1, 1) }, uDpr: { value: dpr }, uHover: { value: 0 } };
  const cloudMat = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aSize; uniform vec2 uMouse; uniform vec2 uRes; uniform float uDpr; uniform float uHover; varying vec3 vColor; varying float vGlow;
      void main(){ vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vec2 px = (clip.xy / clip.w * 0.5 + 0.5) * uRes; px.y = uRes.y - px.y;
        float g = (1.0 - smoothstep(0.0, 60.0, distance(px, uMouse))) * uHover; vGlow = g; vColor = aColor; gl_PointSize = aSize * uDpr * (1.0 + g * 1.6); gl_Position = clip; }`,
    fragmentShader: `varying vec3 vColor; varying float vGlow;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.28, 0.5, r); vec3 c = mix(vColor, vec3(1.0), vGlow * 0.75); gl_FragColor = vec4(c * (2.1 + vGlow * 1.6), a * (0.85 + vGlow * 0.15)); }`,
  });
  world.add(new Points(cloudGeo, cloudMat));

  // ---- connections: 300 cloud nodes, each joined to its 3 nearest ----
  const N = 300; const nodes: Vector3[] = [];
  for (let i = 0; i < N; i++) { const k = Math.floor(rand() * surfaceCount); nodes.push(new Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])); }
  const seen = new Set<string>(); const segs: [Vector3, Vector3][] = [];
  nodes.forEach((a, i) => {
    nodes.map((b, j) => ({ j, d: a.distanceToSquared(b) })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ j }) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(key)) { seen.add(key); segs.push([a, nodes[j]]); }
    });
  });
  const lineArr = new Float32Array(segs.length * 6); segs.forEach(([a, b], i) => lineArr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
  const lineGeo = new BufferGeometry(); lineGeo.setAttribute('position', new BufferAttribute(lineArr, 3));
  world.add(new LineSegments(lineGeo, new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `uniform vec2 uMouse; uniform vec2 uRes; uniform float uHover; varying float vA;
      void main(){ vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vec2 px = (clip.xy / clip.w * 0.5 + 0.5) * uRes; px.y = uRes.y - px.y;
        float g = (1.0 - smoothstep(0.0, 90.0, distance(px, uMouse))) * uHover; vA = mix(0.2, 0.5, g); gl_Position = clip; }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(${cSky.r.toFixed(3)}, ${cSky.g.toFixed(3)}, ${cSky.b.toFixed(3)}, vA); }`,
  })));

  // ---- pulses running along the connections, all the time ----
  const PULSES = 48;
  const pulse = Array.from({ length: PULSES }, () => ({ edge: Math.floor(rand() * segs.length), t: rand(), speed: 0.25 + rand() * 0.5 }));
  const pArr = new Float32Array(PULSES * 3); const pGeo = new BufferGeometry(); pGeo.setAttribute('position', new BufferAttribute(pArr, 3));
  world.add(new Points(pGeo, new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `uniform float uDpr; void main(){ gl_PointSize = 8.0 * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `void main(){ float r = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, r); gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * 1.6, a * a); }`,
  })));
  const placePulses = () => { pulse.forEach((p, i) => { const [a, b] = segs[p.edge]; pArr[i * 3] = MathUtils.lerp(a.x, b.x, p.t); pArr[i * 3 + 1] = MathUtils.lerp(a.y, b.y, p.t); pArr[i * 3 + 2] = MathUtils.lerp(a.z, b.z, p.t); }); pGeo.attributes.position.needsUpdate = true; };

  // ---- 12 highlighted nodes with the app's shapes ----
  const shapes: [BufferGeometry, string][] = [[new TorusGeometry(0.06, 0.022, 10, 20), colors.teal], [new CylinderGeometry(0.055, 0.055, 0.1, 6), colors.violet], [new IcosahedronGeometry(0.06, 0), colors.orange]];
  const m4 = new Matrix4(), q = new Quaternion(), sc = new Vector3(0.85, 0.85, 0.85);
  shapes.forEach(([geo, color], si) => {
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color: new Color(color), emissive: new Color(color), emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.1 }), 4);
    for (let i = 0; i < 4; i++) {
      const n = nodes[(si * 4 + i) * 23 % N]; q.setFromEuler(new Euler(rand() * 6, rand() * 6, rand() * 6));
      m4.compose(n.clone().multiplyScalar(1.03), q, sc); mesh.setMatrixAt(i, m4);
    }
    world.add(mesh);
  });

  // ---- labels (their elements live in the markup) ----
  const hemiR = new Vector3(RX, RY, RZ);
  // six zones spread around the head (frontal, right temporal, occipital, cerebellum, left temporal, parietal), so that at least three are always in view
  const zone = (deg: number, elev: number, cerebellum = false) => {
    const t = (deg * Math.PI) / 180, u = new Vector3(Math.sin(t), elev, Math.cos(t)).normalize();
    if (cerebellum) return { p: onEllipsoid(CB.c, CB.r, u), n: ellNormal(CB.r, u) };
    const c = new Vector3((u.x >= 0 ? 1 : -1) * HEMI_X, 0, 0); return { p: onEllipsoid(c, hemiR, u), n: ellNormal(hemiR, u) };
  };
  const anchors = [zone(0, 0.3), zone(60, -0.2), zone(120, 0.25), zone(180, -0.1, true), zone(240, -0.2), zone(300, 0.8)]; // PROCESSES, DEALS, CAPABILITIES, ROLES, RELATIONSHIPS, SYSTEMS
  const labels = [...host.querySelectorAll<HTMLElement>('[data-lbl]')];
  const lines = [...host.querySelectorAll<SVGLineElement>('[data-line]')];
  const tmpP = new Vector3(), tmpN = new Vector3(), tmpV = new Vector3();

  // ---- frame ----
  let w = opts.width || 1, h = opts.height || 1, angle = opts.rotation ?? 0.35, vel = AUTO_SPEED, raf = 0, last = 0, running = false;
  let dragging = false, lastTouch = -Infinity, lastX = 0, lastT = 0;
  world.position.y = 0.08;
  const fit = () => {
    camera.aspect = w / h;
    const R = 1.417, vHalf = MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    camera.position.set(0, 0, R / Math.sin(Math.min(vHalf, hHalf))); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  const resize = (nw: number, nh: number) => { w = Math.max(1, nw); h = Math.max(1, nh); renderer.setSize(w, h, false); uniforms.uRes.value.set(w, h); fit(); };
  const place = () => {
    world.rotation.set(TILT, angle, 0); world.updateMatrixWorld();
    labels.forEach((el, i) => {
      const a = anchors[i]; if (!a) return;
      tmpP.copy(a.p).applyMatrix4(world.matrixWorld); tmpN.copy(a.n).transformDirection(world.matrixWorld); tmpV.copy(camera.position).sub(tmpP).normalize();
      const facing = MathUtils.clamp((tmpN.dot(tmpV) + 0.35) / 0.6, 0, 1);
      const s = tmpP.clone().project(camera); const x = (s.x * 0.5 + 0.5) * w, y = (1 - (s.y * 0.5 + 0.5)) * h;
      let dx = x - w / 2, dy = y - h / 2; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const off = Math.min(w, h) * 0.12, ew = el.offsetWidth || 90; let lx = x + dx * off; const ly = y + dy * off;
      lx = dx < 0 ? Math.max(lx, ew + 4) : Math.min(lx, w - ew - 4); // keep the label inside the column, away from the wordmark
      el.style.opacity = String(facing); el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(${dx < 0 ? '-100%' : '0'}, -50%)`;
      const ln = lines[i]; if (ln) { ln.setAttribute('x1', x.toFixed(1)); ln.setAttribute('y1', y.toFixed(1)); ln.setAttribute('x2', (lx - dx * 4).toFixed(1)); ln.setAttribute('y2', ly.toFixed(1)); ln.style.opacity = String(facing * 0.7); }
    });
  };
  const render = () => { place(); renderer.render(scene, camera); };
  const tick = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!dragging) {
      if (now - lastTouch > IDLE_MS) vel += (AUTO_SPEED - vel) * Math.min(1, dt * 1.2); // back to turning by itself
      else vel *= Math.exp(-2.6 * dt); // inertia
      angle += vel * dt;
    }
    pulse.forEach((p) => { p.t += p.speed * dt; if (p.t >= 1) { p.t = 0; p.edge = Math.floor(rand() * segs.length); } });
    placePulses(); render(); raf = requestAnimationFrame(tick);
  };

  // ---- pointer: drag to turn (with inertia), hover glow. Vertical page scroll is never blocked (touch-action: pan-y in CSS). ----
  const local = (e: PointerEvent) => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastT = performance.now(); lastTouch = lastT; vel = 0; host.setPointerCapture?.(e.pointerId); host.classList.add('dragging'); };
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e);
    if (e.pointerType === 'mouse') { uniforms.uMouse.value.set(x, y); uniforms.uHover.value = 1; }
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX, dt = Math.max(1, now - lastT) / 1000;
    angle += dx * 0.007; vel = MathUtils.lerp(vel, (dx * 0.007) / dt, 0.5); lastX = e.clientX; lastT = now; lastTouch = now;
  };
  const onUp = () => { dragging = false; lastTouch = performance.now(); host.classList.remove('dragging'); vel = MathUtils.clamp(vel, -3, 3); };
  const onLeave = () => { uniforms.uHover.value = 0; };
  if (!opts.static) {
    host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);
  }

  resize(opts.width || canvas.clientWidth || 1, opts.height || canvas.clientHeight || 1);
  placePulses(); render();
  return {
    resize,
    start() { if (running || opts.static) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() { running = false; cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
