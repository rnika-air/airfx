import type { EffectDefinition } from '../types';
import { R, S, T } from '../generative';
import { BANDS, sig, soundNow } from './sound';

/**
 * Audio Pulse: the whole picture (everything above it in the stack) reacts to
 * the sound: it zooms, flashes, shifts colour, shakes or blurs. Put it last
 * to make any effect chain move with the music. The smoothness comes from
 * the Audio tab's Attack and Release.
 */
export const audioPulse: EffectDefinition = {
  id: 'audioPulse', name: 'Audio Pulse', category: 'animate',
  description: 'Makes everything before it zoom, flash, shift colour, shake or blur with the music. Put it at the end of the stack.',
  animated: () => true,
  params: [
    S('zoomFrom', 'Zoom Follows', 'beat', BANDS, 'Zoom'),
    R('zoom', 'Zoom Amount', 0, 0.5, 0.005, 0.08, 'Zoom'),
    S('turnFrom', 'Turn Follows', 'none', BANDS, 'Zoom'),
    R('turn', 'Turn Amount', -20, 20, 0.5, 4, 'Zoom'),
    S('flashFrom', 'Flash Follows', 'hit', BANDS, 'Flash'),
    R('flash', 'Flash Amount', 0, 1, 0.01, 0.25, 'Flash'),
    { key: 'flashColor', label: 'Flash Color', type: 'color', group: 'Flash', default: '#ffffff' },
    S('hueFrom', 'Color Shift Follows', 'none', BANDS, 'Color'),
    R('hue', 'Color Shift', 0, 180, 1, 60, 'Color'),
    S('shakeFrom', 'Shake Follows', 'none', BANDS, 'Shake & Blur'),
    R('shake', 'Shake Amount', 0, 60, 0.5, 12, 'Shake & Blur'),
    S('blurFrom', 'Blur Follows', 'none', BANDS, 'Shake & Blur'),
    R('blur', 'Blur Amount', 0, 30, 0.25, 6, 'Shake & Blur'),
    T('idle', 'Move Without Sound', true, 'Sound'),
  ],
  presets: [
    { name: 'Kick Zoom', values: { zoomFrom: 'beat', zoom: 0.1, flashFrom: 'none' } },
    { name: 'Strobe On Hits', values: { zoomFrom: 'none', flashFrom: 'hit', flash: 0.7 } },
    { name: 'Bass Shake', values: { zoomFrom: 'bass', zoom: 0.04, shakeFrom: 'beat', shake: 18, flashFrom: 'none' } },
    { name: 'Color On The Beat', values: { zoomFrom: 'none', flashFrom: 'none', hueFrom: 'beat', hue: 90 } },
    { name: 'Dreamy Swell', values: { zoomFrom: 'level', zoom: 0.06, blurFrom: 'treble', blur: 4, flashFrom: 'none', turnFrom: 'mid', turn: 3 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const b = soundNow(time, p.idle as boolean);
    const z = 1 + sig(b, p.zoomFrom) * (p.zoom as number), a = (sig(b, p.turnFrom) * (p.turn as number) * Math.PI) / 180;
    const sh = sig(b, p.shakeFrom) * (p.shake as number) * unit, k = Math.floor(time * 30);
    const sx = sh ? (Math.sin(k * 12.9898) * 43758.5453 % 1) * sh : 0, sy = sh ? (Math.sin(k * 78.233) * 12543.1 % 1) * sh : 0;
    const hue = sig(b, p.hueFrom) * (p.hue as number), blur = sig(b, p.blurFrom) * (p.blur as number) * unit;
    ctx.save();
    const f: string[] = [];
    if (hue > 0.5) f.push(`hue-rotate(${hue.toFixed(1)}deg)`);
    if (blur > 0.2) f.push(`blur(${blur.toFixed(2)}px)`);
    if (f.length) ctx.filter = f.join(' ');
    ctx.translate(w / 2 + sx, h / 2 + sy);
    ctx.rotate(a);
    // Never shows an edge: zoomed at least as much as the turn and shake need.
    const cover = z * (1 + Math.abs(Math.sin(a)) * 0.6 + (Math.abs(sx) + Math.abs(sy)) / Math.min(w, h));
    ctx.scale(cover, cover);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas as HTMLCanvasElement, -w / 2, -h / 2, w, h);
    ctx.restore();
    const fl = sig(b, p.flashFrom) * (p.flash as number);
    if (fl > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, fl);
      ctx.fillStyle = p.flashColor as string;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  },
};
