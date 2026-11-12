import { useId } from 'react';

/**
 * AirFx wordmark: every letter in a different typographic voice —
 * a Helvetica Neue Bold A, a serif-italic i, a pixel r, a heavy glitch-sliced F
 * and an oversized italic x — with a trailing ™. Drawn as SVG so it stays
 * crisp at any size; uses currentColor plus the accent for the pixel r.
 */

// 6 × 7 bitmap for the pixel "r" (1 = filled cell)
const PIXEL_R = [
  '100111',
  '101000',
  '110000',
  '100000',
  '100000',
  '100000',
  '100000',
];

// Horizontal slices of the F (y-from, y-to) and their x-shift — the "cut" look.
const F_SLICES: [number, number, number][] = [
  [8, 31, 0],
  [31, 53, 13],
  [53, 79, -9],
  [79, 113, 6],
];

function SlicedF({ clipBase }: { clipBase: string }) {
  const glyph = (
    <g>
      <rect x="0" y="8" width="28" height="104" />
      <rect x="0" y="8" width="74" height="23" />
      <rect x="0" y="53" width="58" height="19" />
    </g>
  );
  return (
    <g transform="translate(190 0)">
      <defs>
        {F_SLICES.map(([a, b], i) => (
          <clipPath key={i} id={`${clipBase}-f${i}`}>
            <rect x="-20" y={a} width="120" height={b - a + 0.6} />
          </clipPath>
        ))}
      </defs>
      {F_SLICES.map(([, , dx], i) => (
        <g key={i} clipPath={`url(#${clipBase}-f${i})`} transform={`translate(${dx} 0)`}>
          {glyph}
        </g>
      ))}
    </g>
  );
}

export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const id = useId().replace(/:/g, '');
  const cell = 11;
  return (
    <svg className={`wordmark wordmark--${size}`} viewBox="0 0 340 122" role="img" aria-label="AirFx" fill="currentColor">
      {/* A — plain Helvetica Neue Bold */}
      <text x="2" y="112" fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif" fontSize="142" fontWeight="700" letterSpacing="-4">
        A
      </text>

      {/* i — serif italic, leaning into the A */}
      <text x="88" y="112" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontSize="118" fontWeight="400">
        i
      </text>

      {/* r — chunky pixel bitmap */}
      <g className="wordmark__pixel" transform={`translate(126 ${112 - PIXEL_R.length * cell})`}>
        {PIXEL_R.flatMap((row, y) =>
          [...row].map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.4} height={cell + 0.4} /> : null)),
        )}
      </g>

      {/* F — heavy, condensed, sliced */}
      <SlicedF clipBase={id} />

      {/* x — oversized italic overlapping the F */}
      <text x="238" y="112" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontSize="134" fontWeight="400">
        x
      </text>

      {/* ™ */}
      <text x="310" y="28" fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif" fontSize="20" fontWeight="500">
        ™
      </text>
    </svg>
  );
}
