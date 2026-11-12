import { useEffect, useRef, useState } from 'react';
import { camera } from '../live/camera';
import { VisionCard } from '../components/LiveControls';
import type { EngineStatus, GestureEngine } from './engine';
import { HandGlyph } from './HandGlyph';

/**
 * A short, live tutorial. Each gesture step waits for the camera to actually see
 * the gesture, so it doubles as a check that tracking works for this person,
 * camera and room. Drawing stays off until the calibration step is done.
 */

interface Props {
  engine: GestureEngine;
  status: EngineStatus;
  cameraOn: boolean;
  handsReady: boolean;
  onSwap: (swap: boolean) => void;
  onClearPractice: () => void;
  onDone: () => void;
}

const STEPS = ['Start', 'Position', 'Calibrate', 'Draw', 'Stop', 'Size', 'Erase', 'Colour', 'Practice'] as const;

export function Tutorial({ engine, status: st, cameraOn, handsReady, onSwap, onClearPractice, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false));
  const [note, setNote] = useState('');
  const prog = useRef({ n: 0, phase: 0, votes: 0, size0: 0, colors: 0, sawPause: false });

  // Drawing waits until the hands are calibrated.
  useEffect(() => { engine.enabled = step >= 3; return () => { engine.enabled = true; }; }, [engine, step]);
  useEffect(() => {
    prog.current = { n: 0, phase: 0, votes: 0, size0: engine.painter.size, colors: st.colorChanges, sawPause: false };
    setNote('');
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const mark = (i: number) => setDone((d) => (d[i] ? d : d.map((v, j) => (j === i ? true : v))));

  // Checks run on each status update from the studio (about ten a second).
  useEffect(() => {
    const p = prog.current;
    const one = st.hands.length === 1 ? st.hands[0] : null;
    switch (STEPS[step]) {
      case 'Start': if (cameraOn && handsReady) mark(0); break;
      case 'Position': {
        p.n = st.hands.length === 2 ? p.n + 1 : 0;
        if (p.n >= 8) mark(1);
        const palm = Math.max(0, ...st.hands.map((h) => h.palm));
        setNote(!st.hands.length ? 'No hands seen yet.' : palm < 0.07 ? 'Hands look small: come a little closer.' : palm > 0.3 ? 'Hands look large: step back a little.' : st.hands.length === 2 ? 'Both hands seen. Good distance.' : 'One hand seen. Raise both.');
        break;
      }
      case 'Calibrate': {
        if (p.phase === 0) {
          if (one) { p.n++; if (one.side === 'right') p.votes++; } else p.n = Math.max(0, p.n - 1);
          if (p.n >= 10) {
            if (p.votes < 5) { onSwap(!engine.settings.swapHands); setNote('Your camera reports hands the other way round. Corrected.'); } else setNote('Right hand confirmed.');
            p.phase = 1; p.n = 0;
          }
        } else if (one?.side === 'left') { p.n++; if (p.n >= 8) mark(2); }
        break;
      }
      case 'Draw': if (st.mode === 'draw') { p.n++; if (p.n >= 10) mark(3); } break;
      case 'Stop': if (st.paused) p.sawPause = true; else if (p.sawPause) mark(4); break;
      case 'Size': if (Math.abs(Math.log(engine.painter.size / Math.max(1e-6, p.size0))) > 0.25) mark(5); break;
      case 'Erase': if (st.mode === 'erase') { p.n++; if (p.n >= 5) mark(6); } break;
      case 'Colour': if (st.colorChanges > p.colors) mark(7); break;
      case 'Practice': mark(8); break;
    }
  }, [st, step, cameraOn, handsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = STEPS[step];
  const check = (ok: boolean, waiting: string) => <p className={`tut__check ${ok ? 'ok' : ''}`}>{ok ? '✓ Seen. Press Next.' : waiting}</p>;
  const calibPhase = prog.current.phase;

  return (
    <div className="tut" role="dialog" aria-label="Gesture Studio tutorial">
      <div className="tut__dots" aria-hidden="true">{STEPS.map((n, i) => <i key={n} className={i === step ? 'on' : done[i] ? 'done' : ''} />)}</div>
      <span className="label label--dim">Tutorial · {step + 1} / {STEPS.length}</span>

      {s === 'Start' && (<>
        <h3>Paint In The Air</h3>
        <div className="tut__demo"><HandGlyph pose="open" side="left" /><HandGlyph pose="point" className="anim-draw" /></div>
        <p>Your right hand paints, your left hand controls. Tracking runs on this computer. Video is never uploaded or saved unless you record.</p>
        <p className="small muted">First allow the camera, then load hand tracking.</p>
        {!cameraOn && <button className="btn btn--accent btn--block" disabled={camera.status === 'asking'} onClick={() => camera.start()}>{camera.status === 'asking' ? 'Waiting For Permission…' : 'Allow Camera'}</button>}
        {camera.message && !cameraOn && <p className="small error">{camera.message}</p>}
        {cameraOn && <p className="small ok">● Camera on</p>}
        <VisionCard task="hands" />
      </>)}

      {s === 'Position' && (<>
        <h3>Position Both Hands</h3>
        <div className="tut__demo"><HandGlyph pose="open" side="left" /><HandGlyph pose="open" /></div>
        <p>Sit or stand about an arm's length from the camera. Raise both hands to chest height, palms facing the camera, with some space around them. Light from the front works best.</p>
        <p className="small muted">{note}</p>
        {check(done[1], 'Waiting to see both hands…')}
      </>)}

      {s === 'Calibrate' && (<>
        <h3>Calibrate Left And Right</h3>
        <div className="tut__demo">{calibPhase === 0 ? <HandGlyph pose="open" /> : <HandGlyph pose="open" side="left" />}</div>
        <p>{calibPhase === 0 ? 'Lower your left hand and raise only your RIGHT hand.' : 'Now lower it and raise only your LEFT hand.'}</p>
        {note && <p className="small ok">{note}</p>}
        {check(done[2], calibPhase === 0 ? 'Watching for one hand…' : 'Watching for your left hand…')}
      </>)}

      {s === 'Draw' && (<>
        <h3>Draw</h3>
        <div className="tut__demo"><HandGlyph pose="point" className="anim-draw" /></div>
        <p>Point with your right index finger, other fingers folded. The brush follows your fingertip. Fold the finger, or open the hand, to lift the brush.</p>
        {check(done[3], 'Try drawing a line…')}
      </>)}

      {s === 'Stop' && (<>
        <h3>Stop And Resume</h3>
        <div className="tut__demo"><HandGlyph pose="fist" side="left" className="anim-a" /><HandGlyph pose="open" side="left" className="anim-b" /></div>
        <p>Make a fist with your left hand to stop drawing: your right hand can move freely and the cursor turns red. Open your left hand to resume.</p>
        {check(done[4], st.paused ? 'Stopped. Now open your left hand…' : 'Make a left fist…')}
      </>)}

      {s === 'Size' && (<>
        <h3>Change The Brush Size</h3>
        <div className="tut__demo"><HandGlyph pose="pinch" className="anim-bob" /><span className="tut__ring" /></div>
        <p>Pinch your right thumb and index finger together, like pressing a spray-can cap. While pinching, move up for a bigger brush and down for a smaller one. Let go to keep the size.</p>
        {check(done[5], `Brush size now ${Math.round(engine.painter.radius())} px…`)}
      </>)}

      {s === 'Erase' && (<>
        <h3>Erase</h3>
        <div className="tut__demo"><HandGlyph pose="open" className="anim-wipe" /></div>
        <p>Open your right hand, palm to the camera, and wipe across the paint. Each wipe can be undone.</p>
        {check(done[6], 'Wipe with an open right hand…')}
      </>)}

      {s === 'Colour' && (<>
        <h3>Change Colour</h3>
        <div className="tut__demo"><HandGlyph pose="victory" side="left" /><span className="tut__swatches"><i /><i /><i /></span></div>
        <p>Show a V sign with your left hand (index and middle fingers up) to move to the next colour in your palette. Lower it and show it again for the one after.</p>
        {check(done[7], 'Show a left V sign…')}
      </>)}

      {s === 'Practice' && (<>
        <h3>Practice</h3>
        <p>Try everything together. When you start the studio, the practice drawing is cleared.</p>
        <ul className="tut__list">
          <li><b>Right point</b> draw</li><li><b>Right pinch + up/down</b> size</li><li><b>Right open palm</b> erase</li>
          <li><b>Left fist</b> stop</li><li><b>Left open</b> resume</li><li><b>Left V</b> next colour</li>
        </ul>
        <button className="btn btn--sm btn--block" onClick={onClearPractice}>Clear Practice</button>
      </>)}

      <div className="tut__nav">
        <button className="btn btn--sm" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        <button className="btn btn--sm" onClick={onDone} title="You can replay it from the panel">Skip Tutorial</button>
        {step < STEPS.length - 1
          ? <button className={`btn btn--sm ${done[step] ? 'btn--accent' : ''}`} disabled={step === 0 && !(cameraOn && handsReady)} onClick={() => setStep(step + 1)}>{done[step] || step === 0 ? 'Next' : 'Next Anyway'}</button>
          : <button className="btn btn--sm btn--accent" onClick={onDone}>Start Studio</button>}
      </div>
    </div>
  );
}
