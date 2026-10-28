'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ActionButton, type ButtonSize, type ButtonVariant } from './button';
import { Tooltip } from './tooltip';

/** Every icon-only action requires an accessible name and matching tooltip. */
export function IconButton({
  tooltip,
  children,
  variant = 'outline',
  size = 'small',
  ...props
}: {
  tooltip: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <Tooltip text={tooltip}>
      <ActionButton {...props} variant={variant} size={size} aria-label={tooltip} title={tooltip}>
        {children}
      </ActionButton>
    </Tooltip>
  );
}
