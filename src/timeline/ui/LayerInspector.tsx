import type { AudioMod, ModMap, ParamDef, ParamValue } from '../../effects/types';
import { getEffect } from '../../effects/registry';
import { assetStore } from '../../engine/assets';
import { PropsEditor } from '../../components/PropsEditor';
import { keyState, propAt, setTransformProp, toggleKey } from '../animate';
import { ANIM_DEFS, COMP_PRESETS, TRANSFORM_DEFS, cloneLayer, propDefsFor, type Composition, type Layer } from '../model';
import type { CompositionApi } from '../useComposition';

interface Props {
  comp: Composition;
  api: CompositionApi;
  selected: Layer | null;
  time: number;
  onSelect: (id: string | null) => void;
  songDuration: number;
}

const KIND_LABEL: Record<Layer['kind'], string> = { media: 'Media Layer', text: 'Text Layer', shape: 'Shape Layer', effect: 'Effect Layer' };

function NumberField({ label, value, step, min, max, onChange, unit }: { label: string; value: number; step: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="numfield">
      <span className="label">{label}</span>
      <span className="ctl__num">
        <input
          className="num"
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number(value.toFixed(2))}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
        />
        {unit && <span className="ctl__unit">{unit}</span>}
      </span>
    </label>
  );
}

function CompSettings({ comp, api, songDuration }: { comp: Composition; api: CompositionApi; songDuration: number }) {
  const set = (patch: Partial<Composition>, key?: string) => api.apply((c) => ({ ...c, ...patch }), key ?? null);
  const setDuration = (d: number) =>
    api.apply((c) => ({ ...c, duration: d, layers: c.layers.map((l) => (l.start >= d ? { ...l, start: Math.max(0, d - 0.5), end: d } : { ...l, end: Math.min(l.end, d) })) }), 'comp:dur');
  return (
    <>
      <div className="panel-head">
        <div>
          <span className="label label--dim">Composition</span>
          <h2 className="panel-title">Settings</h2>
        </div>
      </div>
      <p className="panel-desc">Nothing selected. Click a layer on the canvas or timeline to edit it.</p>
      <div className="sidebar__scroll">
        <fieldset className="group">
          <legend className="group__title">Frame</legend>
          <div className="segmented segmented--4">
            {COMP_PRESETS.map((p) => (
              <button key={p.label} className={comp.width === p.width && comp.height === p.height ? 'on' : ''} onClick={() => set({ width: p.width, height: p.height })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="numgrid">
            <NumberField label="Width" value={comp.width} step={2} min={16} max={4096} unit="px" onChange={(v) => set({ width: Math.round(v / 2) * 2 }, 'comp:w')} />
            <NumberField label="Height" value={comp.height} step={2} min={16} max={4096} unit="px" onChange={(v) => set({ height: Math.round(v / 2) * 2 }, 'comp:h')} />
          </div>
          <div className="ctl ctl--inline">
            <span className="label">Background</span>
            <input type="color" value={comp.background} onChange={(e) => set({ background: e.target.value }, 'comp:bg')} aria-label="Background color" />
          </div>
        </fieldset>
        <fieldset className="group">
          <legend className="group__title">Time</legend>
          <NumberField label="Duration" value={comp.duration} step={0.5} min={0.5} max={600} unit="s" onChange={setDuration} />
          {songDuration > 0 && (
            <button className="btn btn--sm btn--block" onClick={() => setDuration(Math.round(songDuration * 100) / 100)}>
              Match song length ({songDuration.toFixed(1)}s)
            </button>
          )}
        </fieldset>
        <fieldset className="group">
          <legend className="group__title">Tips</legend>
          <ul className="tips">
            <li>Layers stack top-to-bottom like the list in the timeline.</li>
            <li><strong>Effect layers</strong> process everything below them — stack several for combined looks.</li>
            <li>Press <span className="key-btn key-btn--none key-btn--inline">◆</span> next to a property to keyframe it at the playhead.</li>
            <li><strong>Boil</strong> + <strong>Hand-Drawn</strong> gives the stop-motion scribble look.</li>
          </ul>
        </fieldset>
      </div>
    </>
  );
}

export function LayerInspector({ comp, api, selected, time, onSelect, songDuration }: Props) {
  if (!selected) return <CompSettings comp={comp} api={api} songDuration={songDuration} />;
  const l = selected;
  const upd = (fn: (x: Layer) => Layer, key: string | null = null) => api.updateLayer(l.id, fn, key);
  const isEffect = l.kind === 'effect';
  const tDefs: ParamDef[] = isEffect ? TRANSFORM_DEFS.filter((d) => d.key === 'opacity').map((d) => ({ ...d, label: 'Mix' })) : TRANSFORM_DEFS;
  const tValues: Record<string, ParamValue> = {};
  for (const d of TRANSFORM_DEFS) tValues[d.key] = propAt(l, d.key, time);
  const effect = isEffect ? getEffect(l.effectId ?? '') : null;
  const asset = l.assetId ? assetStore.get(l.assetId) : undefined;
  const contentDefs = propDefsFor(l).filter((d) => !(l.kind === 'media' && d.group === 'Video' && asset?.kind !== 'video'));
  const setMod = (field: 'tmods' | 'pmods') => (key: string, mod: AudioMod | null) =>
    upd((x) => {
      const m: ModMap = { ...x[field] };
      if (mod) m[key] = mod;
      else delete m[key];
      return { ...x, [field]: m };
    });

  return (
    <>
      <div className="panel-head">
        <div>
          <span className="label label--dim">{KIND_LABEL[l.kind]}{asset ? ` · ${asset.name}` : ''}</span>
          <input className="panel-title panel-title--edit" value={l.name} onChange={(e) => upd((x) => ({ ...x, name: e.target.value }), `name:${l.id}`)} aria-label="Layer name" />
        </div>
        <div className="btn-group">
          <button
            className="btn btn--sm"
            title="Duplicate (Ctrl/Cmd + D)"
            onClick={() => {
              const c = cloneLayer(l);
              api.apply((cp) => {
                const i = cp.layers.findIndex((x) => x.id === l.id);
                const layers = [...cp.layers];
                layers.splice(i + 1, 0, c);
                return { ...cp, layers };
              });
              onSelect(c.id);
            }}
          >
            Duplicate
          </button>
          <button className="btn btn--sm btn--danger" title="Delete (Del)" onClick={() => { api.apply((cp) => ({ ...cp, layers: cp.layers.filter((x) => x.id !== l.id) })); onSelect(null); }}>
            Delete
          </button>
        </div>
      </div>
      <div className="sidebar__scroll">
        <fieldset className="group">
          <legend className="group__title">Timing</legend>
          <div className="numgrid">
            <NumberField label="Start" value={l.start} step={0.05} min={0} max={l.end - 0.05} unit="s" onChange={(v) => upd((x) => ({ ...x, start: v }), `start:${l.id}`)} />
            <NumberField label="End" value={l.end} step={0.05} min={l.start + 0.05} max={comp.duration} unit="s" onChange={(v) => upd((x) => ({ ...x, end: v }), `end:${l.id}`)} />
          </div>
          <div className="btn-group btn-group--wide">
            <button className="btn btn--sm" onClick={() => upd((x) => ({ ...x, start: Math.min(time, x.end - 0.05) }))} title="Set the start to the playhead">Start at playhead</button>
            <button className="btn btn--sm" onClick={() => upd((x) => ({ ...x, end: Math.max(time, x.start + 0.05) }))} title="Set the end to the playhead">End at playhead</button>
          </div>
        </fieldset>

        <PropsEditor
          defs={tDefs}
          values={tValues}
          onChange={(k, v) => upd((x) => setTransformProp(x, k, v as number, time), `tf:${l.id}:${k}`)}
          keyframes={{ state: (k) => keyState(l, k, time), toggle: (k) => upd((x) => toggleKey(x, k, time)) }}
          mods={l.tmods}
          onMod={setMod('tmods')}
          audioDefaults={{ scale: { band: 'beat', amount: 0.05 }, rotation: { band: 'bass', amount: 0.02 }, opacity: { band: 'level', amount: 0.4 } }}
        />

        <PropsEditor
          defs={isEffect ? ANIM_DEFS.filter((d) => !['boil', 'boilFps'].includes(d.key)) : ANIM_DEFS}
          values={l.anim}
          onChange={(k, v) => upd((x) => ({ ...x, anim: { ...x.anim, [k]: v } }), `anim:${l.id}:${k}`)}
        />

        {effect && <p className="panel-desc">{effect.description}</p>}
        <PropsEditor
          defs={contentDefs}
          values={l.props}
          onChange={(k, v) => upd((x) => ({ ...x, props: { ...x.props, [k]: v } }), `p:${l.id}:${k}`)}
          mods={l.pmods}
          onMod={setMod('pmods')}
          audioDefaults={effect?.audioDefaults}
        />
      </div>
    </>
  );
}
