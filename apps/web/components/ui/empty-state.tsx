import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-8)] text-center',
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] p-[var(--s-3)] text-[var(--accent)]">
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className="flex max-w-md flex-col gap-[var(--s-1)]">
        <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
        <p className="text-sm text-[var(--text-2)]">{description}</p>
      </div>
      {action ? <div className="pt-[var(--s-2)]">{action}</div> : null}
    </div>
  );
}
