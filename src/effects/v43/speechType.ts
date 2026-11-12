import type { EffectDefinition, ParamValues } from '../types';
import { speech } from '../../ai/speech';
import { BODY_REGIONS, vision } from '../../ai/vision';
import { selection } from '../../ai/selection';
import { tracks } from '../../ai/client';
import { createCanvas, get2d, toLuma } from '../../utils/imageProcessing';
import { resample } from '../airKey';
import { C, R, S, T } from '../generative';

/**
 * Spoken words fill the speaker's silhouette. The body shape comes from body
 * tracking (or the Key selection), the words from Whisper on this machine,
 * the browser's recognizer, an audio file, or typed text. Words can fill the
 * whole body or chosen parts, and the newest word can ride on a fingertip.
 */

const REGION_KEYS = ['regHead', 'regTorso', 'regArms', 'regLegs', 'regHands'] as const;

function silhouette(p: ParamValues, frame: HTMLCanvasElement, src: ImageData, w: number, h: number, time: number, key: unknown) {
  const from = p.shapeFrom as string;
  let mask: Float32Array | null = null, points: { x: number; y: number }[] = [];
  if (from === 'body') {
    const r = vision.poseIn(frame, key);
    if (r?.mask) mask = resample({ w: r.mask.w, h: r.mask.h, data: r.mask.data }, w, h);
    points = r?.points ?? [];
  } else if (from === 'selection') {
    const m = selection.union(time) ?? tracks.matte.at(time);
    if (m) mask = resample(m, w, h);
  } else {
    const L = toLuma(src), th = p.level as number, dark = from === 'dark';
    mask = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) mask[i] = dark ? (L[i] < th ? 1 : 0) : L[i] > th ? 1 : 0;
  }
  // Regions: thick strokes along the chosen limbs, kept inside the silhouette.
  const all = REGION_KEYS.every((k) => p[k]);
  if (mask && !all && points.length) {
    const c = createCanvas(w, h), g = get2d(c, true), thick = Math.max(w, h) * 0.09;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = thick;
    const line = (a: number, b: number) => { const A = points[a], B = points[b]; if (!A || !B) return; g.beginPath(); g.moveTo(A.x * w, A.y * h); g.lineTo(B.x * w, B.y * h); g.stroke(); };
    if (p.regHead) { const n0 = points[0]; if (n0) { g.beginPath(); g.arc(n0.x * w, n0.y * h, thick * 1.3, 0, 6.2832); g.fill(); } BODY_REGIONS.head.forEach(([a, b]) => line(a, b)); }
    if (p.regTorso) { const q = [11, 12, 24, 23].map((i) => points[i]); if (q.every(Boolean)) { g.beginPath(); q.forEach((pt, i) => (i ? g.lineTo(pt.x * w, pt.y * h) : g.moveTo(pt.x * w, pt.y * h))); g.closePath(); g.fill(); } BODY_REGIONS.torso.forEach(([a, b]) => line(a, b)); }
    if (p.regArms) BODY_REGIONS.arms.forEach(([a, b]) => line(a, b));
    if (p.regLegs) BODY_REGIONS.legs.forEach(([a, b]) => line(a, b));
    if (p.regHands) for (const i of [15, 16, 17, 18, 19, 20]) { const q = points[i]; if (q) { g.beginPath(); g.arc(q.x * w, q.y * h, thick * 0.9, 0, 6.2832); g.fill(); } }
    const d = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < mask.length; i++) mask[i] *= d[i * 4 + 3] / 255;
  }
  return mask;
}

export const speechType: EffectDefinition = {
  id: 'speechType', name: 'Speech Typography', category: 'type',
  description: 'Words you speak fill your silhouette, live from the webcam and microphone, or from a video and its sound.',
  animated: () => true,
  supportsTransparency: true,
  params: [
    { key: 'speechControls', label: 'Words', type: 'custom', editor: 'speech', default: '', group: 'Words' },
    S('textSource', 'Text From', 'both', [['speech', 'Speech Only'], ['manual', 'Typed Text Only'], ['both', 'Speech, Typed Text Until Then']], 'Words'),
    { key: 'manual', label: 'Typed Text', type: 'text', default: 'say something and your words will fill your shape', maxLength: 2000, multiline: true, group: 'Words' },
    S('caseMode', 'Case', 'upper', [['none', 'As Spoken'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']], 'Words'),
    { key: 'trackControls', label: 'Body Tracking', type: 'custom', editor: 'vision', default: 'pose,hands', group: 'Shape' },
    S('shapeFrom', 'Silhouette From', 'body', [['body', 'Body Tracking'], ['selection', 'Selection Or Matte (Key)'], ['dark', 'Dark Areas'], ['bright', 'Bright Areas']], 'Shape'),
    { ...R('level', 'Threshold', 0.05, 0.95, 0.01, 0.45, 'Shape'), visibleWhen: (v) => v.shapeFrom === 'dark' || v.shapeFrom === 'bright' },
    { ...T('regHead', 'Head', true, 'Body Regions'), visibleWhen: (v) => v.shapeFrom === 'body' },
    { ...T('regTorso', 'Torso', true, 'Body Regions'), visibleWhen: (v) => v.shapeFrom === 'body' },
    { ...T('regArms', 'Arms', true, 'Body Regions'), visibleWhen: (v) => v.shapeFrom === 'body' },
    { ...T('regLegs', 'Legs', true, 'Body Regions'), visibleWhen: (v) => v.shapeFrom === 'body' },
    { ...T('regHands', 'Hands', true, 'Body Regions'), visibleWhen: (v) => v.shapeFrom === 'body' },
    T('fingerWord', 'Newest Word On Fingertip', true, 'Shape'),
    { key: 'font', label: 'Font', type: 'custom', editor: 'font', default: '"Segoe UI", Arial, sans-serif', group: 'Type' },
    R('fontSize', 'Font Size', 4, 80, 0.5, 14, 'Type'),
    R('density', 'Text Density', 0.5, 2, 0.01, 1.05, 'Type', 'Higher packs lines closer.'),
    R('weight', 'Weight', 100, 900, 100, 800, 'Type'),
    C('textColor', 'Text Color', '#ffffff', 'Color'),
    C('newColor', 'Newest Words', '#c6ff2e', 'Color'),
    R('newCount', 'Highlight Newest', 0, 20, 1, 3, 'Color'),
    S('background', 'Background', 'color', [['color', 'Color'], ['dim', 'Dimmed Picture'], ['image', 'Picture'], ['clear', 'Transparent']], 'Color'),
    { ...C('bgColor', 'Background Color', '#000000', 'Color'), visibleWhen: (v) => v.background === 'color' },
    { ...R('dim', 'Dim Picture', 0, 1, 0.01, 0.85, 'Color'), visibleWhen: (v) => v.background === 'dim' },
    R('ghost', 'Show Person Faintly', 0, 1, 0.01, 0.08, 'Color'),
    S('motion', 'Text Animation', 'flow', [['none', 'Still'], ['flow', 'Flow Sideways'], ['rise', 'Rise'], ['wave', 'Wave'], ['jitter', 'Jitter']], 'Animation'),
    R('speed', 'Animation Speed', 0, 4, 0.01, 0.8, 'Animation'),
  ],
  presets: [
    { name: 'Spoken Silhouette', values: {} },
    { name: 'Upper Body Words', values: { regLegs: false, regArms: true, fontSize: 11 } },
    { name: 'Hands Only', values: { regHead: false, regTorso: false, regArms: false, regLegs: false, regHands: true, fontSize: 9 } },
    { name: 'Over Video', values: { background: 'dim', dim: 0.7, ghost: 0 } },
    { name: 'Poster Type', values: { fontSize: 28, density: 0.95, motion: 'none', textColor: '#ff3b1f', bgColor: '#f2eee6', newColor: '#111111', caseMode: 'upper' } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const frameC = srcCanvas as HTMLCanvasElement, key = `${time}|${frame}|${w}`;
    const bg = p.background as string;
    if (bg === 'color') { ctx.fillStyle = p.bgColor as string; ctx.fillRect(0, 0, w, h); }
    else if (bg !== 'clear') { ctx.drawImage(frameC, 0, 0); if (bg === 'dim') { ctx.fillStyle = `rgba(0,0,0,${p.dim})`; ctx.fillRect(0, 0, w, h); } }
    const mask = silhouette(p, frameC, src, w, h, time, key);
    const gho = p.ghost as number;
    if (gho > 0 && bg === 'color') { ctx.globalAlpha = gho; ctx.drawImage(frameC, 0, 0); ctx.globalAlpha = 1; }

    // The words.
    const live = speech.wordsAt(time).map((wd) => wd.text), src2 = p.textSource as string;
    let words = src2 === 'manual' ? [] : live;
    if (src2 === 'manual' || (src2 === 'both' && !words.length)) words = ((p.manual as string) || '').split(/\s+/).filter(Boolean);
    if (!words.length) words = ['…'];
    const cs = p.caseMode as string, fix = (s: string) => (cs === 'upper' ? s.toUpperCase() : cs === 'lower' ? s.toLowerCase() : s);
    const fs = (p.fontSize as number) * unit, lh = fs * 1.05 / (p.density as number), font = `${p.weight} ${fs}px ${p.font}`;
    const layer = createCanvas(w, h), g = get2d(layer, true);
    g.font = font;
    g.textBaseline = 'alphabetic';
    const spd = p.speed as number, motion = p.motion as string, newest = p.newCount as number;
    // Newest first, so fresh words show where the shape begins and the rest follow.
    const seq = [...words].reverse().map(fix), space = g.measureText(' ').width, widths = seq.map((s) => g.measureText(s).width);
    let k = 0;
    const rows = Math.ceil(h / lh) + 1;
    for (let r = 0; r < rows; r++) {
      let y = (r + 1) * lh - fs * 0.15;
      if (motion === 'rise') y = ((y - time * spd * 40 * unit) % (rows * lh) + rows * lh) % (rows * lh);
      const shift = motion === 'flow' ? ((time * spd * 60 * unit * (r % 2 ? 1 : -1)) % (w * 0.5)) - w * 0.25 : 0;
      let x = -w * 0.25 + shift;
      while (x < w * 1.25) {
        const i = k % seq.length, ww = widths[i];
        let dx = 0, dy = 0;
        if (motion === 'wave') dy = Math.sin(x * 0.02 / unit + time * spd * 4) * fs * 0.25;
        if (motion === 'jitter') { dx = (Math.sin(k * 12.9 + time * 9 * spd) * 0.5) * fs * 0.15; dy = Math.cos(k * 7.1 + time * 11 * spd) * fs * 0.15; }
        g.fillStyle = i < newest && seq.length > newest ? (p.newColor as string) : (p.textColor as string);
        g.fillText(seq[i], x + dx, y + dy);
        x += ww + space;
        k++;
      }
    }
    // Keep only the letters inside the silhouette.
    if (mask) {
      const mc = createCanvas(w, h), mg = get2d(mc, true), im = mg.createImageData(w, h);
      for (let i = 0; i < mask.length; i++) im.data[i * 4 + 3] = Math.min(255, mask[i] * 320);
      mg.putImageData(im, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mc, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(layer, 0, 0);
    if (!mask) {
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = `${Math.round(12 * unit)}px monospace`;
      ctx.fillText(p.shapeFrom === 'body' ? (vision.ready('pose') ? 'NO PERSON FOUND' : 'LOAD BODY TRACKING TO FIND THE SILHOUETTE') : 'NO SELECTION YET', 12 * unit, h - 14 * unit);
    }
    // The newest word on a fingertip.
    if (p.fingerWord && vision.ready('hands') && live.length) {
      const hands = vision.handsIn(frameC, key);
      ctx.font = `${p.weight} ${fs * 2.2}px ${p.font}`;
      ctx.fillStyle = p.newColor as string;
      ctx.textAlign = 'center';
      for (const hd of hands) ctx.fillText(fix(live[live.length - 1]), hd.tip.x * w, hd.tip.y * h - fs);
      ctx.textAlign = 'left';
    }
  },
};
