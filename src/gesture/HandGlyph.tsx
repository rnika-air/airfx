import type { Gesture } from './engine';

/** Drawn hands for the tutorial and the gesture list: palm towards you, as the camera sees it mirrored. */

type Pose = { thumb: 'out' | 'in' | 'pinch'; fingers: [boolean, boolean, boolean, boolean] };
const POSES: Record<Exclude<Gesture, 'none' | 'other'>, Pose> = {
  open: { thumb: 'out', fingers: [true, true, true, true] },
  fist: { thumb: 'in', fingers: [false, false, false, false] },
  point: { thumb: 'in', fingers: [true, false, false, false] },
  victory: { thumb: 'in', fingers: [true, true, false, false] },
  pinch: { thumb: 'pinch', fingers: [false, false, false, false] },
};

const X = [19, 27, 35, 43];
const TIP = [8, 4, 7, 14];

export function HandGlyph({ pose, side = 'right', size = 56, className = '' }: { pose: keyof typeof POSES; side?: 'left' | 'right'; size?: number; className?: string }) {
  const p = POSES[pose];
  return (
    <svg className={`hand ${className}`} width={size} height={size * 1.15} viewBox="0 0 60 69" aria-hidden="true">
      <g transform={side === 'left' ? 'translate(60 0) scale(-1 1)' : undefined} stroke="currentColor" strokeLinecap="round" fill="none">
        <rect x="14" y="33" width="34" height="28" rx="9" fill="currentColor" fillOpacity="0.14" strokeWidth="2.2" />
        {p.fingers.map((on, i) => (pose === 'pinch' && i === 0 ? null : <line key={i} x1={X[i]} y1="36" x2={X[i]} y2={on ? TIP[i] : 29} strokeWidth="6.5" opacity={on ? 1 : 0.55} />))}
        {p.thumb === 'out' && <line x1="15" y1="50" x2="4" y2="36" strokeWidth="6.5" />}
        {p.thumb === 'in' && <line x1="16" y1="49" x2="27" y2="43" strokeWidth="6.5" opacity="0.7" />}
        {p.thumb === 'pinch' && (
          <>
            <path d="M19 36 C 18 26, 14 21, 10 20" strokeWidth="6.5" />
            <line x1="15" y1="50" x2="8" y2="25" strokeWidth="6.5" />
            <circle cx="9" cy="21.5" r="5.5" strokeWidth="1.4" strokeDasharray="2 2" />
          </>
        )}
      </g>
      <text x={side === 'left' ? 52 : 8} y="67" fontSize="9" fontFamily="var(--mono)" fill="currentColor" textAnchor="middle" opacity="0.8">{side === 'left' ? 'L' : 'R'}</text>
    </svg>
  );
}
