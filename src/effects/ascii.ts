import type { EffectDefinition } from './types';
import { adjust, cellAverages, createCanvas, get2d, hexToRgb, luminance } from '../utils/imageProcessing';

const CHARSETS: Record<string, string> = {
  standard: ' .:-=+*#%@',
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
  dots: ' ·∙•●',
  binary: ' 01',
  lines: ' -=≡',
  braille: '⠀⠁⠃⠇⠏⠟⠿⡿⣿',
  shapes: ' ·◦○◐◑●■',
  arrows: ' ←↖↑↗→↘↓↙',
  katakana: ' ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺ',
  math: ' ·∘∙+×÷=≠≈∞∑∫',
};

const FONTS: Record<string, string> = {
  mono: "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace",
  sans: "'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  gothic: "'Yu Gothic', 'MS Gothic', 'Noto Sans JP', sans-serif",
};

/** Sort glyphs by the ink they really put on screen, so any font maps correctly. */
const rampCache = new Map<string, string[]>();
function measuredRamp(chars: string, font: string): string[] {
  const key = `${font}|${chars}`;
  const hit = rampCache.get(key);
  if (hit) return hit;
  const list = [...new Set([...chars])];
  const c = createCanvas(24, 24);
  const g = get2d(c, true);
  g.font = `20px ${FONTS[font] ?? FONTS.mono}`;
  g.textBaseline = 'top';
  const ink = list.map((ch) => {
    g.clearRect(0, 0, 24, 24);
    g.fillText(ch, 2, 1);
    const d = g.getImageData(0, 0, 24, 24).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return { ch, s };
  });
  const out = ink.sort((a, b) => a.s - b.s).map((x) => x.ch);
  if (rampCache.size > 40) rampCache.clear();
  rampCache.set(key, out);
  return out;
}

/** Per-cell tone memory, so characters don't flicker on video. */
let memory: { key: string; tone: Float32Array } | null = null;

/**
 * ASCII: a fixed character grid whose glyphs are picked by measured ink
 * density. The grid never moves, and tone is smoothed over time, keeping
 * video stable.
 */
export const ascii: EffectDefinition = {
  id: 'ascii',
  name: 'ASCII Renderer',
  category: 'type',
  description: 'Rebuild the image from characters: ASCII, Unicode or your own text.',
  supportsTransparency: true,
  audioDefaults: { size: { band: 'bass', amount: 0.15 }, brightness: { band: 'level', amount: 0.3 } },
  params: [
    {
      key: 'charset', label: 'Character Set', type: 'select', group: 'Glyphs', default: 'standard',
      options: [
        { value: 'standard', label: 'Standard ASCII' }, { value: 'detailed', label: 'Detailed ASCII' }, { value: 'blocks', label: 'Blocks' },
        { value: 'dots', label: 'Dots' }, { value: 'binary', label: 'Binary' }, { value: 'lines', label: 'Lines' }, { value: 'braille', label: 'Braille' },
        { value: 'shapes', label: 'Unicode Shapes' }, { value: 'arrows', label: 'Arrows' }, { value: 'katakana', label: 'Katakana' }, { value: 'math', label: 'Math' },
        { value: 'custom', label: 'Custom Characters' }, { value: 'sequence', label: 'Sequence (Text)' },
      ],
    },
    {
      key: 'text', label: 'Custom Characters', type: 'text', group: 'Glyphs', default: 'AIRFX ', maxLength: 120,
      hint: 'Custom: any characters, auto-sorted by ink density. Sequence: text repeated across the image.',
      visibleWhen: (v) => v.charset === 'custom' || v.charset === 'sequence',
    },
    { key: 'font', label: 'Font Family', type: 'select', group: 'Glyphs', default: 'mono', options: [{ value: 'mono', label: 'Mono' }, { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'gothic', label: 'Gothic' }] },
    { key: 'bold', label: 'Bold', type: 'toggle', group: 'Glyphs', default: false },
    { key: 'size', label: 'Cell Size', type: 'range', group: 'Grid', min: 4, max: 60, step: 0.5, default: 12 },
    { key: 'fontScale', label: 'Font Size', type: 'range', group: 'Grid', min: 0.4, max: 2, step: 0.01, default: 1, unit: '×' },
    { key: 'spacing', label: 'Character Spacing', type: 'range', group: 'Grid', min: 0.3, max: 2, step: 0.01, default: 0.6, hint: 'Cell width as a fraction of the cell height.' },
    { key: 'density', label: 'Character Density', type: 'range', group: 'Grid', min: 0, max: 1, step: 0.01, default: 1, hint: 'Below 100% the darkest cells drop out.' },
    { key: 'offset', label: 'Character Offset', type: 'range', group: 'Grid', min: 0, max: 1, step: 0.01, default: 0, hint: 'Shifts where in the ramp each tone lands; animate it with audio.' },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Brightness Mapping', min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Brightness Mapping', min: -0.6, max: 0.6, step: 0.01, default: 0 },
    { key: 'gamma', label: 'Mapping Curve', type: 'range', group: 'Brightness Mapping', min: 0.3, max: 3, step: 0.01, default: 1 },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Brightness Mapping', default: false },
    { key: 'stability', label: 'Video Stability', type: 'range', group: 'Brightness Mapping', min: 0, max: 0.95, step: 0.01, default: 0.5, hint: 'Smooths tone over time so glyphs do not flicker.' },
    {
      key: 'colorMode', label: 'Color Mode', type: 'select', group: 'Color', default: 'original',
      options: [{ value: 'original', label: 'Original' }, { value: 'mono', label: 'Mono' }, { value: 'custom', label: 'Custom' }],
    },
    { key: 'color', label: 'Text Color', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => v.colorMode === 'custom' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0a0a0a' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ srcCanvas, ctx, width, height, params, unit, time }) {
    const size = Math.max(3, (params.size as number) * unit);
    const cw = size * (params.spacing as number), ch = size;
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, cw, ch);
    const mode = params.charset as string;
    const custom = (params.text as string) || ' ';
    const font = params.font as string;
    const ramp = measuredRamp(mode === 'custom' || mode === 'sequence' ? ` ${custom}` : CHARSETS[mode] ?? CHARSETS.standard, font);
    const sequence = mode === 'sequence';
    const seqChars = [...custom];
    const contrast = params.contrast as number, brightness = params.brightness as number, gi = 1 / (params.gamma as number);
    const invert = params.invert as boolean, colorMode = params.colorMode as string;
    const density = params.density as number, offset = params.offset as number, stab = params.stability as number;

    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = params.background as string;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.font = `${params.bold ? 700 : 400} ${size * (params.fontScale as number)}px ${FONTS[font] ?? FONTS.mono}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = params.color as string;

    const bg = hexToRgb(params.background as string);
    const bgLight = !params.transparent && luminance(bg[0], bg[1], bg[2]) > 0.5;

    const key = `${cols}x${rows}`;
    if (!memory || memory.key !== key) memory = { key, tone: new Float32Array(cols * rows).fill(-1) };
    const mem = memory.tone;
    const smooth = time > 0 ? stab : 0;

    let seq = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c, i = k * 4;
        let t = adjust(luminance(data[i], data[i + 1], data[i + 2]), brightness, contrast) ** gi;
        if (mem[k] >= 0 && smooth > 0) t = mem[k] * smooth + t * (1 - smooth);
        mem[k] = t;
        const tone = t;
        if (bgLight !== invert) t = 1 - t;
        let glyph: string;
        if (sequence) {
          glyph = seqChars[seq++ % seqChars.length];
          if (t < 0.08 || glyph === ' ') continue;
          ctx.globalAlpha = Math.min(1, t * 1.2);
        } else {
          if (t < 1 - density) continue;
          const pos = ((t + offset) % 1.0001) * ramp.length;
          glyph = ramp[Math.min(ramp.length - 1, Math.floor(pos))];
          if (glyph === ' ' || glyph === '⠀') continue;
        }
        if (colorMode === 'original') ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        else if (colorMode === 'mono') {
          const v = Math.round(tone * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        }
        ctx.fillText(glyph, c * cw, r * ch);
      }
    }
    ctx.globalAlpha = 1;
  },
};
