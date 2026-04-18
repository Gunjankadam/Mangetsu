import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, RefreshCw } from 'lucide-react';
import { useRefreshUpdates, useUpdates } from '../../hooks/useBackend';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import coverFallbackImage from '../../assets/fallback-cover.png';
import { mangaDetailsPath } from '@/lib/readerPath';

const UpdatesScreen: React.FC = () => {
  const { data: updates, isLoading, isError, refetch } = useUpdates();
  const refresh = useRefreshUpdates();
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    if (!updates) return {};
    const groups: Record<string, typeof updates> = {};
    updates.forEach(u => {
      const dateKey = new Date(u.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      (groups[dateKey] ??= []).push(u);
    });
    return groups;
  }, [updates]);

  return (
    <div className="flex flex-col min-h-screen pb-16">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border safe-top">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-lg font-bold tracking-tight text-foreground">Updates</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await refresh.mutateAsync();
                } finally {
                  refetch();
                }
              }}
              disabled={refresh.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground touch-manipulation disabled:opacity-50"
              aria-label="Refresh updates"
              title="Refresh"
            >
              <RefreshCw size={16} className={refresh.isPending ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {isLoading ? (
          <div className="space-y-2 px-4 pt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="h-12 w-9 skeleton-shimmer rounded-md" />
                <div className="flex-1 space-y-1.5"><div className="h-3.5 w-32 skeleton-shimmer rounded" /><div className="h-3 w-24 skeleton-shimmer rounded" /></div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !updates?.length ? (
          <EmptyState icon={<Bell size={48} strokeWidth={1} />} title="No updates" description="New chapters will appear here" />
        ) : (
          <div className="animate-fade-in">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date}>
                <div className="sticky top-14 bg-background/95 backdrop-blur px-4 py-2 z-10">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{date}</span>
                </div>
                <div className="divide-y divide-border">
                  {items.map(u => (
                    <button
                      key={u.id}
                      onClick={() => navigate(mangaDetailsPath(u.manga.id))}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left touch-manipulation active:bg-muted/50"
                    >
                      <img
                        src={u.manga.coverUrl}
                        alt=""
                        className="h-12 w-9 rounded-md object-cover flex-shrink-0"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.src = coverFallbackImage; }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.manga.title}</p>
                        <p className="text-xs text-muted-foreground">{u.chapter.title}</p>
                      </div>
                      {!u.chapter.read && (
                        <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default UpdatesScreen;
