// "Our team" carousel and dialogs (markup in src/components/TeamSection.astro).
// There are exactly three cards in the DOM, and the script places each one with a transform, moving them right to left at about 30 px per second:
//   x_i = ((offset_i - travelled) mod L) - cardWidth,   offset_i = i * spacing,   L = 3 * spacing
//   spacing = max(cardWidth + gap, (viewportWidth + cardWidth + gap) / 3)
// so a card only comes back in at the right edge once it has left the left edge completely, and two copies of one person are never on screen.
// It pauses with the Pause button, while keyboard focus is inside a card, while a dialog is open and while the section is off screen; a mouse hover does
// not pause it. Under prefers-reduced-motion nothing moves (the CSS shows a row, or a snapping scroll).
const SPEED = 30; // px per second
const GAP = 24;

export function initTeam(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('[data-team-viewport]')!;
  const track = root.querySelector<HTMLElement>('[data-team-track]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-team-pause]')!;
  const slots = Array.from(track.children) as HTMLElement[];
  const dialogs = Array.from(root.querySelectorAll<HTMLDialogElement>('dialog[data-dialog]'));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- dialogs
  let dialogOpen = false;
  const syncDialog = () => { dialogOpen = dialogs.some((d) => d.open); document.documentElement.style.overflow = dialogOpen ? 'hidden' : ''; };
  dialogs.forEach((d) => {
    d.addEventListener('close', syncDialog);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // a click on the backdrop
  });
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-open]');
    const d = btn ? dialogs[Number(btn.dataset.open)] : null;
    if (d && !d.open) { d.showModal(); syncDialog(); }
  });

  if (reduce) return;

  // ---- carousel
  root.classList.add('is-moving');
  let cardW = 380, spacing = 0, loop = 0, travelled = 0, last = 0;
  let userPaused = false, focusPaused = false, offscreen = false;
  const mod = (a: number, n: number) => ((a % n) + n) % n;

  const measure = () => {
    const phase = loop ? mod(travelled, loop) / loop : 0; // keep the loop's phase across a resize so nothing jumps
    cardW = slots[0].offsetWidth;
    spacing = Math.max(cardW + GAP, (viewport.clientWidth + cardW + GAP) / 3);
    loop = 3 * spacing; travelled = phase * loop;
  };
  const place = () => {
    slots.forEach((el, i) => { el.style.transform = `translate3d(${mod(i * spacing - travelled, loop) - cardW}px,0,0)`; });
  };
  const running = () => !(userPaused || focusPaused || dialogOpen || offscreen || document.hidden);
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!running()) return;
    travelled += SPEED * dt; place();
  };

  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused; pauseBtn.textContent = userPaused ? 'Play' : 'Pause';
    pauseBtn.setAttribute('aria-label', userPaused ? 'Play the team carousel' : 'Pause the team carousel');
  });

  // keyboard focus inside a card pauses the carousel, and a card that is not fully in view is brought in (the browser must not scroll the viewport itself)
  track.addEventListener('focusin', (e) => {
    focusPaused = true; viewport.scrollLeft = 0;
    const i = slots.findIndex((el) => el.contains(e.target as Node)); if (i < 0) return;
    const x = mod(i * spacing - travelled, loop) - cardW;
    if (x < 0 || x + cardW > viewport.clientWidth) { travelled = i * spacing - ((viewport.clientWidth - cardW) / 2 + cardW); place(); }
  });
  track.addEventListener('focusout', (e) => { if (!track.contains((e as FocusEvent).relatedTarget as Node | null)) focusPaused = false; });

  new IntersectionObserver(([e]) => { offscreen = !e.isIntersecting; }).observe(root);
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => { measure(); place(); }, 150); });
  measure(); place();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
}
