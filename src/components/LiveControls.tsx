import { useRef, useState, useSyncExternalStore } from 'react';
import { VISION_MODELS, vision, type VisionTask } from '../ai/vision';
import { speech } from '../ai/speech';
import { revealStore } from '../effects/v43/reveal';
import { audioBus } from '../engine/audio';
import { ModelCard, useModels } from './Workspaces';

/** Load, state and clear for one MediaPipe model. Nothing downloads until Load is pressed. */
export function VisionCard({ task }: { task: VisionTask }) {
  useSyncExternalStore(vision.subscribe, vision.getVersion);
  const s = vision.state(task), m = VISION_MODELS[task];
  return (
    <div className="model" data-model={task} data-state={s.status}>
      <div className="model__head"><strong>{m.label}</strong><span className="small muted">{m.license}</span></div>
      <p className="small muted">{m.note}</p>
      {s.status === 'loading' && <div className="progress"><div className="progress__bar" style={{ width: `${Math.round((s.loaded / Math.max(1, s.total)) * 100)}%` }} /><span className="progress__txt">Downloading {(s.loaded / 1048576).toFixed(1)} / {(s.total / 1048576).toFixed(1)} MB</span></div>}
      {s.status === 'ready' && <p className="small ok">● Ready · {s.device === 'GPU' ? 'GPU (WebGL)' : 'CPU'} · passed a test detection</p>}
      {s.status === 'error' && <p className="small error">{s.message}</p>}
      <div className="audio__buttons">
        {(s.status === 'idle' || s.status === 'cached' || s.status === 'error') && <button className="btn btn--sm btn--accent" onClick={() => vision.load(task)}>{s.status === 'cached' ? 'Load Model' : s.status === 'error' ? 'Retry' : `Download & Load · about ${m.mb} MB`}</button>}
        {(s.status === 'ready' || s.status === 'cached') && <button className="btn btn--sm" onClick={() => vision.clear(task)}>Clear From Cache</button>}
      </div>
    </div>
  );
}

export function VisionControls({ tasks }: { tasks: string }) {
  return <div className="livectl">{tasks.split(',').filter(Boolean).map((t) => <VisionCard key={t} task={t as VisionTask} />)}<p className="small muted">Tracking runs on this computer, on whatever the preview shows: the webcam in Live, a video or a photo.</p></div>;
}

export function RevealControls() {
  const [, force] = useState(0);
  const act = (f: () => void) => { f(); force((n) => n + 1); };
  return (
    <div className="livectl">
      <div className="toolgrid">
        <button className="btn btn--sm btn--accent" onClick={() => act(() => revealStore.setAll(true))}>Hide All</button>
        <button className="btn btn--sm" onClick={() => act(() => revealStore.setAll(false))}>Show All</button>
        <button className="btn btn--sm" onClick={() => act(() => revealStore.clear())}>Clear Painting</button>
        <button className="btn btn--sm" onClick={() => act(() => revealStore.capture())} title="Step out of the shot first, then press this">Capture Background</button>
      </div>
      <p className="small muted">Paint on the preview with the mouse, or choose Hand in Interaction. For Invisible Subject, step out of the frame and press Capture Background for the cleanest result.</p>
      <VisionCard task="hands" />
      <VisionCard task="pose" />
    </div>
  );
}

export function SpeechControls() {
  useModels();
  useSyncExternalStore(speech.subscribe, speech.getVersion);
  const file = useRef<HTMLInputElement>(null), reactor = audioBus.reactor, video = audioBus.video;
  const recent = speech.wordsAt(Infinity, 14).map((w) => w.text).join(' ');
  return (
    <div className="livectl">
      <ModelCard model="asr" compact />
      <input ref={file} type="file" accept="audio/*,video/*" hidden aria-label="Audio or video file to transcribe" onChange={(e) => { const f = e.target.files?.[0]; if (f) speech.transcribeUrl(URL.createObjectURL(f), f.name); e.target.value = ''; }} />
      <div className="toolgrid">
        <button className={`btn btn--sm ${speech.mode === 'mic' ? 'btn--on' : ''}`} onClick={() => (speech.mode === 'mic' ? speech.stop() : speech.startMic())} title="Whisper on this computer. The browser asks for the microphone first.">{speech.mode === 'mic' ? 'Stop Listening' : 'Microphone (Whisper)'}</button>
        <button className="btn btn--sm" disabled={speech.busy} onClick={() => file.current?.click()}>Transcribe A File</button>
        <button className="btn btn--sm" disabled={speech.busy || !video} title={video ? 'Transcribe the sound of the video on screen' : 'Load a video first'} onClick={() => video && speech.transcribeUrl(video.currentSrc || video.src, 'the video')}>Video's Sound</button>
        <button className="btn btn--sm" disabled={speech.busy || !reactor?.sourceUrl} onClick={() => reactor?.sourceUrl && speech.transcribeUrl(reactor.sourceUrl, reactor.state.name || 'the song')}>Loaded Song</button>
        <button className={`btn btn--sm ${speech.mode === 'browser' ? 'btn--on' : ''}`} disabled={!speech.browserAvailable} onClick={() => (speech.mode === 'browser' ? speech.stop() : speech.startBrowser())} title="Faster, but Chrome sends this audio to Google's speech service">{speech.mode === 'browser' ? 'Stop Browser Speech' : 'Browser Speech (Online)'}</button>
        <button className="btn btn--sm" onClick={() => speech.clear()}>Clear Words</button>
      </div>
      {speech.mode === 'browser' && <p className="small warn">Browser Speech: Chrome sends your voice to Google to turn it into text. Use Microphone (Whisper) to keep it on this computer.</p>}
      {speech.status && <p className="small muted">{speech.status}</p>}
      {speech.error && <p className="small error">{speech.error}</p>}
      <p className="small">{recent ? <>Latest: <em>{recent}</em></> : <span className="muted">No words yet.</span>}</p>
    </div>
  );
}
