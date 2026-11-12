/** Tiny line glyphs that hint at what each effect does. */
export function EffectIcon({ id }: { id: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 };
  if (id.startsWith('stack') && id !== 'stack') {
    // two layered sheets = a stacked look
    return (
      <svg {...common}>
        <path d="M11 3 L19 7 L11 11 L3 7 Z" fill="currentColor" fillOpacity="0.35" />
        <path d="M3 11 L11 15 L19 11 M3 15 L11 19 L19 15" />
      </svg>
    );
  }
  switch (id) {
    case 'stutter':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[2, 6, 10].map((x) => <rect key={x} x={x} y="5" width="3" height="12" />)}
          <rect x="14" y="5" width="3" height="12" opacity="0.3" />
          <rect x="18" y="5" width="2" height="12" opacity="0.3" />
        </svg>
      );
    case 'pixDisplace':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <rect x="3" y="3" width="6" height="5" />
          <rect x="11" y="3" width="8" height="5" opacity="0.5" />
          <rect x="7" y="9" width="10" height="4" />
          <rect x="2" y="15" width="6" height="4" opacity="0.5" />
          <rect x="12" y="15" width="7" height="4" />
        </svg>
      );
    case 'printAnimate':
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="5" />
          <circle cx="12" cy="12" r="5" strokeDasharray="1.5 1.5" />
        </svg>
      );
    case 'stars':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <path d="M8 2 L9.2 7 L14 8 L9.2 9 L8 14 L6.8 9 L2 8 L6.8 7 Z" />
          <path d="M16 11 L16.7 14 L19.5 14.7 L16.7 15.4 L16 18.5 L15.3 15.4 L12.5 14.7 L15.3 14 Z" opacity="0.6" />
        </svg>
      );
    case 'datamosh':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" />
          <path d="M11 7 C15 7 14 13 19 13 M11 11 C14 11 13 17 19 17" />
        </svg>
      );
    case 'vhs':
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="17" height="12" rx="1.5" />
          <circle cx="8" cy="11" r="2" />
          <circle cx="14" cy="11" r="2" />
        </svg>
      );
    case 'moire':
      return (
        <svg {...common}>
          {[3, 6, 9, 12, 15, 18].map((x) => <line key={x} x1={x} y1="2" x2={x} y2="20" />)}
          {[3, 6, 9, 12, 15, 18].map((x) => <line key={'b' + x} x1={x - 2} y1="2" x2={x + 2} y2="20" opacity="0.6" />)}
        </svg>
      );
    case 'halftone':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[0, 1, 2, 3].flatMap((r) =>
            [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={4 + c * 4.7} cy={4 + r * 4.7} r={0.5 + (r + c) * 0.33} />),
          )}
        </svg>
      );
    case 'scatter':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[[4, 5, 1.5], [10, 3, 0.8], [16, 6, 1.8], [7, 11, 1], [13, 12, 2.2], [18, 15, 0.9], [5, 17, 1.9], [11, 18, 1.1]].map(
            ([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />,
          )}
        </svg>
      );
    case 'glitch':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="12" height="3" />
          <rect x="7" y="9.5" width="12" height="3" />
          <rect x="2" y="15" width="10" height="3" />
        </svg>
      );
    case 'rgbShift':
      return (
        <svg {...common}>
          <circle cx="9" cy="11" r="5.5" />
          <circle cx="13" cy="11" r="5.5" opacity="0.55" />
        </svg>
      );
    case 'filmGrain':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {Array.from({ length: 34 }, (_, i) => (
            <rect key={i} x={(i * 7.3) % 19 + 1.5} y={(i * 11.7) % 19 + 1.5} width="1.3" height="1.3" />
          ))}
        </svg>
      );
    case 'dithering':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {Array.from({ length: 25 }, (_, i) => {
            const x = i % 5, y = Math.floor(i / 5);
            return (x + y) % 2 === 0 || x < y - 1 ? <rect key={i} x={2 + x * 3.7} y={2 + y * 3.7} width="2.6" height="2.6" /> : null;
          })}
        </svg>
      );
    case 'duotone':
      return (
        <svg {...common}>
          <path d="M3 19 L19 3 L19 19 Z" fill="currentColor" />
          <rect x="3" y="3" width="16" height="16" />
        </svg>
      );
    case 'posterize':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="4" height="16" fill="currentColor" opacity="0.25" />
          <rect x="7" y="3" width="4" height="16" fill="currentColor" opacity="0.5" />
          <rect x="11" y="3" width="4" height="16" fill="currentColor" opacity="0.75" />
          <rect x="15" y="3" width="4" height="16" fill="currentColor" />
        </svg>
      );
    case 'invert':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7.5" />
          <path d="M11 3.5 A7.5 7.5 0 0 1 11 18.5 Z" fill="currentColor" />
        </svg>
      );
    case 'threshold':
      return (
        <svg {...common}>
          <path d="M3 17 H11 V5 H19" />
        </svg>
      );
    case 'stippling':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {Array.from({ length: 40 }, (_, i) => {
            const x = (i * 5.3) % 17 + 2.5, y = (i * 8.9) % 17 + 2.5;
            return x + y < 26 ? <circle key={i} cx={x} cy={y} r="0.7" /> : null;
          })}
        </svg>
      );
    case 'dots':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={4 + c * 4.7} cy={4 + r * 4.7} r="1.6" />))}
        </svg>
      );
    case 'patterns':
      return (
        <svg {...common}>
          {[4, 8, 12, 16].map((y) => <path key={y} d={`M2 ${y} Q6 ${y - 3} 11 ${y} T20 ${y}`} />)}
        </svg>
      );
    case 'ascii':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <text x="2" y="10" fontSize="8" fontFamily="monospace">#@</text>
          <text x="2" y="19" fontSize="8" fontFamily="monospace">:.</text>
        </svg>
      );
    case 'cellular':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2], [3, 3], [0, 3]].map(([c, r], i) => <rect key={i} x={3 + c * 4} y={3 + r * 4} width="3.4" height="3.4" />)}
        </svg>
      );
    case 'distort':
      return (
        <svg {...common}>
          <path d="M3 3 Q11 8 19 3 M3 11 Q11 16 19 11 M3 19 Q11 14 19 19" />
        </svg>
      );
    case 'displace':
      return (
        <svg {...common}>
          <path d="M3 5 H8 V9 H14 V5 H19 M3 13 H6 V17 H12 V13 H19" />
        </svg>
      );
    case 'pixelSort':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <rect x="3" y="3" width="16" height="2.5" opacity="0.3" />
          <rect x="3" y="7" width="12" height="2.5" opacity="0.55" />
          <rect x="3" y="11" width="8" height="2.5" opacity="0.8" />
          <rect x="3" y="15" width="16" height="2.5" />
        </svg>
      );
    case 'edge':
      return (
        <svg {...common}>
          <path d="M3 17 L8 6 L12 13 L15 8 L19 17 Z" />
        </svg>
      );
    case 'bevel':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="16" height="16" />
          <path d="M3 3 L7 7 H15 L19 3 M7 7 V15 L3 19 M15 7 V15 L19 19 M7 15 H15" />
        </svg>
      );
    case 'crt':
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="17" height="13" rx="3" />
          {[7, 9.5, 12, 14.5].map((y) => <line key={y} x1="5" y1={y} x2="17" y2={y} opacity="0.5" />)}
        </svg>
      );
    case 'noise':
      return (
        <svg {...common}>
          <path d="M2 14 C5 6 7 18 10 10 S15 4 20 12" />
        </svg>
      );
    case 'recolor':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="5" />
          <circle cx="14" cy="9" r="5" />
          <circle cx="11" cy="14" r="5" />
        </svg>
      );
    case 'gradients':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="ig" x1="0" x2="1">
              <stop offset="0" stopColor="currentColor" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="16" height="7" fill="url(#ig)" stroke="none" />
          <rect x="3" y="12" width="16" height="7" fill="url(#ig)" stroke="none" />
        </svg>
      );
    case 'slide':
      return (
        <svg {...common}>
          <rect x="8" y="5" width="6" height="12" />
          <rect x="2" y="7" width="4" height="8" opacity="0.5" />
          <rect x="16" y="7" width="4" height="8" opacity="0.5" />
        </svg>
      );
    case 'dreamy':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="4" fill="currentColor" fillOpacity="0.5" />
          <circle cx="11" cy="11" r="7" opacity="0.55" />
          <circle cx="11" cy="11" r="9.5" opacity="0.25" />
        </svg>
      );
    case 'inkBleed':
      return (
        <svg {...common}>
          <path d="M11 2.5c3.5 5 6 7.6 6 10.8a6 6 0 0 1-12 0C5 10.1 7.5 7.5 11 2.5Z" fill="currentColor" fillOpacity="0.35" />
          <path d="M4 18.5c2-1.6 3.5 1.2 5.5 0s3.5 1.2 5.5 0 2-.8 3-.4" />
        </svg>
      );
    case 'soundViz':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[[2, 6], [5.5, 11], [9, 16], [12.5, 9], [16, 13]].map(([x, h]) => <rect key={x} x={x} y={11 - h / 2} width="2.4" height={h} />)}
        </svg>
      );
    case 'pixelArt':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {['..XX..XX..', '.XXXXXXXX.', '.XXXXXXXX.', '..XXXXXX..', '...XXXX...', '....XX....'].flatMap((row, y) => [...row].map((c, x) => (c === 'X' ? <rect key={`${x}${y}`} x={1 + x * 2} y={5 + y * 2} width="2" height="2" /> : null)))}
        </svg>
      );
    case 'glitch2':
      return (
        <svg {...common}>
          <rect x="2" y="3.5" width="9" height="3" />
          <rect x="11" y="3.5" width="9" height="3" opacity="0.45" transform="translate(-3 0)" />
          <rect x="6" y="9.5" width="14" height="3" fill="currentColor" />
          <rect x="1.5" y="15.5" width="7" height="3" />
          <rect x="12" y="15.5" width="8" height="3" opacity="0.45" />
        </svg>
      );
    case 'nightVision':
      return (<svg {...common}><circle cx="7" cy="11" r="5" /><circle cx="15" cy="11" r="5" /><circle cx="7" cy="11" r="2" fill="currentColor" /><circle cx="15" cy="11" r="2" fill="currentColor" /></svg>);
    case 'thermal':
      return (<svg {...common}><path d="M9 3h4v10.5a4.5 4.5 0 1 1-4 0Z" /><circle cx="11" cy="16.5" r="2.2" fill="currentColor" /><path d="M15 6h3M15 9h2M15 12h3" /></svg>);
    case 'reveal':
      return (<svg {...common}><path d="M11 3a3.5 3.5 0 1 1-.01 0ZM4 20c0-5 3-8 7-8s7 3 7 8" strokeDasharray="2 2" /><circle cx="16" cy="15" r="3" fill="currentColor" fillOpacity="0.4" /></svg>);
    case 'particleSim':
      return (<svg {...common} stroke="none" fill="currentColor">{[[5, 6, 1.6], [9, 4, 1], [14, 7, 1.3], [17, 11, 0.8], [11, 11, 2], [6, 14, 1], [13, 16, 1.2], [18, 17, 0.7], [4, 19, 0.7]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}</svg>);
    case 'speechType':
      return (<svg {...common}><path d="M11 3a3 3 0 1 1-.01 0ZM5 20c0-4.5 2.5-7 6-7s6 2.5 6 7" /><path d="M8 16h6M7.5 18.5h7" strokeWidth="1" /></svg>);
    case 'audioShapes':
      return (<svg {...common}><path d="M11 3.5c2 2.5 5 2 6 5s-1.5 4.5-1 7-3.5 3.5-5 2.5-5 .5-5.5-2.5-2-4.5-.5-7 4-2 6-5Z" /><circle cx="11" cy="11" r="2.4" fill="currentColor" /></svg>);
    case 'modulation':
      return (<svg {...common}>{[5, 9, 13, 17].map((y, i) => <path key={y} d={`M2 ${y} q2 -${1 + i} 4 0 t4 0 t4 0 t4 0 t4 0`} />)}</svg>);
    case 'crayon':
      return (<svg {...common}><path d="M4 18 15 7l3 3L7 21H4Z" fill="currentColor" fillOpacity="0.35" /><path d="m15 7 2-2 3 3-2 2" /><path d="M3 5c3 1 5-1 8 0" strokeDasharray="1.5 1.2" /></svg>);
    case 'stack':
      return (
        <svg {...common}>
          <rect x="6" y="7" width="11" height="12" transform="rotate(8 11 13)" opacity="0.45" />
          <rect x="5" y="4" width="11" height="12" />
        </svg>
      );
    default:
      return (
        <svg {...common} strokeDasharray="2 2">
          <rect x="3.5" y="3.5" width="15" height="15" />
        </svg>
      );
  }
}
