import { useEffect, useSyncExternalStore } from 'react';
import { FrameRenderer } from '../engine/FrameRenderer';
import { EFFECTS, getEffect } from '../effects/registry';
import { defaultParams, type EffectDefinition } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { EffectIcon } from './EffectIcon';

/**
 * Library thumbnails are made by the real renderers: each effect runs on one
 * small test picture with its default settings, so the icon shows what the
 * effect actually does. Effects that need an AI result have a drawn icon.
 */

const SIZE = 72;
const thumbs = new Map<string, string>();
const failed = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
let started = false;

function sample(shift = 0) {
  const c = createCanvas(SIZE, SIZE), g = get2d(c, true);
  const sky = g.createLinearGradient(0, 0, SIZE, SIZE);
  sky.addColorStop(0, '#2b6fd6');
  sky.addColorStop(0.55, '#e0793a');
  sky.addColorStop(1, '#f4d35e');
  g.fillStyle = sky;
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = '#fff6d8';
  g.beginPath(); g.arc(SIZE * 0.78, SIZE * 0.22, SIZE * 0.1, 0, 7); g.fill();
  // A head and shoulders gives every effect something recognisable to work on.
  g.fillStyle = '#17181c';
  g.beginPath(); g.ellipse(SIZE * 0.5 + shift, SIZE * 1.02, SIZE * 0.36, SIZE * 0.32, 0, 0, 7); g.fill();
  g.fillStyle = '#d8a988';
  g.beginPath(); g.arc(SIZE * 0.5 + shift, SIZE * 0.47, SIZE * 0.21, 0, 7); g.fill();
  g.fillStyle = '#17181c';
  g.beginPath(); g.arc(SIZE * 0.5 + shift, SIZE * 0.4, SIZE * 0.22, Math.PI, 0); g.fill();
  return c;
}

/** Thumbnails have no sound, so the visualizer shows its stand-in signal here only. */
const THUMB_PARAMS: Record<string, Record<string, boolean | string | number>> = {
  soundViz: { testSignal: true }, audioShapes: { testSignal: true },
  speechType: { shapeFrom: 'dark', level: 0.5, fontSize: 9, textSource: 'manual' },
  particleSim: { background: 'color', bgColor: '#061033', dissolve: 0.5, count: 900, size: 1.4 },
};

/** Marked with drawn icons below because they show nothing without analysis. */
const DRAWN = new Set(['airKey', 'airCleanup', 'airDepth', 'reveal']);

function runQueue() {
  if (started) return;
  started = true;
  const renderer = new FrameRenderer();
  const list = EFFECTS.filter((e) => !DRAWN.has(e.id) && !e.hidden);
  const flat = createCanvas(SIZE, SIZE);
  renderer.render({ source: sample(), target: flat, width: SIZE, height: SIZE, layers: [] });
  const plain = flat.toDataURL('image/png');
  let i = 0;
  const next = () => {
    if (i >= list.length) { renderer.dispose(); return; }
    const e = list[i++];
    try {
      const target = createCanvas(SIZE, SIZE);
      const layers = [{ effect: e, params: { ...defaultParams(e), ...THUMB_PARAMS[e.id] } }];
      const video = e.compat === 'video' || e.id === 'datamosh' || e.id === 'inkBleed' || e.id === 'particleSim';
      // Time-based effects need a few frames before they show anything.
      for (let f = 0; f < (video ? 14 : 1); f++) renderer.render({ source: sample(video ? Math.sin(f / 2) * 16 : 0), target, width: SIZE, height: SIZE, layers, time: 0.7, frame: f + 12 });
      let url = target.toDataURL('image/png');
      if (url === plain) {
        // Neutral at defaults (most adjustments): show it with its sliders pushed.
        const pushed = defaultParams(e);
        for (const p of e.params) if (p.type === 'range') pushed[p.key] = p.min + (p.max - p.min) * 0.8;
        renderer.render({ source: sample(), target, width: SIZE, height: SIZE, layers: [{ effect: e, params: pushed }], time: 0.7, frame: 12 });
        url = target.toDataURL('image/png');
      }
      thumbs.set(e.id, url);
    } catch {
      failed.add(e.id);
    }
    version++;
    listeners.forEach((l) => l());
    setTimeout(next, 8);
  };
  setTimeout(next, 200);
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const getVersion = () => version;

function DrawnIcon({ id }: { id: string }) {
  const cells = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) cells.push(<rect key={`${x}${y}`} x={x * 9} y={y * 9} width={9} height={9} fill="#3a3c3a" />);
  const figure = 'M36 12a11 11 0 1 1-.01 0ZM14 72c0-16 10-26 22-26s22 10 22 26Z';
  if (id === 'airKey') {
    // Foreground silhouette over a transparency checkerboard.
    return <svg viewBox="0 0 72 72" className="thumb"><rect width="72" height="72" fill="#1a1b1a" />{cells}<path d={figure} fill="#c6ff2e" /></svg>;
  }
  if (id === 'reveal') {
    // A person, half gone: the room shows through the lower part.
    return (
      <svg viewBox="0 0 72 72" className="thumb">
        <rect width="72" height="72" fill="#2c3440" />
        {[0, 1, 2, 3].map((r) => <rect key={r} x="0" y={r * 18} width="72" height="9" fill="#38424f" />)}
        <defs><linearGradient id="rv" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stopColor="#d8a988" /><stop offset="0.75" stopColor="#d8a988" stopOpacity="0" /></linearGradient></defs>
        <path d={figure} fill="url(#rv)" />
        <path d={figure} fill="none" stroke="#bfefff" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx="52" cy="52" r="9" fill="none" stroke="#c6ff2e" strokeWidth="2" />
      </svg>
    );
  }
  if (id === 'airDepth') {
    return (
      <svg viewBox="0 0 72 72" className="thumb">
        <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0c0c0c" /><stop offset="1" stopColor="#4a4a4a" /></linearGradient></defs>
        <rect width="72" height="72" fill="url(#dg)" />
        <path d={figure} fill="#ececec" />
        <path d="M0 62 72 54V72H0Z" fill="#8a8a8a" opacity=".55" />
      </svg>
    );
  }
  // Removal: a dashed selection around a patch, rebuilt from the same texture.
  return (
    <svg viewBox="0 0 72 72" className="thumb">
      <rect width="72" height="72" fill="#5a4a38" />
      {[0, 1, 2, 3].map((r) => <g key={r}>{[0, 1, 2].map((c) => <rect key={c} x={c * 28 - (r % 2) * 14} y={r * 18} width="26" height="16" fill="#9d6a4a" />)}</g>)}
      <rect x="20" y="18" width="34" height="34" fill="none" stroke="#c6ff2e" strokeWidth="2.5" strokeDasharray="5 4" />
    </svg>
  );
}

export function EffectThumb({ effect }: { effect: EffectDefinition | string }) {
  const e = typeof effect === 'string' ? getEffect(effect) : effect;
  useSyncExternalStore(subscribe, getVersion);
  useEffect(runQueue, []);
  if (!e) return null;
  if (DRAWN.has(e.id)) return <DrawnIcon id={e.id} />;
  const src = thumbs.get(e.id);
  if (src) return <img src={src} alt="" className="thumb" draggable={false} />;
  // A thumbnail that could not render falls back to the line icon.
  if (failed.has(e.id)) return <EffectIcon id={e.id} />;
  return <span className="thumb thumb--wait" />;
}

/** For tests and the audit: which effects produced a thumbnail. */
export const thumbStatus = () => ({ made: thumbs.size + DRAWN.size, failed: [...failed] });
