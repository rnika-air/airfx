import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';
import { AccountButton } from '../cloud/ui';

export type AppMode = 'effects' | 'key' | 'cleanup' | 'depth' | 'depthlab' | 'live' | 'gesture' | 'timeline';

interface Props {
  mode: AppMode;
  onMode: (m: AppMode) => void;
  projectName: string;
  onProjectName: (name: string) => void;
  canExport: boolean;
  canNew: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onImport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Effects mode only. */
  onResetEffect?: () => void;
  resetDisabled?: boolean;
  onNewProject: () => void;
  onExport: () => void;
  /** Model status and diagnostics. */
  onAi?: () => void;
  /** Project save / open menu. */
  projectMenu?: ReactNode;
}

export function TopBar(p: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Wordmark />
        <span className="topbar__tag">FX LAB · v{__APP_VERSION__}</span>
      </div>

      <div className="segmented segmented--8 segmented--compact topbar__mode" role="tablist" aria-label="Workspace">
        {(['effects', 'key', 'cleanup', 'depth', 'depthlab', 'live', 'gesture', 'timeline'] as AppMode[]).map((m) => (
          <button key={m} role="tab" aria-selected={p.mode === m} className={p.mode === m ? 'on' : ''} onClick={() => p.onMode(m)}>
            {m === 'depthlab' ? 'Depth Lab' : m === 'gesture' ? 'Gesture Studio' : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="topbar__project">
        <span className="label">Project</span>
        <input
          className="topbar__name"
          value={p.projectName}
          onChange={(e) => p.onProjectName(e.target.value)}
          spellCheck={false}
          aria-label="Project name"
        />
        {p.projectMenu}
      </div>

      <div className="topbar__actions">
        {p.onAi && <button className="btn" onClick={p.onAi} title="AI model status and diagnostics">AI</button>}
        <button className="btn" onClick={p.onImport} title="Import media (Ctrl/Cmd + O)">
          Import Media
        </button>
        <div className="btn-group">
          <button className="btn btn--icon" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl/Cmd + Z)" aria-label="Undo">
            ↶
          </button>
          <button className="btn btn--icon" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl/Cmd + Shift + Z)" aria-label="Redo">
            ↷
          </button>
        </div>
        {p.onResetEffect && (
          <button className="btn" onClick={p.onResetEffect} disabled={p.resetDisabled} title="Reset effect to defaults (R)">
            Reset Effect
          </button>
        )}
        <button className="btn" onClick={p.onNewProject} disabled={!p.canNew} title={p.mode === 'timeline' ? 'Clear the timeline' : 'Clear media and start over'}>
          New
        </button>
        <button className="btn btn--accent" onClick={p.onExport} disabled={!p.canExport} title="Export (Ctrl/Cmd + S)">
          Export ↗
        </button>
        <AccountButton />
      </div>
    </header>
  );
}
