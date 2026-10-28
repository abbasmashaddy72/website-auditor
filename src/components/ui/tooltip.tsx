'use client';

import { cloneElement, isValidElement, useId, useState, type ReactNode } from 'react';

/** Mouse, keyboard and touch friendly context help. Keep important labels visible. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // The described-by relationship belongs on the focusable child, not its non-focusable wrapper.
  const child = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })
    : children;
  return (
    <span
      className="ui-tooltip-anchor"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') setOpen((value) => !value);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <span>{child}</span>
      <span role="tooltip" id={id} className={`ui-tooltip ${open ? 'ui-tooltip--open' : ''}`}>
        {text}
      </span>
    </span>
  );
}
