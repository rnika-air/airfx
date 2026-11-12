import { ai, frameData, tracks } from '../ai/client';
import { estimateMotion, grayOf } from '../ai/motion';
import type { LoadedMedia } from '../hooks/useMedia';
import { disposeVideo, loadVideo, seekVideo } from '../utils/videoProcessing';
import type { ParamValues } from '../effects/types';

/**
 * Scene analysis. Measurements from pixels run automatically and cost almost
 * nothing. Anything that needs a model runs only when the user presses a
 * button. Results are cached per media, so they run once.
 */

export interface SceneStats {
  brightness: number;
  contrast: number;
  saturation: number;
  edgeDensity: number;
  texture: number;
  /** Share of skin-coloured pixels. */
  skin: number;
  green: number;
  /** Mostly flat areas with hard edges and few colours: logos, text, artwork. */
  graphic: number;
  palette: { hex: string; share: number }[];
  motion?: { camera: number; subject: number };
  depth?: { spread: number; near: number; far: number };
  objects?: { label: string; count: number }[];
  people?: number;
  sceneType?: { label: string; score: number }[];
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Runs on import: pixels only, no model. */
export function measure(image: ImageData): SceneStats {
  const { width: w, height: h, data: d } = image, n = w * h, L = new Float32Array(n);
  let sum = 0, sq = 0, sat = 0, skin = 0, green = 0;
  const buckets = new Map<number, [number, number, number, number]>();
  const hist = new Uint32Array(32);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    L[i] = l; sum += l; sq += l * l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - mn > 15 && Math.abs(r - g) > 15) skin++;
    if (g > r * 1.1 && g > b * 1.1) green++;
    hist[Math.min(31, (l * 32) | 0)]++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), e = buckets.get(key);
    if (e) { e[0] += r; e[1] += g; e[2] += b; e[3]++; } else buckets.set(key, [r, g, b, 1]);
  }
  const mean = sum / n, variance = sq / n - mean * mean;
  let edges = 0, lap = 0, flat = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w], m = Math.hypot(gx, gy);
      if (m > 0.12) edges++;
      if (m < 0.004) flat++;
      lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
    }
  const inner = (w - 2) * (h - 2), edgeDensity = edges / inner;
  const top = [...buckets.values()].sort((a, b) => b[3] - a[3]);
  const palette = top.slice(0, 6).map((e) => ({ hex: hex(e[0] / e[3], e[1] / e[3], e[2] / e[3]), share: e[3] / n }));
  const coverage = top.slice(0, 6).reduce((a, e) => a + e[3], 0) / n;
  return {
    brightness: mean, contrast: Math.sqrt(variance), saturation: sat / n, edgeDensity, texture: lap / inner,
    skin: skin / n, green: green / n, graphic: Math.min(1, (flat / inner) * 0.6 + coverage * 0.6 - (1 - edgeDensity * 8 > 0 ? 0.2 : 0)), palette,
  };
}

/** Video only. Samples a few frames; no model. */
export async function measureMotion(media: LoadedMedia): Promise<SceneStats['motion']> {
  const v = await loadVideo(media.url);
  v.muted = true;
  try {
    const steps = 8, gap = v.duration / (steps + 1);
    let prev = null, cam = 0, sub = 0, c = 0;
    for (let i = 1; i <= steps; i++) {
      await seekVideo(v, i * gap);
      const g = grayOf(frameData(v, v.videoWidth, v.videoHeight, 320), 160);
      if (prev) {
        const m = estimateMotion(prev, g, () => true);
        cam += Math.hypot(m.dx, m.dy);
        let diff = 0;
        for (let k = 0; k < g.data.length; k++) diff += Math.abs(g.data[k] - prev.data[k]);
        sub += Math.max(0, diff / g.data.length / 255 - Math.hypot(m.dx, m.dy) * 0.004) * (1 - m.inliers * 0.5);
        c++;
      }
      prev = g;
    }
    return c ? { camera: cam / c / 160, subject: sub / c } : undefined;
  } finally {
    disposeVideo(v);
  }
}

export function depthSummary(time: number): SceneStats['depth'] {
  const m = tracks.depth.at(time);
  if (!m) return undefined;
  let near = 0, far = 0, s = 0, s2 = 0;
  for (const v of m.data) { if (v > 0.66) near++; if (v < 0.33) far++; s += v; s2 += v * v; }
  const n = m.data.length;
  return { spread: Math.sqrt(s2 / n - (s / n) ** 2), near: near / n, far: far / n };
}

export const SCENE_LABELS = ['a portrait of a person', 'a group of people', 'architecture or a building', 'a city street', 'a nature landscape', 'plants or flowers', 'a night scene with lights', 'text or a graphic design', 'skateboarding or action sport', 'a product photo', 'an animal', 'a car or vehicle', 'food'];

export async function classify(image: ImageData) {
  const r = await ai.classify(image, SCENE_LABELS);
  return r.sort((a, b) => b.score - a.score).slice(0, 3);
}

/* Recommendations */

export interface Suggestion { id: string; effectId: string; title: string; why: string; params: ParamValues; score: number }

/** Suggestions only: each one is a normal stack step with normal controls. */
export function recommend(s: SceneStats): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (effectId: string, title: string, why: string, score: number, params: ParamValues = {}) => out.push({ id: `${effectId}:${title}`, effectId, title, why, params, score });
  const type = s.sceneType?.[0]?.label ?? '', typed = (t: string) => (s.sceneType?.[0] && type.includes(t) ? 0.5 : 0) + (s.sceneType?.[1]?.label.includes(t) ? 0.2 : 0);
  const people = s.people ?? 0;
  const portrait = Math.min(1, (people ? 0.5 : 0) + (s.skin > 0.1 ? 0.3 : 0)) + typed('portrait') + typed('group');
  const night = (s.brightness < 0.25 ? 0.5 : 0) + typed('night');
  const nature = (s.green > 0.25 ? 0.4 : 0) + typed('nature') + typed('plants');
  const arch = (s.edgeDensity > 0.09 && s.saturation < 0.4 ? 0.35 : 0) + typed('architecture') + typed('street');
  const graphic = (s.graphic > 0.55 ? 0.5 : 0) + typed('text');
  const moving = s.motion ? Math.min(1, s.motion.subject * 12 + s.motion.camera * 8) : 0;
  const sport = typed('skateboarding') + moving * 0.5;
  const person = people === 1 ? 'one person' : people > 1 ? `${people} people` : 'skin tones';

  if (portrait > 0.3) {
    add('airDepth', 'Background Blur', `Found ${person}. Depth keeps the subject sharp.`, portrait + (s.depth ? 0.2 : 0), { blur: 22, focusRange: 0.2 });
    add('halftone', 'Portrait Halftone', 'Faces hold up well as large dot screens.', portrait * 0.8, { spacing: 7 });
    add('adjColor', 'Warm Skin Grade', 'A gentle vibrance lift flatters skin.', portrait * 0.7);
    add('glowBloom', 'Soft Glow', 'Adds a soft-focus portrait finish.', portrait * 0.6);
    add('textPortrait', 'Text Portrait', 'High-contrast faces read well in type.', portrait * 0.5 + s.contrast);
    add('nodeNetwork', 'Node Network', 'Traces the figure with a web of points.', portrait * 0.5);
  }
  if (arch > 0.3) {
    add('edge', 'Edge Lines', 'Strong straight edges were measured.', arch);
    add('topoSurvey', 'Contour Lines', 'Contours follow big planes well.', arch * 0.7);
    add('circuitBoard', 'Circuit Overlay', 'Geometric shapes suit routed traces.', arch * 0.7);
    add('radialArray', 'Geometric Array', 'Rebuilds structure from a shape pattern.', arch * 0.5);
    add('displaceMap', 'Structural Displacement', 'Bends lines along the image.', arch * 0.5);
  }
  if (nature > 0.3) {
    add('pointillism', 'Pointillism', 'Foliage and natural colour suit paint dots.', nature);
    add('topoSurvey', 'Topographic', 'Organic forms make natural contours.', nature * 0.8);
    add('turbulence', 'Organic Displacement', 'Soft warping suits natural shapes.', nature * 0.6);
    add('cyanotype', 'Botanical Cyanotype', 'A classic treatment for plants.', nature * 0.7);
    add('recolor', 'Color Grade', 'Remaps the greens into a new palette.', nature * 0.5);
  }
  if (night > 0.3) {
    add('vhs', 'VHS', 'Low light hides tape noise in a natural way.', night, { });
    add('glowBloom', 'Light Bloom', 'Bright points on dark bloom strongly.', night * 0.9);
    add('chromaticAb', 'Chromatic Aberration', 'Fringes show on lights against dark.', night * 0.7);
    add('anamorphic', 'Anamorphic Streaks', 'Horizontal streaks from light sources.', night * 0.7);
    add('lensFlare', 'Lens Flare', 'Works with a single strong light.', night * 0.5);
  }
  if (graphic > 0.3) {
    add('ditherLab', 'Dithering', 'Flat shapes and hard edges dither cleanly.', graphic);
    add('ascii', 'ASCII', 'High-contrast artwork stays readable in glyphs.', graphic * 0.9);
    add('posterize', 'Posterize', 'Few colours were measured.', graphic * 0.6);
    add('cmykPrint', 'CMYK Print', 'Solid colour shows off the screens.', graphic * 0.6);
    add('displaceMap', 'Displacement', 'Bends crisp shapes into new forms.', graphic * 0.5);
  }
  if (sport > 0.3) {
    add('motionTrails', 'Motion Trails', 'Strong movement was measured.', sport + 0.1);
    add('blobTracker', 'Tracking Overlay', 'Boxes follow the moving shapes.', sport);
    add('glitch', 'Glitch', 'Fast cuts suit digital breakup.', sport * 0.7);
    add('vhs', 'VHS', 'A classic look for action footage.', sport * 0.6);
    add('datamosh', 'Datamosh', 'Motion drives the melt.', sport * 0.6);
    add('lineScan', 'Line Scan', 'Turns motion into ribbons.', sport * 0.5);
  }
  if (s.motion && moving > 0.2 && sport <= 0.3) add('motionTrails', 'Motion Trails', 'Movement was measured in this clip.', moving);
  if (s.depth && s.depth.spread > 0.2) add('airDepth', 'Depth Grade', 'The depth map has clear near and far areas.', 0.6, { gradeAmount: 0.5, blur: 0 });
  if (s.texture > 0.08) add('filmGrain', 'Film Grain', 'Fine detail carries grain well.', 0.25);
  if (s.contrast < 0.14) add('adjLevels', 'Levels', 'Contrast is low. Start by widening the tones.', 0.5);
  if (s.brightness > 0.72) add('duotone', 'Duotone', 'Bright images print well in two colours.', 0.3);
  add('moire', 'Moiré', 'Works on almost anything. A good wild card.', 0.15);
  add('scatter', 'Scatter', 'Rebuilds any image from dots.', 0.14);
  // One suggestion per effect, best reason first.
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((x) => !seen.has(x.effectId) && seen.add(x.effectId)).slice(0, 8);
}
