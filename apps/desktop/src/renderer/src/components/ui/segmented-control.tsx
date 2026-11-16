'use client';

import * as React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  onValueChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const handleSelect = onChange ?? onValueChange;
  const layoutId = React.useId();

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-1)]',
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => handleSelect?.(opt.value)}
            className={cn(
              'relative z-10 min-h-[var(--s-8)] rounded-[var(--r-sm)] px-[var(--s-3)] py-[var(--s-1)] text-sm font-medium transition-colors',
              selected ? 'text-[var(--text)]' : 'text-[var(--text-2)]',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-[var(--r-sm)] bg-[var(--surface)] shadow-[var(--shadow-1)]"
              />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
