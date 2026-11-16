import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'default'
  | 'accent'
  | 'info'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline'
  | 'secondary';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--separator)]',
  neutral: 'bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--separator)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)] border-transparent',
  info: 'bg-[var(--accent-soft)] text-[var(--accent)] border-transparent',
  success: 'bg-[var(--success-bg)] text-[var(--success)] border-transparent',
  warning: 'bg-[var(--warning-bg)] text-[var(--warning)] border-transparent',
  danger: 'bg-[var(--danger-bg)] text-[var(--danger)] border-transparent',
  outline: 'bg-transparent text-[var(--text)] border-[var(--separator)]',
  secondary: 'bg-[var(--surface-2)] text-[var(--text)] border-transparent',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--r-sm)] border px-[var(--s-2)] py-[var(--s-1)] text-xs font-semibold',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}
