import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Installing AirFx as an app (PWA) and noticing new versions.
 * - Chrome, Edge and Android offer "Install" through beforeinstallprompt.
 * - Safari has no prompt: the hint explains Share › Add to Dock / Home Screen.
 * - A new deploy installs its service worker in the background; the app then
 *   offers to reload into the new version (it never reloads on its own).
 */
interface PromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const state = { deferred: null as PromptEvent | null, installed: false, update: null as ServiceWorker | null };
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferred = e as PromptEvent; bump(); });
window.addEventListener('appinstalled', () => { state.deferred = null; state.installed = true; bump(); });
state.installed = standalone();

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { state.update = w; bump(); } });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { state.update = reg.waiting; bump(); }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // Look for a new version every 30 minutes, and when the app comes back to the front.
      setInterval(() => reg.update().catch(() => undefined), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => undefined); });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
    } catch (e) { console.warn('AirFx: offline support is not available here.', e); }
  });
}

export function useInstall() {
  useSyncExternalStore(subscribe, () => version);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  return {
    canInstall: !!state.deferred && !state.installed,
    installed: state.installed,
    hint: ios ? 'To install on iPhone or iPad: Share › Add to Home Screen.' : safari ? 'To install in Safari: File › Add to Dock.' : 'Your browser offers Install AirFx in its address bar or menu when it supports it (Chrome and Edge do).',
    async prompt() {
      const p = state.deferred;
      if (!p) return;
      await p.prompt();
      const r = await p.userChoice;
      state.deferred = null;
      if (r.outcome === 'accepted') state.installed = true;
      bump();
    },
  };
}

export function useUpdate() {
  useSyncExternalStore(subscribe, () => version);
  return { ready: !!state.update, apply: () => state.update?.postMessage('SKIP_WAITING') };
}

/** "A new version is ready" notice. */
export function UpdateNotice() {
  const u = useUpdate();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (u.ready) setHidden(false); }, [u.ready]);
  if (!u.ready || hidden) return null;
  return (
    <div className="toast toast--fixed toast--ok update-notice" role="status">
      <span>A new version of AirFx is ready.</span>
      <button className="btn btn--sm btn--accent" onClick={u.apply}>Reload</button>
      <button className="btn btn--icon btn--sm" onClick={() => setHidden(true)} aria-label="Later">×</button>
    </div>
  );
}
