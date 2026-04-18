import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Clock, MoreVertical, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { readerPath } from '@/lib/readerPath';
import {
  useHistory,
  useResetHistoryChapter,
  useClearHistoryForManga,
} from '../../hooks/useBackend';
import { Backend } from '../../native/Backend';
import type { HistoryItem, Manga } from '../../types';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import coverFallbackImage from '../../assets/fallback-cover.png';
import { isUnreliableHistoryCoverUrl } from '../../storage/readProgressStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Soft glow behind list — header stays plain above it */
function HistoryAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-20 right-[-18%] h-[min(20rem,50vw)] w-[min(20rem,50vw)] rounded-full bg-primary/[0.12] blur-[96px]" />
      <div className="absolute top-[32%] -left-[12%] h-48 w-48 rounded-full bg-[hsl(320_70%_45%/0.1)] blur-[80px]" />
      <div className="absolute bottom-32 right-[-8%] h-36 w-36 rounded-full bg-primary/[0.07] blur-[64px]" />
    </div>
  );
}

function historyCalendarDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** `chapter.title` is already `Chapter n - subtitle` from history builder — avoid duplicating "Chapter n". */
function chapterMetaLine(chapter: { title: string; lastPageRead: number }): string {
  const t = chapter.title?.trim() || 'Chapter';
  return `${t} · p.${chapter.lastPageRead}`;
}

type ConfirmState = null | { kind: 'undo' | 'clearAll'; item: HistoryItem };

const HistoryScreen: React.FC = () => {
  const { data: history, isLoading, isError, refetch } = useHistory();
  const navigate = useNavigate();
  const resetChapter = useResetHistoryChapter();
  const clearManga = useClearHistoryForManga();
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const displayHistory = useMemo(() => history ?? [], [history]);

  const grouped = useMemo(() => {
    const groups: Record<string, HistoryItem[]> = {};
    for (const h of displayHistory) {
      const dateKey = historyCalendarDayKey(h.lastRead);
      (groups[dateKey] ??= []).push(h);
    }
    return groups;
  }, [displayHistory]);

  const mangaIdsNeedingDetails = useMemo(() => {
    const ids = new Set<string>();
    for (const h of displayHistory) {
      if (h.manga.title === 'Unknown series' || isUnreliableHistoryCoverUrl(h.manga.coverUrl)) {
        ids.add(h.manga.id);
      }
    }
    return [...ids];
  }, [displayHistory]);

  const detailQueries = useQueries({
    queries: mangaIdsNeedingDetails.map(id => ({
      queryKey: ['mangaDetails', id] as const,
      queryFn: () => Backend.getMangaDetails(id),
      enabled: !!id,
      staleTime: 60 * 60 * 1000,
    })),
  });

  const historyMangaOverlay = useMemo(() => {
    const m = new Map<string, Manga>();
    detailQueries.forEach((q, i) => {
      const id = mangaIdsNeedingDetails[i];
      if (id && q.data) m.set(id, q.data);
    });
    return m;
  }, [detailQueries, mangaIdsNeedingDetails]);

  const pending = resetChapter.isPending || clearManga.isPending;

  const displayManga = useCallback(
    (h: HistoryItem) => {
      const overlay = historyMangaOverlay.get(h.manga.id);
      if (!overlay) return h.manga;
      const base = h.manga;
      const cover =
        !isUnreliableHistoryCoverUrl(overlay.coverUrl) && overlay.coverUrl.trim()
          ? overlay.coverUrl
          : !isUnreliableHistoryCoverUrl(base.coverUrl) && base.coverUrl.trim()
            ? base.coverUrl
            : overlay.coverUrl || base.coverUrl;
      return { ...base, ...overlay, coverUrl: cover };
    },
    [historyMangaOverlay],
  );

  function runConfirm() {
    if (!confirm) return;
    const { kind, item } = confirm;
    setConfirm(null);
    if (kind === 'undo') {
      resetChapter.mutate(item.chapter.id);
    } else {
      clearManga.mutate(item.manga.id);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col pb-16">
      <HistoryAmbient />

      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border safe-top">
        <div className="flex h-14 items-center px-4">
          <h1 className="text-lg font-bold tracking-tight text-foreground">History</h1>
        </div>
      </header>

      <main className="relative flex-1">
        {isLoading ? (
          <div className="space-y-3 px-3 pt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 backdrop-blur-sm"
              >
                <div className="h-[4.5rem] w-[3.35rem] shrink-0 skeleton-shimmer rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-[55%] max-w-[12rem] skeleton-shimmer rounded-md" />
                  <div className="h-3 w-[85%] skeleton-shimmer rounded-md" />
                  <div className="h-1.5 w-14 skeleton-shimmer rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !displayHistory.length ? (
          <EmptyState
            icon={<Clock size={48} strokeWidth={1} />}
            title="No history"
            description="Manga you've read will appear here"
          />
        ) : (
          <div className="animate-fade-in px-3 pb-4 pt-4">
            {Object.entries(grouped).map(([date, items]) => (
              <section key={date} className="mb-6 last:mb-0">
                <div className="sticky top-14 z-10 -mx-1 mb-3 bg-background/70 px-1 py-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/55">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/90">
                    {date.toUpperCase()}
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {items.map(h => {
                    const manga = displayManga(h);
                    const pct = Math.min(100, Math.max(0, h.progress * 100));
                    const fillPct =
                      pct <= 0 ? 0 : pct < 4 ? Math.min(4, Math.max(pct, 2)) : pct;
                    return (
                      <li key={h.id}>
                        <div
                          className={cn(
                            'group relative flex w-full items-stretch overflow-hidden rounded-2xl',
                            'border border-white/[0.1] bg-gradient-to-br from-white/[0.08] to-white/[0.02]',
                            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_10px_36px_-16px_rgba(0,0,0,0.65)]',
                            'backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 ease-out',
                            '[@media(hover:hover)]:hover:border-primary/35 [@media(hover:hover)]:hover:shadow-[0_14px_44px_-12px_hsl(var(--primary)/0.28),inset_0_1px_0_0_rgba(255,255,255,0.1)]',
                          )}
                        >
                          <div
                            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
                            style={{
                              background:
                                'radial-gradient(100% 90% at 0% 40%, hsl(var(--primary) / 0.1), transparent 58%)',
                            }}
                          />
                          <button
                            type="button"
                            disabled={openingKey === `${h.manga.id}\0${h.chapter.id}` || pending}
                            onClick={async () => {
                              const key = `${h.manga.id}\0${h.chapter.id}`;
                              setOpeningKey(key);
                              try {
                                const total = Math.max(0, Number(h.chapter.totalPages) || 0);
                                const last = Math.max(0, Number(h.chapter.lastPageRead) || 0);
                                const done = h.chapter.read || (total > 0 && last >= total);
                                if (!done) {
                                  navigate(readerPath(h.manga.id, h.chapter.id), {
                                    state: {
                                      chapterTitle: h.chapter.title,
                                      chapterNumber: h.chapter.number,
                                      startPage: last,
                                    },
                                  });
                                  return;
                                }

                                // Completed chapter: open next chapter (if any), else open the same.
                                const chapters = await Backend.getMangaChapters(h.manga.id, {
                                  filter: {},
                                  sort: { field: 'number', direction: 'asc' },
                                });
                                const ordered = (chapters ?? []).filter(c => !!c?.id).sort((a, b) => a.number - b.number);
                                const idx = ordered.findIndex(c => c.id === h.chapter.id);
                                const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
                                const target = next ?? h.chapter;
                                navigate(readerPath(h.manga.id, target.id), {
                                  state: {
                                    chapterTitle: target.title,
                                    chapterNumber: target.number,
                                    // Ensure the reader starts on first real page for the next chapter.
                                    readerEnterNext: true,
                                    // Helps non-library continuation.
                                    chaptersSnapshot: ordered.map(c => ({ id: c.id, number: c.number, title: c.title })),
                                    readerInLibrary: false,
                                    startPage: target.id === h.chapter.id ? last : undefined,
                                  },
                                });
                              } finally {
                                setOpeningKey(null);
                              }
                            }}
                            className="relative flex min-w-0 flex-1 items-center gap-3.5 px-3.5 py-3 text-left touch-manipulation transition-transform active:scale-[0.985] active:duration-150"
                          >
                            <div className="relative shrink-0">
                              <div className="pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-br from-primary/30 to-transparent opacity-0 blur-md transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-60" />
                            <img
                              src={manga.coverUrl || coverFallbackImage}
                              alt=""
                              className="relative h-[4.5rem] w-[3.35rem] rounded-xl border border-white/15 object-cover shadow-lg ring-1 ring-black/20 transition-transform duration-300 [@media(hover:hover)]:group-hover:scale-[1.02]"
                              loading="lazy"
                              onError={e => {
                                e.currentTarget.src = coverFallbackImage;
                              }}
                            />
                          </div>
                            <div className="relative flex min-w-0 flex-1 items-center gap-3">
                              <div className="min-w-0 flex-1 pr-1">
                                <p className="truncate font-semibold leading-snug tracking-tight text-foreground">
                                  {manga.title}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground/80">
                                  {chapterMetaLine(h.chapter)}
                                </p>
                              </div>

                              <div
                                className="relative h-1.5 w-[3.5rem] shrink-0 overflow-hidden rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]"
                                title={`${Math.round(pct)}% read`}
                              >
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-primary via-fuchsia-500/95 to-primary shadow-[0_0_14px_hsl(var(--primary)/0.75),0_0_6px_hsl(320_85%_60%/0.45)] transition-[width] duration-500 ease-out"
                                  style={{ width: `${fillPct}%` }}
                                />
                              </div>
                            </div>
                            
                            {openingKey === `${h.manga.id}\0${h.chapter.id}` ? (
                              <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                            ) : null}
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="relative z-[1] flex h-[inherit] min-h-[3.25rem] w-11 shrink-0 items-center justify-center rounded-none border-l border-white/[0.08] text-muted-foreground touch-manipulation transition-colors active:bg-white/[0.06] [@media(hover:hover)]:hover:text-foreground"
                                aria-label={`Options for ${manga.title}`}
                                onClick={e => e.stopPropagation()}
                              >
                                <MoreVertical className="h-5 w-5" strokeWidth={1.75} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[min(100vw-2rem,16rem)]">
                              <DropdownMenuItem
                                onSelect={() => setConfirm({ kind: 'undo', item: h })}
                                disabled={pending}
                              >
                                Undo this read
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setConfirm({ kind: 'clearAll', item: h })}
                                disabled={pending}
                              >
                                Clear all for this manga
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={!!confirm} onOpenChange={open => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'clearAll' ? 'Clear all for this manga?' : 'Undo this read?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm == null ? null : confirm.kind === 'clearAll' ? (
                <>
                  Remove reading progress for every chapter of{' '}
                  <span className="font-medium text-foreground">{confirm.item.manga.title}</span>. Those
                  chapters will leave history until you read them again.
                </>
              ) : (
                <>
                  Remove progress for{' '}
                  <span className="font-medium text-foreground">{confirm.item.chapter.title}</span> of{' '}
                  <span className="font-medium text-foreground">{confirm.item.manga.title}</span>. If you read
                  another chapter the same day, that entry will show next.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className={confirm?.kind === 'clearAll' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={e => {
                e.preventDefault();
                runConfirm();
              }}
            >
              {confirm?.kind === 'clearAll' ? 'Clear all' : 'Undo read'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default HistoryScreen;
