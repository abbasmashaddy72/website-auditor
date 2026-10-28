'use client';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant =
  'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'danger-outline' | 'outline';
export type ButtonSize = 'small' | 'medium' | 'large';

/** Shared button. Native type remains configurable; never implicitly submits forms. */
export function ActionButton({
  variant = 'secondary',
  size = 'medium',
  loading = false,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      aria-busy={loading}
      disabled={loading || props.disabled}
      title={
        props.title || (props['aria-label'] && typeof children !== 'string' ? props['aria-label'] : undefined)
      }
      className={`ui-button ui-button--${variant} ui-button--${size} ${props.className || ''}`}
    >
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
