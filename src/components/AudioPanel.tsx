import { useEffect, useRef, useState } from 'react';
import type { AudioReactor, AudioState } from '../engine/audio';
import { AUDIO_ACCEPT } from '../engine/audio';
import type { AudioMod, EffectDefinition, ModMap } from '../effects/types';
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

export function AudioPanel({ reactor, audio, effect, mods, onMod, onAutoMap, onClearMods }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [gain, setGain] = useState(reactor.analyser?.gain ?? 1);
  const [smooth, setSmooth] = useState(reactor.analyser?.smoothing ?? 0.35);

  // Keep analyser tuning when a new source is loaded.
  useEffect(() => {
    if (reactor.analyser) {
      reactor.analyser.gain = gain;
      reactor.analyser.smoothing = smooth;
    }
  }, [reactor, audio.kind, audio.name, gain, smooth]);

  const linked = effect ? effect.params.filter((p) => p.type === 'range' && mods?.[p.key]) : [];

  return (
    <div className="sidebar__scroll audio">
      <fieldset className="group">
        <legend className="group__title">Source</legend>
        <p className="small muted">
          Load a song, then link any slider to its bass, mids, highs or beat. Works on photos and videos.
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
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Analysis</legend>
        <Meters reactor={reactor} active={!!audio.kind && (audio.playing || audio.kind === 'mic')} />
        <div className="ctl">
          <div className="ctl__row">
            <span className="label">Sensitivity</span>
            <span className="ctl__num">{gain.toFixed(2)}×</span>
          </div>
          <input type="range" className="slider" min={0.3} max={4} step={0.05} value={gain} style={{ ['--pct' as string]: `${((gain - 0.3) / 3.7) * 100}%` }} onChange={(e) => setGain(parseFloat(e.target.value))} />
        </div>
        <div className="ctl">
          <div className="ctl__row">
            <span className="label">Smoothing</span>
            <span className="ctl__num">{Math.round(smooth * 100)}%</span>
          </div>
          <input type="range" className="slider" min={0} max={1} step={0.01} value={smooth} style={{ ['--pct' as string]: `${smooth * 100}%` }} onChange={(e) => setSmooth(parseFloat(e.target.value))} />
        </div>
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
            {!linked.length && (
              <p className="small muted">
                No links yet. Press <strong>Auto-Map</strong>, or click <span className="link-btn link-btn--inline">∿</span> next to any slider in the Parameters tab.
              </p>
            )}
            <ul className="links">
              {linked.map((p) => {
                const m = mods![p.key];
                return (
                  <li key={p.key}>
                    <span>{p.label}</span>
                    <select className="select select--compact" value={m.band} onChange={(e) => onMod(p.key, { ...m, band: e.target.value as AudioMod['band'] })}>
                      {BAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                    <span className="ctl__num">{m.amount > 0 ? '+' : ''}{Math.round(m.amount * 100)}%</span>
                    <button className="btn btn--icon btn--sm" onClick={() => onMod(p.key, null)} aria-label={`Unlink ${p.label}`}>×</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </fieldset>
    </div>
  );
}
