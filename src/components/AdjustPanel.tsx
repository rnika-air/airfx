import type { EffectStackApi } from '../hooks/useEffectState';
import { ADJUST_PARAMS, adjustIsNeutral } from '../effects/adjust/master';
import { EFFECTS } from '../effects/registry';
import { PropsEditor } from './PropsEditor';
import { EffectThumb } from './EffectThumb';

/**
 * The Adjust tab. Its sliders are one adjustment pass that runs with the stack,
 * so changing them never touches or resets an effect. The single-purpose
 * adjustments live here too, to keep the effect library for effects.
 */
export function AdjustPanel({ fx }: { fx: EffectStackApi }) {
  const a = fx.adjust, neutral = adjustIsNeutral(a.params);
  const more = EFFECTS.filter((e) => e.category === 'adjust' && !e.hidden);
  return (
    <>
      <div className="panel-head">
        <div><span className="label label--dim">Whole Image</span><h2 className="panel-title">Adjust</h2></div>
        <div className="audio__buttons">
          <button className={`btn btn--sm ${a.enabled ? 'btn--on' : ''}`} onClick={() => fx.setAdjust({ enabled: !a.enabled })} title="Compare with and without the adjustments" aria-pressed={a.enabled}>{a.enabled ? 'On' : 'Off'}</button>
          <button className="btn btn--sm" disabled={neutral} onClick={fx.resetAdjust}>Reset</button>
        </div>
      </div>
      <div className="sidebar__scroll">
        <p className="panel-desc">These settings work with your effects. They never change or reset a step in the stack.</p>
        <div className="segmented segmented--2 segmented--tiny" role="radiogroup" aria-label="Where adjustments apply">
          {(['before', 'after'] as const).map((w) => <button key={w} role="radio" aria-checked={a.place === w} className={a.place === w ? 'on' : ''} onClick={() => fx.setAdjust({ place: w })}>{w === 'before' ? 'Before Effects' : 'After Effects'}</button>)}
        </div>
        <PropsEditor defs={ADJUST_PARAMS} values={a.params} onChange={(k, v) => fx.setAdjust({ params: { ...a.params, [k]: v } }, `adj:${k}`)} idPrefix="adj" />
        <fieldset className="group">
          <legend className="group__title">More Adjustments</legend>
          <p className="small muted">These add a step to the stack, so they can sit anywhere in the chain.</p>
          {more.map((e) => (
            <div key={e.id} className="effect-item">
              <button className="effect-item__main" onClick={() => fx.add(e.id)} title={e.description}>
                <span className="effect-item__icon"><EffectThumb effect={e} /></span>
                <span className="effect-item__name">{e.name}</span>
              </button>
              <button className="effect-item__add" onClick={() => fx.add(e.id)} aria-label={`Add ${e.name} to stack`} title="Add to stack">+</button>
            </div>
          ))}
        </fieldset>
      </div>
    </>
  );
}
