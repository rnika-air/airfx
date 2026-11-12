import type { AudioMod, ModMap, ParamDef, ParamValue, ParamValues } from '../effects/types';
import { ColorControl, ImagesControl, ModRow, RangeControl, SeedControl, SelectControl, TextControl, ToggleControl } from './controls';
import { CustomControl } from './editors';

export type KeyState = 'none' | 'animated' | 'on';

/** Optional keyframe hooks: when given, range params get a ◆ toggle. */
export interface KeyframeHooks {
  state: (key: string) => KeyState;
  toggle: (key: string) => void;
}

interface Props {
  defs: ParamDef[];
  values: ParamValues;
  onChange: (key: string, value: ParamValue) => void;
  mods?: ModMap;
  onMod?: (key: string, mod: AudioMod | null) => void;
  audioDefaults?: ModMap;
  keyframes?: KeyframeHooks;
  /** Prefix for DOM ids so two editors on screen don't collide. */
  idPrefix?: string;
}

function Single({ def, value, onChange }: { def: Exclude<ParamDef, { type: 'range' }>; value: ParamValue; onChange: (v: ParamValue) => void }) {
  switch (def.type) {
    case 'select':
      return <SelectControl def={def} value={value as string} onChange={onChange} />;
    case 'color':
      return <ColorControl def={def} value={value as string} onChange={onChange} />;
    case 'toggle':
      return <ToggleControl def={def} value={value as boolean} onChange={onChange} />;
    case 'seed':
      return <SeedControl def={def} value={value as number} onChange={onChange} />;
    case 'text':
      return <TextControl def={def} value={value as string} onChange={onChange} />;
    case 'images':
      return <ImagesControl def={def} value={value as string} onChange={onChange} />;
    case 'custom':
      return <CustomControl def={def} value={value as string} onChange={onChange} />;
  }
}

/**
 * Renders any parameter schema as grouped controls. Used by the Effects
 * parameter panel and by every timeline layer inspector.
 */
export function PropsEditor({ defs, values, onChange, mods, onMod, audioDefaults, keyframes }: Props) {
  const groups: { name: string; defs: ParamDef[] }[] = [];
  for (const def of defs) {
    if (def.visibleWhen && !def.visibleWhen(values)) continue;
    const name = def.group ?? 'Settings';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, defs: [] }));
    g.defs.push(def);
  }

  return (
    <>
      {groups.map((g) => (
        <fieldset key={g.name} className="group">
          <legend className="group__title">{g.name}</legend>
          {g.defs.map((def) => {
            const value = values[def.key] ?? def.default;
            if (def.type !== 'range') {
              return <Single key={def.key} def={def} value={value} onChange={(v) => onChange(def.key, v)} />;
            }
            const mod = mods?.[def.key];
            const ks = keyframes?.state(def.key);
            const extra = (keyframes || onMod) && (
              <>
                {keyframes && (
                  <button
                    className={`key-btn key-btn--${ks}`}
                    onClick={() => keyframes.toggle(def.key)}
                    title={ks === 'on' ? 'Remove keyframe here' : 'Add keyframe at the playhead'}
                    aria-label={`Keyframe ${def.label}`}
                    aria-pressed={ks === 'on'}
                  >
                    ◆
                  </button>
                )}
                {onMod && (
                  <button
                    className={`link-btn ${mod ? 'link-btn--on' : ''}`}
                    onClick={() => onMod(def.key, mod ? null : (audioDefaults?.[def.key] ?? { band: 'bass', amount: 0.3 }))}
                    title={mod ? 'Linked to audio — click to unlink' : 'Link this parameter to audio'}
                    aria-pressed={!!mod}
                    aria-label={`Link ${def.label} to audio`}
                  >
                    ∿
                  </button>
                )}
              </>
            );
            return (
              <div key={def.key} className={mod ? 'ctl-linked' : undefined}>
                <RangeControl def={def} value={value as number} onChange={(v) => onChange(def.key, v)} extra={extra} />
                {mod && onMod && <ModRow mod={mod} onChange={(m) => onMod(def.key, m)} onRemove={() => onMod(def.key, null)} />}
              </div>
            );
          })}
        </fieldset>
      ))}
    </>
  );
}
