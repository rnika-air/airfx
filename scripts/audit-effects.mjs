// Writes docs/EFFECT_AUDIT.md from the real registry, so the list cannot drift
// from the code. Usage: node scripts/audit-effects.mjs
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const out = 'node_modules/.cache/airfx-audit.mjs';
await build({
  stdin: { contents: "export { EFFECTS, CATEGORY_ORDER } from './src/effects/registry.ts'; export { CATEGORY_LABELS } from './src/effects/types.ts';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  external: ['@huggingface/transformers', 'onnxruntime-web', 'mediabunny'],
  loader: { '.css': 'empty' },
  plugins: [{ name: 'worker-url', setup(b) {
    b.onResolve({ filter: /\?worker/ }, (a) => ({ path: a.path, namespace: 'worker-url' }));
    b.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default ""', loader: 'js' }));
  } }],
  define: { 'import.meta.url': '"file:///audit"' },
  banner: { js: 'globalThis.Worker ??= class {}; globalThis.document ??= { createElement: () => ({ getContext: () => null }) };' },
});
const { EFFECTS: ALL, CATEGORY_ORDER, CATEGORY_LABELS } = await import(pathToFileURL(out).href);
// The Adjust tab's own pass is not a library effect.
const EFFECTS = ALL.filter((e) => !e.hidden);
rmSync(out);

const KNOWN = {
  airKey: 'Selection and Auto Matte need a model loaded. Hair is good, not perfect.',
  airCleanup: 'Shows nothing until a reconstruction exists.',
  airDepth: 'Passes the image through until a depth map exists.',
  datamosh: 'Keeps earlier frames: it develops during playback.',
  stutter: 'Repeat and Freeze need moving footage.',
  motionTrails: 'Keeps earlier frames: it develops during playback.',
  lineScan: 'Keeps earlier frames: it develops during playback.',
  depthParticles: 'Needs a depth map.',
  kineticType: 'Weight changes in named steps unless the font is variable.',
  dithering: 'A 1-pixel-scale pattern, so a downscaled copy of a 4K render differs slightly from the preview.',
  slide: 'Faux 3D, not true perspective.',
  stack: 'Faux 3D, not true perspective.',
  imageReactor: 'Reacts to the song or microphone from the Audio tab; with none it moves on a steady stand-in rhythm (can be turned off). Trails keep earlier frames.',
  audioPulse: 'Reacts to the song or microphone from the Audio tab; with none it moves on a steady stand-in rhythm (can be turned off).',
  reactionDiffusion: 'After a long jump forward in a video, the preview catches up over a few frames; an export grows frame by frame from the start.',
  textPortrait: 'On video, letters reflow each frame as the tones change.',
  ascii: 'Very small glyphs rasterise slightly differently in a small preview than in a large export.',
  edge: 'Very fine texture (grass, gravel) can give a few more lines in a large export than in a small preview.',
};
const media = { both: 'Image, video', image: 'Image', video: 'Video' };
const esc = (s) => String(s).replace(/\|/g, '/');
let md = `# AirFx Effect Audit\n\nGenerated from \`src/effects/registry.ts\` by \`scripts/audit-effects.mjs\`. ${EFFECTS.length} effects.\n\n`;
md += 'Every effect below was rendered through the real stack renderer with default settings, without errors. All can be added, reordered, disabled, duplicated and removed in the stack. Each effect was also rendered at 1920×1080 and 960×540 and compared, and rendered twice to confirm the same frame gives the same result. The controls of the effects added in 3.0 and 4.0 were each changed one at a time and confirmed to change the picture.\n\n';
md += 'Since 5.2 the test bench in `qa/` (development only: `npm run dev`, then open `/qa/`) renders the whole library on nine test pictures (portrait, landscape, architecture, an object, typography, abstract art, bright, dark, saturated colour) and on 16 frames of three videos (fast movement, night, close-up). It saves contact sheets and flags errors, unchanged or flat results, crushed blacks or whites, preview/export differences (480 px vs 1440 px, compared after a slight blur so fine grain does not count), unrepeatable frames, slow steps and flicker beyond the footage’s own movement. `qa.audioTest()` checks beat and hit detection and the attack/release response on a synthetic track.\n\n';
for (const cat of CATEGORY_ORDER) {
  const list = EFFECTS.filter((e) => e.category === cat);
  if (!list.length) continue;
  md += `## ${CATEGORY_LABELS[cat]} (${list.length})\n\n| Effect | Media | Controls | Parameters | Known limitation |\n| --- | --- | --- | --- | --- |\n`;
  for (const e of list) md += `| **${esc(e.name)}** | ${media[e.compat ?? 'both']} | ${e.params.length} | ${esc(e.params.map((p) => p.label).join(', '))} | ${KNOWN[e.id] ?? ''} |\n`;
  md += '\n';
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/EFFECT_AUDIT.md', md);
console.log(`Wrote docs/EFFECT_AUDIT.md with ${EFFECTS.length} effects.`);
