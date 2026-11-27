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

  // ---- dialogs: the whole card is one button (the "Read more" button stretches over it). On a desktop the card morphs into the dialog with the
  // View Transitions API (a manual FLIP of the photo where that is missing), on a phone the dialog is a sheet that rises from the bottom, and with
  // reduced motion there is only a 150 ms fade. Closing (X, Esc, a click outside, a swipe down on the handle) plays the same thing backwards and
  // returns focus to the card.
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)', DUR = 450;
  const phone = () => matchMedia('(max-width: 639px)').matches;
  let dialogOpen = false, busy = false;
  const syncDialog = () => { dialogOpen = dialogs.some((d) => d.open); document.documentElement.style.overflow = dialogOpen ? 'hidden' : ''; };
  const pick = (el: Element, sel: string) => el.querySelector<HTMLElement>(sel)!;
  // view-transition names: side 0 = the card, 1 = the dialog, null = none (a name must be on one element at a time)
  const tag = (i: number, side: 0 | 1 | null) => {
    const d = dialogs[i], c = slots[i];
    const pairs: [string, HTMLElement, HTMLElement][] = [['card', pick(c, '.team-card'), pick(d, '.dlg-panel')], ['photo', pick(c, '.team-media'), pick(d, '.dlg-media')], ['name', pick(c, '.team-name'), pick(d, '.team-name')]];
    pairs.forEach(([k, a, b]) => { a.style.setProperty('view-transition-name', side === 0 ? `team-${k}-${i}` : 'none'); b.style.setProperty('view-transition-name', side === 1 ? `team-${k}-${i}` : 'none'); });
  };
  const hasVT = () => typeof (document as any).startViewTransition === 'function';
  const cascade = (d: HTMLDialogElement, delay: number) => { // label, name, role, bio: 60 ms apart; the name is revealed left to right
    Array.from(pick(d, '.dlg-text').children).forEach((el, k) => {
      const at = delay + 60 * Math.min(k, 3);
      el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: at, easing: EASE, fill: 'backwards' });
      if (k === 1) el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 300, delay: at, easing: EASE, fill: 'backwards' });
    });
  };
  const flip = (from: DOMRect, to: HTMLElement, reverse: boolean) => { // photo from (or back to) the card's photo
    const r = to.getBoundingClientRect(); const k = [`translate(${from.left - r.left}px,${from.top - r.top}px) scale(${from.width / r.width},${from.height / r.height})`, 'none'];
    to.style.transformOrigin = 'top left';
    return to.animate({ transform: reverse ? k.reverse() : k }, { duration: DUR, easing: EASE, fill: 'both' }).finished;
  };
  const openDialog = (i: number) => {
    const d = dialogs[i]; if (d.open || busy) return;
    const show = () => { d.showModal(); syncDialog(); };
    if (reduce) { show(); d.animate({ opacity: [0, 1] }, { duration: 150 }); return; }
    busy = true; slots[i].dispatchEvent(new PointerEvent('pointerleave'));
    if (phone()) {
      show(); pick(d, '.dlg-panel').animate({ transform: ['translateY(100%)', 'none'] }, { duration: DUR, easing: EASE }); pick(d, '.dlg-bg').animate({ opacity: [0, 1] }, { duration: DUR });
      cascade(d, 200); busy = false; return;
    }
    if (hasVT()) {
      tag(i, 0);
      const t = (document as any).startViewTransition(() => { tag(i, 1); show(); cascade(d, 160); });
      t.finished.finally(() => { tag(i, null); busy = false; });
    } else {
      const from = pick(slots[i], '.team-media').getBoundingClientRect(); show();
      pick(d, '.dlg-bg').animate({ opacity: [0, 1] }, { duration: DUR }); pick(d, '.dlg-panel').animate({ opacity: [0, 1] }, { duration: 200 });
      cascade(d, 160); void flip(from, pick(d, '.dlg-media'), false).then(() => { busy = false; });
    }
  };
  const closeDialog = (d: HTMLDialogElement) => {
    if (!d.open || busy) return; const i = dialogs.indexOf(d);
    const end = () => { d.close(); syncDialog(); busy = false; };
    if (reduce) { d.animate({ opacity: [1, 0] }, { duration: 150, fill: 'forwards' }).finished.then(() => { end(); d.getAnimations().forEach((a) => a.cancel()); }); return; }
    busy = true;
    if (phone()) { void pick(d, '.dlg-bg').animate({ opacity: [1, 0] }, { duration: DUR, fill: 'forwards' }); void pick(d, '.dlg-panel').animate({ transform: ['none', 'translateY(100%)'] }, { duration: DUR, easing: EASE, fill: 'forwards' }).finished.then(() => { end(); d.getAnimations({ subtree: true }).forEach((a) => a.cancel()); }); return; }
    if (hasVT()) {
      tag(i, 1);
      const t = (document as any).startViewTransition(() => { tag(i, 0); end(); busy = true; });
      t.finished.finally(() => { tag(i, null); busy = false; });
    } else {
      const to = pick(slots[i], '.team-media').getBoundingClientRect();
      pick(d, '.dlg-bg').animate({ opacity: [1, 0] }, { duration: DUR, fill: 'forwards' }); pick(d, '.dlg-panel').animate({ opacity: [1, 0] }, { duration: DUR, fill: 'forwards' });
      void flip(to, pick(d, '.dlg-media'), true).then(() => { end(); d.getAnimations({ subtree: true }).forEach((a) => a.cancel()); });
    }
  };
  dialogs.forEach((d) => {
    d.addEventListener('close', syncDialog);
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(d); }); // Esc
    d.addEventListener('click', (e) => { // X, or a click outside the panel
      const t = e.target as Element;
      if (t.closest('[data-close]')) { e.preventDefault(); closeDialog(d); } else if (!t.closest('.dlg-panel')) closeDialog(d);
    });
    const grab = pick(d, '[data-grab]'), panel = pick(d, '.dlg-panel'); let y0 = 0, dy = 0, drag = false;
    grab.addEventListener('pointerdown', (e) => { drag = true; y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', (e) => { if (!drag) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
    grab.addEventListener('pointerup', () => { if (!drag) return; drag = false; const far = dy > 80 || dy < 6; panel.style.transform = ''; if (far) closeDialog(d); });
  });
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-open]'); if (btn) openDialog(Number(btn.dataset.open));
  });

  if (reduce) return;

  // ---- tilt: with a mouse only, at most 4 degrees (perspective 900px is in the CSS), and a soft highlight on the photo that follows the cursor
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    slots.forEach((s) => {
      const card = pick(s, '.team-card');
      s.addEventListener('pointermove', (e) => {
        if ((e as PointerEvent).pointerType !== 'mouse') return;
        const r = s.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', `${((0.5 - py) * 8).toFixed(2)}deg`); card.style.setProperty('--ry', `${((px - 0.5) * 8).toFixed(2)}deg`);
        card.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`); card.style.setProperty('--gy', `${((e.clientY - r.top) / r.width * 100).toFixed(1)}%`);
      });
      s.addEventListener('pointerleave', () => ['--rx', '--ry', '--gx', '--gy'].forEach((v) => card.style.removeProperty(v)));
    });
  }

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
  const running = () => !(userPaused || focusPaused || dialogOpen || busy || offscreen || document.hidden);
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
    viewport.scrollLeft = 0; if (!(e.target as Element).matches(':focus-visible')) return; // a keyboard user pauses it; a mouse click does not
    focusPaused = true;
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
