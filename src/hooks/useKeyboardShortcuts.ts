import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  importMedia: () => void;
  exportMedia: () => void;
  togglePlay: () => void;
  closeDialogs: () => void;
  resetEffect: () => void;
  undo: () => void;
  redo: () => void;
  fit: () => void;
  actualSize: () => void;
  cycleCompare: () => void;
  toggleBypass: () => void;
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // range/color/checkbox inputs don't consume text keys
    return !['range', 'color', 'checkbox', 'radio', 'button', 'file'].includes(type);
  }
  return false;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, dialogOpen: boolean, enabled = true) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === 'Escape') {
        h.current.closeDialogs();
        return;
      }
      // Modifier shortcuts work everywhere (they don't clash with typing).
      if (mod && key === 'o') {
        e.preventDefault();
        if (!dialogOpen) h.current.importMedia();
        return;
      }
      if (mod && key === 's' && !e.shiftKey) {
        e.preventDefault();
        if (!dialogOpen) h.current.exportMedia();
        return;
      }
      if (dialogOpen || isTyping(e.target)) return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.current.redo();
        else h.current.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        h.current.redo();
        return;
      }
      if (mod || e.altKey) return;

      if (e.code === 'Space') {
        // Buttons activate on Space themselves; don't double-toggle.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        h.current.togglePlay();
      } else if (key === 'r') {
        h.current.resetEffect();
      } else if (key === 'f') {
        h.current.fit();
      } else if (key === '1') {
        h.current.actualSize();
      } else if (key === 'c') {
        h.current.cycleCompare();
      } else if (key === 'b') {
        h.current.toggleBypass();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, enabled]);
}
