import * as React from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'danger'
  | 'plain'
  | 'outline'
  | 'ghost';

export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

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
  outline: 'ios-btn-secondary border border-[var(--separator)]',
  ghost: 'ios-btn-plain hover:bg-[var(--surface-2)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: '',
  sm: 'h-8 px-2.5 text-xs',
  lg: 'h-11 px-5 text-base',
  icon: 'h-8 w-8 p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn('ios-btn', variantClasses[variant], sizeClasses[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
