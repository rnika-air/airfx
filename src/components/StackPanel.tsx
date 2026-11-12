import { useRef, useState, useSyncExternalStore } from 'react';
import { tracks } from '../ai/client';
import { selection } from '../ai/selection';
import { getEffect } from '../effects/registry';
import type { EffectStackApi } from '../hooks/useEffectState';

interface Props {
  fx: EffectStackApi;
  bypass: boolean;
  onBypass: (b: boolean) => void;
}

/** The chain: Original → step → step → Output. Order here is render order. */
export function StackPanel({ fx, bypass, onBypass }: Props) {
  useSyncExternalStore(selection.subscribe, selection.getVersion);
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const { items } = fx;

  return (
    <div className="stack">
      <div className="stack__head">
        <span className="label">Stack · {items.filter((i) => i.enabled).length}/{items.length}</span>
        <button className={`btn btn--sm ${bypass ? 'btn--on' : ''}`} onClick={() => onBypass(!bypass)} title="Compare against the original (B)" aria-pressed={bypass}>Bypass</button>
        <button className="btn btn--sm" disabled={!items.length} onClick={fx.clearStack} title="Remove every step">Reset Stack</button>
      </div>
      <ol className={`stack__list ${bypass ? 'stack__list--bypass' : ''}`}>
        <li className="stack__end">Source Media · never changed</li>
        <li className="stack__end stack__end--data">
          <span>Analysis</span>
          <span className={`stack__tag ${selection.hasMask() ? 'stack__tag--on' : ''}`} title="Selection masks">Mask {selection.objects.length || '–'}</span>
          <span className={`stack__tag ${tracks.depth.frames.length ? 'stack__tag--on' : ''}`} title="Depth map">Depth {tracks.depth.frames.length ? '✓' : '–'}</span>
          <span className={`stack__tag ${tracks.matte.frames.length ? 'stack__tag--on' : ''}`} title="Fine matte">Matte {tracks.matte.frames.length ? '✓' : '–'}</span>
        </li>
        {items.map((it, i) => {
          const e = getEffect(it.effectId);
          return (
            <li
              key={it.id}
              className={`stack__item ${fx.selectedId === it.id ? 'stack__item--on' : ''} ${it.enabled ? '' : 'stack__item--off'} ${over === i ? 'stack__item--over' : ''}`}
              draggable
              onDragStart={() => (dragFrom.current = i)}
              onDragOver={(ev) => { ev.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver(null)}
              onDrop={(ev) => {
                ev.preventDefault();
                setOver(null);
                if (dragFrom.current !== null) fx.moveItem(dragFrom.current, i);
                dragFrom.current = null;
              }}
              onClick={() => fx.selectItem(it.id)}
            >
              <span className="stack__grip" aria-hidden>⋮⋮</span>
              <button className={`tl-eye ${it.enabled ? '' : 'tl-eye--off'}`} onClick={(ev) => { ev.stopPropagation(); fx.updateItem(it.id, { enabled: !it.enabled }); }} aria-label={`${it.enabled ? 'Disable' : 'Enable'} ${e?.name}`} title="Toggle">{it.enabled ? '●' : '○'}</button>
              <span className="stack__name">{e?.name ?? it.effectId}</span>
              {it.scope && it.scope !== 'all' && <span className="stack__tag" title="This step is limited by a mask or depth">{it.scope === 'subject' ? 'Subj' : it.scope === 'background' ? 'Bg' : it.scope === 'depthNear' ? 'Near' : 'Far'}</span>}
              <button className="tl-mini" onClick={(ev) => { ev.stopPropagation(); fx.moveItem(i, i - 1); }} disabled={i === 0} aria-label="Move up" title="Move up">▲</button>
              <button className="tl-mini" onClick={(ev) => { ev.stopPropagation(); fx.moveItem(i, i + 1); }} disabled={i === items.length - 1} aria-label="Move down" title="Move down">▼</button>
              <button className="tl-mini" onClick={(ev) => { ev.stopPropagation(); fx.duplicateItem(it.id); }} aria-label={`Duplicate ${e?.name}`} title="Duplicate">⧉</button>
              <button className="tl-mini" onClick={(ev) => { ev.stopPropagation(); fx.resetItem(it.id); }} aria-label={`Reset ${e?.name}`} title="Reset">↺</button>
              <button className="tl-mini" onClick={(ev) => { ev.stopPropagation(); fx.removeItem(it.id); }} aria-label={`Remove ${e?.name}`} title="Remove">×</button>
            </li>
          );
        })}
        <li className="stack__end">Final Composite</li>
      </ol>
    </div>
  );
}
