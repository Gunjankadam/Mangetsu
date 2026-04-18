import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { X, Search, Loader2, Library, Globe, Eye } from 'lucide-react';
import { useGlobalSourceSearch, useLibraryManga } from '../hooks/useBackend';
import { getCurrentBackendBaseUrl } from '../native/Backend';
import { runMangaMigration } from '../lib/migrateManga';
import { useStore } from '../store/useStore';
import type { Source } from '../types';
import { cn } from '@/lib/utils';
import { MangaCardSkeleton } from './MangaCard';
import coverFallbackImage from '../assets/fallback-cover.png';

function sourceDisplayName(s: Source): string {
  return s.id === 'mangapill' ? 'MangaPill' : s.name;
}

type ConfirmTarget = {
  toId: string;
  title: string;
  sourceLabel: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  fromMangaId: string;
  fromMangaTitle: string;
  onMigrated: (newMangaId: string) => void;
};

export const MangaMigrationSheet: React.FC<Props> = ({
  open,
  onClose,
  fromMangaId,
  fromMangaTitle,
  onMigrated,
}) => {
  const navigate = useNavigate();
  const hasBackend = !!getCurrentBackendBaseUrl().trim();

  const globalQuery = useStore(s => s.migrationSearchQuery);
  const setGlobalQuery = useStore(s => s.setMigrationSearchQuery);
  const libraryQuery = useStore(s => s.migrationLibraryQuery);
  const setLibraryQuery = useStore(s => s.setMigrationLibraryQuery);
  const scrollPos = useStore(s => s.migrationScrollPos);
  const setScrollPos = useStore(s => s.setMigrationScrollPos);

  const [busy, setBusy] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Restore scroll
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollPos;
    }
  }, [open, scrollPos]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollPos(e.currentTarget.scrollTop);
  }, [setScrollPos]);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // Prefill ONLY if empty
  useEffect(() => {
    if (open && !globalQuery) {
      setGlobalQuery(fromMangaTitle);
    }
  }, [open, fromMangaTitle, globalQuery, setGlobalQuery]);

  const { data: libraryHits = [], isLoading: loadingLib } = useLibraryManga(
    {
      query: libraryQuery.trim() || undefined,
      sort: { field: 'title', direction: 'asc' },
    },
    { enabled: open && libraryQuery.trim().length > 0 },
  );

  const globalEnabled = open && hasBackend && globalQuery.trim().length > 0;
  const { sources, loadingSources, sourcesError, queries } = useGlobalSourceSearch(globalQuery, {
    enabled: globalEnabled,
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

  const filteredLibrary = useMemo(
    () => libraryHits.filter(m => m.id !== fromMangaId),
    [libraryHits, fromMangaId],
  );

  const requestMigrate = useCallback((target: ConfirmTarget) => {
    if (target.toId === fromMangaId) return;
    setConfirmTarget(target);
    setError(null);
  }, [fromMangaId]);

  const openPreviewDetails = useCallback(
    (toId: string, sourceLabel: string) => {
      if (!toId || toId === fromMangaId) return;
      navigate(`/manga/${encodeURIComponent(toId)}`, {
        state: {
          migratePreviewFrom: fromMangaId,
          migrateSourceLabel: sourceLabel,
          migrateFromTitle: fromMangaTitle,
        },
      });
    },
    [fromMangaId, fromMangaTitle, navigate],
  );

  const runMigrate = useCallback(
    async (toId: string) => {
      if (!toId || toId === fromMangaId) return;
      setBusy(true);
      setError(null);
      try {
        const r = await runMangaMigration(fromMangaId, toId);
        if (r.ok === false) {
          setError(r.error);
          return;
        }
        setConfirmTarget(null);
        onClose();
        onMigrated(r.newMangaId);
        navigate(`/manga/${encodeURIComponent(r.newMangaId)}`, { replace: true });
      } finally {
        setBusy(false);
      }
    },
    [fromMangaId, onClose, onMigrated, navigate],
  );

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[70] bg-background/75 backdrop-blur-sm"
        aria-label="Close"
        onClick={() => !busy && !confirmTarget && onClose()}
      />
      <div className="fixed inset-x-0 bottom-0 z-[71] flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div
          className="pointer-events-auto flex w-full max-w-md flex-col rounded-t-2xl border border-border/80 bg-card shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.55)] max-h-[min(90dvh,620px)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="migrate-title"
        >
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3 shrink-0">
            <div className="min-w-0 pr-2">
              <h2 id="migrate-title" className="text-sm font-semibold text-foreground">
                Migrate to another source
              </h2>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground touch-manipulation disabled:opacity-50"
              aria-label="Close"
            >
              <X size={17} strokeWidth={1.5} />
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
          >
            {error ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Globe size={12} /> All sources
              </p>
              {!hasBackend ? (
                <p className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-2.5 text-center text-xs text-muted-foreground">
                  Add a{' '}
                  <Link to="/more/settings" className="font-medium text-primary underline-offset-2 hover:underline">
                    backend URL
                  </Link>{' '}
                  to search every source.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2">
                    <Search size={15} className="shrink-0 text-muted-foreground" />
                    <input
                      value={globalQuery}
                      onChange={e => setGlobalQuery(e.target.value)}
                      placeholder="Search query…"
                      className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      aria-label="Global search query"
                    />
                  </div>

                  {loadingSources ? (
                    <div className="space-y-4">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="space-y-2">
                          <div className="h-4 w-36 animate-pulse rounded-md bg-muted/60" />
                          <div className="flex gap-2 overflow-hidden">
                            {Array.from({ length: 4 }).map((__, j) => (
                              <div key={j} className="w-[30%] min-w-[92px] max-w-[112px] shrink-0">
                                <MangaCardSkeleton />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : sourcesError || !sources?.length ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {sourcesError ? 'Could not load sources.' : 'No sources from the backend.'}
                    </p>
                  ) : (
                    <div className="space-y-5 pb-1">
                      {orderedIndices.map(i => {
                        const source = sources[i];
                        const q = queries[i];
                        if (!source || !q) return null;
                        const raw = q.data?.manga ?? [];
                        const mangaList = raw.filter(m => m.id !== fromMangaId);
                        const hasHits = mangaList.length > 0;
                        if (!q.isLoading && !q.isError && !hasHits) return null;

                        return (
                          <section key={source.id} className="space-y-2" aria-label={`${source.name} results`}>
                            <div className="flex items-center gap-2 px-0.5">
                              <img
                                src={source.iconUrl}
                                alt=""
                                className="h-7 w-7 shrink-0 rounded-full border border-white/10 object-cover"
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                                {sourceDisplayName(source)}
                              </span>
                              {q.isLoading ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                              ) : null}
                              {q.isError ? (
                                <span className="shrink-0 text-[10px] font-medium text-destructive">Failed</span>
                              ) : null}
                            </div>

                            {q.isLoading ? (
                              <div className="flex gap-2 overflow-hidden">
                                {Array.from({ length: 5 }).map((_, j) => (
                                  <div key={j} className="w-[30%] min-w-[92px] max-w-[112px] shrink-0">
                                    <MangaCardSkeleton />
                                  </div>
                                ))}
                              </div>
                            ) : q.isError ? null : hasHits ? (
                              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar touch-manipulation [-webkit-overflow-scrolling:touch]">
                                {mangaList.map(m => (
                                  <div
                                    key={m.id}
                                    className={cn(
                                      'flex w-[32%] min-w-[108px] max-w-[128px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl',
                                      'border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.02]',
                                      'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
                                    )}
                                  >
                                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[12px] m-[3px] pointer-events-none">
                                      <img
                                        src={m.coverUrl}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        onError={e => {
                                          const img = e.currentTarget;
                                          if (img.src !== coverFallbackImage) img.src = coverFallbackImage;
                                        }}
                                      />
                                    </div>
                                    <p className="line-clamp-2 px-1.5 pt-1 text-[10px] font-medium leading-tight text-foreground">
                                      {m.title}
                                    </p>
                                    <div className="mt-1 flex gap-1 px-1.5 pb-2">
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => openPreviewDetails(m.id, sourceDisplayName(source))}
                                        className={cn(
                                          'flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-border/70 bg-secondary/80 py-1.5 text-[10px] font-semibold touch-manipulation',
                                          'hover:bg-secondary active:scale-[0.98] disabled:opacity-50',
                                        )}
                                      >
                                        <Eye size={12} strokeWidth={2} aria-hidden />
                                        View
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          requestMigrate({
                                            toId: m.id,
                                            title: m.title,
                                            sourceLabel: sourceDisplayName(source),
                                          })
                                        }
                                        className={cn(
                                          'flex flex-1 items-center justify-center rounded-lg bg-primary/90 py-1.5 text-[10px] font-semibold text-primary-foreground touch-manipulation',
                                          'hover:bg-primary active:scale-[0.98] disabled:opacity-50',
                                        )}
                                      >
                                        Migrate
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="px-0.5 text-[11px] text-muted-foreground">No results</p>
                            )}
                          </section>
                        );
                      })}

                      {queries.length > 0 &&
                        queries.every(q => !q.isLoading) &&
                        !queries.some(q => q.isError) &&
                        !orderedIndices.some(i => {
                          const q = queries[i];
                          const raw = q?.data?.manga ?? [];
                          return raw.some(m => m.id !== fromMangaId);
                        }) && (
                          <p className="pt-1 text-center text-xs text-muted-foreground">
                            No results from any source. Try editing the search words above.
                          </p>
                        )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Library size={12} /> From your library
              </p>
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2">
                <Search size={15} className="shrink-0 text-muted-foreground" />
                <input
                  value={libraryQuery}
                  onChange={e => setLibraryQuery(e.target.value)}
                  placeholder="Search other library titles…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                {loadingLib && libraryQuery.trim() ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredLibrary.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {libraryQuery.trim() ? 'No matches' : 'Optional: pick another copy already in your library'}
                  </p>
                ) : (
                  filteredLibrary.map(m => (
                    <div
                      key={m.id}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-2 py-2',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium pl-1">{m.title}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPreviewDetails(m.id, 'Your library')}
                        className={cn(
                          'shrink-0 rounded-lg border border-border/70 bg-secondary/80 px-2.5 py-1.5 text-[11px] font-semibold touch-manipulation',
                          'hover:bg-secondary disabled:opacity-50',
                        )}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          requestMigrate({
                            toId: m.id,
                            title: m.title,
                            sourceLabel: 'Your library',
                          })
                        }
                        className={cn(
                          'shrink-0 rounded-lg bg-primary/90 px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground touch-manipulation',
                          'hover:bg-primary disabled:opacity-50',
                        )}
                      >
                        Migrate
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {busy ? (
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border/60 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Migrating…
            </div>
          ) : null}
        </div>
      </div>

      {confirmTarget ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[80] bg-black/70"
            aria-label="Dismiss"
            disabled={busy}
            onClick={() => !busy && setConfirmTarget(null)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="migrate-confirm-title"
            className="fixed left-1/2 top-1/2 z-[81] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/80 bg-card p-4 shadow-2xl"
          >
            <h3 id="migrate-confirm-title" className="text-base font-semibold text-foreground">
              Migrate to this entry?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{confirmTarget.title}</span>
              <span className="text-muted-foreground"> · {confirmTarget.sourceLabel}</span>
            </p>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmTarget(null)}
                className="rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-medium touch-manipulation disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runMigrate(confirmTarget.toId)}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground touch-manipulation disabled:opacity-50"
              >
                Migrate
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
};
