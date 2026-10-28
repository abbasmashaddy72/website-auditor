'use client';

import type { HTMLAttributes, ReactNode } from 'react';

/** The single surface primitive for KPI, website and general dashboard cards. */
export function Card({
  children,
  className = '',
  as = 'section',
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: 'section' | 'article' | 'div';
}) {
  const Component = as;
  return (
    <Component {...props} className={`surface ${className}`}>
      {children}
    </Component>
  );
}
/** Compatibility alias for older cards; all card variants use Card internally. */
export const SurfaceCard = Card;
