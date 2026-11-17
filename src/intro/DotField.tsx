import { useEffect, useRef } from 'react';

/**
 * The splash background: a halftone dot grid. During the opening the dots
 * swell from the middle of a dark screen, coloured where the wave passes,
 * until they merge into the lime page. Afterwards they stay as a quiet
 * pattern that bulges around the pointer (or drifts slowly on touch screens).
 *
 * Drawn on one canvas at device resolution, about 30 frames a second, and
 * only while the page is visible.
 */

const LIME = [198, 255, 46], INK = [11, 12, 11];
const HUES = [[255, 62, 165], [54, 214, 255], [198, 255, 46], [255, 214, 10]];
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function DotField({ intro, onDone }: { intro: boolean; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let w = 0, h = 0, dpr = 1, step = 22;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      step = Math.max(16, Math.min(26, Math.min(w, h) / 26));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);

    let px = -9999, py = -9999, pAmt = 0, pTarget = 0;
    const move = (e: PointerEvent) => { const r = c.getBoundingClientRect(); px = e.clientX - r.left; py = e.clientY - r.top; pTarget = 1; };
    const leave = () => { pTarget = 0; };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);

    const t0 = performance.now();
    const INTRO = intro && !still ? 1.6 : 0;
    let raf = 0, last = 0, finished = !INTRO;
    if (finished) done.current?.();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < 33) return;
      last = now;
      const t = (now - t0) / 1000;
      pAmt += (pTarget - pAmt) * 0.12;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = w / 2, cy = h / 2, far = Math.hypot(cx, cy);
      // Opening progress: 0 = dark, 1 = full lime.
      const k = INTRO ? Math.min(1, t / INTRO) : 1;
      if (!finished && k >= 1) { finished = true; done.current?.(); }
      const fill = ease((k - 0.55) / 0.45);
      // Background: dark ink turning lime as the dots merge.
      g.fillStyle = `rgb(${INK.map((v, i) => Math.round(v + (LIME[i] - v) * fill)).join(',')})`;
      g.fillRect(0, 0, w, h);
      const off = (step / 2) % step;
      for (let y = off; y < h + step; y += step) {
        for (let x = off; x < w + step; x += step) {
          const d = Math.hypot(x - cx, y - cy) / far;
          let r: number, col: number[];
          if (k < 1) {
            // A diagonal wave from the centre: dots grow, take a colour, then merge.
            const front = k * 1.5 - d * 0.75 + Math.sin((x + y) * 0.02) * 0.04;
            const s = ease(front * 2.2);
            r = step * (0.08 + s * 0.62);
            const hue = HUES[(Math.floor(x / step) + Math.floor(y / step) * 2) % HUES.length];
            const m = ease(front * 1.6 - 0.6);
            col = hue.map((v, i) => Math.round(v + (LIME[i] - v) * m));
            if (fill > 0) col = col.map((v, i) => Math.round(v + (LIME[i] - v) * fill));
          } else {
            // Resting: small darker-lime dots, larger near the pointer or a slow drifting swell.
            let bump: number;
            if (still) bump = 0;
            else if (coarse || pAmt < 0.02) bump = 0.5 + 0.5 * Math.sin(x * 0.012 + y * 0.008 - t * 0.9);
            else bump = 0;
            const near = pAmt > 0.02 ? Math.max(0, 1 - Math.hypot(x - px, y - py) / (step * 7)) * pAmt : 0;
            r = step * (0.07 + bump * 0.05 + ease(near) * 0.3);
            col = [150, 205, 20];
          }
          if (r < 0.4) continue;
          g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      // After the opening, a still page needs no more frames.
      if (finished && still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
    };
  }, [intro]);

  return <canvas ref={ref} className="sp__dots" aria-hidden />;
}
