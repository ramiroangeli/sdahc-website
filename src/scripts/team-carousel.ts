// "Our team" carousel and dialogs (markup in src/components/TeamSection.astro).
// The track moves right to left at about 30 px per second in a continuous loop: the script appends copies of the cards (aria-hidden and inert) so there
// is always a card entering as another leaves. It pauses with the Pause button, while keyboard focus is inside a card, while a dialog is open and while the
// section is off screen; a mouse hover does not pause it. Under prefers-reduced-motion nothing moves (the CSS shows a row, or a snapping scroll).
// Copies are inert, so the pointer cannot reach them: hover and the Read more click are mapped to them here.
const SPEED = 30; // px per second

export function initTeam(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('[data-team-viewport]')!;
  const track = root.querySelector<HTMLElement>('[data-team-track]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-team-pause]')!;
  const dialogs = Array.from(root.querySelectorAll<HTMLDialogElement>('dialog[data-dialog]'));
  const originals = Array.from(track.children) as HTMLElement[];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- dialogs
  let dialogOpen = false;
  const syncDialog = () => { dialogOpen = dialogs.some((d) => d.open); document.documentElement.style.overflow = dialogOpen ? 'hidden' : ''; };
  const openDialog = (i: number) => { const d = dialogs[i]; if (d && !d.open) { d.showModal(); syncDialog(); } };
  dialogs.forEach((d) => {
    d.addEventListener('close', syncDialog);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // a click on the backdrop
  });
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-open]');
    if (btn && !btn.closest('[inert]')) openDialog(Number(btn.dataset.open));
  });

  if (reduce) return;

  // ---- carousel
  root.classList.add('is-moving');
  let clones: HTMLElement[] = [];
  let loopWidth = 0, pos = 0, raf = 0, last = 0;
  let userPaused = false, focusPaused = false, offscreen = false;

  const build = () => {
    clones.forEach((c) => c.remove()); clones = [];
    const unit = originals.reduce((w, el) => w + el.getBoundingClientRect().width + parseFloat(getComputedStyle(el).marginRight), 0);
    loopWidth = unit;
    const sets = Math.ceil(viewport.clientWidth / unit) + 1; // enough copies to cover the viewport while one set scrolls out
    for (let s = 1; s < sets; s++) for (const el of originals) {
      const c = el.cloneNode(true) as HTMLElement;
      c.setAttribute('aria-hidden', 'true'); c.setAttribute('inert', ''); c.dataset.clone = '1';
      track.appendChild(c); clones.push(c);
    }
  };
  const paint = () => { track.style.transform = `translate3d(${-pos}px,0,0)`; };
  const running = () => !(userPaused || focusPaused || dialogOpen || offscreen || document.hidden);

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!running() || !loopWidth) return;
    pos += SPEED * dt; if (pos >= loopWidth) pos -= loopWidth;
    paint();
  };

  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused; pauseBtn.textContent = userPaused ? 'Play' : 'Pause';
    pauseBtn.setAttribute('aria-label', userPaused ? 'Play the team carousel' : 'Pause the team carousel');
  });

  // keyboard focus inside a card pauses the carousel; bring the focused card fully into view
  track.addEventListener('focusin', (e) => {
    focusPaused = true;
    const card = (e.target as Element).closest<HTMLElement>('.team-card'); if (!card) return;
    const v = viewport.getBoundingClientRect(), r = card.getBoundingClientRect();
    if (r.left < v.left) pos = Math.max(0, pos + (r.left - v.left) - 24); else if (r.right > v.right) pos += r.right - v.right + 24;
    if (pos >= loopWidth) pos -= loopWidth; paint();
  });
  track.addEventListener('focusout', (e) => { if (!track.contains((e as FocusEvent).relatedTarget as Node | null)) focusPaused = false; });

  // inert copies: lift and click are mapped from the pointer position
  let hovered: HTMLElement | null = null;
  const overRect = (el: Element, x: number, y: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const c = clones.find((el) => overRect(el, e.clientX, e.clientY)) ?? null;
    if (c !== hovered) { hovered?.classList.remove('hov'); hovered = c; hovered?.classList.add('hov'); }
    const rm = c?.querySelector('.read-more'); viewport.style.cursor = rm && overRect(rm, e.clientX, e.clientY) ? 'pointer' : '';
  });
  viewport.addEventListener('pointerleave', () => { hovered?.classList.remove('hov'); hovered = null; viewport.style.cursor = ''; });
  viewport.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-open]')) return; // a real button handled it
    const c = clones.find((el) => overRect(el, e.clientX, e.clientY)); const rm = c?.querySelector<HTMLElement>('.read-more');
    if (c && rm && overRect(rm, e.clientX, e.clientY)) openDialog(Number(rm.dataset.open));
  });

  new IntersectionObserver(([e]) => { offscreen = !e.isIntersecting; }).observe(root);
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => { build(); }, 150); });
  build(); paint();
  requestAnimationFrame((t) => { last = t; raf = requestAnimationFrame(tick); });
}
