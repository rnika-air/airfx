import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_ORDER, LIBRARY } from '../effects/registry';
import { CATEGORY_LABELS, type EffectCategory } from '../effects/types';
import { EffectThumb } from '../components/EffectThumb';
import { HomeLogo } from '../components/Wordmark';
import { AccountButton } from '../cloud/ui';
import type { AppMode } from '../components/TopBar';

/**
 * The phone and tablet editor: the preview stays on screen, panels open in a
 * bottom sheet above a five-tab navigation bar, and every control is sized
 * for a finger. The effect engine and panels are the same as on desktop.
 */

const QUERY = '(max-width: 900px), (pointer: coarse) and (max-height: 540px)';

export function useCompact() {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(QUERY).matches);
  useEffect(() => {
    const m = matchMedia(QUERY);
    const f = () => setOn(m.matches);
    // Resize too: some browsers deliver the media-query change late (rotation, split view).
    m.addEventListener('change', f);
    window.addEventListener('resize', f);
    return () => { m.removeEventListener('change', f); window.removeEventListener('resize', f); };
  }, []);
  return on;
}

export type MTab = 'preview' | 'effects' | 'adjust' | 'layers' | 'export';
export type SheetSize = 'half' | 'full';

const ICONS: Record<MTab, ReactNode> = {
  preview: <path d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6" />,
  effects: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7" />,
  adjust: <path d="M5 4v16M12 4v16M19 4v16M2.5 14h5M9.5 8h5M16.5 16h5" />,
  layers: <path d="M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5" />,
  export: <path d="M12 15V3M7 8l5-5 5 5M4 14v6h16v-6" />,
};
const NAMES: Record<MTab, string> = { preview: 'Preview', effects: 'Effects', adjust: 'Adjust', layers: 'Layers', export: 'Export' };

export function MobileNav({ tab, onTab, layers, effectsLabel }: { tab: MTab; onTab: (t: MTab) => void; layers: number; effectsLabel?: string }) {
  return (
    <nav className="mnav" aria-label="Editor">
      {(Object.keys(NAMES) as MTab[]).map((t) => (
        <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => onTab(t)}>
          <svg viewBox="0 0 24 24" aria-hidden>{ICONS[t]}</svg>
          <span>{t === 'effects' && effectsLabel ? effectsLabel : NAMES[t]}</span>
          {t === 'layers' && layers > 0 && <i className="mnav__badge">{layers}</i>}
        </button>
      ))}
    </nav>
  );
}

/** A bottom sheet: half height keeps the preview in view, full height for long panels. Drag the handle to resize or close. */
export function Sheet({ title, size, onSize, onClose, actions, children }: { title: ReactNode; size: SheetSize; onSize: (s: SheetSize) => void; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const start = useRef<number | null>(null);
  const [dy, setDy] = useState(0);
  const end = () => {
    if (start.current === null) return;
    if (dy > 70) (size === 'full' ? onSize('half') : onClose());
    else if (dy < -50) onSize('full');
    start.current = null;
    setDy(0);
  };
  return (
    <section className={`sheet sheet--${size}`} style={dy ? { transform: `translateY(${Math.max(-40, dy)}px)`, transition: 'none' } : undefined} aria-label={typeof title === 'string' ? title : undefined}>
      <div
        className="sheet__grab"
        onPointerDown={(e) => { start.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (start.current !== null) setDy(e.clientY - start.current); }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <button className="sheet__handle" onClick={() => onSize(size === 'full' ? 'half' : 'full')} aria-label={size === 'full' ? 'Make panel smaller' : 'Make panel larger'}><span /></button>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <div className="sheet__actions">{actions}</div>
        </div>
      </div>
      <div className="sheet__body">{children}</div>
    </section>
  );
}

/** Experimental tools: reachable from the menu, kept out of the editing workspaces. */
const EXPERIMENTAL: { id: AppMode; name: string; note: string }[] = [
  { id: 'depthlab', name: 'Depth Lab', note: 'Compare depth models on test scenes' },
];

const WORKSPACES: { id: AppMode; name: string; note: string; wide?: boolean }[] = [
  { id: 'effects', name: 'Effects', note: 'The effect library and stack' },
  { id: 'key', name: 'Key', note: 'Remove or replace the background' },
  { id: 'cleanup', name: 'Cleanup', note: 'Remove objects and blemishes' },
  { id: 'depth', name: 'Depth', note: 'Depth maps, focus and fog' },
  { id: 'live', name: 'Live', note: 'Effects on your camera' },
  { id: 'gesture', name: 'Gesture Studio', note: 'Paint with your hands', wide: true },
  { id: 'timeline', name: 'Timeline', note: 'Layered motion compositions', wide: true },
];

export function MobileHeader({ mode, canUndo, canRedo, onUndo, onRedo, onMenu }: { mode: AppMode; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onMenu: () => void }) {
  const ws = WORKSPACES.find((w) => w.id === mode) ?? EXPERIMENTAL.find((w) => w.id === mode);
  return (
    <header className="mhead">
      <div className="mhead__brand">
        <HomeLogo />
        <button className="mhead__ws mono" onClick={onMenu} aria-label="Menu and workspaces">{ws?.name ?? 'Effects'} <span aria-hidden>▾</span></button>
      </div>
      <div className="mhead__actions">
        <button className="mbtn" onClick={onUndo} disabled={!canUndo} aria-label="Undo"><svg viewBox="0 0 24 24" aria-hidden><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg></button>
        <button className="mbtn" onClick={onRedo} disabled={!canRedo} aria-label="Redo"><svg viewBox="0 0 24 24" aria-hidden><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></svg></button>
        <AccountButton />
      </div>
    </header>
  );
}

export function MobileMenu({ mode, onMode, onClose, onAbout, onAi, onIntro }: { mode: AppMode; onMode: (m: AppMode) => void; onClose: () => void; onAbout: () => void; onAi: () => void; onIntro: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="mmenu" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mmenu__panel">
        <div className="mmenu__head"><HomeLogo /><button className="pill" onClick={onClose}>Close</button></div>
        <p className="mmenu__label mono">Workspaces</p>
        <ul className="mmenu__list">
          {WORKSPACES.map((w) => (
            <li key={w.id}>
              <button className={mode === w.id ? 'on' : ''} onClick={() => { onMode(w.id); onClose(); }}>
                <strong>{w.name}</strong>
                <span>{w.note}{w.wide ? ' · best on a larger screen' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mmenu__label mono">Experimental</p>
        <ul className="mmenu__list mmenu__list--plain">
          {EXPERIMENTAL.map((w) => (
            <li key={w.id}><button className={mode === w.id ? 'on' : ''} onClick={() => { onMode(w.id); onClose(); }}><strong>{w.name}</strong><span>{w.note}</span></button></li>
          ))}
        </ul>
        <p className="mmenu__label mono">AirFx</p>
        <ul className="mmenu__list mmenu__list--plain">
          <li><button onClick={() => { onClose(); onAbout(); }}><strong>About AirFx</strong><span>Info, creator, contact and legal</span></button></li>
          <li><button onClick={() => { onClose(); onAi(); }}><strong>Air Models</strong><span>Download and check the on-device models</span></button></li>
          <li><button onClick={() => { onClose(); onIntro(); }}><strong>Replay Intro</strong><span>The AirFx welcome screen</span></button></li>
        </ul>
        <p className="mmenu__fine mono">AirFx v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}

/** The effect library as large, tappable thumbnails. Tap: use it. Plus: add it as a new layer. */
export function MobileLibrary({ activeId, onPick, onAdd }: { activeId: string | null; onPick: (id: string) => void; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<EffectCategory | 'all'>('all');
  const effects = LIBRARY.filter((e) => e.category !== 'adjust');
  const s = q.trim().toLowerCase();
  const list = effects.filter((e) => (cat === 'all' || e.category === cat) && (!s || e.name.toLowerCase().includes(s) || e.description.toLowerCase().includes(s)));
  const cats = CATEGORY_ORDER.filter((c) => c !== 'adjust' && effects.some((e) => e.category === c));
  return (
    <div className="mlib">
      <div className="mlib__bar">
        <input type="search" className="mlib__search" placeholder={`Search ${effects.length} effects`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search effects" enterKeyHint="search" />
        <div className="mlib__cats" role="radiogroup" aria-label="Category">
          <button role="radio" aria-checked={cat === 'all'} className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>All</button>
          {cats.map((c) => <button key={c} role="radio" aria-checked={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{CATEGORY_LABELS[c]}</button>)}
        </div>
      </div>
      <ul className="mlib__grid">
        {list.map((e) => (
          <li key={e.id} className={activeId === e.id ? 'on' : ''}>
            <button className="mlib__pick" onClick={() => onPick(e.id)} aria-label={`Use ${e.name}`}>
              <EffectThumb effect={e} />
              <span>{e.name}</span>
            </button>
            <button className="mlib__add" onClick={() => onAdd(e.id)} aria-label={`Add ${e.name} as a new layer`}>+</button>
          </li>
        ))}
      </ul>
      {!list.length && <p className="muted pad">No effects match.</p>}
    </div>
  );
}
