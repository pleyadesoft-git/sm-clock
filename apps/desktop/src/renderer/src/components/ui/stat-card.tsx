import * as React from 'react';
import { Card } from './card';
import { Skeleton } from './skeleton';

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaVariant?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  sparkline?: number[];
  loading?: boolean;
}

export function StatCard({
  label,
  value,
  delta,
  deltaVariant = 'neutral',
  icon,
  sparkline,
  loading = false,
}: StatCardProps) {
  const deltaClasses: Record<'positive' | 'negative' | 'neutral', string> = {
    positive: 'bg-[var(--success-soft)] text-[var(--success)]',
    negative: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    neutral: 'bg-[var(--fill-secondary)] text-[var(--text-2)]',
  };

  const sparklinePoints = React.useMemo(() => {
    if (!sparkline || sparkline.length < 2) return null;
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    return sparkline
      .map((v, idx) => {
        const x = (idx / (sparkline.length - 1)) * 100;
        const y = 28 - ((v - min) / range) * 22;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [sparkline]);

  return (
    <Card className="flex flex-col justify-between gap-[var(--s-3)]">
      <div className="flex items-center justify-between gap-[var(--s-2)]">
        <span className="text-xs font-semibold tracking-wide text-[var(--text-2)]">
          {label}
        </span>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
          {icon}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="flex items-baseline justify-between gap-[var(--s-2)]">
          <span className="tabular-nums text-2xl font-bold tracking-tight text-[var(--text)]">
            {value}
          </span>
          {delta && (
            <span
              className={`inline-flex items-center rounded-[var(--r-pill)] px-[var(--s-2)] py-[var(--s-1)] text-xs font-semibold ${deltaClasses[deltaVariant]}`}
            >
              {delta}
            </span>
          )}
        </div>
      )}

      {sparklinePoints && !loading && (
        <svg
          viewBox="0 0 100 32"
          className="h-7 w-full overflow-visible"
          aria-hidden="true"
        >
          <polyline
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={sparklinePoints}
          />
        </svg>
      )}
    </Card>
  );
}
