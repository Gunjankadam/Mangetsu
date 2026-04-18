import React, { useMemo } from 'react';
import { Pause, Play, X, Download, Trash2, AlertTriangle, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  useDownloads,
  useCancelDownload,
  useDeleteDownloadedChapter,
  usePauseDownload,
  useResumeDownload,
} from '../../hooks/useBackend';
import { EmptyState } from '../../components/EmptyState';
import { cn } from '@/lib/utils';
import { mangaDetailsPath, readerPath } from '@/lib/readerPath';

function DownloadsAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-24 right-[-20%] h-[min(18rem,48vw)] w-[min(18rem,48vw)] rounded-full bg-primary/[0.11] blur-[92px]" />
      <div className="absolute top-[36%] -left-[14%] h-44 w-44 rounded-full bg-[hsl(290_60%_44%/0.1)] blur-[76px]" />
      <div className="absolute bottom-28 right-[-10%] h-40 w-40 rounded-full bg-primary/[0.07] blur-[72px]" />
    </div>
  );
}

const DownloadsScreen: React.FC = () => {
  const { data: downloads, isLoading } = useDownloads();
  const cancel = useCancelDownload();
  const del = useDeleteDownloadedChapter();
  const pause = usePauseDownload();
  const resume = useResumeDownload();
  const navigate = useNavigate();

  const { active, done, errors } = useMemo(() => {
    const list = downloads ?? [];
    const done = list.filter(d => d.progress >= 100 && d.status !== 'error');
    const errors = list.filter(d => d.status === 'error');
    const active = list.filter(d => !errors.includes(d) && !done.includes(d));
    return { active, done, errors };
  }, [downloads]);

  return (
    <div className="relative flex flex-col min-h-screen pb-16">
      <DownloadsAmbient />
      <ScreenHeader title="Downloads" showBack />

      <main className="relative flex-1">
        {isLoading ? (
          <div className="space-y-3 px-3 pt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 backdrop-blur-sm"
              >
                <div className="h-[4.25rem] w-[3.2rem] shrink-0 skeleton-shimmer rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-[55%] max-w-[12rem] skeleton-shimmer rounded-md" />
                  <div className="h-3 w-[85%] skeleton-shimmer rounded-md" />
                  <div className="h-1.5 w-28 skeleton-shimmer rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : !downloads?.length ? (
          <EmptyState icon={<Download size={48} strokeWidth={1} />} title="No downloads" description="Downloads will appear here" />
        ) : (
          <div className="animate-fade-in px-3 pt-4 pb-6 space-y-6">
            {active.length > 0 && (
              <section>
                <div className="mb-3 px-1 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/90">
                      Downloading
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{active.length} active</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-3">
                  {active.map(dl => (
                    <li key={dl.id}>
                      <div
                        className={cn(
                          'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl px-3.5 py-3 text-left',
                          'border border-white/[0.1] bg-gradient-to-br from-white/[0.08] to-white/[0.02]',
                          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_10px_36px_-16px_rgba(0,0,0,0.65)]',
                          'backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 ease-out',
                        )}
                      >
                        <div
                          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
                          style={{
                            background:
                              'radial-gradient(90% 80% at 0% 50%, hsl(var(--primary) / 0.09), transparent 55%)',
                          }}
                        />
                        <div className="relative flex h-[4.25rem] w-[3.2rem] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] shadow-lg ring-1 ring-black/20">
                          <Download size={18} className="text-primary/80" />
                        </div>
                        <div className="relative flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{dl.manga.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                            {dl.chapter.title}
                          </p>
                          <div className="mt-2">
                            <div className="h-1.5 rounded-full bg-white/[0.1] overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary via-fuchsia-500/95 to-primary shadow-[0_0_14px_hsl(var(--primary)/0.55)] transition-[width] duration-500 ease-out"
                                style={{ width: `${Math.min(100, Math.max(0, dl.progress))}%` }}
                              />
                            </div>
                              <div className="mt-1 flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {dl.status === 'downloading' ? `${dl.progress}%` : dl.status}
                              </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => (dl.status === 'paused' ? resume.mutate(dl.id) : pause.mutate(dl.id))}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground active:bg-white/[0.06] touch-manipulation"
                                    aria-label={dl.status === 'paused' ? 'Resume download' : 'Pause download'}
                                    title={dl.status === 'paused' ? 'Resume' : 'Pause'}
                                  >
                                    {dl.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => cancel.mutate(dl.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground active:bg-white/[0.06] touch-manipulation"
                                    aria-label="Cancel download"
                                    title="Cancel"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {done.length > 0 && (
              <section>
                <div className="mb-3 px-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/90">
                    Downloaded
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{done.length} items</p>
                </div>
                <ul className="flex flex-col gap-3">
                  {done.map(dl => (
                    <li key={dl.id} className="relative">
                      {/* Clickable card — opens reader */}
                      <button
                        type="button"
                        onClick={() =>
                          navigate(readerPath(dl.manga.id, dl.chapter.id), {
                            state: {
                              chapterTitle: dl.chapter.title,
                              chapterNumber: dl.chapter.number,
                              readerInLibrary: true,
                              backTo: mangaDetailsPath(dl.manga.id),
                            },
                          })
                        }
                        className={cn(
                          'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl px-3.5 py-3 pr-14 text-left',
                          'border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.015]',
                          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.6)]',
                          'backdrop-blur-md transition-[transform,border-color] duration-200',
                          'active:scale-[0.985] active:border-primary/30',
                          '[@media(hover:hover)]:hover:border-primary/20 [@media(hover:hover)]:hover:bg-white/[0.08]',
                        )}
                      >
                        <div
                          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
                          style={{ background: 'radial-gradient(80% 70% at 0% 50%, hsl(var(--primary) / 0.08), transparent 60%)' }}
                        />
                        <div className="relative flex h-[4.1rem] w-[3.1rem] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] shadow-md">
                          <BookOpen size={18} className="text-primary/70" />
                        </div>
                        <div className="relative flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{dl.manga.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                            {dl.chapter.title}
                          </p>
                          <span className="mt-1 flex items-center gap-1 text-[10px] text-primary/70">
                            <BookOpen size={9} />
                            Tap to read
                          </span>
                        </div>
                      </button>

                      {/* Delete button — absolutely positioned so it's NOT inside the card button */}
                      <button
                        type="button"
                        onClick={() => del.mutate(dl.chapter.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground active:bg-white/[0.06] touch-manipulation"
                        aria-label="Delete download"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {errors.length > 0 && (
              <section>
                <div className="mb-3 px-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/90">
                    Errors
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{errors.length} failed</p>
                </div>
                <ul className="flex flex-col gap-3">
                  {errors.map(dl => (
                    <li key={dl.id}>
                      <div className="flex items-center gap-3.5 rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 backdrop-blur-md">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive shrink-0">
                          <AlertTriangle size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{dl.manga.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{dl.chapter.title}</p>
                          <span className="mt-1 block text-[10px] text-destructive/90">Failed</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancel.mutate(dl.id)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground active:bg-destructive/15 touch-manipulation"
                          aria-label="Remove failed download"
                          title="Remove"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default DownloadsScreen;
