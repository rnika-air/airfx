import { useEffect, useMemo, useRef, useState } from 'react';
import { ai, frameData } from '../ai/client';
import { selection, sourceKeyOf } from '../ai/selection';
import type { EffectStackApi } from '../hooks/useEffectState';
import { newItem } from '../hooks/useEffectState';
import type { LoadedMedia } from '../hooks/useMedia';
import { getEffect } from '../effects/registry';
import type { StackItem } from '../effects/types';
import { classify, depthSummary, measure, measureMotion, recommend, type SceneStats, type Suggestion } from '../scene/analyze';
import { JobBar, ModelCard, useJob, useModels } from './Workspaces';

/** Kept per media, so switching tabs or tweaking effects never re-analyses. */
const cache = new Map<string, SceneStats>();

interface Props {
  media: LoadedMedia | null;
  fx: EffectStackApi;
  trial: StackItem | null;
  setTrial: (i: StackItem | null) => void;
  getTime: () => number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const word = (v: number, lo: number, hi: number, a: string, b: string, c: string) => (v < lo ? a : v > hi ? c : b);

export function ScenePanel({ media, fx, trial, setTrial, getTime }: Props) {
  useModels();
  const job = useJob();
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const key = media ? sourceKeyOf(media) : '';
  const live = useRef(key);
  live.current = key;

  useEffect(() => {
    if (!media) { setStats(null); return; }
    const hit = cache.get(key);
    if (hit) { setStats({ ...hit, depth: depthSummary(getTime()) }); return; }
    const s = measure(frameData(media.element, media.width, media.height, 256));
    cache.set(key, s);
    setStats(s);
    setRejected(new Set());
    if (media.kind === 'video') measureMotion(media).then((motion) => {
      if (live.current !== key) return;
      const next = { ...cache.get(key)!, motion };
      cache.set(key, next);
      setStats(next);
    }).catch(() => undefined);
  }, [key]);

  const update = (patch: Partial<SceneStats>) => {
    const next = { ...cache.get(key)!, ...patch };
    cache.set(key, next);
    setStats(next);
  };
  const detectObjects = () => job.run('Detecting objects', async () => {
    const dets = await selection.detect(media!);
    const counts = new Map<string, number>();
    for (const d of dets) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
    update({ people: counts.get('person') ?? 0, objects: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) });
  });
  const classifyScene = () => job.run('Reading the scene', async () => {
    update({ sceneType: await classify(frameData(media!.element, media!.width, media!.height, 512)) });
  });

  const list = useMemo(() => {
    if (!stats) return [];
    return recommend(stats).filter((s) => {
      const e = getEffect(s.effectId);
      // Never suggest a video-only look for a still.
      return !rejected.has(s.id) && !!e && !(e.compat === 'video' && media?.kind !== 'video');
    });
  }, [stats, rejected, media]);
  const make = (s: Suggestion) => newItem(getEffect(s.effectId)!, s.params);

  if (!media) return <div className="sidebar__scroll"><p className="muted pad">Import media to analyse it.</p></div>;
  const detectReady = ai.state('detect').status === 'ready', sceneReady = ai.state('scene').status === 'ready';

  return (
    <div className="sidebar__scroll scene">
      <fieldset className="group">
        <legend className="group__title">Suggested Effects</legend>
        <p className="small muted">Starting points only. Every one is a normal step with normal controls.</p>
        {!list.length && <p className="small muted">No suggestions left.</p>}
        <ul className="suggest">
          {list.map((s) => {
            const trying = trial?.effectId === s.effectId;
            return (
              <li key={s.id} className={trying ? 'on' : ''}>
                <strong>{s.title}</strong>
                <span>{s.why}</span>
                <div className="suggest__row">
                  <button className={`btn btn--sm ${trying ? 'btn--on' : ''}`} onClick={() => setTrial(trying ? null : make(s))}>{trying ? 'Stop Preview' : 'Preview'}</button>
                  <button className="btn btn--sm" onClick={() => { setTrial(null); fx.add(s.effectId, s.params); }}>Apply</button>
                  <button className="btn btn--sm" onClick={() => { if (trying) setTrial(null); setRejected(new Set(rejected).add(s.id)); }}>Reject</button>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {stats && (
        <fieldset className="group">
          <legend className="group__title">What AirFx Measured</legend>
          <dl className="facts">
            <dt>Brightness</dt><dd>{pct(stats.brightness)} · {word(stats.brightness, 0.3, 0.65, 'dark', 'mid', 'bright')}</dd>
            <dt>Contrast</dt><dd>{word(stats.contrast, 0.14, 0.26, 'low', 'medium', 'high')}</dd>
            <dt>Saturation</dt><dd>{pct(stats.saturation)}</dd>
            <dt>Edge Density</dt><dd>{word(stats.edgeDensity, 0.03, 0.1, 'soft', 'moderate', 'busy')}</dd>
            <dt>Texture</dt><dd>{word(stats.texture, 0.03, 0.09, 'smooth', 'moderate', 'detailed')}</dd>
            {stats.motion && <><dt>Camera Motion</dt><dd>{word(stats.motion.camera, 0.005, 0.03, 'steady', 'moving', 'fast')}</dd><dt>Subject Motion</dt><dd>{word(stats.motion.subject, 0.01, 0.05, 'calm', 'moving', 'fast')}</dd></>}
            {stats.people !== undefined && <><dt>People</dt><dd>{stats.people}</dd></>}
            {stats.objects && stats.objects.length > 0 && <><dt>Objects</dt><dd>{stats.objects.map((o) => `${o.label}${o.count > 1 ? ` ×${o.count}` : ''}`).join(', ')}</dd></>}
            {stats.sceneType && <><dt>Scene</dt><dd>{stats.sceneType[0].label.replace(/^an? /, '')} ({pct(stats.sceneType[0].score)})</dd></>}
            {stats.depth && <><dt>Depth</dt><dd>{pct(stats.depth.near)} near · {pct(stats.depth.far)} far</dd></>}
          </dl>
          <div className="swatches">{stats.palette.map((c) => <i key={c.hex} style={{ background: c.hex, flexGrow: Math.max(1, c.share * 100) }} title={`${c.hex} · ${pct(c.share)}`} />)}</div>
        </fieldset>
      )}

      <fieldset className="group">
        <legend className="group__title">Deeper Analysis</legend>
        <p className="small muted">These use AI models, so they run only when you ask. Depth comes from AirFx Depth.</p>
        <ModelCard model="detect" />
        <button className="btn btn--sm btn--block" disabled={!detectReady || !!job.busy} onClick={detectObjects}>Detect People &amp; Objects</button>
        <ModelCard model="scene" />
        <button className="btn btn--sm btn--block" disabled={!sceneReady || !!job.busy} onClick={classifyScene}>Classify Scene Type</button>
        <JobBar job={job} cancellable={false} />
      </fieldset>
    </div>
  );
}
