import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TopBar, type AppMode } from '../../components/TopBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { AudioReactor, AudioState } from '../../engine/audio';
import { assetStore, type Asset } from '../../engine/assets';
import { cloneLayer, newEffectLayer, newMediaLayer, newShapeLayer, newTextLayer, type Layer } from '../model';
import type { CompositionApi } from '../useComposition';
import { useCompPlayback } from '../useCompPlayback';
import { CompExportDialog } from './CompExportDialog';
import { LayerInspector } from './LayerInspector';
import { TimelineLibrary } from './TimelineLibrary';
import { TimelinePanel } from './TimelinePanel';
import { TimelineStage } from './TimelineStage';

interface Props {
  api: CompositionApi;
  reactor: AudioReactor;
  audio: AudioState;
  onMode: (m: AppMode) => void;
  projectName: string;
  onProjectName: (n: string) => void;
  studioMedia: { name: string; url: string; mime: string } | null;
  projectMenu?: ReactNode;
}

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'button', 'file'].includes((el as HTMLInputElement).type);
}

const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(f.name);

/** After-Effects-style composition editor, simplified. */
export function TimelineMode({ api, reactor, audio, onMode, projectName, onProjectName, studioMedia, projectMenu }: Props) {
  const { comp } = api;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pb = useCompPlayback(comp.duration, reactor, audio);
  const selected = comp.layers.find((l) => l.id === selectedId) ?? null;
  const hasSong = (audio.kind === 'file' || audio.kind === 'url') && !!reactor.sourceUrl;

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __tl: unknown }).__tl = { comp, time: pb.time, selectedId };
  });

  // Stop the timeline clock when leaving the workspace.
  const { pause } = pb;
  useEffect(() => () => pause(), [pause]);

  // A ref so several layers added in one go (multi-file import) stack in order.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const addLayer = useCallback(
    (l: Layer | null) => {
      if (!l) return;
      const above = selectedRef.current;
      api.apply((c) => {
        const i = c.layers.findIndex((x) => x.id === above);
        const layers = [...c.layers];
        layers.splice(i >= 0 ? i + 1 : layers.length, 0, l);
        return { ...c, layers };
      });
      selectedRef.current = l.id;
      setSelectedId(l.id);
      // Show the new layer fully on screen rather than at the first frame of its intro.
      if (!pb.playing && l.anim.animIn !== 'none' && l.kind !== 'effect') {
        pb.setTime(Math.min(l.end - 0.01, l.start + (l.anim.inDur as number) + 0.05));
      }
    },
    [api, pb],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      for (const f of files) {
        if (isAudio(f)) {
          reactor.loadFile(f);
          continue;
        }
        try {
          const a = await assetStore.addFile(f);
          addLayer(newMediaLayer(api.comp, pb.timeRef.current, a));
        } catch (e) {
          setError((e as Error).message);
        }
      }
    },
    [addLayer, api.comp, pb.timeRef, reactor],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    api.apply((c) => ({ ...c, layers: c.layers.filter((l) => l.id !== selectedId) }));
    setSelectedId(null);
  }, [api, selectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    const c = cloneLayer(selected);
    addLayer(c);
  }, [selected, addLayer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (exportOpen || confirmNew) {
          setExportOpen(false);
          setConfirmNew(false);
        } else setSelectedId(null);
        return;
      }
      if (exportOpen || confirmNew) return;
      if (mod && k === 's' && !e.shiftKey) { e.preventDefault(); setExportOpen(true); return; }
      if (mod && k === 'o') { e.preventDefault(); importRef.current?.click(); return; }
      if (isTyping(e.target)) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); api.redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod) return;
      if (e.code === 'Space') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        pb.toggle();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Home') {
        pb.setTime(0);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = (e.shiftKey ? 1 : 1 / 30) * (e.key === 'ArrowLeft' ? -1 : 1);
        pb.setTime(pb.timeRef.current + d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, pb, exportOpen, confirmNew, deleteSelected, duplicateSelected]);

  const addMedia = (a: Asset) => addLayer(newMediaLayer(comp, pb.time, a));

  return (
    <div className="app app--timeline">
      <TopBar
        mode="timeline"
        onMode={onMode}
        projectName={projectName}
        onProjectName={onProjectName}
        canExport={comp.layers.length > 0}
        canNew={comp.layers.length > 0}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onImport={() => importRef.current?.click()}
        onUndo={api.undo}
        onRedo={api.redo}
        onNewProject={() => setConfirmNew(true)}
        onExport={() => setExportOpen(true)}
        projectMenu={projectMenu}
      />
      <input
        ref={importRef}
        type="file"
        multiple
        hidden
        accept="image/*,video/mp4,video/webm,video/quicktime,audio/*"
        data-testid="tl-import"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          importFiles(files);
        }}
      />
      <TimelineLibrary
        onAddMedia={addMedia}
        onAddText={(id) => addLayer(newTextLayer(comp, pb.time, id))}
        onAddShape={(s) => addLayer(newShapeLayer(comp, pb.time, s))}
        onAddEffect={(id) => addLayer(newEffectLayer(comp, id))}
        onImportFiles={importFiles}
        studioMedia={studioMedia}
        reactor={reactor}
        audio={audio}
      />
      <TimelineStage
        comp={comp}
        time={pb.time}
        playing={pb.playing}
        selectedId={selectedId}
        onSelect={setSelectedId}
        updateLayer={api.updateLayer}
        previewEdge={1280}
        getBands={() => reactor.sample()}
        onDropFiles={importFiles}
      />
      <aside className="sidebar sidebar--right" aria-label="Inspector">
        <LayerInspector comp={comp} api={api} selected={selected} time={pb.time} onSelect={setSelectedId} songDuration={hasSong ? audio.duration : 0} />
      </aside>
      <TimelinePanel
        comp={comp}
        api={api}
        time={pb.time}
        setTime={pb.setTime}
        playing={pb.playing}
        toggle={pb.toggle}
        selectedId={selectedId}
        onSelect={setSelectedId}
        song={hasSong ? { name: audio.name, url: reactor.sourceUrl!, duration: audio.duration } : null}
      />

      {error && (
        <div className="toast toast--error toast--fixed" role="alert">
          <span>{error}</span>
          <button className="btn btn--icon btn--sm" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {exportOpen && (
        <CompExportDialog
          comp={comp}
          time={pb.time}
          projectName={projectName}
          song={hasSong ? { url: reactor.sourceUrl!, name: audio.name, cors: audio.kind === 'url' } : null}
          onBefore={pb.pause}
          onClose={() => setExportOpen(false)}
        />
      )}
      {confirmNew && (
        <ConfirmDialog
          title="Clear the timeline?"
          message="All layers are removed (you can undo this). Imported media stays in the bin."
          confirmLabel="Clear Timeline"
          onConfirm={() => {
            api.apply((c) => ({ ...c, layers: [] }));
            setSelectedId(null);
            setConfirmNew(false);
          }}
          onCancel={() => setConfirmNew(false)}
        />
      )}
    </div>
  );
}
