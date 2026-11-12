import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AudioMod, Band, ColorParam, ImagesParam, RangeParam, SelectParam, SeedParam, TextParam, ToggleParam } from '../effects/types';
import { parseIds } from '../effects/types';
import { assetStore } from '../engine/assets';
import { useAssets } from '../hooks/useAssets';

export const BAND_OPTIONS: { value: Band; label: string }[] = [
  { value: 'level', label: 'Level' },
  { value: 'bass', label: 'Bass' },
  { value: 'mid', label: 'Mid' },
  { value: 'treble', label: 'High' },
  { value: 'beat', label: 'Beat' },
];

/** Inline audio link editor shown under a linked slider. */
export function ModRow({ mod, onChange, onRemove }: { mod: AudioMod; onChange: (m: AudioMod) => void; onRemove: () => void }) {
  const pct = ((mod.amount + 1) / 2) * 100;
  return (
    <div className="modrow">
      <div className="segmented segmented--5 segmented--tiny" role="radiogroup" aria-label="Audio band">
        {BAND_OPTIONS.map((b) => (
          <button key={b.value} role="radio" aria-checked={mod.band === b.value} className={mod.band === b.value ? 'on' : ''} onClick={() => onChange({ ...mod, band: b.value })}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="modrow__depth">
        <span className="label label--dim">Depth</span>
        <input
          type="range"
          className="slider slider--mod"
          min={-1}
          max={1}
          step={0.01}
          value={mod.amount}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => onChange({ ...mod, amount: parseFloat(e.target.value) })}
          aria-label="Audio depth"
        />
        <span className="ctl__num">{mod.amount > 0 ? '+' : ''}{Math.round(mod.amount * 100)}%</span>
        <button className="btn btn--icon btn--sm" onClick={onRemove} aria-label="Remove audio link" title="Remove audio link">×</button>
      </div>
    </div>
  );
}

export function TextControl({ def, value, onChange }: { def: TextParam; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ctl" title={def.hint}>
      <label className="label" htmlFor={`p-${def.key}`}>{def.label}</label>
      {def.multiline ? (
        <textarea
          id={`p-${def.key}`}
          className="num num--text num--area"
          value={value}
          rows={3}
          maxLength={def.maxLength}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <input
          id={`p-${def.key}`}
          className="num num--text"
          value={value}
          maxLength={def.maxLength}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}

/** Ordered picker over the shared asset bin (images only). */
export function ImagesControl({ def, value, onChange }: { def: ImagesParam; value: string; onChange: (v: string) => void }) {
  const assets = useAssets();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = parseIds(value).filter((id) => assets.some((a) => a.id === id));
  const set = (next: string[]) => onChange(next.slice(0, def.max).join(','));
  const unused = assets.filter((a) => (a.kind === 'image' || def.video) && !ids.includes(a.id));

  return (
    <div className="ctl" title={def.hint}>
      <span className="label">{def.label} · {ids.length}/{def.max}</span>
      <div className="thumbs">
        {ids.map((id, i) => {
          const a = assets.find((x) => x.id === id)!;
          return (
            <div key={id + i} className="thumb">
              <img src={a.thumb} alt={a.name} title={a.name} />
              <span className="thumb__n">{i + 1}</span>
              <div className="thumb__bar">
                <button disabled={i === 0} onClick={() => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set(n); }} aria-label="Move earlier">‹</button>
                <button onClick={() => set(ids.filter((_, k) => k !== i))} aria-label={`Remove ${a.name}`}>×</button>
                <button disabled={i === ids.length - 1} onClick={() => { const n = [...ids]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set(n); }} aria-label="Move later">›</button>
              </div>
            </div>
          );
        })}
        <button className="thumb thumb--add" onClick={() => fileRef.current?.click()} title="Add images from your computer">
          +<span>Add</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={def.video ? 'image/*,.svg,video/mp4,video/webm' : 'image/*,.svg'}
        multiple
        hidden
        data-testid={`images-input-${def.key}`}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          setError(null);
          const added: string[] = [];
          for (const f of files) {
            try {
              added.push((await assetStore.addFile(f)).id);
            } catch (err) {
              setError((err as Error).message);
            }
          }
          set([...ids, ...added]);
        }}
      />
      {unused.length > 0 && (
        <div className="thumbs thumbs--bin">
          <span className="label label--dim">From bin — click to add</span>
          {unused.map((a) => (
            <button key={a.id} className="thumb thumb--pick" onClick={() => set([...ids, a.id])} title={`Add ${a.name}`}>
              <img src={a.thumb} alt={a.name} />
            </button>
          ))}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function decimals(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export function RangeControl({
  def, value, onChange, extra,
}: { def: RangeParam; value: number; onChange: (v: number) => void; extra?: ReactNode }) {
  const dp = decimals(def.step);
  const [draft, setDraft] = useState(value.toFixed(dp));
  useEffect(() => setDraft(value.toFixed(dp)), [value, dp]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) {
      setDraft(value.toFixed(dp));
      return;
    }
    const clamped = Math.min(def.max, Math.max(def.min, n));
    onChange(clamped);
    setDraft(clamped.toFixed(dp));
  };
  const pct = ((value - def.min) / (def.max - def.min)) * 100;

  return (
    <div className="ctl" title={def.hint}>
      <div className="ctl__row">
        <label className="label" htmlFor={`p-${def.key}`}>{def.label}</label>
        {extra && <span className="ctl__extra">{extra}</span>}
        <span className="ctl__num">
          <input
            className="num"
            value={draft}
            inputMode="decimal"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const dir = e.key === 'ArrowUp' ? 1 : -1;
                const mult = e.shiftKey ? 10 : 1;
                commit(String(value + dir * def.step * mult));
              }
            }}
            aria-label={`${def.label} value`}
          />
          {def.unit && <span className="ctl__unit">{def.unit}</span>}
        </span>
      </div>
      <input
        id={`p-${def.key}`}
        type="range"
        className="slider"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function SelectControl({ def, value, onChange }: { def: SelectParam; value: string; onChange: (v: string) => void }) {
  if (def.options.length <= 4) {
    return (
      <div className="ctl">
        <span className="label">{def.label}</span>
        <div className={`segmented segmented--${def.options.length}`} role="radiogroup" aria-label={def.label}>
          {def.options.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={value === o.value}
              className={value === o.value ? 'on' : ''}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="ctl">
      <label className="label" htmlFor={`p-${def.key}`}>{def.label}</label>
      <select id={`p-${def.key}`} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function ColorControl({ def, value, onChange }: { def: ColorParam; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => {
    const hex = v.startsWith('#') ? v : '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
    else setDraft(value);
  };
  return (
    <div className="ctl ctl--inline">
      <label className="label" htmlFor={`p-${def.key}`}>{def.label}</label>
      <span className="color">
        <input
          className="num num--hex"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          aria-label={`${def.label} hex`}
        />
        <input id={`p-${def.key}`} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  );
}

export function ToggleControl({ def, value, onChange }: { def: ToggleParam; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="ctl ctl--inline" title={def.hint}>
      <span className="label">{def.label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={def.label}
        className={`switch ${value ? 'switch--on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="switch__knob" />
        <span className="switch__txt">{value ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
}

export function SeedControl({ def, value, onChange }: { def: SeedParam; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) onChange(Math.abs(n) % 100000);
    else setDraft(String(value));
  };
  return (
    <div className="ctl ctl--inline">
      <label className="label" htmlFor={`p-${def.key}`}>{def.label}</label>
      <span className="seed">
        <input
          id={`p-${def.key}`}
          className="num"
          value={draft}
          inputMode="numeric"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
        />
        <button className="btn btn--icon btn--sm" title="Randomize seed" aria-label="Randomize seed" onClick={() => onChange(Math.floor(Math.random() * 100000))}>
          ⚄
        </button>
      </span>
    </div>
  );
}
