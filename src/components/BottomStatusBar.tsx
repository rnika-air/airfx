import type { EffectDefinition } from '../effects/types';
import type { AudioState } from '../engine/audio';
import type { RenderStats } from '../hooks/useEffectRenderer';
import type { LoadedMedia } from '../hooks/useMedia';
import type { TransportState } from '../hooks/useTransport';
import { formatTime } from '../utils/videoProcessing';

interface Props {
  media: LoadedMedia | null;
  effect: EffectDefinition | null;
  stats: RenderStats;
  transport: TransportState;
  audio: AudioState;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onToggleMute: () => void;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function BottomStatusBar({ media, effect, stats, transport, audio, onTogglePlay, onSeek, onToggleMute }: Props) {
  const statusText =
    stats.state === 'idle'
      ? 'Idle'
      : stats.state === 'rendering'
        ? 'Rendering…'
        : stats.state === 'error'
          ? `Error: ${stats.error ?? 'render failed'}`
          : `Ready · ${stats.ms.toFixed(0)} ms`;
  const dur = transport.duration || 0;

  return (
    <footer className="statusbar">
      <div className="statusbar__cell">
        <span className="label label--dim">Media</span>
        <span>{media ? media.kind.toUpperCase() : '—'}</span>
      </div>
      <div className="statusbar__cell">
        <span className="label label--dim">Size</span>
        <span>{media ? `${media.width}×${media.height} · ${formatBytes(media.size)}` : '—'}</span>
      </div>
      <div className="statusbar__cell">
        <span className="label label--dim">Preview</span>
        <span>{stats.width ? `${stats.width}×${stats.height}` : '—'}</span>
      </div>
      <div className="statusbar__cell">
        <span className="label label--dim">Effect</span>
        <span>{effect ? effect.name : 'None'}</span>
      </div>
      {audio.kind && (
        <div className="statusbar__cell statusbar__audio" title={audio.name}>
          <span className="label label--dim">Audio</span>
          <span className="statusbar__audioname">{audio.kind === 'mic' ? 'Mic (live)' : audio.name}</span>
        </div>
      )}
      <div className={`statusbar__cell statusbar__status statusbar__status--${stats.state}`}>
        <span className="dot" />
        <span>{statusText}</span>
      </div>

      {transport.visible && (
        <div className="transport">
          <button className="btn btn--icon btn--sm" onClick={onTogglePlay} aria-label={transport.playing ? 'Pause' : 'Play'} title="Play / Pause (Space)">
            {transport.playing ? '❚❚' : '▶'}
          </button>
          <span className="transport__time">{formatTime(transport.time)}</span>
          <input
            type="range"
            className="slider transport__scrub"
            min={0}
            max={dur}
            step={0.01}
            value={Math.min(transport.time, dur)}
            disabled={!dur}
            style={{ ['--pct' as string]: `${dur ? (transport.time / dur) * 100 : 0}%` }}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            aria-label="Seek"
          />
          <span className="transport__time muted">{formatTime(dur)}</span>
          {(media?.kind === 'video' || audio.kind === 'file' || audio.kind === 'url') && (
            <button className="btn btn--sm" onClick={onToggleMute} title="Mute / unmute preview">
              {transport.muted ? 'MUTED' : 'SOUND'}
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
