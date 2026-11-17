import { useEffect, useRef, useState, type ReactNode } from 'react';
import { account, limits, useAccount } from './account';
import { APP_VERSION, cloudEnabled, explain } from './client';
import { AuthScreen, openAbout, type AuthMode } from '../intro/Intro';
import { cloudProjects, mediaLibrary, type CloudProject, type MediaItem } from './storage';
import { useInstall } from '../pwa/install';

const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);
const when = (s: string) => new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => onClose && e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal--wide' : 'modal--sm'} acct`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head"><h2 className="panel-title">{title}</h2>{onClose && <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close">×</button>}</div>
        {children}
      </div>
    </div>
  );
}

/* ───────────── Signing in ───────────── */

/** Log in, sign up or reset: the full-screen account screen, opened from the editor. */
export function AuthDialog({ initial = 'login', onClose }: { initial?: AuthMode; onClose?: () => void }) {
  return <AuthScreen initial={initial} onBack={onClose} backLabel="Back To Editor" />;
}

/** After following a reset link: choose a new password. */
export function RecoveryDialog() {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Choose A New Password" onClose={() => account.endRecovery()}>
      <form className="acct__form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await account.setPassword(pw); } catch (err) { setMsg(explain(err)); } finally { setBusy(false); } }}>
        <label className="ctl"><span className="label">New Password</span><input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus /></label>
        {msg && <p className="small error">{msg}</p>}
        <button className="btn btn--accent btn--block" disabled={busy}>Save Password</button>
      </form>
    </Modal>
  );
}

/* ───────────── Account ───────────── */

function Meter({ label, used, max, unit = '' }: { label: string; used: number; max: number; unit?: string }) {
  const pct = Math.min(100, (used / Math.max(1, max)) * 100);
  return (
    <div className="acct__meter">
      <div className="ctl__row"><span className="label">{label}</span><span className="small">{unit === 'bytes' ? `${mb(used)} of ${mb(max)}` : `${used} of ${max}`}</span></div>
      <div className="progress"><div className="progress__bar" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : undefined }} /></div>
    </div>
  );
}

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const a = useAccount();
  const install = useInstall();
  const [name, setName] = useState(a.profile?.display_name ?? '');
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(a.profile?.display_name ?? ''); }, [a.profile?.display_name]);
  const act = async (f: () => Promise<unknown>, ok: string) => { setBusy(true); setMsg(null); try { await f(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: explain(e) }); } finally { setBusy(false); } };
  const plan = limits(), u = a.usage;

  return (
    <Modal title="Your Account" onClose={onClose} wide>
      <div className="acct__grid">
        <section>
          <fieldset className="group"><legend className="group__title">Profile</legend>
            <label className="ctl"><span className="label">Display Name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            <p className="small muted">Signed in as {a.user?.email}. Member since {a.profile ? new Date(a.profile.created_at).toLocaleDateString() : '…'}.</p>
            <button className="btn btn--sm" disabled={busy || name === (a.profile?.display_name ?? '')} onClick={() => act(() => account.updateProfile({ display_name: name.trim() }), 'Profile saved.')}>Save Profile</button>
          </fieldset>
          <fieldset className="group"><legend className="group__title">Security</legend>
            <label className="ctl"><span className="label">New Password</span><input className="input" type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
            <button className="btn btn--sm" disabled={busy || pw.length < 8} onClick={() => act(async () => { await account.setPassword(pw); setPw(''); }, 'Password changed.')}>Change Password</button>
            <label className="ctl" style={{ marginTop: 10 }}><span className="label">New Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <button className="btn btn--sm" disabled={busy || !email.includes('@')} onClick={() => act(async () => { await account.changeEmail(email.trim()); setEmail(''); }, 'Check both inboxes: the change completes when you confirm it.')}>Change Email</button>
          </fieldset>
        </section>
        <section>
          <fieldset className="group"><legend className="group__title">Plan · {plan.name}</legend>
            {u ? (<>
              <Meter label="Cloud Storage" used={u.storage_bytes} max={plan.storage_mb * 1048576} unit="bytes" />
              <Meter label="Projects" used={u.projects} max={plan.max_projects} />
              <Meter label="Saved Presets" used={u.presets} max={plan.cloud_presets} />
            </>) : <p className="small muted">Loading usage…</p>}
            <p className="small muted">Cloud files up to {plan.max_upload_mb} MB each. Exports are not limited. Pro and Studio plans with more space are coming; payments are not active yet.</p>
          </fieldset>
          <fieldset className="group"><legend className="group__title">App</legend>
            {install.canInstall && <button className="btn btn--sm btn--accent" onClick={install.prompt}>Install AirFx As An App</button>}
            {install.installed && <p className="small ok">AirFx is installed on this device.</p>}
            {!install.canInstall && !install.installed && <p className="small muted">{install.hint}</p>}
            <p className="small muted">AirFx {APP_VERSION}. Your effects run on this device; the server only stores your account, projects and presets.</p>
            <button className="text-link small" onClick={() => { onClose(); openAbout(); }}>About AirFx, contact and legal</button>
          </fieldset>
          <div className="acct__row">
            <button className="btn" disabled={busy} onClick={async () => { await account.signOut(); onClose(); }}>Log Out</button>
          </div>
          <fieldset className="group acct__danger"><legend className="group__title">Delete Account</legend>
            <p className="small muted">Deletes your account, cloud projects, presets and media for good. Type DELETE to confirm.</p>
            <div className="acct__row"><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" /><button className="btn btn--danger btn--sm" disabled={busy || confirm !== 'DELETE'} onClick={() => act(async () => { await account.deleteAccount(); onClose(); }, 'Account deleted.')}>Delete</button></div>
          </fieldset>
        </section>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</p>}
    </Modal>
  );
}

/** Top-bar button: Log In, or the account initials. */
export function AccountButton() {
  const a = useAccount();
  const [open, setOpen] = useState<'auth' | 'account' | null>(null);
  if (!cloudEnabled) return null;
  const initials = (a.profile?.display_name || a.user?.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  return (
    <>
      {a.user
        ? <button className="btn acct__me" onClick={() => setOpen('account')} title={`Account: ${a.user.email}`} aria-label="Your account">{initials}</button>
        : <button className="btn" onClick={() => setOpen('auth')} disabled={!a.ready}>Log In</button>}
      {open === 'auth' && !a.user && <AuthDialog onClose={() => setOpen(null)} />}
      {open === 'account' && a.user && <AccountDialog onClose={() => setOpen(null)} />}
      {a.recovering && <RecoveryDialog />}
    </>
  );
}

/* ───────────── My Projects / My Media ───────────── */

export function CloudDialog({ onClose, onOpenProject, onOpenMedia }: { onClose: () => void; onOpenProject: (p: CloudProject, blob: Blob) => Promise<void>; onOpenMedia: (f: File) => void }) {
  const a = useAccount();
  const [tab, setTab] = useState<'projects' | 'media'>('projects');
  const [projects, setProjects] = useState<CloudProject[] | null>(null);
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = async () => {
    setErr(null);
    try {
      if (tab === 'projects') { const l = await cloudProjects.list(); setProjects(l); setThumbs(await cloudProjects.thumbs(l)); }
      else setMedia(await mediaLibrary.list());
    } catch (e) { setErr(explain(e)); }
  };
  useEffect(() => { if (a.user) load(); }, [tab, a.user]); // eslint-disable-line react-hooks/exhaustive-deps
  const task = async (label: string, f: () => Promise<unknown>) => { setBusy(label); setErr(null); try { await f(); } catch (e) { setErr(explain(e)); } finally { setBusy(null); } };

  if (!a.user) return <AuthDialog onClose={onClose} />;
  return (
    <Modal title="My Projects" onClose={onClose} wide>
      <div className="segmented segmented--2 segmented--compact"><button className={tab === 'projects' ? 'on' : ''} onClick={() => setTab('projects')}>Projects</button><button className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}>Media</button></div>
      {a.usage && <p className="small muted">{mb(a.usage.storage_bytes)} of {mb(limits().storage_mb * 1048576)} cloud storage used · {limits().name} plan</p>}
      {err && <p className="small error" role="alert">{err}</p>}
      {busy && <p className="small warn" role="status">{busy}</p>}
      {tab === 'projects' && (
        <div className="acct__list">
          {projects === null && <p className="small muted">Loading…</p>}
          {projects?.length === 0 && <p className="small muted">No cloud projects yet. In the editor, use Project › Save To My Projects.</p>}
          {projects?.map((p) => (
            <div key={p.id} className="acct__item">
              <div className="acct__thumb">{p.thumb_path && thumbs[p.thumb_path] ? <img src={thumbs[p.thumb_path]} alt="" /> : null}</div>
              <div className="acct__info">
                {renaming === p.id
                  ? <input className="input" defaultValue={p.name} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') task('Renaming…', async () => { await cloudProjects.rename(p.id, (e.target as HTMLInputElement).value); setRenaming(null); await load(); }); if (e.key === 'Escape') setRenaming(null); }} />
                  : <strong>{p.name}</strong>}
                <span className="small muted">{mb(p.size_bytes)} · saved {when(p.updated_at)}</span>
              </div>
              <div className="acct__actions">
                <button className="btn btn--sm btn--accent" disabled={!!busy} onClick={() => task('Opening…', async () => { const blob = await cloudProjects.open(p); await onOpenProject(p, blob); onClose(); })}>Open</button>
                <button className="btn btn--sm" disabled={!!busy} onClick={() => setRenaming(p.id)}>Rename</button>
                <button className="btn btn--sm" disabled={!!busy} onClick={() => { if (confirm(`Delete “${p.name}” from your cloud projects?`)) task('Deleting…', async () => { await cloudProjects.remove(p); await load(); }); }} aria-label={`Delete ${p.name}`}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'media' && (
        <>
          <input ref={file} type="file" hidden accept="image/*,video/*,audio/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) task(`Uploading ${f.name}…`, async () => { await mediaLibrary.upload(f); await load(); }); }} />
          <button className="btn btn--sm" disabled={!!busy} onClick={() => file.current?.click()}>Upload Media</button>
          <div className="acct__list">
            {media === null && <p className="small muted">Loading…</p>}
            {media?.length === 0 && <p className="small muted">Upload pictures, videos and songs here to use them on any device.</p>}
            {media?.map((m) => (
              <div key={m.id} className="acct__item">
                <div className="acct__info"><strong>{m.name}</strong><span className="small muted">{m.mime} · {mb(m.size_bytes)} · {when(m.created_at)}</span></div>
                <div className="acct__actions">
                  <button className="btn btn--sm btn--accent" disabled={!!busy} onClick={() => task('Downloading…', async () => { onOpenMedia(await mediaLibrary.download(m)); onClose(); })}>Use In Editor</button>
                  <button className="btn btn--sm" disabled={!!busy} onClick={() => { if (confirm(`Delete “${m.name}”?`)) task('Deleting…', async () => { await mediaLibrary.remove(m); await load(); }); }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
