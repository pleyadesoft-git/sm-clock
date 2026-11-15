import * as React from 'react';
import { sanitizeLiveInputValue, sanitizeTextInput } from '@sm-clock/contracts';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  errorMessage?: string | undefined;
  sanitizeInput?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      errorMessage,
      id,
      type = 'text',
      sanitizeInput = true,
      onChange,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const errorId = id && errorMessage ? `${id}-error` : undefined;
    const shouldSanitize =
      sanitizeInput && type !== 'password' && type !== 'file';

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (shouldSanitize && typeof event.currentTarget.value === 'string') {
        const cleaned = sanitizeLiveInputValue(event.currentTarget.value);
        if (cleaned !== event.currentTarget.value) {
          event.currentTarget.value = cleaned;
        }
      }
      onChange?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      if (shouldSanitize && typeof event.currentTarget.value === 'string') {
        const cleaned = sanitizeTextInput(event.currentTarget.value, {
          neutralizeFormulaPrefix: type !== 'number' && type !== 'tel',
        });
        if (cleaned !== event.currentTarget.value) {
          event.currentTarget.value = cleaned;
          onChange?.(
            event as unknown as React.ChangeEvent<HTMLInputElement>,
          );
        }
      }
      onBlur?.(event);
    };

    return (
      <div className="flex w-full flex-col gap-[var(--s-1)]">
        <input
          ref={ref}
          id={id}
          type={type}
          suppressHydrationWarning
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorId}
          onChange={handleChange}
          onBlur={handleBlur}
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
