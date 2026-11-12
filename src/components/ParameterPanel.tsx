import type { AudioMod, EffectDefinition, ModMap, ParamValue, ParamValues, StackItem, StepScope } from '../effects/types';
import { CATEGORY_LABELS } from '../effects/types';
import { tracks } from '../ai/client';
import { selection } from '../ai/selection';
import { PropsEditor } from './PropsEditor';
import { CONTENT_PRESETS, contentWarning } from '../content/content';

interface Props {
  effect: EffectDefinition | null;
  item: StackItem | null;
  params: ParamValues;
  mods: ModMap | undefined;
  hasMedia: boolean;
  onChange: (key: string, value: ParamValue) => void;
  onParams: (v: ParamValues) => void;
  onMod: (key: string, mod: AudioMod | null) => void;
  onItem: (patch: Partial<StackItem>) => void;
  onReset: () => void;
}

const BLENDS: [GlobalCompositeOperation, string][] = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['lighter', 'Add'], ['color', 'Color'], ['luminosity', 'Luminosity']];

/** Controls of the selected stack step. */
export function ParameterPanel({ effect, item, params, mods, hasMedia, onChange, onParams, onMod, onItem, onReset }: Props) {
  if (!effect || !item) {
    return (
      <div className="panel-empty">
        <div className="panel-empty__glyph">⌁</div>
        {hasMedia ? (
          <p>Click an effect to try it, or press <strong>+</strong> to add it as a new step in the stack.</p>
        ) : (
          <>
            <p><strong>How to begin</strong></p>
            <ol>
              <li>Import an image or video — drop it on the canvas or press <kbd>Ctrl</kbd>+<kbd>O</kbd>.</li>
              <li>Pick effects and adjustments on the left. Chain as many as you like.</li>
              <li>Reorder, toggle or mix each step here.</li>
              <li>Export with <kbd>Ctrl</kbd>+<kbd>S</kbd>.</li>
            </ol>
            <p className="muted">Everything runs locally. Your files are never uploaded.</p>
          </>
        )}
      </div>
    );
  }

  const scope = item.scope ?? 'all';
  const needsMask = scope !== 'all' && (scope.startsWith('depth') ? !tracks.depth.frames.length : !selection.hasMask());

  return (
    <>
      <div className="panel-head">
        <div>
          <span className="label label--dim">{CATEGORY_LABELS[effect.category]}</span>
          <h2 className="panel-title">{effect.name}</h2>
        </div>
        <button className="btn btn--sm" onClick={onReset} title="Reset parameters (R)">Reset</button>
      </div>
      <div className="sidebar__scroll">
        <p className="panel-desc">{effect.description}</p>
        {effect.presets && (
          <div className="presetchips">
            <span className="label label--dim">Starting Points</span>
            <div className="chips">
              {effect.presets.map((p) => <button key={p.name} className="chip" onClick={() => onParams(p.values)}>{p.name}</button>)}
            </div>
          </div>
        )}
        <PropsEditor defs={effect.params} values={params} onChange={onChange} mods={mods} onMod={onMod} audioDefaults={effect.audioDefaults} />
        {effect.supportsContent && params.cMode === 'typography' && (
          <div className="presetchips">
            <span className="label label--dim">Typography Presets</span>
            <div className="chips">
              {CONTENT_PRESETS.map((p) => <button key={p.name} className="chip" onClick={() => onParams(p.values)}>{p.name}</button>)}
            </div>
          </div>
        )}
        {effect.supportsContent && contentWarning(params) && <p className="small warn">{contentWarning(params)}</p>}
        <fieldset className="group">
          <legend className="group__title">Stack Mix</legend>
          <div className="ctl">
            <div className="ctl__row"><label className="label" htmlFor="st-mix">Mix</label><span className="ctl__num">{item.mix}%</span></div>
            <input id="st-mix" type="range" className="slider" min={0} max={100} value={item.mix} style={{ ['--pct' as string]: `${item.mix}%` }} onChange={(e) => onItem({ mix: Number(e.target.value) })} />
          </div>
          <div className="ctl">
            <label className="label" htmlFor="st-blend">Blend</label>
            <select id="st-blend" className="select" value={item.blend} onChange={(e) => onItem({ blend: e.target.value as GlobalCompositeOperation })}>
              {BLENDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="ctl">
            <label className="label" htmlFor="st-scope">Apply To</label>
            <select id="st-scope" className="select" value={item.scope ?? 'all'} onChange={(e) => onItem({ scope: e.target.value as StepScope })}>
              <option value="all">Whole Image</option>
              <option value="subject">Selected Subject</option>
              <option value="background">Everything But Subject</option>
              <option value="depthNear">Near Half (Depth)</option>
              <option value="depthFar">Far Half (Depth)</option>
            </select>
            {needsMask && <p className="small warn">{item.scope?.startsWith('depth') ? 'No depth map yet: make one in Depth. Until then this step covers the whole image.' : 'Nothing selected yet: select a subject in Key. Until then this step covers the whole image.'}</p>}
          </div>
        </fieldset>
      </div>
    </>
  );
}
