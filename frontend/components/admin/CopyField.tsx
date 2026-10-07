'use client';

import { useId, useRef, useState } from 'react';
import { Icon } from '../Icons';

/**
 * A read-only text box with a Copy button. Uses the clipboard when the browser allows it; otherwise it selects the text
 * so the person can press Ctrl+C (or Cmd+C) themselves.
 */
export default function CopyField({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setState('copied');
      setTimeout(() => setState('idle'), 3000);
    } catch {
      input.current?.focus();
      input.current?.select();
      setState('manual');
    }
  };

  return (
    <div className="adm-copy">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="adm-copy-row">
        <input ref={input} id={id} className="code-input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn-sm" type="button" onClick={copy}>
          <Icon name={state === 'copied' ? 'check' : 'copy'} size={13} /> {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {state === 'copied' && 'Link copied.'}
        {state === 'manual' && 'The link is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.'}
      </p>
    </div>
  );
}
