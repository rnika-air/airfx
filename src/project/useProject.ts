import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioReactor, AudioState } from '../engine/audio';
import { assetStore, type Asset } from '../engine/assets';
import { fonts } from '../content/fonts';
import type { EffectSnapshot } from '../hooks/useEffectState';
import type { LoadedMedia } from '../hooks/useMedia';
import type { Composition } from '../timeline/model';
import { downloadBlob } from '../utils/exportUtils';
import { isUsableDoc, PROJECT_EXT, readProjectFile, writeProjectFile, type ProjectDoc } from './format';
import { clearAutosave, getBlob, loadAutosave, writeAutosave } from './storage';

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'off' };

interface Options {
  name: string;
  setName: (n: string) => void;
  mode: ProjectDoc['mode'];
  setMode: (m: ProjectDoc['mode']) => void;
  effects: EffectSnapshot;
  restoreEffects: (s: EffectSnapshot) => void;
  comp: Composition;
  replaceComp: (c: Composition) => void;
  media: LoadedMedia | null;
  loadMedia: (f: File) => Promise<void>;
  clearMedia: () => void;
  reactor: AudioReactor;
  audio: AudioState;
  assets: Asset[];
}

const AUTOSAVE_MS = 1500;
const safe = (s: string) => s.replace(/[^\w.\-]+/g, '_').slice(0, 60);

/**
 * Project persistence:
 *  • Save / Open a single .airfx file (document + all media bytes)
 *  • Autosave to IndexedDB, offered back on the next visit
 */
export function useProject(o: Options) {
  const latest = useRef(o);
  latest.current = o;
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [offer, setOffer] = useState<ProjectDoc | null>(null);
  const [enabled, setEnabled] = useState(false);
  const busy = useRef(false);

  /* ── build ── */

  const studioRef = (m: LoadedMedia) => `studio:${m.size}:${safe(m.name)}`;
  const songRef = (name: string, size: number) => `song:${size}:${safe(name)}`;

  const buildDoc = useCallback((): { doc: ProjectDoc; refs: string[] } => {
    const s = latest.current;
    const refs: string[] = [];
    const studioMedia = s.media ? { ref: studioRef(s.media), name: s.media.name, mime: s.media.mime } : null;
    if (studioMedia) refs.push(studioMedia.ref);
    const assets = s.assets.map((a) => ({ id: a.id, name: a.name, mime: a.mime }));
    refs.push(...assets.map((a) => a.id));
    const fontList = fonts.loaded.map((f) => ({ ref: `font:${f.family}`, name: f.file.name }));
    refs.push(...fontList.map((f) => f.ref));
    let song: ProjectDoc['song'] = null;
    if (s.audio.kind === 'file' && s.reactor.sourceFile) {
      song = { kind: 'file', ref: songRef(s.audio.name, s.reactor.sourceFile.size), name: s.audio.name, mime: s.reactor.sourceFile.mime };
      refs.push(song.ref);
    } else if (s.audio.kind === 'url' && s.reactor.sourceUrl) {
      song = { kind: 'url', url: s.reactor.sourceUrl, name: s.audio.name };
    }
    const doc: ProjectDoc = {
      app: 'airfx', version: 1, savedAt: Date.now(), name: s.name, mode: s.mode,
      effects: s.effects, comp: s.comp, studioMedia, assets, fonts: fontList, song,
    };
    return { doc, refs };
  }, []);

  /** Bytes for any ref in the current (live) project. */
  const liveBlob = useCallback(async (ref: string): Promise<Blob | null> => {
    const s = latest.current;
    const a = assetStore.get(ref);
    if (a) return a.blob;
    if (ref.startsWith('font:')) return fonts.loaded.find((f) => `font:${f.family}` === ref)?.file ?? null;
    if (s.media && ref === studioRef(s.media)) return (await fetch(s.media.url)).blob();
    if (ref.startsWith('song:') && s.reactor.sourceUrl) return (await fetch(s.reactor.sourceUrl)).blob();
    return null;
  }, []);

  /* ── apply ── */

  const applyDoc = useCallback(async (doc: ProjectDoc, blobFor: (ref: string) => Promise<Blob | null>): Promise<string[]> => {
    if (!isUsableDoc(doc)) throw new Error('This project file could not be read.');
    const s = latest.current;
    busy.current = true;
    const missing: string[] = [];
    try {
      assetStore.clear();
      for (const a of doc.assets ?? []) {
        const b = await blobFor(a.id);
        if (!b) { missing.push(a.name); continue; }
        try {
          await assetStore.addFile(new File([b], a.name, { type: a.mime || b.type }), a.name, a.id);
        } catch {
          missing.push(a.name);
        }
      }
      // Fonts first, so the first frame after opening is drawn in the right one.
      for (const f of doc.fonts ?? []) {
        const b = await blobFor(f.ref);
        if (!b) { missing.push(f.name); continue; }
        try { await fonts.add(new File([b], f.name)); } catch { missing.push(f.name); }
      }
      // Pre-stack projects kept audio links beside the effect; the migration folds them in.
      s.restoreEffects({ ...doc.effects, legacyMods: doc.mods } as EffectSnapshot);
      s.replaceComp(doc.comp);
      s.setName(doc.name || 'Untitled Study');
      if (doc.studioMedia) {
        const b = await blobFor(doc.studioMedia.ref);
        if (b) await s.loadMedia(new File([b], doc.studioMedia.name, { type: doc.studioMedia.mime || b.type }));
        else { missing.push(doc.studioMedia.name); s.clearMedia(); }
      } else s.clearMedia();
      if (doc.song?.kind === 'file') {
        const b = await blobFor(doc.song.ref);
        if (b) await s.reactor.loadFile(new File([b], doc.song.name, { type: doc.song.mime || b.type }));
        else { missing.push(doc.song.name); s.reactor.clear(); }
      } else if (doc.song?.kind === 'url') {
        await s.reactor.loadUrl(doc.song.url);
      } else s.reactor.clear();
      s.setMode(doc.mode ?? 'effects');
    } finally {
      busy.current = false;
    }
    return missing;
  }, []);

  /* ── file save / open ── */

  /** The whole project as one .airfx file: for downloading or for cloud projects. */
  const buildFile = useCallback(async () => {
    const { doc, refs } = buildDoc();
    const blobs = new Map<string, Blob>();
    for (const r of refs) {
      const b = await liveBlob(r);
      if (b) blobs.set(r, b);
    }
    return { doc, file: await writeProjectFile(doc, blobs) };
  }, [buildDoc, liveBlob]);

  const saveToFile = useCallback(async () => {
    const { doc, file } = await buildFile();
    const fname = `${safe(doc.name || 'airfx') || 'airfx'}${PROJECT_EXT}`;
    downloadBlob(file, fname);
    return { name: fname, size: file.size };
  }, [buildFile]);

  const openFile = useCallback(async (file: File) => {
    const { doc, blobs } = await readProjectFile(file);
    return applyDoc(doc, async (ref) => blobs.get(ref) ?? null);
  }, [applyDoc]);

  /* ── autosave ── */

  // On startup: offer the previous session if it had content.
  useEffect(() => {
    let cancelled = false;
    loadAutosave().then((doc) => {
      if (cancelled) return;
      const hasContent = doc && isUsableDoc(doc) && (doc.comp.layers.length > 0 || doc.studioMedia || doc.assets.length > 0 || doc.song);
      if (hasContent) setOffer(doc);
      else setEnabled(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Restore the offered session; the banner stays up (to show warnings) until closeOffer(). */
  const restoreOffer = useCallback(async () => {
    if (!offer) return [];
    try {
      return await applyDoc(offer, getBlob);
    } finally {
      setEnabled(true);
    }
  }, [offer, applyDoc]);

  const closeOffer = useCallback(() => setOffer(null), []);

  const discardOffer = useCallback(async () => {
    setOffer(null);
    await clearAutosave();
    setEnabled(true);
  }, []);

  const { name, mode, effects, comp, media, audio, assets } = o;
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(async () => {
      if (busy.current) return;
      const { doc, refs } = buildDoc();
      setStatus({ kind: 'saving' });
      try {
        await writeAutosave(doc, liveBlob, refs);
        setStatus({ kind: 'saved', at: Date.now() });
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message || 'Autosave failed' });
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [enabled, name, mode, effects, comp, media, audio.kind, audio.name, assets, buildDoc, liveBlob]);

  return { status, offer, restoreOffer, closeOffer, discardOffer, saveToFile, openFile, buildFile };
}
