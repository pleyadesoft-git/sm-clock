import * as React from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'danger'
  | 'plain';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'ios-btn-primary',
  secondary: 'ios-btn-secondary',
  destructive: 'ios-btn-destructive',
  danger: 'ios-btn-destructive',
  plain: 'ios-btn-plain',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn('ios-btn', variantClasses[variant], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
