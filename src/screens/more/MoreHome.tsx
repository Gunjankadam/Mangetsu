import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Settings, Info, ChevronRight, User } from 'lucide-react';
import { cn } from '@/lib/utils';

function MoreAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-24 right-[-20%] h-[min(18rem,48vw)] w-[min(18rem,48vw)] rounded-full bg-primary/[0.11] blur-[92px]" />
      <div className="absolute top-[38%] -left-[14%] h-44 w-44 rounded-full bg-[hsl(285_60%_42%/0.1)] blur-[76px]" />
      <div className="absolute bottom-28 left-1/2 h-px w-[min(12rem,70%)] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
    </div>
  );
}

const MoreHome: React.FC = () => {
  const navigate = useNavigate();

  const items = [
    { icon: User, label: 'Profile', path: '/more/account', hint: 'Name, email, sign out' },
    { icon: Download, label: 'Downloads', path: '/more/downloads', hint: 'Offline chapters' },
    { icon: Settings, label: 'Settings', path: '/more/settings', hint: 'Reader & appearance' },
    { icon: Info, label: 'About', path: '/more/about', hint: 'Version & credits' },
  ];

  return (
    <div className="relative flex min-h-screen flex-col pb-16">
      <MoreAmbient />

      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border safe-top">
        <div className="flex h-14 items-center px-4">
          <h1 className="text-lg font-bold tracking-tight text-foreground">More</h1>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col px-3 pt-4">
        <p className="mb-3 px-1 text-xs leading-relaxed text-muted-foreground">
          Downloads, preferences, and app info.
        </p>

        <ul className="flex flex-col gap-3">
          {items.map(({ icon: Icon, label, path, hint }) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => navigate(path)}
                className={cn(
                  'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-3.5 text-left touch-manipulation',
                  'border border-white/[0.1] bg-gradient-to-br from-white/[0.07] to-white/[0.02]',
                  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_12px_40px_-20px_rgba(0,0,0,0.7)]',
                  'backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 ease-out',
                  'active:scale-[0.985] active:duration-150',
                  '[@media(hover:hover)]:hover:border-primary/30 [@media(hover:hover)]:hover:shadow-[0_16px_48px_-14px_hsl(var(--primary)/0.22),inset_0_1px_0_0_rgba(255,255,255,0.1)]',
                )}
              >
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
                  style={{
                    background:
                      'radial-gradient(90% 80% at 0% 50%, hsl(var(--primary) / 0.09), transparent 55%)',
                  }}
                />
                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] shadow-inner">
                  <div className="pointer-events-none absolute inset-0 rounded-xl bg-primary/15 opacity-0 blur-md transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100" />
                  <Icon
                    size={20}
                    strokeWidth={1.65}
                    className="relative text-primary drop-shadow-[0_0_10px_hsl(var(--primary)/0.35)]"
                  />
                </div>
                <div className="relative min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight text-foreground">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
                </div>
                <ChevronRight
                  size={18}
                  strokeWidth={2}
                  className="relative shrink-0 text-muted-foreground transition-transform duration-300 [@media(hover:hover)]:group-hover:translate-x-0.5 [@media(hover:hover)]:group-hover:text-primary"
                />
              </button>
            </li>
          ))}
        </ul>

        <div className="pointer-events-none mt-auto flex min-h-[36dvh] flex-col items-center justify-end pb-10 pt-8">
          <div className="h-px w-20 bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>
      </main>
    </div>
  );
};

export default MoreHome;
