import { forwardRef, useImperativeHandle, useRef } from 'react';
import { ACCEPT_ATTR } from '../hooks/useMedia';

export interface MediaImporterHandle {
  open: () => void;
}

/** Hidden file input; files go straight to an object URL — never uploaded. */
export const MediaImporter = forwardRef<MediaImporterHandle, { onFile: (file: File) => void }>(
  function MediaImporter({ onFile }, ref) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);
    return (
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        data-testid="media-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ''; // allow re-importing the same file
        }}
      />
    );
  },
);
