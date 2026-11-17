import { useState } from 'react';
import type { EffectDefinition, ParamValue, ParamValues } from '../effects/types';
import type { MediaAnalysis } from '../analysis/media';
import { suggest } from '../analysis/suggest';

/**
 * "Suggested for this picture": what the analysis found, and settings for the
 * selected effect that would suit it. Each one is applied only on a click.
 */
export function Suggestions({ effect, params, analysis, error, onChange }: {
  effect: EffectDefinition; params: ParamValues; analysis: MediaAnalysis | null; error: string | null;
  onChange: (key: string, value: ParamValue) => void;
}) {
  const [open, setOpen] = useState(true);
  if (error) return null;
  if (!analysis) return <div className="suggest suggest--wait small muted">Looking at the picture…</div>;
  const list = suggest(effect, params, analysis);
  return (
    <section className="suggest" aria-label="Suggested for this picture">
      <button className="suggest__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label">Suggested For This {analysis.kind === 'video' ? 'Clip' : 'Picture'}</span>
        <span className="suggest__count">{list.length ? `${list.length}` : '✓'}</span>
      </button>
      {open && (
        <>
          <div className="suggest__tags">
            {analysis.tags.map((t) => <span key={t} className="suggest__tag">{t}</span>)}
            {analysis.colors.slice(0, 5).map((c) => <span key={c} className="suggest__swatch" style={{ background: c }} title={c} />)}
          </div>
          {list.length ? (
            <>
              <ul className="suggest__list">
                {list.map((s) => (
                  <li key={s.key}>
                    <div>
                      <strong>{s.label}</strong> → {typeof s.value === 'string' && s.value.startsWith('#') ? <span className="suggest__swatch" style={{ background: s.value }} title={s.value} /> : s.shown}
                      <p className="small muted">{s.reason}</p>
                    </div>
                    <button className="btn btn--sm" onClick={() => onChange(s.key, s.value)}>Apply</button>
                  </li>
                ))}
              </ul>
              {list.length > 1 && <button className="btn btn--sm btn--block" onClick={() => list.forEach((s) => onChange(s.key, s.value))}>Apply All</button>}
            </>
          ) : (
            <p className="small muted">The current settings already suit this {analysis.kind === 'video' ? 'clip' : 'picture'}.</p>
          )}
        </>
      )}
    </section>
  );
}
