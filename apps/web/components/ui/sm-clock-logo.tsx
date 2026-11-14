import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SmClockLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  roundedClassName?: string;
}

/**
 * Logotipo oficial de SM Clock.
 * Icono institucional con esfera horaria y manecillas en fondo azul iOS (#007aff).
 */
export function SmClockLogo({
  size = 32,
  className,
  ...props
}: SmClockLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      className={cn('shrink-0 select-none', className)}
      aria-hidden="true"
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="#007AFF" />
      <circle cx="16" cy="16" r="9" stroke="#FFFFFF" strokeWidth="2.25" />
      <path
        d="M16 11V16L19.5 18"
        stroke="#FFFFFF"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
