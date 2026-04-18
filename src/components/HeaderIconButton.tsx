import * as React from 'react';
import { cn } from '@/lib/utils';

export interface HeaderIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** e.g. filters / sort panel open */
  pressed?: boolean;
}

/**
 * Premium toolbar control: glass tile, pink edge glow on hover, soft inner highlight.
 */
export const HeaderIconButton = React.forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
  ({ className, children, pressed, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl',
        'border border-white/[0.12] bg-gradient-to-b from-white/[0.1] to-white/[0.02]',
        'backdrop-blur-md',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_4px_18px_-6px_rgba(0,0,0,0.55)]',
        'transition-all duration-300 ease-out touch-manipulation',
        'hover:border-primary/50 hover:shadow-[0_6px_28px_-8px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
        'active:scale-[0.9] active:duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        pressed &&
          'border-primary/55 bg-gradient-to-b from-primary/[0.22] to-primary/[0.06] shadow-[0_0_32px_-10px_hsl(var(--primary)/0.55),inset_0_0_0_1px_rgba(255,255,255,0.12)]',
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-white/20 to-transparent opacity-[0.65] transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden
      />
      {pressed && (
        <span
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--primary)/0.35),transparent_70%)]"
          aria-hidden
        />
      )}
      <span
        className={cn(
          'relative z-[1] flex items-center justify-center text-foreground transition-all duration-300',
          'group-hover:text-primary',
          'group-hover:drop-shadow-[0_0_10px_hsl(var(--primary)/0.45)]',
          '[&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-out',
          'group-hover:[&_svg]:scale-[1.08] group-active:[&_svg]:scale-95',
        )}
      >
        {children}
      </span>
    </button>
  ),
);
HeaderIconButton.displayName = 'HeaderIconButton';
