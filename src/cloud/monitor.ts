import { cloud, APP_VERSION } from './client';

/**
 * Error monitoring: unexpected errors are sent to the AirFx server's
 * client_errors table (message, stack, page and version; never media or
 * project content), at most 10 per visit and never the same one twice.
 * Nobody can read reports through the public API; the owner sees them in the
 * Supabase dashboard. Off when the backend is not configured, and in development.
 */
const seen = new Set<string>();
let sent = 0;

export function reportError(error: unknown, where = 'app') {
  if (!cloud || import.meta.env.DEV || sent >= 10) return;
  const e = error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error));
  const key = `${where}:${e.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  cloud.from('client_errors').insert({
    message: `${where}: ${e.message}`.slice(0, 2000),
    stack: (e.stack ?? '').slice(0, 8000),
    url: location.pathname.slice(0, 500),
    app_version: APP_VERSION,
    user_agent: navigator.userAgent.slice(0, 400),
  }).then(() => undefined, () => undefined);
}

export function installErrorMonitor() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
