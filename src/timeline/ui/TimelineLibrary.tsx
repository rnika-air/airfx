import { useRef, useState } from 'react';
import { CATEGORY_ORDER, EFFECTS } from '../../effects/registry';
import { CATEGORY_LABELS } from '../../effects/types';
import { EffectIcon } from '../../components/EffectIcon';
import { AUDIO_ACCEPT, type AudioReactor, type AudioState } from '../../engine/audio';
import { assetStore, type Asset } from '../../engine/assets';
import { useAssets } from '../../hooks/useAssets';
import { formatTime } from '../../utils/videoProcessing';
import { TEXT_PRESETS } from '../model';

interface Props {
  onAddMedia: (a: Asset) => void;
  onAddText: (presetId: string) => void;
  onAddShape: (shape: string) => void;
  onAddEffect: (effectId: string) => void;
  onImportFiles: (files: File[]) => void;
  /** Effects-studio media that can be copied into the bin. */
  studioMedia: { name: string; url: string; mime: string } | null;
  reactor: AudioReactor;
  audio: AudioState;
}

const SHAPES: { id: string; label: string; icon: string }[] = [
  { id: 'box', label: 'Box', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯' },
  { id: 'star', label: 'Star', icon: '☆' },
  { id: 'burst', label: 'Burst', icon: '✺' },
  { id: 'line', label: 'Line', icon: '―' },
  { id: 'arrow', label: 'Arrow', icon: '→' },
  { id: 'underline', label: 'Underline', icon: '〰' },
  { id: 'scribbleCircle', label: 'Scribble ◯', icon: '➰' },
  { id: 'scribble', label: 'Scribble Fill', icon: '≋' },
];

type Section = 'media' | 'text' | 'shapes' | 'effects';

export function TimelineLibrary(p: Props) {
  const assets = useAssets();
  const fileRef = useRef<HTMLInputElement>(null);
  const songRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({ media: true, text: true, shapes: true, effects: false });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (s: Section) => setOpen((o) => ({ ...o, [s]: !o[s] }));
  const hasSong = p.audio.kind === 'file' || p.audio.kind === 'url';

  return (
    <aside className="sidebar sidebar--left" aria-label="Timeline library">
      <div className="panel-head">
        <span className="label">Add to Timeline</span>
        <span className="label label--dim">click to add</span>
      </div>
      <div className="sidebar__scroll">
        <section className="lib">
          <button className="lib__head" onClick={() => toggle('media')} aria-expanded={open.media}>
            <span>Media &amp; Song</span><span>{open.media ? '−' : '+'}</span>
          </button>
          {open.media && (
            <div className="lib__body">
              <div className="audio__buttons">
                <button className="btn btn--sm btn--accent" onClick={() => fileRef.current?.click()}>Import Files</button>
                {p.studioMedia && (
                  <button
                    className="btn btn--sm"
                    disabled={busy}
                    title="Copy the media open in the Effects workspace into the bin"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const a = await assetStore.addFromUrl(p.studioMedia!.url, p.studioMedia!.name, p.studioMedia!.mime);
                        p.onAddMedia(a);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    + Studio Media
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept="image/*,video/mp4,video/webm,video/quicktime,audio/*"
                data-testid="tl-files"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  p.onImportFiles(files);
                }}
              />
              {assets.length ? (
                <div className="bin">
                  {assets.map((a) => (
                    <button key={a.id} className="bin__item" onClick={() => p.onAddMedia(a)} title={`Add ${a.name} at the playhead`}>
                      <img src={a.thumb} alt="" />
                      <span className="bin__name">{a.kind === 'video' ? '▶ ' : ''}{a.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="small muted">Photos, transparent PNG cut-outs and videos. Drop files on the canvas too.</p>
              )}

              <div className="lib__song">
                <span className="label">Song</span>
                {hasSong ? (
                  <div className="audio__track">
                    <span className="audio__badge">SONG</span>
                    <span className="audio__name" title={p.audio.name}>{p.audio.name}</span>
                    <span className="muted small">{formatTime(p.audio.duration)}</span>
                    <button className="btn btn--icon btn--sm" onClick={() => p.reactor.clear()} aria-label="Remove song">×</button>
                  </div>
                ) : (
                  <button className="btn btn--sm" onClick={() => songRef.current?.click()}>Load Song…</button>
                )}
                <input ref={songRef} type="file" hidden accept={AUDIO_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.reactor.loadFile(f); }} />
                {p.audio.error && <p className="error small">{p.audio.error}</p>}
              </div>
            </div>
          )}
        </section>

        <section className="lib">
          <button className="lib__head" onClick={() => toggle('text')} aria-expanded={open.text}>
            <span>Text</span><span>{open.text ? '−' : '+'}</span>
          </button>
          {open.text && (
            <div className="lib__body lib__grid">
              {TEXT_PRESETS.map((t) => (
                <button key={t.id} className={`lib__tile lib__tile--${t.id}`} onClick={() => p.onAddText(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="lib">
          <button className="lib__head" onClick={() => toggle('shapes')} aria-expanded={open.shapes}>
            <span>Shapes &amp; Scribbles</span><span>{open.shapes ? '−' : '+'}</span>
          </button>
          {open.shapes && (
            <div className="lib__body lib__grid lib__grid--3">
              {SHAPES.map((s) => (
                <button key={s.id} className="lib__tile lib__tile--shape" onClick={() => p.onAddShape(s.id)} title={`Add ${s.label}`}>
                  <span className="lib__icon">{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="lib">
          <button className="lib__head" onClick={() => toggle('effects')} aria-expanded={open.effects}>
            <span>Effect Layers</span><span>{open.effects ? '−' : '+'}</span>
          </button>
          {open.effects && (
            <div className="lib__body">
              <input type="search" placeholder="Search effects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search effects" />
              {CATEGORY_ORDER.map((cat) => {
                const list = EFFECTS.filter((e) => e.category === cat && e.name.toLowerCase().includes(q.trim().toLowerCase()));
                if (!list.length) return null;
                return (
                  <div key={cat}>
                    <h3 className="effect-group__title"><span>{CATEGORY_LABELS[cat]}</span><span className="effect-group__rule" /></h3>
                    {list.map((e) => (
                      <button key={e.id} className="effect-item" onClick={() => p.onAddEffect(e.id)} title={e.description}>
                        <span className="effect-item__icon"><EffectIcon id={e.id} /></span>
                        <span className="effect-item__name">{e.name}</span>
                        <span className="effect-item__meta">+ layer</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
