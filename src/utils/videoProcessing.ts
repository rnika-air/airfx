/** Video helpers: loading, seeking and per-frame scheduling. */

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Loading was aborted.',
  2: 'A network error interrupted loading.',
  3: 'The video could not be decoded — the codec may be unsupported by this browser.',
  4: 'This video format or codec is not supported by your browser. Try MP4 (H.264) or WebM (VP8/VP9).',
};

/**
 * WebM files written by MediaRecorder often carry no duration header, so the
 * browser reports Infinity. Seeking far past the end forces it to scan and
 * discover the real duration.
 */
async function resolveDuration(v: HTMLVideoElement): Promise<void> {
  if (Number.isFinite(v.duration) && v.duration > 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      if (!Number.isFinite(v.duration)) return;
      v.removeEventListener('durationchange', done);
      v.removeEventListener('timeupdate', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      v.removeEventListener('durationchange', done);
      v.removeEventListener('timeupdate', done);
      resolve();
    }, 4000);
    v.addEventListener('durationchange', done);
    v.addEventListener('timeupdate', done);
    v.currentTime = 1e7;
  });
  await seekVideo(v, 0);
}

/** Resolves once the first frame is decodable; rejects with a readable message. */
export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = await loadVideoElement(url);
  await resolveDuration(v);
  return v;
}

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.loop = true;
    v.crossOrigin = 'anonymous';
    const cleanup = () => {
      v.removeEventListener('loadeddata', onData);
      v.removeEventListener('error', onError);
    };
    const onData = () => {
      cleanup();
      if (!v.videoWidth || !v.videoHeight) {
        reject(new Error('This file has no video track that the browser can display.'));
        return;
      }
      resolve(v);
    };
    const onError = () => {
      cleanup();
      const code = v.error?.code ?? 4;
      reject(new Error(MEDIA_ERRORS[code] ?? 'The video could not be loaded.'));
    };
    v.addEventListener('loadeddata', onData);
    v.addEventListener('error', onError);
    v.src = url;
    v.load();
  });
}

export function seekVideo(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - time) < 1e-3 && v.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = time;
  });
}

/**
 * Calls `cb` once per decoded video frame when requestVideoFrameCallback is
 * available, otherwise once per animation frame. Returns a cancel function.
 */
export function onEachVideoFrame(video: HTMLVideoElement, cb: (meta?: { mediaTime: number; presentedFrames: number }) => void): () => void {
  const v = video as VideoWithRVFC;
  let active = true;
  let id = 0;
  let last = performance.now();
  const fire = (meta?: { mediaTime: number; presentedFrames: number }) => {
    last = performance.now();
    cb(meta);
    last = performance.now();
  };
  // Neither callback runs while the window is hidden, but the video keeps
  // playing. Without this an export would record a single frozen frame.
  const watchdog = setInterval(() => {
    if (active && performance.now() - last > 100) fire();
  }, 33);
  if (typeof v.requestVideoFrameCallback === 'function') {
    const loop = (_: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (!active) return;
      fire(meta);
      id = v.requestVideoFrameCallback!(loop);
    };
    id = v.requestVideoFrameCallback(loop);
    return () => {
      active = false;
      clearInterval(watchdog);
      v.cancelVideoFrameCallback?.(id);
    };
  }
  const loop = () => {
    if (!active) return;
    fire();
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => {
    active = false;
    clearInterval(watchdog);
    cancelAnimationFrame(id);
  };
}

/** Fully release a video element's decoder and buffers. */
export function disposeVideo(v: HTMLVideoElement) {
  try {
    v.pause();
    v.removeAttribute('src');
    v.load();
  } catch {
    /* ignore */
  }
}
