import { useEffect, useRef } from 'react';

/**
 * The splash background: a quiet halftone dot grid on black. Around the
 * pointer the dots swell and light up lime, easing after it as it moves;
 * on touch screens (no pointer to follow) a slow swell drifts across;
 * on a desktop the dots stay grey until the pointer moves.
 *
 * One canvas at device resolution, at most about 30 frames a second, only
 * while the page is visible, and still under reduced motion.
 */

const LIME = [198, 255, 46];

export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let w = 0, h = 0, dpr = 1, step = 22;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      step = Math.max(16, Math.min(26, Math.min(w, h) / 26));
      last = 0;
    };
    let last = 0;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);

    // The glow follows the pointer with a little lag, and fades when it leaves.
    let tx = -9999, ty = -9999, px = -9999, py = -9999, amt = 0, target = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = c.getBoundingClientRect();
      tx = e.clientX - r.left; ty = e.clientY - r.top;
      if (target === 0) { px = tx; py = ty; }
      target = 1;
    };
    const leave = () => { target = 0; };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);

    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < 33) return;
      last = now;
      const t = (now - t0) / 1000;
      px += (tx - px) * 0.18; py += (ty - py) * 0.18; amt += (target - amt) * 0.1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const reach = step * 8, off = (step / 2) % step;
      for (let y = off; y < h + step; y += step) {
        for (let x = off; x < w + step; x += step) {
          // Near the pointer, or under the slow drifting swell on touch screens.
          let k = amt > 0.01 ? Math.max(0, 1 - Math.hypot(x - px, y - py) / reach) * amt : 0;
          if (coarse && !still) k = Math.max(k, Math.max(0, Math.sin(x * 0.011 + y * 0.007 - t * 0.6)) ** 6 * 0.35);
          k = k * k * (3 - 2 * k);
          const r = step * (0.06 + k * 0.32);
          // Grey dots everywhere; lime where they swell.
          const a = 0.1 + k * 0.85;
          g.fillStyle = k > 0.02 ? `rgba(${LIME[0]},${LIME[1]},${LIME[2]},${a})` : 'rgba(255,255,255,0.09)';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (still && amt < 0.01 && target === 0) last = now; // nothing moves: keep the frame
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <canvas ref={ref} className="sp__dots" aria-hidden />;
}
