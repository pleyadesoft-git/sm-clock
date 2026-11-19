import * as React from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'danger'
  | 'plain'
  | 'ghost';

export type ButtonSize = 'default' | 'sm' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'ios-btn-primary',
  secondary: 'ios-btn-secondary',
  destructive: 'ios-btn-destructive',
  danger: 'ios-btn-destructive',
  plain: 'ios-btn-plain',
  ghost: 'ios-btn-plain',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: '',
  sm: 'px-[var(--s-3)] py-[var(--s-1)] text-xs',
  lg: 'px-[var(--s-6)] py-[var(--s-3)] text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'default',
      type = 'button',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'ios-btn',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
