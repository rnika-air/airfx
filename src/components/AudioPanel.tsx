import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioReactor, AudioState, AudioTuning } from '../engine/audio';
import { AUDIO_ACCEPT, audioTuning } from '../engine/audio';
import { ROLES, bandFor, routeByRole } from '../engine/audioMap';
import type { AudioMod, EffectDefinition, ModMap, RangeParam } from '../effects/types';
import { formatTime } from '../utils/videoProcessing';
import { BAND_OPTIONS } from './controls';

interface Props {
  reactor: AudioReactor;
  audio: AudioState;
  effect: EffectDefinition | null;
  mods: ModMap | undefined;
  onMod: (key: string, mod: AudioMod | null) => void;
  onAutoMap: () => void;
  onClearMods: () => void;
}

/** Live band meters, updated straight from the analyser (no React re-renders). */
function Meters({ reactor, active }: { reactor: AudioReactor; active: boolean }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!active) {
      refs.current.forEach((el) => el && (el.style.width = '0%'));
      return;
    }
    let id = 0;
    const loop = () => {
      const b = reactor.sample();
      BAND_OPTIONS.forEach((o, i) => {
        const el = refs.current[i];
        if (el) el.style.width = `${Math.round(b[o.value] * 100)}%`;
      });
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [reactor, active]);

  return (
    <div className="meters">
      {BAND_OPTIONS.map((o, i) => (
        <div key={o.value} className="meter">
          <span className="label label--dim">{o.label}</span>
          <div className="meter__track">
            <div className={`meter__fill meter__fill--${o.value}`} ref={(el) => (refs.current[i] = el)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A tuning slider, written straight to the shared tuning. */
function Tune({ k, label, min, max, step, fmt, hint }: { k: keyof AudioTuning; label: string; min: number; max: number; step: number; fmt: (v: number) => string; hint?: string }) {
  const t = useSyncExternalStore(audioTuning.subscribe.bind(audioTuning), audioTuning.get.bind(audioTuning));
  const v = t[k];
  return (
    <div className="ctl" title={hint}>
      <div className="ctl__row">
        <span className="label">{label}</span>
        <span className="ctl__num">{fmt(v)}</span>
      </div>
      <input
        type="range" className="slider" min={min} max={max} step={step} value={v} aria-label={label}
        style={{ ['--pct' as string]: `${((v - min) / (max - min)) * 100}%` }}
        onChange={(e) => audioTuning.set({ [k]: parseFloat(e.target.value) })}
      />
    </div>
  );
}

const ms = (v: number) => `${Math.round(v)} ms`;
const x = (v: number) => `${v.toFixed(2)}×`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

export function AudioPanel({ reactor, audio, effect, mods, onMod, onAutoMap, onClearMods }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState('');
  const [more, setMore] = useState(false);

  const ranges = effect ? effect.params.filter((p): p is RangeParam => p.type === 'range') : [];
  const linked = ranges.filter((p) => mods?.[p.key]);
  const free = ranges.filter((p) => !mods?.[p.key]);
  const roles = effect ? routeByRole(effect) : {};

  return (
    <div className="sidebar__scroll audio">
      <fieldset className="group">
        <legend className="group__title">Source</legend>
        <p className="small muted">
          Load a song or use the microphone, then link any slider to its bass, mids, highs, beat or hits. Works on photos and videos.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          data-testid="audio-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) reactor.loadFile(f);
            e.target.value = '';
          }}
        />
        <div className="audio__buttons">
          <button className="btn btn--accent" onClick={() => fileRef.current?.click()}>Load Song</button>
          <button className={`btn ${audio.kind === 'mic' ? 'btn--on' : ''}`} onClick={() => (audio.kind === 'mic' ? reactor.clear() : reactor.useMic())}>
            {audio.kind === 'mic' ? 'Stop Mic' : 'Microphone'}
          </button>
        </div>
        <form
          className="audio__url"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) reactor.loadUrl(url);
          }}
        >
          <input
            type="url"
            className="num num--text"
            placeholder="https://…/track.mp3"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Audio URL"
          />
          <button className="btn btn--sm" type="submit">Load URL</button>
        </form>
        <p className="small muted">MP3 · WAV · OGG · M4A · FLAC, or a direct audio link. Streaming links (YouTube, Spotify…) can’t be read.</p>

        {audio.loading && <p className="small">Loading audio…</p>}
        {audio.error && (
          <p className="error small" role="alert">
            {audio.error}{' '}
            <button className="btn btn--sm" onClick={() => reactor.clearError()}>OK</button>
          </p>
        )}
        {audio.kind && !audio.loading && (
          <div className="audio__track">
            <span className="audio__badge">{audio.kind === 'mic' ? 'MIC' : 'SONG'}</span>
            <span className="audio__name" title={audio.name}>{audio.name}</span>
            {audio.kind !== 'mic' && <span className="muted small">{formatTime(audio.duration)}</span>}
            <button className="btn btn--icon btn--sm" onClick={() => reactor.clear()} aria-label="Remove audio" title="Remove audio">×</button>
          </div>
        )}
        {audio.kind && audio.kind !== 'mic' && <p className="small muted">Use the play button in the bottom bar (or Space) to play it with your media.</p>}
        {audio.kind === 'mic' && <p className="small muted">The microphone is only analysed, never recorded or sent anywhere. Exports use a song file, not the microphone.</p>}
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Analysis</legend>
        <Meters reactor={reactor} active={!!audio.kind && (audio.playing || audio.kind === 'mic')} />
        <div className="audio__tune">
          <Tune k="gain" label="Sensitivity" min={0.3} max={4} step={0.05} fmt={x} />
          <Tune k="beatSense" label="Beat Sensitivity" min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} hint="How easily a beat or a hit is detected." />
          <Tune k="attack" label="Attack" min={1} max={300} step={1} fmt={ms} hint="How fast a level rises when the sound gets louder." />
          <Tune k="release" label="Release" min={20} max={1500} step={5} fmt={ms} hint="How slowly a level falls back. Longer is smoother." />
        </div>
        <button className="btn btn--sm" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Fewer Settings' : 'Bands & Crossovers'}</button>
        {more && (
          <div className="audio__tune">
            <Tune k="bassGain" label="Bass" min={0} max={3} step={0.05} fmt={x} />
            <Tune k="midGain" label="Mid" min={0} max={3} step={0.05} fmt={x} />
            <Tune k="trebleGain" label="High" min={0} max={3} step={0.05} fmt={x} />
            <Tune k="beatHold" label="Beat Spacing" min={80} max={800} step={10} fmt={ms} hint="Shortest gap between two beats." />
            <Tune k="bassHz" label="Bass Up To" min={60} max={400} step={5} fmt={hz} />
            <Tune k="trebleHz" label="Highs From" min={1000} max={8000} step={50} fmt={hz} />
            <button className="btn btn--sm" onClick={() => audioTuning.reset()}>Reset Analysis</button>
          </div>
        )}
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Links · {effect ? effect.name : 'no effect'}</legend>
        {!effect && <p className="small muted">Select an effect to link its parameters.</p>}
        {effect && (
          <>
            <div className="audio__buttons">
              <button className="btn btn--sm" onClick={onAutoMap}>Auto-Map</button>
              <button className="btn btn--sm" onClick={onClearMods} disabled={!linked.length}>Clear Links</button>
            </div>
            {Object.keys(roles).length > 0 && (
              <div className="audio__routes">
                <span className="label label--dim">Route By Role</span>
                {ROLES.map((r) => {
                  const key = Object.keys(roles).find((k) => roles[k].band === r.band);
                  const p = key ? ranges.find((q) => q.key === key) : null;
                  if (!p || !key) return null;
                  return (
                    <button key={r.band} className={`btn btn--sm ${mods?.[key] ? 'btn--on' : ''}`} onClick={() => onMod(key, mods?.[key] ? null : roles[key])} title={`${r.label}: link ${p.label} to the ${r.band}`}>
                      {BAND_OPTIONS.find((b) => b.value === r.band)?.label} → {p.label}
                    </button>
                  );
                })}
              </div>
            )}
            {!linked.length && (
              <p className="small muted">
                No links yet. Press <strong>Auto-Map</strong>, pick a slider below, or click <span className="link-btn link-btn--inline">∿</span> next to any slider in the Parameters tab.
              </p>
            )}
            <ul className="links">
              {linked.map((p) => {
                const m = mods![p.key];
                return (
                  <li key={p.key}>
                    <span>{p.label}</span>
                    <select className="select select--compact" value={m.band} onChange={(e) => onMod(p.key, { ...m, band: e.target.value as AudioMod['band'] })} aria-label={`${p.label} follows`}>
                      {BAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                    <input
                      type="range" className="slider slider--mod" min={-1} max={1} step={0.01} value={m.amount} aria-label={`${p.label} depth`}
                      style={{ ['--pct' as string]: `${((m.amount + 1) / 2) * 100}%` }}
                      onChange={(e) => onMod(p.key, { ...m, amount: parseFloat(e.target.value) })}
                    />
                    <button className="btn btn--icon btn--sm" onClick={() => onMod(p.key, null)} aria-label={`Unlink ${p.label}`}>×</button>
                  </li>
                );
              })}
            </ul>
            {free.length > 0 && (
              <div className="audio__add">
                <select className="select select--compact" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Slider to link">
                  <option value="">Link another slider…</option>
                  {free.map((p) => <option key={p.key} value={p.key}>{p.group ? `${p.group} · ` : ''}{p.label}</option>)}
                </select>
                <button className="btn btn--sm" disabled={!adding} onClick={() => { onMod(adding, bandFor(effect, adding)); setAdding(''); }}>Link</button>
              </div>
            )}
          </>
        )}
      </fieldset>
    </div>
  );
}
