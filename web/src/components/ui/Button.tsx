import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

type Variant = 'primary' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-ink hover:bg-[#ff6b77] active:bg-[#e63e4c]',
  ghost: 'border border-line-strong text-bone hover:border-bone hover:bg-white/5 active:bg-white/10',
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
