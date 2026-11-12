/** Fonts for the content system. Files stay in memory and in your project, and are never uploaded. */

export const BUILTIN_FONTS: [string, string][] = [
  ['Arial, Helvetica, sans-serif', 'Sans'],
  ['"Arial Black", Impact, sans-serif', 'Heavy Sans'],
  ['Impact, "Arial Narrow", sans-serif', 'Impact'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['"Trebuchet MS", sans-serif', 'Trebuchet'],
  ['Georgia, serif', 'Georgia'],
  ['"Times New Roman", serif', 'Times'],
  ['"Courier New", monospace', 'Courier'],
  ['Consolas, monospace', 'Consolas'],
  ['"Segoe Script", cursive', 'Script'],
];

class FontStore {
  /** The file is kept so a saved project can carry the font with it. */
  loaded: { family: string; name: string; file: File }[] = [];
  private listeners = new Set<() => void>();
  version = 0;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getVersion = () => this.version;

  /** Loads a TTF, OTF, WOFF or WOFF2 file. Returns the CSS family to use. */
  async add(file: File): Promise<string> {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error(`"${file.name}" is not a font file. Use TTF, OTF, WOFF or WOFF2.`);
    const name = file.name.replace(/\.[^.]+$/, '');
    const family = `AirFx ${name.replace(/[^\w -]+/g, ' ').trim() || 'Font'}`;
    const face = new FontFace(family, await file.arrayBuffer());
    try {
      await face.load();
    } catch {
      throw new Error(`"${file.name}" could not be read as a font.`);
    }
    document.fonts.add(face);
    if (!this.loaded.some((f) => f.family === family)) this.loaded = [...this.loaded, { family, name, file }];
    this.version++;
    this.listeners.forEach((f) => f());
    return `"${family}"`;
  }
}

export const fonts = new FontStore();

/** An uploaded family that this session does not have, for example after reopening a project. */
export function fontMissing(css: string) {
  const m = /^"(AirFx [^"]+)"/.exec(css);
  return !!m && !fonts.loaded.some((f) => f.family === m[1]);
}

/** Resolves once a font can be drawn. Text would otherwise use a fallback on the first frames. */
export async function ensureFont(css: string, weight: number) {
  if (!css) return;
  try { await document.fonts.load(`${weight} 40px ${css}`, 'Ag'); } catch { /* system fonts need no loading */ }
}
