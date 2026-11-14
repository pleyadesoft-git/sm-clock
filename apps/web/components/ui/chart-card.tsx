import * as React from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from './card';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export interface ChartDataPoint {
  label: string;
  primary: number;
  secondary?: number;
}

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  data: ChartDataPoint[];
  loading?: boolean;
  actions?: React.ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  primaryLabel,
  secondaryLabel,
  data,
  loading = false,
  actions,
}: ChartCardProps) {
  const maxVal = React.useMemo(() => {
    let max = 0;
    for (const item of data) {
      if (item.primary > max) max = item.primary;
      if (item.secondary !== undefined && item.secondary > max) {
        max = item.secondary;
      }
    }
    return max || 1;
  }, [data]);

  const hasNonZero = data.some(
    (d) => d.primary > 0 || (d.secondary !== undefined && d.secondary > 0),
  );

  return (
    <Card className="flex flex-col gap-[var(--s-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--s-3)]">
        <div>
          <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
          {subtitle && (
            <p className="mt-[var(--s-1)] text-xs text-[var(--text-2)]">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-[var(--s-3)]">
          <div className="flex items-center gap-[var(--s-3)] text-xs font-medium text-[var(--text-2)]">
            <span className="inline-flex items-center gap-[var(--s-1)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-1)]" />
              {primaryLabel}
            </span>
            {secondaryLabel && (
              <span className="inline-flex items-center gap-[var(--s-1)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-2)]" />
                {secondaryLabel}
              </span>
            )}
          </div>
          {actions}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : !hasNonZero ? (
        <EmptyState
          icon={BarChart3}
          title="Sin datos suficientes en este periodo"
          description="Las métricas aparecerán automáticamente conforme el Agente Local envíe checadas."
        />
      ) : (
        <div
          className="grid h-48 grid-cols-6 items-end gap-[var(--s-2)] pt-[var(--s-4)] sm:grid-cols-8 md:grid-cols-12"
          role="img"
          aria-label={title}
        >
          {data.map((point) => {
            const primaryPct = Math.max(6, Math.round((point.primary / maxVal) * 100));
            const secondaryPct =
              point.secondary !== undefined
                ? Math.max(6, Math.round((point.secondary / maxVal) * 100))
                : null;
            return (
              <div
                key={point.label}
                className="group flex h-full flex-col items-center justify-end gap-[var(--s-1)]"
              >
                <div className="flex h-full w-full items-end justify-center gap-[var(--s-1)]">
                  <div
                    style={{ height: `${primaryPct}%` }}
                    title={`${point.label} · ${primaryLabel}: ${point.primary}`}
                    className="w-2.5 rounded-t-[var(--r-xs)] bg-[var(--chart-1)] transition-opacity group-hover:opacity-85 sm:w-3"
                  />
                  {secondaryPct !== null && (
                    <div
                      style={{ height: `${secondaryPct}%` }}
                      title={`${point.label} · ${secondaryLabel ?? ''}: ${point.secondary}`}
                      className="w-2.5 rounded-t-[var(--r-xs)] bg-[var(--chart-2)] opacity-75 transition-opacity group-hover:opacity-100 sm:w-3"
                    />
                  )}
                </div>
                <span className="tabular-nums text-xs font-medium text-[var(--text-2)]">
                  {point.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
