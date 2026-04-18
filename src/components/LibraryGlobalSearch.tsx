import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useGlobalSourceSearch } from '../hooks/useBackend';
import { MangaCard, MangaCardSkeleton } from './MangaCard';
import { cn } from '@/lib/utils';

type Props = {
  query: string;
  /** When false, no network (parent should unmount when not needed). */
  enabled: boolean;
};

/**
 * Mihon-style stacked sections: one row per source, horizontal manga strip when results exist.
 */
export const LibraryGlobalSearch: React.FC<Props> = ({ query, enabled }) => {
  const { hasBackend, sources, loadingSources, sourcesError, queries } = useGlobalSourceSearch(query, {
    enabled,
  });

  const orderedIndices = useMemo(() => {
    const n = sources?.length ?? 0;
    if (!n) return [];
    return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const qa = queries[a];
      const qb = queries[b];
      const ca = qa?.data?.manga?.length ?? 0;
      const cb = qb?.data?.manga?.length ?? 0;
      const doneA = qa && !qa.isLoading;
      const doneB = qb && !qb.isLoading;
      if (doneA && doneB) {
        if (ca > 0 && cb === 0) return -1;
        if (cb > 0 && ca === 0) return 1;
      }
      return a - b;
    });
  }, [sources?.length, queries]);

  if (!hasBackend) {
    return (
      <div
        className={cn(
          'mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-center text-sm text-muted-foreground',
        )}
      >
        Add a{' '}
        <Link to="/more/settings" className="font-medium text-primary underline-offset-2 hover:underline">
          backend URL
        </Link>{' '}
        to search all sources.
      </div>
    );
  }

  if (loadingSources) {
    return (
      <div className="mt-4 space-y-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Global search</p>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-40 animate-pulse rounded-md bg-muted/60" />
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="w-[30%] min-w-[100px] max-w-[120px] shrink-0">
                  <MangaCardSkeleton />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (sourcesError || !sources?.length) {
    return (
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {sourcesError ? 'Could not load sources.' : 'No sources returned from the backend.'}
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-6 pb-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Global search</p>
        <p className="mt-1 text-xs text-muted-foreground">Results from each source</p>
      </div>

      {orderedIndices.map(i => {
        const source = sources[i];
        const q = queries[i];
        if (!source || !q) return null;
        const hasHits = (q.data?.manga?.length ?? 0) > 0;
        if (!q.isLoading && !q.isError && !hasHits) return null;

        return (
          <section key={source.id} className="space-y-2.5" aria-label={`${source.name} search results`}>
            <div className="flex items-center gap-2.5 px-0.5">
              <img
                src={source.iconUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full border border-white/10 bg-background object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{source.name}</span>
              {q.isLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
              {q.isError ? (
                <span className="shrink-0 text-[11px] font-medium text-destructive">Failed</span>
              ) : null}
            </div>

            {q.isLoading ? (
              <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="w-[30%] min-w-[100px] max-w-[120px] shrink-0">
                    <MangaCardSkeleton />
                  </div>
                ))}
              </div>
            ) : q.isError ? null : q.data?.manga?.length ? (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar touch-manipulation [-webkit-overflow-scrolling:touch]">
                {q.data.manga.map(m => (
                  <div key={m.id} className="w-[30%] min-w-[100px] max-w-[120px] shrink-0 snap-start">
                    <MangaCard manga={m} columns={3} showUnreadBadge={false} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-0.5 text-xs text-muted-foreground">No results</p>
            )}
          </section>
        );
      })}

      {queries.length > 0 &&
        queries.every(q => !q.isLoading) &&
        !queries.some(q => q.isError) &&
        !queries.some(q => (q.data?.manga?.length ?? 0) > 0) && (
          <p className="pt-1 text-center text-sm text-muted-foreground">No results from any source.</p>
        )}
    </div>
  );
};
