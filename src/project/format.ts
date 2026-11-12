import type { ModMap } from '../effects/types';
import type { EffectSnapshot } from '../hooks/useEffectState';
import type { Composition } from '../timeline/model';

/**
 * Everything needed to reopen a project. Media bytes are not inside the
 * document; it references them by id, and they travel alongside (in the
 * .airfx file, or as separate IndexedDB records for autosave).
 */
export interface ProjectDoc {
  /** 'airffect' = projects saved before the rename to AirFx */
  app: 'airfx' | 'airffect';
  version: 1;
  savedAt: number;
  name: string;
  mode: 'effects' | 'key' | 'cleanup' | 'depth' | 'timeline';
  effects: EffectSnapshot;
  /** Audio links of pre-stack projects; newer projects keep them on each stack step. */
  mods?: Record<string, ModMap>;
  comp: Composition;
  /** media open in the Effects workspace */
  studioMedia: { ref: string; name: string; mime: string } | null;
  /** asset bin: images / videos used by cards and timeline layers */
  assets: { id: string; name: string; mime: string }[];
  /** Uploaded font files, stored like any other media. Older projects have none. */
  fonts?: { ref: string; name: string }[];
  song: { kind: 'file'; ref: string; name: string; mime: string } | { kind: 'url'; url: string; name: string } | null;
}

export interface BlobEntry {
  id: string;
  mime: string;
  size: number;
}

const MAGIC = 'AIRFX-PROJECT/1\n';
/** Magic of files written before the rename — still readable. */
const LEGACY_MAGIC = 'AIRFFECT-PROJECT/1\n';
export const PROJECT_EXT = '.airfx';
export const PROJECT_ACCEPT = '.airfx,.airffect,application/x-airfx';

/**
 * Binary container: magic line, uint32 header length (LE), UTF-8 JSON
 * header, then the media blobs back to back in header order. Raw bytes keep
 * the file roughly the size of the media itself (no base64 inflation).
 */
export async function writeProjectFile(doc: ProjectDoc, blobs: Map<string, Blob>): Promise<Blob> {
  const entries: BlobEntry[] = [...blobs].map(([id, b]) => ({ id, mime: b.type, size: b.size }));
  const header = new TextEncoder().encode(JSON.stringify({ doc, blobs: entries }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length, true);
  return new Blob([MAGIC, len, header, ...blobs.values()], { type: 'application/x-airfx' });
}

export async function readProjectFile(file: Blob): Promise<{ doc: ProjectDoc; blobs: Map<string, Blob> }> {
  const probe = new TextDecoder().decode(await file.slice(0, LEGACY_MAGIC.length).arrayBuffer());
  const magic = [MAGIC, LEGACY_MAGIC].find((m) => probe.startsWith(m));
  if (!magic) throw new Error('This is not an AirFx project file.');
  const magicLen = new TextEncoder().encode(magic).length;
  const head = new Uint8Array(await file.slice(0, magicLen + 4).arrayBuffer());
  const hLen = new DataView(head.buffer).getUint32(magicLen, true);
  const hStart = magicLen + 4;
  if (hLen <= 0 || hStart + hLen > file.size) throw new Error('The project file is damaged (bad header).');
  let parsed: { doc: ProjectDoc; blobs: BlobEntry[] };
  try {
    parsed = JSON.parse(new TextDecoder().decode(await file.slice(hStart, hStart + hLen).arrayBuffer()));
  } catch {
    throw new Error('The project file is damaged (unreadable header).');
  }
  if (parsed?.doc?.app !== 'airfx' && parsed?.doc?.app !== 'airffect') throw new Error('This is not an AirFx project file.');
  if (parsed.doc.version > 1) throw new Error('This project was saved by a newer version of AirFx.');
  const blobs = new Map<string, Blob>();
  let off = hStart + hLen;
  for (const e of parsed.blobs) {
    if (off + e.size > file.size) throw new Error('The project file is incomplete — some media is missing.');
    blobs.set(e.id, file.slice(off, off + e.size, e.mime));
    off += e.size;
  }
  return { doc: parsed.doc, blobs };
}

/** Light shape check so a hand-edited or partial doc can't crash the app. */
export function isUsableDoc(d: ProjectDoc): boolean {
  return !!d && typeof d.name === 'string' && !!d.comp && Array.isArray(d.comp.layers) && typeof d.comp.width === 'number' && !!d.effects;
}
