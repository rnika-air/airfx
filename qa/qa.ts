/**
 * Effect test bench (development only). Renders every library effect through
 * the real FrameRenderer on a fixed set of test pictures and video frames,
 * measures the results and saves contact sheets to qa/out/.
 *
 *   await qa.stills({ from: 0, to: 20 })   still pictures, preview vs export size
 *   await qa.video({ ids: ['glitch'] })    16 frames of moving footage
 */
import { FrameRenderer } from '../src/engine/FrameRenderer';
import { LIBRARY, getEffect } from '../src/effects/registry';
import { defaultParams, type EffectDefinition, type ParamValues, type RenderLayer } from '../src/effects/types';

const SMALL = 480, BIG = 1440, CELL = 150, LABEL = 120;

interface TestPic { name: string; small: HTMLCanvasElement; big: HTMLCanvasElement }

const log = (s: string) => { document.getElementById('log')!.textContent += s + '\n'; };

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctx(c: HTMLCanvasElement) { return c.getContext('2d', { willReadFrequently: true })!; }

function fit(src: CanvasImageSource & { width: number; height: number }, long: number, filter = 'none') {
  const k = long / Math.max(src.width, src.height), c = canvas(Math.round(src.width * k), Math.round(src.height * k)), g = ctx(c);
  g.filter = filter;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function image(url: string) {
  const i = new Image();
  // onload, not decode(): decode() never settles while the page is hidden.
  await new Promise((ok, no) => { i.onload = ok; i.onerror = no; i.src = url; });
  const c = canvas(i.naturalWidth, i.naturalHeight);
  ctx(c).drawImage(i, 0, 0);
  return c;
}

/** Bold typography: flat colour, hard edges, lots of empty space. */
function typography() {
  const c = canvas(1440, 1800), g = ctx(c);
  g.fillStyle = '#f1ede4'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111'; g.font = '900 420px Arial Black, Arial, sans-serif'; g.textBaseline = 'top';
  g.fillText('AIR', 70, 120); g.fillText('FX', 70, 560);
  g.fillStyle = '#e8311a'; g.fillRect(70, 1080, 1300, 60);
  g.fillStyle = '#111'; g.font = '700 64px Arial, sans-serif';
  ['EXPERIMENTAL', 'VISUAL PLAYGROUND', 'MALAYSIA 2026'].forEach((t, i) => g.fillText(t, 70, 1220 + i * 110));
  g.font = '400 28px Georgia, serif';
  for (let i = 0; i < 6; i++) g.fillText('The quick brown fox jumps over the lazy dog 0123456789.', 70, 1560 + i * 36);
  return c;
}

/** Abstract: soft gradients, a hard shape, fine noise. */
function abstract() {
  const c = canvas(1440, 1440), g = ctx(c);
  const gr = g.createLinearGradient(0, 0, 1440, 1440);
  gr.addColorStop(0, '#1b1fd8'); gr.addColorStop(0.5, '#ff3d8b'); gr.addColorStop(1, '#ffd23f');
  g.fillStyle = gr; g.fillRect(0, 0, 1440, 1440);
  const rg = g.createRadialGradient(500, 600, 20, 500, 600, 520);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 1440, 1440);
  g.fillStyle = '#0c0c0c'; g.beginPath(); g.moveTo(900, 200); g.lineTo(1300, 1100); g.lineTo(760, 900); g.closePath(); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(1040, 1150, 60 + i * 34, 0, Math.PI * 2); g.stroke(); }
  return c;
}

let pics: TestPic[] | null = null;
async function testPictures() {
  if (pics) return pics;
  const raw: [string, HTMLCanvasElement, string?][] = [
    ['portrait', await image('/samples/portrait.jpg')],
    ['landscape', await image('/samples/landscape.jpg')],
    ['architecture', await image('/samples/architecture.jpg')],
    ['object', await image('/samples/flower.jpg')],
    ['typography', typography()],
    ['abstract', abstract()],
    ['bright', await image('/showcase/photo-3.jpg'), 'brightness(1.7) contrast(0.8)'],
    ['dark', await image('/showcase/photo-1.jpg')],
    ['colour', await image('/showcase/photo-2.jpg')],
  ];
  pics = raw.map(([name, c, f]) => { const big = fit(c, BIG, f); return { name, big, small: fit(big, SMALL) }; });
  return pics;
}

function px(c: HTMLCanvasElement) { return ctx(c).getImageData(0, 0, c.width, c.height).data; }

function stats(d: Uint8ClampedArray) {
  let s = 0, s2 = 0, a = 0, lo = 0, hi = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    s += l; s2 += l * l; a += d[i + 3];
    if (l < 8) lo++; else if (l > 248) hi++;
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), alpha: a / n / 255, black: lo / n, white: hi / n };
}

/** Mean absolute RGB difference, over pixels both images cover. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (a.length / 4) / 3;
}

/** Output flattened over black, as a viewer sees it after export. */
function flat(c: HTMLCanvasElement, w = c.width, h = c.height, blur = 0) {
  const o = canvas(w, h), g = ctx(o);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  if (blur) g.filter = `blur(${blur}px)`;
  g.drawImage(c, 0, 0, w, h);
  return o;
}

/**
 * Preview vs export: both are blurred a little at preview size first, so a
 * fine pattern (grain, dither, dots) that cannot survive downscaling does not
 * count, but a change of layout, size, tone or colour does.
 */
function resDiff(small: HTMLCanvasElement, big: HTMLCanvasElement) {
  const w = small.width, h = small.height;
  const b = flat(big, w, h), s = flat(small);
  return diff(px(flat(b, w, h, 3)), px(flat(s, w, h, 3)));
}

function render(r: FrameRenderer, source: HTMLCanvasElement, layers: RenderLayer[], time: number, frame: number) {
  const target = canvas(1, 1);
  const t0 = performance.now();
  r.render({ source, target, width: source.width, height: source.height, layers, time, frame });
  return { target, ms: performance.now() - t0 };
}

async function save(c: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 0.85));
  await fetch(`/__qa/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
}
async function saveJson(data: unknown, name: string) {
  await fetch(`/__qa/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(data, null, 1) });
}

function sheet(rows: { label: string; cells: HTMLCanvasElement[] }[], cols: number) {
  const c = canvas(LABEL + cols * CELL, rows.length * CELL), g = ctx(c);
  g.fillStyle = '#161616'; g.fillRect(0, 0, c.width, c.height);
  rows.forEach((row, y) => {
    g.fillStyle = '#eee'; g.font = '13px Arial';
    const words = row.label.split(' ');
    let line = '', ly = y * CELL + 18;
    for (const w of words) { if (g.measureText(line + w).width > LABEL - 10) { g.fillText(line, 6, ly); ly += 16; line = ''; } line += w + ' '; }
    g.fillText(line, 6, ly);
    row.cells.forEach((cell, x) => {
      const k = Math.min((CELL - 4) / cell.width, (CELL - 4) / cell.height), w = cell.width * k, h = cell.height * k;
      g.fillStyle = '#000';
      g.fillRect(LABEL + x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
      // A checker shows transparency.
      g.drawImage(cell, LABEL + x * CELL + (CELL - w) / 2, y * CELL + (CELL - h) / 2, w, h);
    });
  });
  return c;
}

const RES_PICS = ['portrait', 'typography', 'landscape'];

export interface StillReport {
  id: string; name: string; category: string; errors: string[]; ms: number; msBig: number;
  /** Per picture: change from the input, output brightness spread, black / white share, alpha. */
  pics: Record<string, { change: number; mean: number; std: number; black: number; white: number; alpha: number }>;
  /** Preview (480) vs export (1440, scaled down) difference, per resolution-test picture. */
  res: Record<string, number>;
  /** Same frame rendered twice. */
  repeat: number;
}

function layersOf(e: EffectDefinition, params?: ParamValues): RenderLayer[] {
  return [{ effect: e, params: { ...defaultParams(e), ...params } }];
}

async function stills(opts: { from?: number; to?: number; ids?: string[]; params?: Record<string, ParamValues>; tag?: string } = {}) {
  const P = await testPictures();
  const list = opts.ids ? opts.ids.map((id) => getEffect(id)!).filter(Boolean) : LIBRARY.slice(opts.from ?? 0, opts.to ?? LIBRARY.length);
  const reports: StillReport[] = [];
  const rows: { label: string; cells: HTMLCanvasElement[] }[] = [{ label: 'Original', cells: P.map((p) => p.small) }];
  for (const e of list) {
    const rep: StillReport = { id: e.id, name: e.name, category: e.category, errors: [], ms: 0, msBig: 0, pics: {}, res: {}, repeat: 0 };
    const cells: HTMLCanvasElement[] = [];
    const layers = layersOf(e, opts.params?.[e.id]);
    P.forEach((p, n) => {
      const r = new FrameRenderer();
      try {
        // A different time per picture, so effects that keep state start afresh.
        const time = 3 + n * 10, frame = 72 + n * 240;
        const out = render(r, p.small, layers, time, frame);
        rep.ms = Math.max(rep.ms, out.ms);
        const o = flat(out.target), d = px(o), s = stats(px(out.target));
        const si = stats(px(p.small));
        // Black and white are counted beyond what the picture already had.
        rep.pics[p.name] = { change: +diff(d, px(flat(p.small))).toFixed(1), mean: +s.mean.toFixed(0), std: +s.std.toFixed(0), black: +Math.max(0, s.black - si.black).toFixed(2), white: +Math.max(0, s.white - si.white).toFixed(2), alpha: +s.alpha.toFixed(2) };
        cells.push(out.target);
        if (RES_PICS.includes(p.name)) {
          const big = render(new FrameRenderer(), p.big, layers, time, frame);
          rep.msBig = Math.max(rep.msBig, big.ms);
          rep.res[p.name] = +resDiff(out.target, big.target).toFixed(1);
        }
        if (p.name === 'portrait') {
          const again = render(new FrameRenderer(), p.small, layers, time, frame);
          rep.repeat = +diff(px(flat(again.target)), d).toFixed(1);
        }
      } catch (err) {
        rep.errors.push(`${p.name}: ${(err as Error).message}`);
        cells.push(canvas(4, 4));
      } finally { r.dispose(); }
    });
    rows.push({ label: e.name, cells });
    reports.push(rep);
    log(`${e.id}  ${rep.ms.toFixed(0)} ms  ${rep.errors.length ? 'ERR ' + rep.errors[0] : ''}`);
  }
  const tag = opts.tag ?? `stills-${String(opts.from ?? 0).padStart(3, '0')}`;
  for (let i = 0; i < rows.length; i += 12) await save(sheet(i ? [rows[0], ...rows.slice(i, i + 12)] : rows.slice(0, 13), P.length), `${tag}-${i / 12}.jpg`);
  await saveJson(reports, `${tag}.json`);
  return summarise(reports);
}

/** Only what looks wrong. */
function summarise(reports: StillReport[]) {
  const flags: string[] = [];
  for (const r of reports) {
    const f: string[] = [];
    if (r.errors.length) f.push(`errors: ${r.errors.join('; ')}`);
    const p = Object.entries(r.pics);
    const same = p.filter(([, v]) => v.change < 1.5).map(([k]) => k);
    if (same.length) f.push(`no change on ${same.join(',')}`);
    const blank = p.filter(([, v]) => v.std < 3).map(([k]) => k);
    if (blank.length) f.push(`flat on ${blank.join(',')}`);
    const crushed = p.filter(([, v]) => v.black > 0.35 || v.white > 0.35).map(([k, v]) => `${k}(${v.black > 0.35 ? 'black' : 'white'})`);
    if (crushed.length) f.push(`crushed: ${crushed.join(',')}`);
    const res = Object.entries(r.res).filter(([, v]) => v > 9).map(([k, v]) => `${k}=${v}`);
    if (res.length) f.push(`preview/export differ: ${res.join(',')}`);
    if (r.repeat > 2) f.push(`not repeatable (${r.repeat})`);
    if (r.ms > 250) f.push(`slow ${r.ms.toFixed(0)}ms@480`);
    if (f.length) flags.push(`${r.id}: ${f.join(' | ')}`);
  }
  return { count: reports.length, flagged: flags.length, flags };
}

/* ── Video ── */

let clips: { name: string; frames: HTMLCanvasElement[] }[] | null = null;
async function testClips() {
  if (clips) return clips;
  const mk = async (name: string, url: string, start: number) => {
    const v = document.createElement('video');
    v.src = url; v.muted = true;
    await new Promise((ok) => { v.onloadedmetadata = ok; });
    return { name, frames: await videoFramesSized(url, start, v.videoWidth, v.videoHeight) };
  };
  clips = [await mk('skate', '/showcase/video-3.mp4', 1.5), await mk('night', '/showcase/video-1.mp4', 0.5), await mk('wall', '/showcase/video-2.mp4', 0.5)];
  return clips;
}

async function videoFramesSized(url: string, start: number, vw: number, vh: number, count = 16, fps = 24) {
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.preload = 'auto';
  await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; });
  const k = SMALL / Math.max(vw, vh), w = Math.round(vw * k), h = Math.round(vh * k);
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < count; i++) {
    v.currentTime = start + i / fps;
    await new Promise((ok) => { v.onseeked = ok; });
    const c = canvas(w, h);
    ctx(c).drawImage(v, 0, 0, w, h);
    out.push(c);
  }
  return out;
}

async function video(opts: { from?: number; to?: number; ids?: string[]; tag?: string } = {}) {
  const C = await testClips();
  const list = opts.ids ? opts.ids.map((id) => getEffect(id)!).filter(Boolean) : LIBRARY.slice(opts.from ?? 0, opts.to ?? LIBRARY.length);
  const rows: { label: string; cells: HTMLCanvasElement[] }[] = [{ label: 'Original', cells: C.flatMap((c) => [c.frames[0], c.frames[15]]) }];
  const flags: string[] = [];
  const reports: Record<string, unknown>[] = [];
  for (const e of list) {
    const cells: HTMLCanvasElement[] = [];
    const rep: Record<string, unknown> = { id: e.id };
    const errs: string[] = [];
    let worst = 0;
    C.forEach((clip, n) => {
      const r = new FrameRenderer();
      let prevOut: Uint8ClampedArray | null = null, prevIn: Uint8ClampedArray | null = null, flick = 0, motion = 0, ms = 0;
      try {
        clip.frames.forEach((f, i) => {
          const out = render(r, f, layersOf(e), 100 + n * 50 + i / 24, 2400 + n * 1200 + i);
          ms = Math.max(ms, out.ms);
          const d = px(flat(out.target)), di = px(f);
          if (prevOut && prevIn) { flick += diff(d, prevOut); motion += diff(di, prevIn); }
          prevOut = d; prevIn = di;
          if (i === 0 || i === 15) cells.push(out.target);
        });
      } catch (err) { errs.push(`${clip.name}: ${(err as Error).message}`); while (cells.length < (n + 1) * 2) cells.push(canvas(4, 4)); }
      finally { r.dispose(); }
      // How much the output changes frame to frame, against how much the input does.
      const ratio = motion ? flick / motion : 0;
      rep[clip.name] = { ratio: +ratio.toFixed(2), flick: +(flick / 15).toFixed(1), ms: +ms.toFixed(0) };
      worst = Math.max(worst, ratio);
    });
    rows.push({ label: e.name, cells });
    rep.errors = errs;
    reports.push(rep);
    const f: string[] = [];
    if (errs.length) f.push(`errors: ${errs.join('; ')}`);
    if (worst > 4) f.push(`flickers ${worst.toFixed(1)}× the input motion`);
    if (f.length) flags.push(`${e.id}: ${f.join(' | ')}`);
    log(`video ${e.id} ${worst.toFixed(2)}`);
  }
  const tag = opts.tag ?? `video-${String(opts.from ?? 0).padStart(3, '0')}`;
  for (let i = 0; i < rows.length; i += 12) await save(sheet(i ? [rows[0], ...rows.slice(i, i + 12)] : rows.slice(0, 13), 6), `${tag}-${i / 12}.jpg`);
  await saveJson(reports, `${tag}.json`);
  return { count: list.length, flags };
}

/** One row per preset of an effect (and its defaults), at a few moments in time. */
async function presets(id: string, times = [0.5, 2, 4]) {
  const P = await testPictures(), e = getEffect(id)!;
  const pics = [P[0], P[1], P[4], P[7]];
  const rows: { label: string; cells: HTMLCanvasElement[] }[] = [];
  const list = [{ name: 'Defaults', values: {} as ParamValues }, ...(e.presets ?? [])];
  const timing: string[] = [];
  for (const pr of list) {
    const cells: HTMLCanvasElement[] = [];
    let worst = 0;
    for (const pic of pics) {
      const r = new FrameRenderer();
      // Played from the start, frame by frame, like a preview or an export.
      let last: HTMLCanvasElement | null = null;
      for (let f = 0; f <= Math.round(times[times.length - 1] * 12); f++) {
        const t = f / 12, out = render(r, pic.small, layersOf(e, pr.values), t, f);
        worst = Math.max(worst, out.ms);
        if (times.some((x) => Math.abs(x - t) < 1e-6)) { last = out.target; if (pic === pics[0]) cells.push(last); }
      }
      if (pic !== pics[0] && last) cells.push(last);
      r.dispose();
    }
    rows.push({ label: pr.name, cells });
    timing.push(`${pr.name}: ${worst.toFixed(0)}ms`);
  }
  await save(sheet(rows, rows[0].cells.length), `presets-${id}.jpg`);
  return timing;
}

/**
 * The audio engine on a synthetic track: a kick on every half second, a
 * snare-like noise burst between them, and a steady bass tone. Reads it with
 * the export's own analysis (OfflineBands) and reports when beats and hits
 * fired, and how fast the bass envelope rises and falls.
 */
async function audioTest() {
  const { OfflineBands } = await import('../src/export/offline');
  const { audioTuning } = await import('../src/engine/audio');
  const rate = 44100, dur = 4, n = rate * dur, ctxA = new OfflineAudioContext(1, n, rate), buf = ctxA.createBuffer(1, n, rate), d = buf.getChannelData(0);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate, kb = t % 0.5, sb = (t + 0.25) % 0.5;
    const kick = kb < 0.15 ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-kb * 30)) * kb) * Math.exp(-kb * 18) : 0;
    const snare = sb < 0.08 ? rnd() * Math.exp(-sb * 45) * 0.5 : 0;
    d[i] = kick * 0.9 + snare + Math.sin(2 * Math.PI * 220 * t) * 0.05;
  }
  const run = (patch: Record<string, number>) => {
    const old = { ...audioTuning.value };
    audioTuning.value = { ...old, ...patch };
    const ob = new OfflineBands(buf), beats: number[] = [], hits: number[] = [];
    let lastB = 0, lastH = 0, rise = -1, peakAt = -1, fallTo50 = -1, peak = 0;
    for (let f = 0; f < dur * 60; f++) {
      const t = f / 60, b = ob.at(t, 1 / 60);
      if (b.beat > 0.5 && lastB <= 0.5) beats.push(+t.toFixed(2));
      if (b.hit > 0.5 && lastH <= 0.5) hits.push(+t.toFixed(2));
      lastB = b.beat; lastH = b.hit;
      // Envelope shape around the kick at 2.0 s.
      if (t >= 2 && t < 2.5) {
        if (rise < 0 && b.bass > 0.5) rise = t;
        if (b.bass > peak) { peak = b.bass; peakAt = t; }
        if (peakAt > 0 && fallTo50 < 0 && b.bass < peak * 0.5) fallTo50 = t;
      }
    }
    audioTuning.value = old;
    return { beats, hits, bassRiseAt: rise, bassPeakAt: peakAt, bassHalfAt: fallTo50 };
  };
  return { fast: run({ attack: 5, release: 80 }), slow: run({ attack: 60, release: 600 }), defaults: run({}) };
}

/** Runs the whole library in chunks in the background; poll qa.status. */
function all(kind: 'stills' | 'video', size = 30, prefix?: string) {
  qa.status = 'running';
  void (async () => {
    const flags: string[] = [];
    for (let a = 0; a < LIBRARY.length; a += size) {
      const tag = `${prefix ?? kind}-${String(a).padStart(3, '0')}`;
      const r = kind === 'stills' ? await stills({ from: a, to: a + size, tag }) : await video({ from: a, to: a + size, tag });
      flags.push(...r.flags);
      qa.status = `running ${a + size}/${LIBRARY.length}`;
    }
    qa.flags = flags;
    qa.status = 'done';
  })().catch((e) => { qa.status = `failed: ${(e as Error).message}`; });
}

const qa = { stills, video, all, presets, audioTest, testPictures, status: 'idle', flags: [] as string[], library: () => LIBRARY.map((e, i) => `${i} ${e.id}`) };
(window as unknown as { qa: typeof qa }).qa = qa;
log(`Ready. ${LIBRARY.length} effects.`);
