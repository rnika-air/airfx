import { camera } from '../live/camera';
import { useRef, useState } from 'react';
import { getEffect } from '../effects/registry';
import type { EffectStackApi } from '../hooks/useEffectState';
import { presets, usePresets, type Preset } from '../presets/store';
import { downloadBlob } from '../utils/exportUtils';

/** Save, load, rename, delete, export and import effect and stack presets. */
export function PresetPanel({ fx }: { fx: EffectStackApi }) {
  const list = usePresets();
  const [name, setName] = useState('');
  const [note, setNote] = useState<{ err: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const report = (err: string | null, ok: string) => setNote(err ? { err: true, text: err } : { err: false, text: ok });

  const saveEffect = () => {
    if (!fx.selected || !fx.effect) return;
    const n = name.trim() || `${fx.effect.name} preset`;
    report(presets.add({ name: n, kind: 'effect', effectId: fx.effect.id, params: fx.selected.params }), `Saved “${n}”.`);
    setName('');
  };
  const saveStack = () => {
    const n = name.trim() || `Stack of ${fx.items.length}`;
    report(presets.add({ name: n, kind: 'stack', items: fx.items }), `Saved “${n}”.`);
    setName('');
  };
  const load = (p: Preset) => {
    if (p.kind === 'camera') { if (p.camera) camera.settings = { ...camera.settings, ...p.camera }; if (camera.live) camera.start(); return; }
    if (p.kind === 'stack') fx.loadStack(p.items ?? []);
    else if (p.effectId && getEffect(p.effectId)) fx.add(p.effectId, p.params);
    else return setNote({ err: true, text: 'This preset uses an effect that no longer exists.' });
    setNote({ err: false, text: `Loaded “${p.name}”.` });
  };

  return (
    <div className="sidebar__scroll presets">
      <fieldset className="group">
        <legend className="group__title">Save</legend>
        <input className="num num--text" placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Preset name" />
        <div className="audio__buttons">
          <button className="btn btn--sm" disabled={!fx.effect} onClick={saveEffect}>Save Effect</button>
          <button className="btn btn--sm" disabled={!fx.items.length} onClick={saveStack}>Save Stack</button>
        </div>
        <p className="small muted">Presets store parameters only, never your media.</p>
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Library · {list.length}</legend>
        {!list.length && <p className="small muted">Nothing saved yet.</p>}
        <ul className="presetlist">
          {list.map((p) => (
            <li key={p.id}>
              {editing === p.id ? (
                <input
                  className="num num--text"
                  autoFocus
                  defaultValue={p.name}
                  aria-label="Rename preset"
                  onBlur={(e) => { presets.rename(p.id, e.target.value || p.name); setEditing(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <button className="presetlist__name" onClick={() => load(p)} title="Load">
                  <span>{p.name}</span>
                  <em>{p.kind === 'camera' ? 'Camera' : p.kind === 'stack' ? `Stack · ${p.items?.length ?? 0}` : getEffect(p.effectId ?? '')?.name ?? p.effectId}</em>
                </button>
              )}
              <button className="tl-mini" onClick={() => setEditing(p.id)} aria-label={`Rename ${p.name}`} title="Rename">✎</button>
              <button className="tl-mini" onClick={() => presets.remove(p.id)} aria-label={`Delete ${p.name}`} title="Delete">×</button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Share</legend>
        <div className="audio__buttons">
          <button className="btn btn--sm" disabled={!list.length} onClick={() => downloadBlob(new Blob([presets.exportJson()], { type: 'application/json' }), 'airfx-presets.json')}>Export JSON</button>
          <button className="btn btn--sm" onClick={() => file.current?.click()}>Import JSON</button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="preset-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setNote({ err: false, text: `Imported ${presets.importJson(await f.text())} preset(s).` });
            } catch (x) {
              setNote({ err: true, text: (x as Error).message });
            }
          }}
        />
      </fieldset>
      {note && <p className={`small pad ${note.err ? 'error' : 'ok'}`} role="status">{note.text}</p>}
    </div>
  );
}
