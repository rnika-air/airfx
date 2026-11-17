import { MARK_PATH } from './logoPaths';

/**
 * The AirFx logo: the swept "A" mark on its own, traced from the logo
 * artwork and drawn as SVG so it stays sharp at any size. It takes the
 * accent colour (lime). `size` only sets the default height.
 */
export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <svg className={`wordmark wordmark--${size}`} viewBox="404 967 2632 1308" role="img" aria-label="AirFx">
      <path className="wordmark__mark" d={MARK_PATH} fillRule="evenodd" />
    </svg>
  );
}

/** The logo as a button home: it opens the AirFx intro, from anywhere. */
export function HomeLogo() {
  return (
    <button type="button" className="home-logo" onClick={() => window.dispatchEvent(new Event('airfx:intro'))} aria-label="AirFx home" title="AirFx home">
      <Wordmark />
    </button>
  );
}
