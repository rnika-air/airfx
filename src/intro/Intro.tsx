import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Wordmark } from '../components/Wordmark';
import { LIBRARY } from '../effects/registry';
import { account, useAccount } from '../cloud/account';
import { cloudEnabled, explain, requireAccount } from '../cloud/client';
import { About } from '../about/About';
import { CREATOR } from '../about/config';
import { previews, type Preview } from './previews';
import { LiveFx, TYPE_NAME } from './LiveFx';

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

export function Splash({ onEnter, onAuth, onAbout }: { onEnter?: () => void; onAuth: (m: AuthMode) => void; onAbout: () => void }) {
  const list = usePreviews();
  const [phase, setPhase] = useState<'intro' | 'ready'>(() => (reduced() ? 'ready' : 'intro'));
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setPhase('ready'), 1700);
    return () => clearTimeout(t);
  }, [phase]);
  const count = LIBRARY.filter((e) => e.category !== 'adjust').length;

  return (
    <div className={`sp sp--${phase}`} role="dialog" aria-modal="true" aria-label="Welcome to AirFx">
      <div className="sp__wipe" aria-hidden><span className="mono">Experimental Visual Playground</span></div>
      <header className="brandbar">
        <span className="brandbar__mark mono">AIRFX <em>©{new Date().getFullYear()}</em></span>
        <span className="brandbar__mid mono">Images · Video · Motion · Sound</span>
        <nav className="brandbar__nav">
          {phase === 'intro' && <button className="pill pill--ghost" onClick={() => setPhase('ready')}>Skip Intro</button>}
          <button className="pill" onClick={onAbout}>Info</button>
          {cloudEnabled && <button className="pill sp__hide-sm" onClick={() => onAuth('login')}>Log In</button>}
        </nav>
      </header>

      <main className="sp__main">
        <section className="sp__copy">
          <p className="sp__kicker mono">(01) — {count} effects, one playground</p>
          <h1 className="sp__word"><span className="sr-only">AIRFX</span><Wordmark size="lg" /></h1>
          <p className="sp__claim">Experimental Visual <em>Playground.</em></p>
          <p className="sp__lead">A creative platform for transforming images and videos through experimental visual effects.</p>
          <div className="sp__cta">
            {onEnter && <button className="pill pill--lime pill--lg" onClick={onEnter} autoFocus>Enter AirFx <span aria-hidden>→</span></button>}
            {cloudEnabled && <button className="pill pill--lg" onClick={() => onAuth('signup')}>Create Account</button>}
            {cloudEnabled && <button className="pill pill--lg pill--ghost" onClick={() => onAuth('login')}>Log In</button>}
          </div>
          <p className="sp__fine mono">{onEnter ? 'No account needed to start · ' : ''}Runs in your browser · Your files stay on your device</p>
        </section>

        <section className="sp__stage" aria-label="Effect previews">
          <LiveHero />
          <div className="sp__tiles">
            {Array.from({ length: 6 }, (_, i) => <Tile key={i} p={list[i + 1]} i={i} />)}
          </div>
        </section>
      </main>

      <footer className="sp__foot">
        <Ticker />
        <p className="sp__credit mono">Created by {CREATOR.name}, {CREATOR.from}</p>
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
        <Wordmark />
      </header>
      <main className="auth__main">
        <aside className="auth__art" aria-hidden>
          <div className="auth__mosaic">
            <LiveFx className="tile" offset={2} every={3600} caption={(s) => <figcaption className="mono"><span>{TYPE_NAME[s.item.type]}</span>{s.effectName}</figcaption>} />
            {Array.from({ length: 3 }, (_, i) => <Tile key={i} p={list[i + 5] ?? list[i]} i={i + 5} />)}
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
