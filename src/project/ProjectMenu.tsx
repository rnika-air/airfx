import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PROJECT_ACCEPT, PROJECT_EXT, type ProjectDoc } from './format';
import type { SaveStatus } from './useProject';

interface MenuProps {
  status: SaveStatus;
  hasContent: boolean;
  onSave: () => Promise<{ name: string; size: number }>;
  onOpen: (f: File) => Promise<string[]>;
  /** pause playback etc. before replacing the project */
  onBeforeOpen: () => void;
  /** Cloud projects, when accounts are available. */
  cloud?: { signedIn: boolean; current: string | null; onSave: (asNew: boolean) => Promise<{ name: string; size: number }>; onBrowse: () => void };
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "Project ▾" dropdown with Save / Open, plus the autosave status chip. */
export function ProjectMenu({ status, hasContent, onSave, onOpen, onBeforeOpen, cloud }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const save = async () => {
    setOpen(false);
    setBusy('Saving project…');
    try {
      const r = await onSave();
      setNote({ kind: 'ok', text: `Saved ${r.name} (${(r.size / 1048576).toFixed(1)} MB)` });
    } catch (e) {
      setNote({ kind: 'err', text: `Save failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const saveCloud = async (asNew: boolean) => {
    setOpen(false);
    setBusy('Saving to My Projects…');
    try {
      const r = await cloud!.onSave(asNew);
      setNote({ kind: 'ok', text: `Saved “${r.name}” to My Projects (${(r.size / 1048576).toFixed(1)} MB)` });
    } catch (e) {
      setNote({ kind: 'err', text: `Cloud save failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const pick = () => {
    setOpen(false);
    if (hasContent) setConfirmOpen(true);
    else fileRef.current?.click();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  });

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), note.kind === 'ok' ? 4000 : 9000);
    return () => clearTimeout(id);
  }, [note]);

  const chip =
    busy ? <span className="savechip savechip--busy">{busy}</span>
    : status.kind === 'saving' ? <span className="savechip savechip--busy">Autosaving…</span>
    : status.kind === 'saved' ? <span className="savechip" title="Autosaved in this browser">● Saved {time(status.at)}</span>
    : status.kind === 'error' ? <span className="savechip savechip--err" title={status.message}>Autosave failed</span>
    : null;

  return (
    <div className="projmenu" ref={wrap}>
      <button className="btn btn--sm" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        Project ▾
      </button>
      {chip}
      {open && (
        <div className="projmenu__list" role="menu">
          <button role="menuitem" onClick={save}>
            <span>Save Project</span><kbd>Ctrl+Shift+S</kbd>
          </button>
          <button role="menuitem" onClick={pick}>
            <span>Open Project…</span><kbd>{PROJECT_EXT}</kbd>
          </button>
          {cloud && (cloud.signedIn ? (<>
            <hr className="projmenu__sep" />
            <button role="menuitem" onClick={() => saveCloud(false)}><span>{cloud.current ? 'Save To My Projects' : 'Save To My Projects (New)'}</span><kbd>Cloud</kbd></button>
            {cloud.current && <button role="menuitem" onClick={() => saveCloud(true)}><span>Save As New Cloud Project</span></button>}
            <button role="menuitem" onClick={() => { setOpen(false); cloud.onBrowse(); }}><span>My Projects…</span></button>
          </>) : (<>
            <hr className="projmenu__sep" />
            <button role="menuitem" onClick={() => { setOpen(false); cloud.onBrowse(); }}><span>Log In To Save Online…</span></button>
          </>))}
          <p className="projmenu__hint">
            Your work also autosaves in this browser and is offered back next time. Save a project file to keep it permanently or move it to another computer.
          </p>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={PROJECT_ACCEPT}
        hidden
        data-testid="project-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          onBeforeOpen();
          setBusy('Opening project…');
          try {
            const missing = await onOpen(f);
            setNote(missing.length
              ? { kind: 'err', text: `Opened, but some media could not be loaded: ${missing.join(', ')}` }
              : { kind: 'ok', text: `Opened ${f.name}` });
          } catch (err) {
            setNote({ kind: 'err', text: (err as Error).message });
          } finally {
            setBusy(null);
          }
        }}
      />
      {note && (
        <div className={`toast toast--fixed ${note.kind === 'err' ? 'toast--error' : 'toast--ok'}`} role="status">
          <span>{note.text}</span>
          <button className="btn btn--icon btn--sm" onClick={() => setNote(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {confirmOpen && (
        <ConfirmDialog
          title="Open another project?"
          message="The current project will be replaced. Save it first (Project → Save) if you want to keep it."
          confirmLabel="Choose File…"
          onConfirm={() => {
            setConfirmOpen(false);
            fileRef.current?.click();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

/** Shown on startup when the previous session was autosaved. */
export function RestoreBanner({ doc, onRestore, onDiscard, onClose }: { doc: ProjectDoc; onRestore: () => Promise<string[]>; onDiscard: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const layers = doc.comp.layers.length;
  const bits = [
    doc.studioMedia && doc.studioMedia.name,
    layers && `${layers} timeline layer${layers > 1 ? 's' : ''}`,
    doc.song && `song “${doc.song.name}”`,
  ].filter(Boolean);
  if (warn) {
    return (
      <div className="restore restore--warn" role="alert">
        <span>{warn}</span>
        <button className="btn btn--sm" onClick={onClose}>OK</button>
      </div>
    );
  }
  return (
    <div className="restore" role="dialog" aria-label="Restore previous session">
      <div>
        <strong>Continue where you left off?</strong>
        <span className="muted"> “{doc.name}” · {new Date(doc.savedAt).toLocaleString()}{bits.length ? ` · ${bits.join(' · ')}` : ''}</span>
      </div>
      <div className="restore__actions">
        <button
          className="btn btn--accent btn--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const missing = await onRestore();
              if (missing.length) setWarn(`Restored, but some media was missing: ${missing.join(', ')}`);
              else onClose();
            } catch (e) {
              setWarn(`Could not restore: ${(e as Error).message}`);
            }
          }}
        >
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button className="btn btn--sm" disabled={busy} onClick={onDiscard}>Start Fresh</button>
      </div>
    </div>
  );
}
