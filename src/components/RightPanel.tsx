import type { ReactNode } from 'react';

export type RightTab = 'params' | 'adjust' | 'scene' | 'audio' | 'presets';

interface Props {
  /** The Adjust tab has changes in it. */
  adjusted?: boolean;
  tab: RightTab;
  onTab: (t: RightTab) => void;
  audioActive: boolean;
  linkCount: number;
  children: ReactNode;
}

/** Right sidebar shell: Stack / Adjust / Scene / Audio / Presets. */
export function RightPanel({ tab, onTab, audioActive, linkCount, adjusted, children }: Props) {
  const T = (id: RightTab, label: ReactNode) => (
    <button role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'tab--on' : ''}`} onClick={() => onTab(id)}>{label}</button>
  );
  return (
    <aside className="sidebar sidebar--right" aria-label="Controls">
      <div className="tabs tabs--5" role="tablist">
        {T('params', 'Stack')}
        {T('adjust', <>Adjust {adjusted && <span className="tab__dot" />}</>)}
        {T('scene', 'Scene')}
        {T('audio', <>Audio {audioActive && <span className="tab__dot" />}{linkCount > 0 && <span className="tab__count">{linkCount}</span>}</>)}
        {T('presets', 'Presets')}
      </div>
      {children}
    </aside>
  );
}
