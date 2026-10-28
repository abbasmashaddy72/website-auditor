'use client';

import { Archive, Trash2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ActionButton } from './button';

/** One visual treatment for destructive actions; callers must show confirmation before the mutation. */
export function DestructiveButton({
  children,
  action = 'delete',
  emphasis = 'quiet',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  action?: 'delete' | 'archive';
  emphasis?: 'quiet' | 'strong';
}) {
  const Icon = action === 'archive' ? Archive : Trash2;
  return (
    <ActionButton
      {...props}
      type={props.type || 'button'}
      variant={emphasis === 'strong' ? 'danger' : 'danger-outline'}
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span>{children}</span>
    </ActionButton>
  );
}
