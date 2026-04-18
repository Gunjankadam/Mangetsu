import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Compass, Bell, Clock, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { path: '/library', label: 'Library', icon: BookOpen },
  { path: '/browse', label: 'Browse', icon: Compass },
  { path: '/updates', label: 'Updates', icon: Bell },
  { path: '/history', label: 'History', icon: Clock },
  { path: '/more', label: 'More', icon: MoreHorizontal },
];

export const BottomTabBar: React.FC = () => {
  const location = useLocation();

  if (location.pathname.startsWith('/reader/')) return null;

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50',
        'border-t border-white/[0.1]',
        'bg-gradient-to-t from-background via-background/98 to-background/88',
        'backdrop-blur-xl backdrop-saturate-150',
        'shadow-[0_-8px_36px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
        'safe-bottom',
      )}
      role="tablist"
      aria-label="Main navigation"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-lg items-stretch px-1.5 pt-1 pb-1">
        {tabs.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname.startsWith(path);
          return (
            <NavLink
              key={path}
              to={path}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              className={cn(
                'group/tab relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 touch-manipulation',
                'transition-all duration-300 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                !isActive && 'text-muted-foreground hover:text-foreground/90 active:scale-[0.96]',
              )}
            >
              {isActive && (
                <>
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-x-0.5 inset-y-0.5 rounded-xl',
                      'border border-white/20',
                      'bg-gradient-to-b from-primary/[0.28] to-primary/[0.07]',
                      'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_6px_22px_-8px_hsl(var(--primary)/0.55)]',
                    )}
                    aria-hidden
                  />
                  <span
                    className="pointer-events-none absolute inset-x-0.5 top-0.5 h-[45%] rounded-t-[10px] bg-gradient-to-b from-white/25 to-transparent opacity-90"
                    aria-hidden
                  />
                  <span
                    className="pointer-events-none absolute inset-x-1 top-1 bg-[radial-gradient(ellipse_100%_80%_at_50%_0%,rgba(255,255,255,0.2),transparent_65%)]"
                    aria-hidden
                  />
                </>
              )}
              <span className="relative z-[1] flex flex-col items-center gap-0.5">
                <Icon
                  size={21}
                  strokeWidth={isActive ? 2.25 : 1.75}
                  className={cn(
                    'transition-all duration-300',
                    isActive
                      ? 'text-primary drop-shadow-[0_0_12px_hsl(var(--primary)/0.55)] scale-[1.06]'
                      : 'group-hover/tab:scale-105',
                  )}
                />
                <span
                  className={cn(
                    'max-w-full truncate px-0.5 text-center text-[9px] font-bold uppercase tracking-[0.14em]',
                    isActive ? 'text-primary' : 'group-hover/tab:text-foreground/80',
                  )}
                >
                  {label}
                </span>
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
