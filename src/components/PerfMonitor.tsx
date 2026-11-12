import { useEffect, useState } from 'react';
import { detectAcceleration, perf } from '../engine/perf';

/** Compact technical readout. Only exists while it is switched on. */
export function PerfMonitor({ onClose }: { onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    detectAcceleration();
    const id = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, []);
  const rows: [string, string][] = [
    ['Preview', `${perf.previewFps.toFixed(1)} fps`],
    ['Source', perf.sourceFps ? `${perf.sourceFps.toFixed(1)} fps` : '–'],
    ['Processing', perf.processingFps ? `${perf.processingFps.toFixed(1)} fps` : '–'],
    ['Skipped', String(perf.dropped)],
    ['Resolution', `${perf.width}×${perf.height}${perf.scale < 0.995 ? ` · ${Math.round(perf.scale * 100)}%` : ''}`],
    ['Effects', String(perf.effects)],
    ['Frame Time', `${perf.ms.toFixed(1)} ms`],
    ['Cache Hits', String(perf.cacheHits)],
  ];
  const heavy = [...perf.steps].sort((a, b) => b.ms - a.ms).slice(0, 3);
  return (
    <aside className="perfmon" aria-label="Performance monitor">
      <div className="perfmon__head"><span className="label">Performance</span><button className="tl-mini" aria-label="Hide performance monitor" onClick={onClose}>×</button></div>
      {rows.map(([k, v]) => <div key={k} className="perfmon__row"><span>{k}</span><strong>{v}</strong></div>)}
      {heavy.length > 0 && <div className="perfmon__steps">{heavy.map((s, i) => <div key={i} className="perfmon__row"><span>{s.name}</span><strong>{s.ms.toFixed(1)} ms</strong></div>)}</div>}
      <p className="perfmon__foot">{perf.acceleration}</p>
    </aside>
  );
}
