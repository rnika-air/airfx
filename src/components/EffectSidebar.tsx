import { useState } from 'react';
import { CATEGORY_ORDER, CORE_EFFECT_IDS, LIBRARY } from '../effects/registry';
import { CATEGORY_LABELS, type EffectCategory, type EffectDefinition } from '../effects/types';
import { EffectThumb } from './EffectThumb';

interface Props {
  activeId: string | null;
  /** Click: try the effect in the selected stack slot. */
  onSelect: (id: string | null) => void;
  /** Plus button: add it as a new stack step. */
  onAdd: (id: string) => void;
  /** Open a dedicated workspace. */
  onWorkspace: (m: 'key' | 'depth' | 'cleanup') => void;
  /** Inside another panel, as in AirFx Live. */
  embedded?: boolean;
}

const COMPAT = { both: 'IMG·VID', image: 'IMG', video: 'VID' } as const;

const AI_NOTE: Record<string, string> = {
  airKey: 'Selection and Auto Matte use AI models. Chroma keying does not.',
  airCleanup: 'Local and patch fills need no model. AI Reconstruction uses LaMa.',
  airDepth: 'Needs a depth map from Depth Anything, or a map you load.',
};

/** Hover or focus a row to see what an effect does before using it. */
function InfoCard({ e, top }: { e: EffectDefinition; top: number }) {
  const keys = e.params.filter((p) => p.type === 'range' || p.type === 'select').slice(0, 5).map((p) => p.label);
  return (
    <div className="fxcard" style={{ top }} role="tooltip">
      <div className="fxcard__thumb"><EffectThumb effect={e} /></div>
      <strong>{e.name}</strong>
      <p>{e.description}</p>
      <dl>
        <dt>Works On</dt><dd>{e.compat === 'video' ? 'Video' : e.compat === 'image' ? 'Images' : 'Images and video'}</dd>
        {keys.length > 0 && <><dt>Key Controls</dt><dd>{keys.join(', ')}</dd></>}
        <dt>AI Analysis</dt><dd>{AI_NOTE[e.id] ?? 'Not required'}</dd>
      </dl>
    </div>
  );
}

function Row({ e, activeId, onSelect, onAdd, onInfo }: { e: EffectDefinition; activeId: string | null; onSelect: Props['onSelect']; onAdd: Props['onAdd']; onInfo: (e: EffectDefinition | null, top: number) => void }) {
  const show = (t: HTMLElement) => onInfo(e, Math.min(window.innerHeight - 300, t.getBoundingClientRect().top));
  return (
    <div className={`effect-item ${activeId === e.id ? 'effect-item--on' : ''}`} onMouseEnter={(ev) => show(ev.currentTarget)} onMouseLeave={() => onInfo(null, 0)} onFocus={(ev) => show(ev.currentTarget)} onBlur={() => onInfo(null, 0)}>
      <button className="effect-item__main" onClick={() => onSelect(e.id)}>
        <span className="effect-item__icon"><EffectThumb effect={e} /></span>
        <span className="effect-item__name">{e.name}</span>
        <span className={`effect-item__meta ${CORE_EFFECT_IDS.includes(e.id) ? 'effect-item__meta--core' : ''}`}>{COMPAT[e.compat ?? 'both']}</span>
      </button>
      <button className="effect-item__add" onClick={() => onAdd(e.id)} aria-label={`Add ${e.name} to stack`} title="Add to stack">+</button>
    </div>
  );
}

export function EffectSidebar({ activeId, onSelect, onAdd, onWorkspace, embedded }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EffectCategory | 'all'>('all');
  const [media, setMedia] = useState<'all' | 'image' | 'video'>('all');
  const [info, setInfo] = useState<{ e: EffectDefinition; top: number } | null>(null);
  const onInfo = (e: EffectDefinition | null, top: number) => setInfo(e ? { e, top } : null);

  const q = query.trim().toLowerCase();
  const match = (e: EffectDefinition) =>
    (filter === 'all' || filter === e.category) &&
    (media === 'all' || (e.compat ?? 'both') === 'both' || e.compat === media) &&
    (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
  // Adjustments have their own tab on the right, so the library holds effects only.
  const effects = LIBRARY.filter((e) => e.category !== 'adjust');
  const sections = CATEGORY_ORDER.filter((c) => c !== 'adjust').map((cat) => ({ cat, list: effects.filter((e) => e.category === cat && match(e)) })).filter((s) => s.list.length);

  return (
    <aside className={embedded ? 'embedded-library' : 'sidebar sidebar--left'} aria-label="Effect library">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected className="tab tab--on">Effects</button>
      </div>
      {(
        <>
          <div className="sidebar__search">
            <input type="search" placeholder={`Search ${effects.length} effects…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search effects" />
            <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as EffectCategory | 'all')} aria-label="Category">
              <option value="all">All Categories</option>
              {CATEGORY_ORDER.filter((c) => c !== 'adjust').map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <div className="segmented segmented--3 segmented--tiny" role="radiogroup" aria-label="Media type">
              {(['all', 'image', 'video'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={media === m} className={media === m ? 'on' : ''} onClick={() => setMedia(m)}>{m === 'all' ? 'Any Media' : m === 'image' ? 'Image' : 'Video'}</button>
              ))}
            </div>
          </div>
          <div className="sidebar__scroll">
            {sections.map(({ cat, list }) => (
              <section key={cat} className="effect-group">
                <h3 className="effect-group__title"><span>{CATEGORY_LABELS[cat]}</span><span className="effect-group__rule" /></h3>
                {cat === 'key' && <button className="wslink" onClick={() => onWorkspace('key')}>Open AirFx Key workspace →</button>}
                {cat === 'key' && <button className="wslink" onClick={() => onWorkspace('cleanup')}>Open AirFx Cleanup workspace →</button>}
                {cat === 'depth' && <button className="wslink" onClick={() => onWorkspace('depth')}>Open AirFx Depth workspace →</button>}
                {list.map((e) => <Row key={e.id} e={e} activeId={activeId} onSelect={onSelect} onAdd={onAdd} onInfo={onInfo} />)}
              </section>
            ))}
            {!sections.length && <p className="muted pad">No effects match.</p>}
          </div>
        </>
      )}
      {info && <InfoCard e={info.e} top={info.top} />}
    </aside>
  );
}
