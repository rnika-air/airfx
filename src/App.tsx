import { INTERACTIVE, stagePointer } from './engine/interaction';
import { audioBus } from './engine/audio';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TopBar, type AppMode } from './components/TopBar';
import { TimelineMode } from './timeline/ui/TimelineMode';
import { GestureStudio } from './gesture/GestureStudio';
import { useComposition } from './timeline/useComposition';
import { useProject } from './project/useProject';
import { ProjectMenu, RestoreBanner } from './project/ProjectMenu';
import { CloudDialog, WelcomeGate } from './cloud/ui';
import { cloudEnabled } from './cloud/client';
import { useAccount } from './cloud/account';
import { cloudProjects } from './cloud/storage';
import { UpdateNotice } from './pwa/install';
import { useAssets } from './hooks/useAssets';
import { EffectSidebar } from './components/EffectSidebar';
import { PreviewCanvas, type CompareMode, type Zoom } from './components/PreviewCanvas';
import { ParameterPanel } from './components/ParameterPanel';
import { AudioPanel } from './components/AudioPanel';
import { RightPanel, type RightTab } from './components/RightPanel';
import { AdjustPanel } from './components/AdjustPanel';
import { adjustIsNeutral } from './effects/adjust/master';
import { BottomStatusBar } from './components/BottomStatusBar';
import { MediaImporter, type MediaImporterHandle } from './components/MediaImporter';
import { ExportDialog, type SongInfo } from './components/ExportDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useMedia } from './hooks/useMedia';
import { useEffectState } from './hooks/useEffectState';
import { useEffectRenderer } from './hooks/useEffectRenderer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAudio } from './hooks/useAudio';
import { useTransport } from './hooks/useTransport';
import type { ModMap } from './effects/types';
import { StackPanel } from './components/StackPanel';
import { PresetPanel } from './components/PresetPanel';
import type { CanvasTool } from './components/Workspaces';
import { CleanupPanel, DepthPanel, KeyPanel } from './components/WorkspacePanels';
import { SelectionOverlay } from './components/SelectionOverlay';
import { ScenePanel } from './components/ScenePanel';
import { ai, edits, frameData, tracks } from './ai/client';
import { selection } from './ai/selection';
import { cleanup, ManualPatch } from './cleanup/engine';
import { resample } from './effects/airKey';
import type { StackItem } from './effects/types';
import { depthField } from './effects/airDepth';
import { EFFECTS, getEffect } from './effects/registry';
import { assetStore } from './engine/assets';
import { DepthLab } from './depth/DepthLab';
import { LivePanel } from './live/LivePanel';
import { AiManager } from './components/AiManager';
import { DepthGuide, guideHidden } from './depth/DepthGuide';
import { loadSampleFile } from './depth/samples';
import { camera } from './live/camera';
import { PerfMonitor } from './components/PerfMonitor';
import { perf, type PreviewQuality } from './engine/perf';
import { fonts } from './content/fonts';
import { FrameRenderer } from './engine/FrameRenderer';
import { defaultParams } from './effects/types';
import { hitVhsText, parseTexts } from './effects/vhs';
import { layersOf, newItem } from './hooks/useEffectState';
import { createCanvas, get2d } from './utils/imageProcessing';

const effectApi = { EFFECTS, FrameRenderer, defaultParams, getEffect };
const COMPARE_CYCLE: CompareMode[] = ['processed', 'split', 'original'];
const DEFAULT_LOOP = 10;

function isAudioFile(f: File) {
  return f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(f.name);
}

export default function App() {
  const importer = useRef<MediaImporterHandle>(null);
  const processedRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);

  const { media: fileMedia, loading, error, setError, load, clear } = useMedia();
  const [mode, setMode] = useState<AppMode>('effects');
  useSyncExternalStore(camera.subscribe, camera.getVersion);
  const inLive = mode === 'live';
  // In Live the camera stands in for the imported file, so every effect runs on it unchanged.
  const media = inLive ? camera.media : fileMedia;
  const frameSink = useRef<((c: HTMLCanvasElement) => void) | null>(null);
  const [picking, setPicking] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    const open = () => setAiOpen(true), guide = () => setGuideOpen(true);
    window.addEventListener('airfx:ai-manager', open);
    window.addEventListener('airfx:depth-guide', guide);
    return () => { window.removeEventListener('airfx:ai-manager', open); window.removeEventListener('airfx:depth-guide', guide); };
  }, []);
  const fx = useEffectState();
  const { reactor, state: audio } = useAudio();

  const [projectName, setProjectName] = useState('Untitled Study');
  const [compare, setCompare] = useState<CompareMode>('processed');
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [previewEdge, setPreviewEdge] = useState(1080);
  const [quality, setQuality] = useState<PreviewQuality>('balanced');
  const [monitor, setMonitor] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [tab, setTab] = useState<RightTab>('params');
  const [bypass, setBypass] = useState(false);
  const [tool, setTool] = useState<CanvasTool>({ kind: 'none' });
  const [brush, setBrush] = useState({ size: 0.05, soft: 0.6 });
  const [reading, setReading] = useState<{ depth: number } | null>(null);
  const [dragBox, setDragBox] = useState<number[] | null>(null);
  const [paintTick, setPaintTick] = useState(0);
  /** A suggestion being tried: rendered last, not part of the stack until applied. */
  const [trial, setTrial] = useState<StackItem | null>(null);
  const compApi = useComposition();

  const effectMods = fx.mods;
  // In Key / Depth, render the chain only as far as that workspace's step.
  const wsId = mode === 'key' ? 'airKey' : mode === 'depth' ? 'airDepth' : mode === 'cleanup' ? 'airCleanup' : null;
  const wsIndex = wsId ? fx.items.findIndex((i) => i.effectId === wsId) : -1;
  const renderItems = useMemo(() => {
    const base = wsIndex >= 0 ? fx.items.slice(0, wsIndex + 1) : fx.items;
    return fx.withAdjust(trial ? [...base, trial] : base);
  }, [fx.items, wsIndex, trial, fx.withAdjust]);
  const live = renderItems.filter((i) => i.enabled);
  const animated = !bypass && live.some((i) => getEffect(i.effectId)?.animated?.(i.params));
  const timed = live.find((i) => typeof i.params.duration === 'number');
  const loopLength = timed ? (timed.params.duration as number) : DEFAULT_LOOP;
  const transport = useTransport(fileMedia, reactor, audio, animated, loopLength);
  const getTime = useCallback(() => (inLive && camera.media ? (camera.media.element as HTMLVideoElement).currentTime : transport.getTime()), [inLive, transport.getTime]);
  const isVideo = media?.kind === 'video';

  const { stats, rerender } = useEffectRenderer({
    media,
    items: renderItems,
    bypass,
    previewEdge,
    showOriginal: compare !== 'processed',
    processedRef,
    originalRef,
    getTime,
    getBands: () => reactor.sample(),
    quality,
    onFrame: (c) => frameSink.current?.(c),
    live: !inLive && !!media && !transport.videoPlaying && ((transport.state.playing && !isVideo) || audio.kind === 'mic'),
  });

  // On a fresh import: fit, name the project, and start with Moiré if nothing is selected.
  const { effect: activeEffect, select } = fx;
  useEffect(() => { setZoom('fit'); }, [camera.media]);
  useEffect(() => {
    const media = fileMedia;
    if (!media) return;
    setZoom('fit');
    setProjectName((n) => (n === 'Untitled Study' ? media.name.replace(/\.[^.]+$/, '') : n));
    if (!activeEffect && !fx.items.length) select('moire');
    // Maps and brush work belong to one piece of media.
    tracks.matte.clear();
    tracks.depth.clear();
    selection.clear();
    cleanup.clear();
    edits.hint.ensure(0, 0);
    edits.depth.ensure(0, 0);
    edits.protect.ensure(0, 0);
    edits.clean.ensure(0, 0);
    setReading(null);
    setTrial(null);
  }, [fileMedia]); // only on media change, not on effect change

  // Analysis results live outside React; redraw when they change.
  useEffect(() => { const off = selection.subscribe(rerender); return () => { off(); }; }, [rerender]);
  useEffect(() => { const off = cleanup.subscribe(rerender); return () => { off(); }; }, [rerender]);

  // Dev-only handle for debugging the audio engine from the console.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __airfx: unknown }).__airfx = { reactor, selection, tracks, cleanup, assetStore, fonts, ai, ...effectApi };
  }, [reactor]);
  if (import.meta.env.DEV) (window as unknown as { __fx: unknown }).__fx = fx; (window as unknown as { __perf: unknown }).__perf = perf;

  // Effects that follow the pointer get a new frame when it moves over the preview.
  const interactive = renderItems.some((i) => i.enabled && INTERACTIVE.has(i.effectId));
  useEffect(() => (interactive ? stagePointer.subscribe(rerender) : undefined), [interactive, rerender]);

  // Sound Visualizer can listen to the clip on screen. A new clip ends that.
  useEffect(() => {
    const video = media?.kind === 'video' ? (media.element as HTMLVideoElement) : null;
    audioBus.video = video;
    if (reactor.readsVideo && reactor.readsVideo !== video) reactor.clear();
  }, [media, reactor]);

  const handleFile = useCallback(
    (f: File) => {
      if (isAudioFile(f)) {
        reactor.loadFile(f);
        setTab('audio');
      } else load(f);
    },
    [load, reactor],
  );

  const autoMap = useCallback(() => {
    const eff = fx.effect;
    if (!eff) return;
    let defaults: ModMap | undefined = eff.audioDefaults;
    if (!defaults) {
      const ranges = eff.params.filter((p) => p.type === 'range').slice(0, 2);
      defaults = Object.fromEntries(ranges.map((p, i) => [p.key, { band: i === 0 ? 'bass' : 'level', amount: i === 0 ? 0.3 : 0.2 }])) as ModMap;
    }
    fx.setMods({ ...(fx.mods ?? {}), ...defaults });
  }, [fx]);

  const clearMods = useCallback(() => fx.setMods({}), [fx]);

  const openImport = useCallback(() => importer.current?.open(), []);
  const openExport = useCallback(() => {
    if (fileMedia) setExportOpen(true);
  }, [fileMedia]);

  const doNewProject = () => {
    setConfirmNew(false);
    setExportOpen(false);
    transport.pause();
    clear();
    setCompare('processed');
    setProjectName('Untitled Study');
  };

  useKeyboardShortcuts(
    {
      importMedia: openImport,
      exportMedia: openExport,
      togglePlay: transport.toggle,
      closeDialogs: () => {
        setExportOpen(false);
        setConfirmNew(false);
      },
      resetEffect: fx.resetEffect,
      undo: fx.undo,
      redo: fx.redo,
      fit: () => setZoom('fit'),
      actualSize: () => setZoom(1),
      cycleCompare: () => media && setCompare((c) => COMPARE_CYCLE[(COMPARE_CYCLE.indexOf(c) + 1) % COMPARE_CYCLE.length]),
      toggleBypass: () => setBypass((b) => !b),
    },
    exportOpen || confirmNew,
    mode !== 'timeline',
  );

  const switchMode = (m: AppMode) => {
    transport.pause();
    setExportOpen(false);
    setTool({ kind: 'none' });
    // Leaving Live always releases the camera.
    if (mode === 'live' && m !== 'live') camera.stop();
    setPicking(false);
    setGuideOpen(m === 'depth' && (guideOpen || (mode !== 'depth' && !guideHidden() && !tracks.depth.frames.length)));
    setMode(m);
    if (m === 'key' || m === 'depth' || m === 'cleanup') {
      const id = m === 'key' ? 'airKey' : m === 'depth' ? 'airDepth' : 'airCleanup';
      const found = fx.items.find((i) => i.effectId === id);
      if (found) fx.selectItem(found.id);
      else {
        // Key and Depth read the source, so they go first; an effect the user never touched just goes.
        const def = getEffect(id)!;
        const only = fx.items.length === 1 ? fx.items[0] : null;
        const onlyDef = only && getEffect(only.effectId);
        // A workspace step holds work in its masks and maps, not in its params, so it never counts as untouched.
        const untouched = !!only && !!onlyDef && !['airKey', 'airCleanup', 'airDepth'].includes(only.effectId) && only.mix === 100 && only.blend === 'source-over' && !Object.keys(only.mods).length && JSON.stringify(only.params) === JSON.stringify(newItem(onlyDef).params);
        // Keep the working order: reconstruction, then keying, then depth, then everything else.
        const rank = (e: string) => ['airCleanup', 'airKey', 'airDepth'].indexOf(e);
        const at = fx.items.filter((i) => rank(i.effectId) >= 0 && rank(i.effectId) < rank(id)).length;
        // The panel edits the selected step, so the new step must be the selected one.
        if (untouched) fx.loadStack([newItem(def)]);
        else fx.loadStack([...fx.items.slice(0, at), newItem(def), ...fx.items.slice(at)], at);
      }
      setTab('params');
    }
  };

  /** Brush, colour-pick, focus and text-drag strokes on the preview. */
  const stroke = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const boxStart = useRef<[number, number] | null>(null);
  const paintObject = useRef<ReturnType<typeof selection.beginStroke> | null>(null);
  const patch = useRef<{ tool: ManualPatch; lastId: string | null } | null>(null);
  useEffect(() => { if (tool.kind !== 'clone') patch.current = null; }, [tool.kind]);
  const planeSize = () => {
    const w = media!.width, h = media!.height, k = 640 / Math.max(w, h);
    return [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
  };
  const samGuard = () => {
    if (ai.state('sam').status === 'ready') return true;
    selection.warning = 'Press Download & Load on EdgeTAM first, or use the brush.';
    selection.bump();
    return false;
  };
  const failed = (e: unknown) => { selection.warning = (e as Error).message; selection.bump(); };
  const onCanvasPointer = (phase: 'down' | 'move' | 'up', nx: number, ny: number) => {
    if (!media) return false;
    if (inLive) {
      if (!picking) return false;
      if (phase === 'down') {
        const c = createCanvas(1, 1), g = get2d(c, true);
        g.drawImage(media.element, nx * media.width, ny * media.height, 1, 1, 0, 0, 1, 1);
        const [r, gg, b] = g.getImageData(0, 0, 1, 1).data, target = '#' + [r, gg, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        const tracker = fx.items.find((i) => i.effectId === 'blobTracker');
        if (tracker) fx.updateItem(tracker.id, { params: { ...tracker.params, drive: 'color', target } }, 'item');
        else { fx.add('blobTracker', { ...defaultParams(getEffect('blobTracker')!), drive: 'color', target }); }
        setPicking(false);
      }
      return true;
    }
    const now = transport.getTime();
    // With no tool on, a click inside a detected box selects that object: the smallest box wins.
    if (tool.kind === 'none' && showSelection && phase === 'down' && selection.detectionsAt(now).length) {
      const hit = selection.detectionsAt(now).filter((d) => nx >= d.box[0] && nx <= d.box[2] && ny >= d.box[1] && ny <= d.box[3]).sort((a, b) => (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) - (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]))[0];
      if (hit && samGuard()) {
        selection.boxSelect(media, now, hit.box.map((v) => Math.min(1, Math.max(0, v))), hit.label).catch(failed);
        return true;
      }
    }
    if (tool.kind === 'select') {
      if (phase === 'down' && samGuard()) {
        selection.click(media, now, nx, ny, tool.label, tool.fresh).catch(failed);
        if (tool.fresh) setTool({ ...tool, fresh: false });
      }
      return true;
    }
    if (tool.kind === 'box') {
      if (phase === 'down') { boxStart.current = [nx, ny]; setDragBox([nx, ny, nx, ny]); return true; }
      const s = boxStart.current;
      if (!s) return true;
      const b = [Math.min(s[0], nx), Math.min(s[1], ny), Math.max(s[0], nx), Math.max(s[1], ny)].map((v) => Math.min(1, Math.max(0, v)));
      if (phase === 'move') setDragBox(b);
      else {
        boxStart.current = null;
        setDragBox(null);
        if (b[2] - b[0] > 0.01 && b[3] - b[1] > 0.01 && samGuard()) selection.boxSelect(media, now, b, undefined, !selection.active).catch(failed);
      }
      return true;
    }
    if (tool.kind === 'selBrush') {
      if (phase === 'down') paintObject.current = selection.beginStroke(media, now);
      if (phase === 'up') { paintObject.current = null; selection.bump(); return true; }
      if (paintObject.current) { selection.dab(paintObject.current, now, nx, ny, brush.size, brush.soft, tool.value); setPaintTick((t) => t + 1); rerender(); }
      return true;
    }
    if (tool.kind === 'cleanBrush') {
      const [w, h] = planeSize();
      edits.clean.ensure(w, h);
      if (phase === 'down') edits.clean.checkpoint();
      if (phase === 'up') return true;
      if (tool.value) edits.clean.dab(nx, ny, brush.size, brush.soft, 1, 'set');
      else edits.clean.dab(nx, ny, brush.size, brush.soft, 0, 'erase');
      setPaintTick((t) => t + 1);
      return true;
    }
    if (tool.kind === 'clone') {
      if (!tool.source) {
        if (phase === 'down') setTool({ kind: 'clone', source: [nx, ny] });
        return true;
      }
      if (phase === 'down') {
        patch.current ??= { tool: new ManualPatch(media, now), lastId: null };
        stroke.current = { id: 'clone', dx: tool.source[0] - nx, dy: tool.source[1] - ny };
      }
      const s = stroke.current, c = patch.current;
      if (!s || !c) return true;
      if (phase === 'up') {
        stroke.current = null;
        const old = c.lastId;
        c.tool.commit(media).then(() => { if (old) cleanup.remove(old); c.lastId = cleanup.activeId; });
      } else c.tool.dab(nx, ny, s.dx, s.dy, brush.size, brush.soft);
      return true;
    }
    if (tool.kind === 'inspect') {
      if (phase !== 'down') return true;
      const small = frameData(media.element, media.width, media.height, 320);
      const { depth } = depthField(small, fx.params, now);
      setReading({ depth: depth[Math.floor(ny * (small.height - 1)) * small.width + Math.floor(nx * (small.width - 1))] });
      return true;
    }
    if (tool.kind === 'protect') {
      const [w, h] = planeSize();
      edits.protect.ensure(w, h);
      if (phase === 'up') return true;
      edits.protect.dab(nx, ny, brush.size, brush.soft, tool.value, 'set');
      return true;
    }
    if (mode === 'effects' && fx.effect?.id === 'vhs') {
      const texts = parseTexts(fx.params.texts as string);
      const W = media.width, H = media.height;
      if (phase === 'down') {
        const hit = hitVhsText(texts, nx * 100, ny * 100, Math.max(W, H) / 1000, W, H);
        if (!hit) return false;
        stroke.current = { id: hit.id, dx: nx * 100 - hit.x, dy: ny * 100 - hit.y };
        return true;
      }
      const s = stroke.current;
      if (s && phase === 'move') {
        fx.setParam('texts', JSON.stringify(texts.map((t) => (t.id === s.id ? { ...t, x: Math.round((nx * 100 - s.dx) * 10) / 10, y: Math.round((ny * 100 - s.dy) * 10) / 10 } : t))));
      }
      if (phase === 'up') stroke.current = null;
      return true;
    }
    if (tool.kind === 'pick') {
      if (phase !== 'down') return true;
      const c = createCanvas(1, 1), g = get2d(c, true);
      g.drawImage(media.element, nx * media.width, ny * media.height, 1, 1, 0, 0, 1, 1);
      const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
      fx.setParams({ keyColor: '#' + [r, gg, b].map((v) => v.toString(16).padStart(2, '0')).join(''), mode: 'color' });
      setTool({ kind: 'none' });
      return true;
    }
    if (tool.kind === 'focus') {
      if (phase === 'up') return true;
      const small = frameData(media.element, media.width, media.height, 320);
      const { depth } = depthField(small, fx.params, transport.getTime());
      fx.setParam('focus', Math.round(depth[Math.floor(ny * (small.height - 1)) * small.width + Math.floor(nx * (small.width - 1))] * 500) / 500);
      return true;
    }
    if (tool.kind === 'hint' || tool.kind === 'depth') {
      const plane = tool.kind === 'hint' ? edits.hint : edits.depth;
      const [pw, ph] = planeSize();
      plane.ensure(pw, ph);
      if (phase === 'down') plane.checkpoint();
      if (phase === 'up') return true;
      if (tool.kind === 'hint') plane.dab(nx, ny, brush.size, brush.soft, tool.value, 'set');
      else {
        const map = tool.mode === 'smooth' ? tracks.depth.at(now) : null;
        plane.dab(nx, ny, brush.size, brush.soft, tool.value, tool.mode, edits.protect, map ? resample(map, pw, ph) : undefined);
      }
      rerender();
      return true;
    }
    return false;
  };
  const wsProps = {
    fx, media, tool, setTool, brush, setBrush, refresh: rerender, time: transport.getTime, seek: transport.seek,
    chain: () => layersOf(renderItems),
    onBack: () => switchMode('effects'),
    onOpen: switchMode,
    onFile: handleFile,
    reading,
  };
  const showSelection = (mode === 'key' && fx.params.mode === 'select') || mode === 'cleanup';

  const song: SongInfo | null =
    (audio.kind === 'file' || audio.kind === 'url') && reactor.sourceUrl
      ? { url: reactor.sourceUrl, name: audio.name, duration: audio.duration, cors: audio.kind === 'url' }
      : null;
  const linkCount = effectMods ? Object.keys(effectMods).length : 0;

  const assets = useAssets();
  const project = useProject({
    name: projectName,
    setName: setProjectName,
    // Projects open in a place with an image. Depth Lab, Live and Gesture Studio have none of their own.
    mode: mode === 'depthlab' || mode === 'live' || mode === 'gesture' ? 'effects' : mode,
    setMode,
    effects: fx.snapshot,
    restoreEffects: fx.restore,
    comp: compApi.comp,
    replaceComp: compApi.replace,
    media: fileMedia,
    loadMedia: load,
    clearMedia: clear,
    reactor,
    audio,
    assets,
  });
  // Cloud projects: which one is open, so Save replaces it.
  const acct = useAccount();
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudId, setCloudId] = useState<string | null>(null);
  useEffect(() => { if (!acct.user) setCloudId(null); }, [acct.user]);
  const thumbnail = useCallback(async (): Promise<Blob | null> => {
    const c = processedRef.current;
    if (!c || !c.width) return null;
    const k = Math.min(1, 480 / Math.max(c.width, c.height)), t = createCanvas(Math.round(c.width * k), Math.round(c.height * k));
    get2d(t).drawImage(c, 0, 0, t.width, t.height);
    return new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8));
  }, []);
  const saveCloud = useCallback(async (asNew: boolean) => {
    const { file } = await project.buildFile();
    const id = await cloudProjects.save(file, projectName, await thumbnail(), asNew ? undefined : cloudId ?? undefined);
    setCloudId(id);
    return { name: projectName, size: file.size };
  }, [project, projectName, thumbnail, cloudId]);
  const cloudLayer = (
    <>
      {cloudOpen && (
        <CloudDialog
          onClose={() => setCloudOpen(false)}
          onOpenProject={async (p, blob) => {
            transport.pause();
            setExportOpen(false);
            await project.openFile(new File([blob], `${p.name}.airfx`, { type: 'application/x-airfx' }));
            setCloudId(p.id);
          }}
          onOpenMedia={(f) => { if (mode === 'timeline' || mode === 'gesture') switchMode('effects'); handleFile(f); }}
        />
      )}
      <WelcomeGate />
      <UpdateNotice />
    </>
  );

  const projectMenu = (
    <ProjectMenu
      cloud={cloudEnabled ? { signedIn: !!acct.user, current: cloudId, onSave: saveCloud, onBrowse: () => setCloudOpen(true) } : undefined}
      status={project.status}
      hasContent={!!fileMedia || compApi.comp.layers.length > 0 || assets.length > 0 || !!audio.kind}
      onSave={project.saveToFile}
      onOpen={project.openFile}
      onBeforeOpen={() => {
        transport.pause();
        setExportOpen(false);
      }}
    />
  );
  const restoreBanner = project.offer && (
    <RestoreBanner doc={project.offer} onRestore={project.restoreOffer} onDiscard={project.discardOffer} onClose={project.closeOffer} />
  );

  if (mode === 'gesture') {
    return (
      <>
        <GestureStudio
          onMode={switchMode}
          projectName={projectName}
          onProjectName={setProjectName}
          projectMenu={projectMenu}
          onUseInEffects={(f) => { switchMode('effects'); handleFile(f); }}
        />
        {restoreBanner}{cloudLayer}
      </>
    );
  }

  if (mode === 'timeline') {
    return (
      <>
        <TimelineMode
          api={compApi}
          reactor={reactor}
          audio={audio}
          onMode={switchMode}
          projectName={projectName}
          onProjectName={setProjectName}
          studioMedia={media ? { name: media.name, url: media.url, mime: media.mime } : null}
          projectMenu={projectMenu}
        />
        {restoreBanner}{cloudLayer}
      </>
    );
  }

  return (
    <div className="app">
      {restoreBanner}{cloudLayer}
      <MediaImporter ref={importer} onFile={handleFile} />
      <TopBar
        mode={mode}
        onMode={switchMode}
        projectName={projectName}
        onProjectName={setProjectName}
        canExport={!!fileMedia && !inLive && mode !== 'depthlab'}
        canNew={!!fileMedia}
        canUndo={fx.canUndo}
        canRedo={fx.canRedo}
        onImport={openImport}
        onUndo={fx.undo}
        onRedo={fx.redo}
        onResetEffect={fx.resetEffect}
        resetDisabled={!fx.effect}
        onNewProject={() => setConfirmNew(true)}
        onExport={openExport}
        onAi={() => setAiOpen(true)}
        projectMenu={projectMenu}
      />
      {aiOpen && <AiManager onClose={() => setAiOpen(false)} />}
      {guideOpen && mode === 'depth' && <DepthGuide {...wsProps} onClose={() => setGuideOpen(false)} onImport={openImport} onExport={openExport} />}
      {inLive ? <LivePanel processedRef={processedRef} setFrameSink={(f) => { frameSink.current = f; }} activeEffect={fx.effect?.id ?? null} onSelect={fx.select} onAdd={fx.add} picking={picking} onPick={() => setPicking((p) => !p)} /> : mode === 'depthlab' ? <DepthLab onOpenSample={async (id) => { await load(await loadSampleFile(id)); switchMode('depth'); }} /> : mode === 'key' ? <KeyPanel {...wsProps} /> : mode === 'depth' ? <DepthPanel {...wsProps} /> : mode === 'cleanup' ? <CleanupPanel {...wsProps} /> : (
        <EffectSidebar activeId={fx.effect?.id ?? null} onSelect={fx.select} onAdd={fx.add} onWorkspace={switchMode} />
      )}
      {mode !== 'depthlab' && <PreviewCanvas
        media={media}
        loading={loading}
        error={error}
        onDismissError={() => setError(null)}
        processedRef={processedRef}
        originalRef={originalRef}
        compare={compare}
        onCompare={setCompare}
        zoom={zoom}
        onZoom={setZoom}
        previewEdge={previewEdge}
        onPreviewEdge={setPreviewEdge}
        quality={quality}
        onQuality={setQuality}
        monitor={monitor}
        onMonitor={() => setMonitor((m) => !m)}
        onImport={openImport}
        onFile={handleFile}
        onStageClick={inLive ? () => undefined : transport.toggle}
        onCanvasPointer={onCanvasPointer}
        toolActive={tool.kind !== 'none' || picking}
        monitorPanel={monitor ? <PerfMonitor onClose={() => setMonitor(false)} /> : null}
        overlay={<SelectionOverlay active={showSelection && !!media} getTime={getTime} box={dragBox} cleanMask={mode === 'cleanup'} tick={paintTick} toolOn={tool.kind !== 'none' && tool.kind !== 'clone'} />}
      />}
      {mode !== 'depthlab' && <RightPanel tab={tab} onTab={setTab} audioActive={!!audio.kind} linkCount={linkCount} adjusted={fx.adjust.enabled && !adjustIsNeutral(fx.adjust.params)}>
        {tab === 'params' ? (
          <>
            {(mode === 'effects' || inLive) && <StackPanel fx={fx} bypass={bypass} onBypass={setBypass} />}
            <ParameterPanel
              effect={fx.effect}
              item={fx.selected}
              params={fx.params}
              mods={effectMods}
              hasMedia={!!media}
              onChange={fx.setParam}
              onParams={fx.setParams}
              onMod={fx.setMod}
              onItem={(patch) => fx.selected && fx.updateItem(fx.selected.id, patch, 'item')}
              onReset={fx.resetEffect}
            />
          </>
        ) : tab === 'adjust' ? (
          <AdjustPanel fx={fx} />
        ) : tab === 'presets' ? (
          <PresetPanel fx={fx} />
        ) : tab === 'scene' ? (
          <ScenePanel media={media} fx={fx} trial={trial} setTrial={setTrial} getTime={transport.getTime} />
        ) : (
          <AudioPanel
            reactor={reactor}
            audio={audio}
            effect={fx.effect}
            mods={effectMods}
            onMod={fx.setMod}
            onAutoMap={autoMap}
            onClearMods={clearMods}
          />
        )}
      </RightPanel>}
      <BottomStatusBar
        media={media}
        effect={fx.effect}
        stats={stats}
        transport={inLive ? { ...transport.state, visible: false } : transport.state}
        audio={audio}
        onTogglePlay={transport.toggle}
        onSeek={transport.seek}
        onToggleMute={transport.toggleMute}
      />

      {exportOpen && fileMedia && (
        <ExportDialog
          media={fileMedia}
          items={bypass ? [] : renderItems}
          song={song}
          time={transport.getTime()}
          loopLength={loopLength}
          micActive={audio.kind === 'mic'}
          projectName={projectName}
          onClose={() => setExportOpen(false)}
          onBeforeVideoExport={transport.pause}
        />
      )}
      {confirmNew && (
        <ConfirmDialog
          title="Start a new project?"
          message="This clears the current media from the workspace. Effect settings and the loaded song are kept. Unsaved exports will be lost."
          confirmLabel="Clear Media"
          onConfirm={doNewProject}
          onCancel={() => setConfirmNew(false)}
        />
      )}
    </div>
  );
}
