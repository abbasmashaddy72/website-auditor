'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`pill ${status}`} title={`Current status: ${status.replaceAll('_', ' ')}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
export function InlineAlert({
  tone = 'info',
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
      className={`ui-alert ui-alert--${tone} ${className}`}
    >
      {children}
    </div>
  );
}
export function EmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p>{message}</p>
      {children}
    </div>
  );
}
