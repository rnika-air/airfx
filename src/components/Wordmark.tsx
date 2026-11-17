import { MARK_PATH, WORD_PATH } from './logoPaths';

/**
 * The AirFx logo: the swept "A" mark and the AirFx word, traced from the
 * logo artwork and drawn as SVG so it stays sharp at any size.
 *   lg  the artwork's own lockup: the word tucked under the mark's left foot;
 *   sm  for bars and headers: the word beside the mark, larger, so it stays
 *       readable at 20 to 30 px tall.
 * The mark takes the accent (lime); the word takes the text colour.
 */

// The word beside the mark: scaled 2.6× and centred on the mark's height.
const WORD_SCALE = 2.6;
const SIDE = { tx: 3296 - 411 * WORD_SCALE, ty: 1339 - 2046 * WORD_SCALE };

export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <svg className={`wordmark wordmark--${size}`} viewBox={lg ? '404 967 2632 1308' : '404 967 5094 1308'} role="img" aria-label="AirFx">
      <path className="wordmark__mark" d={MARK_PATH} fillRule="evenodd" />
      <path
        className="wordmark__word" d={WORD_PATH} fillRule="evenodd"
        transform={lg ? undefined : `translate(${SIDE.tx} ${SIDE.ty}) scale(${WORD_SCALE})`}
      />
    </svg>
  );
}
