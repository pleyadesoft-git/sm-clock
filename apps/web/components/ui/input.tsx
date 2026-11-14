import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  errorMessage?: string | undefined;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, errorMessage, id, ...props }, ref) => {
    const errorId = id && errorMessage ? `${id}-error` : undefined;
    return (
      <div className="flex w-full flex-col gap-[var(--s-1)]">
        <input
          ref={ref}
          id={id}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            'ios-input',
            errorMessage && 'border-[var(--danger)]',
            className,
          )}
          {...props}
        />
        {errorMessage ? (
          <p id={errorId} className="text-xs text-[var(--danger)]" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
