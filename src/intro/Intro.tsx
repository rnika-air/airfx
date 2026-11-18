import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { HomeLogo } from '../components/Wordmark';
import { WORD_PATH } from '../components/logoPaths';
import { LIBRARY } from '../effects/registry';
import { account, useAccount } from '../cloud/account';
import { cloudEnabled, explain, requireAccount } from '../cloud/client';
import { About } from '../about/About';
import { CREATOR, INTRO_TEXT } from '../about/config';
import { previews, type Preview } from './previews';
import { LiveFx, TYPE_NAME } from './LiveFx';
import { DotField, DOT_INTRO_SECONDS } from './DotField';

/**
 * The way into AirFx: an intro screen, the log-in / sign-up screen that
 * continues from it, and the About page. Guests can always go straight to the
 * editor unless the site requires an account.
 *
 * Other parts of the app open these with window events:
 *   airfx:intro   replay the intro
 *   airfx:auth    the log-in screen (detail: 'login' | 'signup' | 'forgot')
 *   airfx:about   the About page
 */

export type AuthMode = 'login' | 'signup' | 'forgot';
const SEEN_KEY = 'airfx.intro.seen';
const seen = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const openAuth = (mode: AuthMode = 'login') => window.dispatchEvent(new CustomEvent('airfx:auth', { detail: mode }));
export const openAbout = () => window.dispatchEvent(new Event('airfx:about'));
export const openIntro = () => window.dispatchEvent(new Event('airfx:intro'));

function usePreviews() {
  const list = useSyncExternalStore(previews.subscribe, previews.get);
  useEffect(() => { previews.start(); }, []);
  return list;
}

/* ───────────── Intro ───────────── */

function Tile({ p, i, className = '' }: { p?: Preview; i: number; className?: string }) {
  return (
    <figure className={`tile ${p ? '' : 'tile--wait'} ${className}`} style={{ ['--i' as string]: i }}>
      {p && <img src={p.url} alt={`${p.name} effect`} draggable={false} />}
      <figcaption className="mono"><span>{String(i + 1).padStart(2, '0')}</span>{p?.name ?? 'Rendering'}</figcaption>
    </figure>
  );
}

/** Photos, videos and GIFs in turn, each with a different effect running live. */
function LiveHero() {
  return (
    <LiveFx
      className="hero"
      caption={(s) => (
        <>
          <div className="hero__types mono" aria-label="Works on">
            {(['photo', 'video', 'gif'] as const).map((t) => <span key={t} className={s.item.type === t ? 'on' : ''}>{TYPE_NAME[t]}</span>)}
          </div>
          <div className="hero__cap mono">
            <span>{String(s.index + 1).padStart(2, '0')} / {String(s.count).padStart(2, '0')}</span>
            <strong>{s.effectName}</strong>
          </div>
          <span className="hero__tag mono">Live · {TYPE_NAME[s.item.type]}</span>
        </>
      )}
    />
  );
}

function Ticker() {
  const names = LIBRARY.filter((e) => e.category !== 'adjust').map((e) => e.name);
  const row = names.map((n) => <span key={n}>{n}<i aria-hidden>✳</i></span>);
  return (
    <div className="ticker" aria-hidden>
      <div className="ticker__track">{row}{row}</div>
    </div>
  );
}

/**
 * The front page's centrepiece: the AirFx lettering from the logo artwork, as
 * large as the screen allows, in lime. It is vector, so it is sharp at any size.
 * The original A mark stays in the top bar.
 */
function Lockup() {
  return (
    <h1 className="sp__lockup">
      <span className="sr-only">AirFx</span>
      <svg className="sp__word" viewBox="411 2046 847 217" aria-hidden><path d={WORD_PATH} fillRule="evenodd" /></svg>
    </h1>
  );
}

/**
 * The live preview and the effect tiles laid over each other like prints on a
 * table. They float gently; moving the pointer over them tilts the layers
 * apart (nearer ones move more) and the card under the pointer lifts.
 */
function Collage({ list }: { list: Preview[] }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
    const step = () => {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      el.style.setProperty('--mx', x.toFixed(3)); el.style.setProperty('--my', y.toFixed(3));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1; ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      kick();
    };
    const leave = () => { tx = 0; ty = 0; kick(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, []);
  return (
    <section ref={ref} className="sp__collage" aria-label="Effect previews">
      <div className="sp__card sp__card--hero" style={{ ['--i' as string]: 0 }}>
        <LiveHero />
        <span className="sp__sticker mono" aria-hidden>Live<br />Render</span>
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`sp__card sp__card--t${i}`} style={{ ['--i' as string]: i + 1 }}><Tile p={list[i]} i={i} /></div>
      ))}
    </section>
  );
}

export function Splash({ onEnter, onAuth, onAbout }: { onEnter?: () => void; onAuth: (m: AuthMode) => void; onAbout: () => void }) {
  const list = usePreviews();
  const [phase, setPhase] = useState<'intro' | 'ready'>(() => (reduced() ? 'ready' : 'intro'));
  // Skipping ends the dot opening at once; otherwise it runs to the end on its own.
  const [skipped, setSkipped] = useState(false);
  // Only a guard for a page that never draws (the dot field reveals the page itself).
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setPhase('ready'), (DOT_INTRO_SECONDS + 1) * 1000);
    return () => clearTimeout(t);
  }, [phase]);
  const count = LIBRARY.filter((e) => e.category !== 'adjust').length;
  const year = new Date().getFullYear();
  // Focus Enter for keyboards, without scrolling the phone layout.
  const enterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (phase === 'ready') enterRef.current?.focus({ preventScroll: true }); }, [phase]);

  return (
    <div className={`sp sp--${phase}`} role="dialog" aria-modal="true" aria-label="Welcome to AirFx">
      <DotField intro={!skipped} onReveal={() => setPhase('ready')} />
      <header className="sp__bar">
        <span className="sp__mark-home"><HomeLogo /></span>
        <span className="sp__badge mono">Visual Playground <em>©{year}</em></span>
        <nav className="sp__nav">
          {phase === 'intro' && <button className="pill pill--ink pill--sm" onClick={() => { setSkipped(true); setPhase('ready'); }}>Skip Intro</button>}
          <button className="pill pill--ink pill--sm" onClick={onAbout}>Info</button>
          {cloudEnabled && <button className="pill pill--ink pill--sm sp__hide-sm" onClick={() => onAuth('login')}>Log In</button>}
        </nav>
      </header>

      <main className="sp__main sp__main--stage">
        <Collage list={list} />
        <section className="sp__copy">
          <p className="sp__kicker mono">(01) {count} effects · images · video · motion · sound</p>
          <Lockup />
          <p className="sp__lead">{INTRO_TEXT}</p>
          <div className="sp__cta">
            {onEnter && <button ref={enterRef} className="pill pill--ink-solid pill--lg" onClick={onEnter}>Enter AirFx <span aria-hidden>→</span></button>}
            {cloudEnabled && <button className="pill pill--ink pill--lg" onClick={() => onAuth('signup')}>Create Account</button>}
            {cloudEnabled && <button className="pill pill--ink pill--lg" onClick={() => onAuth('login')}>Log In</button>}
          </div>
        </section>
      </main>

      <footer className="sp__foot">
        <div className="sp__base">
          <p className="sp__fine mono">{onEnter ? 'No account needed to start · ' : ''}Runs in your browser · Your files stay on your device · Created by {CREATOR.alias}</p>
        </div>
        <Ticker />
      </footer>
    </div>
  );
}


/* ───────────── Log in / Sign up ───────────── */

const HEAD: Record<AuthMode, [string, string]> = {
  login: ['Welcome back.', 'Log in to open your projects, presets and media on any device.'],
  signup: ['Make an account.', 'Free. Keeps your projects, presets and media in your own private space.'],
  forgot: ['Reset password.', 'Enter your email and we will send a link to choose a new password.'],
};

export function AuthScreen({ initial = 'login', onBack, backLabel = 'Back', onGuest }: { initial?: AuthMode; onBack?: () => void; backLabel?: string; onGuest?: () => void }) {
  const list = usePreviews();
  const [mode, setMode] = useState<AuthMode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!onBack) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onBack]);
  const go = (m: AuthMode) => { setMode(m); setMsg(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'login') { await account.signIn(email.trim(), password); onBack?.(); }
      else if (mode === 'signup') {
        const r = await account.signUp(email.trim(), password, name);
        if (r.needsConfirmation) setMsg({ ok: true, text: `Almost there: we sent a confirmation link to ${email.trim()}. Open it to activate your account, then log in.` });
        else onBack?.();
      } else {
        await account.sendReset(email.trim());
        setMsg({ ok: true, text: 'If an account uses that email, a link to set a new password is on its way.' });
      }
    } catch (err) { setMsg({ ok: false, text: explain(err) }); }
    finally { setBusy(false); }
  };
  const [title, sub] = HEAD[mode];

  return (
    <div className="auth" role="dialog" aria-modal="true" aria-label={title}>
      <header className="brandbar">
        {onBack ? <button className="pill" onClick={onBack}><span aria-hidden>←</span> {backLabel}</button> : <span />}
        <span className="brandbar__mid mono">Account</span>
        <HomeLogo />
      </header>
      <main className="auth__main">
        <aside className="auth__art" aria-hidden>
          <div className="auth__mosaic">
            <LiveFx className="tile" offset={2} every={3600} caption={(s) => <figcaption className="mono"><span>{TYPE_NAME[s.item.type]}</span>{s.effectName}</figcaption>} />
            {Array.from({ length: 3 }, (_, i) => <Tile key={i} p={list[i + 4]} i={i + 4} />)}
          </div>
          <p className="auth__quote">Glitch it, melt it, print it, <em>make it move.</em></p>
        </aside>

        <section className="auth__panel">
          {mode !== 'forgot' && (
            <div className="auth__tabs" role="tablist">
              <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => go('login')}>Log In</button>
              <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => go('signup')}>Sign Up</button>
            </div>
          )}
          <h1 className="auth__title">{title}</h1>
          <p className="auth__sub">{sub}</p>
          <form className="auth__form" onSubmit={submit}>
            {mode === 'signup' && <label className="field"><span className="mono">Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder="What should we call you?" /></label>}
            <label className="field"><span className="mono">Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder="you@example.com" /></label>
            {mode !== 'forgot' && (
              <label className="field">
                <span className="mono">Password{mode === 'signup' && <em> · at least 8 characters</em>}</span>
                <span className="field__pw">
                  <input type={show ? 'text' : 'password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
                  <button type="button" className="field__eye mono" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
                </span>
              </label>
            )}
            {mode === 'login' && <button type="button" className="text-link auth__forgot" onClick={() => go('forgot')}>Forgot password?</button>}
            {msg && <p className={`auth__msg ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</p>}
            <button className="pill pill--lime pill--lg pill--block" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Log In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}</button>
            {mode === 'forgot' && <button type="button" className="pill pill--block" onClick={() => go('login')}>Back To Log In</button>}
          </form>
          {onGuest && (
            <>
              <div className="auth__or mono"><span>or</span></div>
              <button className="pill pill--lg pill--block pill--ghost" onClick={onGuest}>Continue As Guest</button>
              <p className="auth__fine">Guest work saves in this browser only. You can create an account at any time.</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/* ───────────── The gate ───────────── */

type View = { screen: 'splash' } | { screen: 'auth'; mode: AuthMode; from: 'splash' | 'editor' } | { screen: 'about' };

/**
 * Shows the intro once per browser session to visitors who are not signed in,
 * and handles the auth and About screens for the whole app.
 */
export function Intro() {
  const a = useAccount();
  const [view, setView] = useState<View | null>(() => {
    if (location.hash === '#about') return { screen: 'about' };
    return seen() && !requireAccount ? null : { screen: 'splash' };
  });
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    const intro = () => { setAuto(false); setView({ screen: 'splash' }); };
    const auth = (e: Event) => { setAuto(false); setView({ screen: 'auth', mode: ((e as CustomEvent).detail as AuthMode) || 'login', from: 'editor' }); };
    const about = () => { setAuto(false); setView({ screen: 'about' }); };
    window.addEventListener('airfx:intro', intro);
    window.addEventListener('airfx:auth', auth);
    window.addEventListener('airfx:about', about);
    return () => { window.removeEventListener('airfx:intro', intro); window.removeEventListener('airfx:auth', auth); window.removeEventListener('airfx:about', about); };
  }, []);

  // Signed in: the intro and log-in screens have done their job.
  useEffect(() => {
    if (!a.user) return;
    markSeen();
    setView((v) => (v && (v.screen === 'auth' || (v.screen === 'splash' && auto)) ? null : v));
  }, [a.user, auto]);

  const mustSignIn = requireAccount && a.ready && !a.user;
  const enter = mustSignIn ? undefined : () => { markSeen(); setView(null); };
  const closeAbout = () => {
    if (location.hash === '#about') history.replaceState(null, '', location.pathname + location.search);
    setView(mustSignIn ? { screen: 'splash' } : null);
  };

  // Wait for the stored session, so a signed-in visitor never sees the intro flash.
  if (!a.ready && cloudEnabled) return null;
  const v: View | null = view ?? (mustSignIn ? { screen: 'splash' } : null);
  if (!v) return null;
  if (v.screen === 'about') return <About onClose={closeAbout} />;
  if (v.screen === 'auth') {
    const fromIntro = v.from === 'splash' || mustSignIn;
    return <AuthScreen key={v.mode} initial={v.mode} onBack={fromIntro ? () => setView({ screen: 'splash' }) : () => setView(null)} backLabel={fromIntro ? 'Intro' : 'Back To Editor'} onGuest={fromIntro ? enter : undefined} />;
  }
  if (a.user && auto) return null;
  return <Splash onEnter={enter} onAuth={(mode) => setView({ screen: 'auth', mode, from: 'splash' })} onAbout={() => setView({ screen: 'about' })} />;
}
