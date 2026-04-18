import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Heart,
  Download,
  Share2,
  Bookmark,
  Check,
  MoreVertical,
  Trash2,
  Loader2,
  Tag,
  RefreshCw,
  ArrowLeftRight,
  X,
  ListChecks,
  Star,
} from 'lucide-react';
import {
  useMangaDetails,
  useMangaChapters,
  useToggleFavorite,
  useLibrarySections,
  useSetMangaCategories,
  useSetChapterBookmark,
  useEnqueueChapterDownload,
  useDownloads,
  READER_CHAPTER_SORT_PARAMS,
} from '../../hooks/useBackend';
import { cn } from '@/lib/utils';
import { readerPath } from '@/lib/readerPath';
import { useStore } from '../../store/useStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState } from '../../components/EmptyState';
import LibraryCategorySheet from '../../components/LibraryCategorySheet';
import { MangaMigrationSheet } from '../../components/MangaMigrationSheet';
import type { Chapter, ChapterFilter, Sort } from '../../types';
import { Backend } from '../../native/Backend';
import {
  applyReadingProgressToChapters,
  getLibraryProgressEpoch,
  inferChapterNumberForProgressList,
  subscribeLibraryProgress,
} from '../../storage/readProgressStore';
import { useAuth } from '../../auth/AuthProvider';
import { runFullCloudSync } from '../../lib/cloudSync';
import { runMangaMigration } from '../../lib/migrateManga';
import { supabaseConfigured } from '../../lib/supabase';
import coverFallbackImage from '../../assets/fallback-cover.png';

type MigratePreviewLocationState = {
  migratePreviewFrom?: string;
  migrateSourceLabel?: string;
  migrateFromTitle?: string;
};

const MangaDetailsScreen: React.FC = () => {
  const { mangaId } = useParams<{ mangaId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [descExpanded, setDescExpanded] = useState(false);
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>({});
  const [chapterSort, setChapterSort] = useState<Sort>({ field: 'number', direction: 'desc' });
  const [downloadingChapterId, setDownloadingChapterId] = useState<string | null>(null);
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);
  const [openMenuChapterId, setOpenMenuChapterId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categorySheetMode, setCategorySheetMode] = useState<'add' | 'edit'>('add');
  const migratingFromMangaId = useStore.getState().migratingFromMangaId;
  const [migrationOpen, setMigrationOpen] = useState(mangaId === migratingFromMangaId);
  const setMigratingFromMangaId = useStore(s => s.setMigratingFromMangaId);
  const setMigrationSearchQuery = useStore(s => s.setMigrationSearchQuery);
  const setMigrationLibraryQuery = useStore(s => s.setMigrationLibraryQuery);
  const setMigrationScrollPos = useStore(s => s.setMigrationScrollPos);

  const [migrateConfirmOpen, setMigrateConfirmOpen] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [refreshingManga, setRefreshingManga] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [markingBulk, setMarkingBulk] = useState(false);

  const previewState = (location.state as MigratePreviewLocationState | null) ?? {};
  const migratePreviewFrom = previewState.migratePreviewFrom;
  const migrateSourceLabel = previewState.migrateSourceLabel ?? 'this source';
  const migrateFromTitle = previewState.migrateFromTitle ?? 'your library entry';
  const hasMigratePreview = Boolean(
    migratePreviewFrom && mangaId && migratePreviewFrom !== mangaId,
  );

  useEffect(() => {
    if (mangaId && migratingFromMangaId === mangaId) {
      setMigrationOpen(true);
    } else {
      setMigrationOpen(false);
    }
  }, [mangaId, migratingFromMangaId]);

  const clearMigratePreview = () => {
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: {} },
    );
  };

  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { data: manga, isLoading: loadingDetails, refetch: refetchMangaDetails } = useMangaDetails(mangaId!);
  const { data: chapters, isLoading: loadingChapters, refetch: refetchChapters } = useMangaChapters(mangaId!, { filter: chapterFilter, sort: chapterSort });
  const progressEpoch = useSyncExternalStore(subscribeLibraryProgress, getLibraryProgressEpoch, getLibraryProgressEpoch);
  const chaptersWithProgress = useMemo(
    () => applyReadingProgressToChapters(chapters ?? [], mangaId ?? ''),
    [chapters, mangaId, progressEpoch],
  );
  const { data: librarySections = [] } = useLibrarySections();
  const toggleFav = useToggleFavorite();
  const setCategories = useSetMangaCategories();
  const setChapterBookmark = useSetChapterBookmark();
  const enqueueDl = useEnqueueChapterDownload();
  const { data: downloads } = useDownloads();

  const downloadStatusByChapterId = useMemo(() => {
    const m = new Map<string, { status: string; progress: number }>();
    (downloads ?? []).forEach(d => {
      if (!d?.chapter?.id) return;
      m.set(d.chapter.id, { status: d.status, progress: d.progress });
    });
    return m;
  }, [downloads]);

  const chaptersAscSnapshot = useMemo(() => {
    if (!chaptersWithProgress.length) return [];
    return [...chaptersWithProgress]
      .filter(c => !!c.id)
      .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
      .map(c => ({ id: c.id, number: c.number, title: c.title, totalPages: c.totalPages ?? 0 }));
  }, [chaptersWithProgress]);

  const nextChapterPrediction = useMemo(() => {
    if (!chapters?.length) return null;
    const times = chapters
      .map(c => new Date(c.uploadDate).getTime())
      .filter(t => Number.isFinite(t) && t > 0)
      .sort((a, b) => a - b);

    // No usable dates (or all same) → show Next: NA
    const unique = new Set(times);
    if (times.length === 0 || unique.size <= 1) return { kind: 'na' as const };

    // Need enough points to estimate a cadence (Tachiyomi-style).
    if (times.length < 4) return { kind: 'na' as const };

    const diffsDays: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const d = (times[i] - times[i - 1]) / 86400000;
      if (d >= 0.25 && d <= 120) diffsDays.push(d);
    }
    if (diffsDays.length < 3) return { kind: 'na' as const };

    const recent = diffsDays.slice(-6).sort((a, b) => a - b);
    const mid = Math.floor(recent.length / 2);
    const median = recent.length % 2 === 1 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
    if (!Number.isFinite(median) || median <= 0) return { kind: 'na' as const };

    const last = times[times.length - 1];
    const next = new Date(last + median * 86400000);
    const now = Date.now();
    const inDays = Math.round((next.getTime() - now) / 86400000);
    return { kind: 'date' as const, nextDate: next, intervalDays: Math.round(median), inDays };
  }, [chapters]);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    librarySections.forEach(s => m.set(s.id, s.name));
    return m;
  }, [librarySections]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(''), 1800);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const runMigrateFromPreview = async () => {
    if (!mangaId || !migratePreviewFrom) return;
    setMigrateBusy(true);
    try {
      const r = await runMangaMigration(migratePreviewFrom, mangaId);
      if (r.ok === false) {
        setToastMessage(r.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['libraryManga'] });
      queryClient.invalidateQueries({ queryKey: ['mangaDetails'] });
      queryClient.invalidateQueries({ queryKey: ['mangaChapters'] });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['updates'] });
      setToastMessage('Migrated — library & progress moved');
      if (session && supabaseConfigured()) {
        void runFullCloudSync(session).then(res => {
          if (res.ok) queryClient.invalidateQueries();
        });
      }
      setMigrateConfirmOpen(false);
      clearMigratePreview();
      if (r.newMangaId !== mangaId) {
        navigate(`/manga/${encodeURIComponent(r.newMangaId)}`, { replace: true, state: {} });
      }
      // Clear migration state on success
      setMigratingFromMangaId(null);
      setMigrationSearchQuery('');
      setMigrationLibraryQuery('');
      setMigrationScrollPos(0);
    } finally {
      setMigrateBusy(false);
    }
  };

  if (loadingDetails) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-72 skeleton-shimmer" />
        <div className="px-4 py-4 space-y-3">
          <div className="h-6 w-48 skeleton-shimmer rounded" />
          <div className="h-4 w-32 skeleton-shimmer rounded" />
          <div className="h-20 skeleton-shimmer rounded" />
        </div>
      </div>
    );
  }

  if (!manga) return <ErrorState message="Manga not found" />;

  const libraryCategoryIds = (manga.categoryIds ?? []).filter(id => id && id !== 'all');

  const cleanGenres = (manga.genres ?? [])
    .map(g => g?.trim?.() ?? '')
    .filter(Boolean);

  const coverUrl = manga.coverUrl?.trim?.() || coverFallbackImage;

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleMangaRefresh = async () => {
    if (!mangaId) return;
    setRefreshingManga(true);
    try {
      if (manga) {
        const upToDate = await Backend.isMangaUpToDate(manga);
        if (upToDate) {
          setToastMessage('Up to date');
          return;
        }
      }

      await Promise.all([refetchMangaDetails(), refetchChapters()]);
      
      // Update anilist last count from the fresh chapter list
      if (chapters) {
        Backend.updateAnilistLastCount(mangaId, chapters);
      }

      await queryClient.invalidateQueries({ queryKey: ['mangaDetails', mangaId] });
      await queryClient.invalidateQueries({ queryKey: ['mangaChapters', mangaId] });
      queryClient.invalidateQueries({ queryKey: ['libraryManga'] });
      setToastMessage('Refreshed');
    } catch {
      setToastMessage('Could not refresh');
    } finally {
      setRefreshingManga(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = manga.url || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: manga.title,
          text: `Check out ${manga.title}`,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setToastMessage('Share link copied to clipboard');
    } catch {
      // user cancelled share dialog or clipboard denied
    }
  };

  const handleDownloadChapter = async (ch: Chapter) => {
    if (!ch?.id) return;
    try {
      setDownloadingChapterId(ch.id);
      await enqueueDl.mutateAsync({ manga, chapter: ch });
      setToastMessage(`Queued ${ch.title}`);
    } catch {
      setToastMessage('Failed to download chapter');
    } finally {
      setDownloadingChapterId(null);
    }
  };

  const handleBulkMarkRead = async (read: boolean) => {
    if (selectedChapters.size === 0) return;
    setMarkingBulk(true);
    try {
      const ids = Array.from(selectedChapters);
      for (const id of ids) {
        await Backend.markChapterRead(id, read);
      }
      await queryClient.invalidateQueries({ queryKey: ['mangaChapters', mangaId] });
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      setToastMessage(`Marked ${ids.length} as ${read ? 'read' : 'unread'}`);
      setMultiSelectMode(false);
      setSelectedChapters(new Set());
    } catch {
      setToastMessage('Failed to update chapters');
    } finally {
      setMarkingBulk(false);
    }
  };

  const handleDownloadAllChapters = async () => {
    if (!chapters?.length) return;
    try {
      setDownloadingAll(true);
      for (const ch of chapters) {
        const existing = ch.id ? downloadStatusByChapterId.get(ch.id) : null;
        const already =
          ch.downloaded || (existing != null && (existing.progress >= 100 || existing.status === 'downloading' || existing.status === 'queued' || existing.status === 'paused'));
        if (!ch.id || already) continue;
        await enqueueDl.mutateAsync({ manga, chapter: ch });
      }
      setToastMessage('Queued all chapters');
    } catch {
      setToastMessage('Failed while downloading all chapters');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDeleteDownloadedChapter = async (ch: Chapter) => {
    if (!ch?.id) return;
    try {
      setDeletingChapterId(ch.id);
      await Backend.deleteDownloadedChapter(ch.id);
      await refetchChapters();
      setToastMessage(`Deleted ${ch.title} download`);
    } catch {
      setToastMessage('Failed to delete downloaded chapter');
    } finally {
      setDeletingChapterId(null);
      setOpenMenuChapterId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {manga ? (
        <MangaMigrationSheet
          open={migrationOpen}
          onClose={() => {
            setMigrationOpen(false);
            setMigratingFromMangaId(null);
          }}
          fromMangaId={manga.id}
          fromMangaTitle={manga.title}
          onMigrated={() => {
            setMigratingFromMangaId(null);
            setMigrationSearchQuery('');
            setMigrationLibraryQuery('');
            setMigrationScrollPos(0);
            queryClient.invalidateQueries({ queryKey: ['libraryManga'] });
            queryClient.invalidateQueries({ queryKey: ['mangaDetails'] });
            queryClient.invalidateQueries({ queryKey: ['mangaChapters'] });
            queryClient.invalidateQueries({ queryKey: ['downloads'] });
            queryClient.invalidateQueries({ queryKey: ['history'] });
            queryClient.invalidateQueries({ queryKey: ['updates'] });
            setToastMessage('Migrated — library & progress moved');
            if (session && supabaseConfigured()) {
              void runFullCloudSync(session).then(r => {
                if (r.ok) queryClient.invalidateQueries();
              });
            }
          }}
        />
      ) : null}

      <LibraryCategorySheet
        open={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        sections={librarySections}
        initialSelectedIds={libraryCategoryIds}
        mode={categorySheetMode}
        isPending={toggleFav.isPending || setCategories.isPending}
        onConfirm={ids => {
          if (categorySheetMode === 'add') {
            toggleFav.mutate(
              { mangaId: manga.id, favorite: true, categoryIds: ids },
              {
                onSuccess: () => {
                  setCategorySheetOpen(false);
                  setToastMessage('Added to your library');
                },
                onError: () => setToastMessage('Could not add to library'),
              },
            );
          } else {
            setCategories.mutate(
              { mangaId: manga.id, categoryIds: ids },
              {
                onSuccess: () => {
                  setCategorySheetOpen(false);
                  setToastMessage('Categories updated');
                },
                onError: () => setToastMessage('Could not update categories'),
              },
            );
          }
        }}
      />

      {/* Immersive header */}
      <div className="relative h-[19rem] sm:h-80 overflow-hidden">
        <img
          src={manga.bannerUrl || coverUrl}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            !manga.bannerUrl && "scale-110 blur-2xl opacity-50 saturate-125"
          )}
          onError={(e) => { e.currentTarget.src = coverFallbackImage; }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/55 to-background" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-primary/[0.07]" />

        <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-3 px-4 h-14 safe-top z-10">
          <button
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-background/55 backdrop-blur-md border border-border/50 text-foreground shadow-sm touch-manipulation"
            aria-label="Back"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-background/55 backdrop-blur-md border border-border/50 text-foreground shadow-sm touch-manipulation"
                aria-label="More options"
              >
                {refreshingManga ? (
                  <Loader2 size={20} strokeWidth={1.5} className="animate-spin" />
                ) : (
                  <MoreVertical size={20} strokeWidth={1.5} />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl border-border/80">
              <DropdownMenuItem
                className="gap-2 rounded-lg py-2.5"
                disabled={refreshingManga}
                onSelect={() => {
                  void handleMangaRefresh();
                }}
              >
                <RefreshCw size={16} strokeWidth={2} className="text-muted-foreground" />
                Refresh
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 rounded-lg py-2.5"
                onSelect={() => {
                  setMigratingFromMangaId(mangaId!);
                  setMigrationOpen(true);
                }}
              >
                <ArrowLeftRight size={16} strokeWidth={2} className="text-muted-foreground" />
                Migrate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="absolute bottom-5 left-4 right-4 flex gap-4 z-10 items-end">
          <div className="relative flex-shrink-0">
            <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-primary/40 to-primary/5 opacity-80 blur-sm" aria-hidden />
            <img
              src={coverUrl}
              alt={manga.title}
              className="relative h-40 w-[6.75rem] sm:h-44 sm:w-28 rounded-xl object-cover shadow-2xl ring-2 ring-border/60"
              onError={(e) => { e.currentTarget.src = coverFallbackImage; }}
            />
          </div>
          <div className="flex flex-col justify-end min-w-0 pb-0.5">
            <h1 className="text-[1.35rem] sm:text-2xl font-bold text-foreground leading-snug line-clamp-2 tracking-tight">
              {manga.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{manga.author}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'text-[11px] font-semibold px-2.5 py-1 rounded-full border',
                  manga.status === 'Ongoing'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-secondary/70 text-secondary-foreground border-border/60',
                )}
              >
                {manga.status}
              </span>
              {manga.averageScore && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 text-[11px] font-bold text-amber-500 shadow-sm transition-all hover:bg-amber-400/20">
                  <Star size={12} fill="currentColor" strokeWidth={0} className="-mt-0.5" />
                  {manga.averageScore}%
                </span>
              )}
              {nextChapterPrediction && manga.status !== 'Completed' && manga.status !== 'Cancelled' && (
                <span
                  className={cn(
                    'text-[11px] font-semibold px-2.5 py-1 rounded-full border',
                    nextChapterPrediction.kind === 'na'
                      ? 'bg-muted/60 text-muted-foreground border-border/60'
                      : nextChapterPrediction.inDays <= 0
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        : manga.status === 'Ongoing'
                          ? 'bg-secondary/70 text-secondary-foreground border-border/60'
                          : 'bg-muted/60 text-muted-foreground border-border/60',
                  )}
                  title={
                    nextChapterPrediction.kind === 'na'
                      ? 'Not enough distinct publish dates to predict'
                      : `Estimated cadence: ~${nextChapterPrediction.intervalDays}d`
                  }
                >
                  {nextChapterPrediction.kind === 'na' ? (
                    <>Next: NA</>
                  ) : (
                    <>
                      Next:{' '}
                      {nextChapterPrediction.nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                      {nextChapterPrediction.inDays <= 0 ? '(due)' : `(${nextChapterPrediction.inDays}d)`}
                    </>
                  )}
                </span>
              )}
              {manga.source ? (
                <span className="text-[11px] font-medium text-muted-foreground/90 truncate max-w-[10rem] sm:max-w-none">
                  {manga.source}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {hasMigratePreview ? (
        <div className="mx-4 mt-3 rounded-2xl border border-primary/35 bg-primary/10 px-3 py-3 text-xs leading-relaxed text-foreground/95">
          <p className="font-semibold text-foreground">Migration preview</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={migrateBusy}
              onClick={() => clearMigratePreview()}
              className="rounded-xl border border-border/80 bg-secondary/80 px-3 py-2 text-[11px] font-semibold touch-manipulation disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              disabled={migrateBusy}
              onClick={() => setMigrateConfirmOpen(true)}
              className="rounded-xl bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground touch-manipulation disabled:opacity-50"
            >
              Migrate here
            </button>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="px-4 -mt-1 relative z-[1]">
        <div className="rounded-2xl border border-border/70 bg-card/70 backdrop-blur-xl p-3 shadow-lg shadow-black/20">
          <div className="flex items-stretch gap-2">
            {!manga.inLibrary ? (
              <button
                type="button"
                onClick={() => {
                  if (hasMigratePreview) {
                    setMigrateConfirmOpen(true);
                    return;
                  }
                  setCategorySheetMode('add');
                  setCategorySheetOpen(true);
                }}
                className="flex flex-1 min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/90 py-2.5 px-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 touch-manipulation active:scale-[0.99] transition-transform"
              >
                <Heart size={17} strokeWidth={1.75} /> Add to library
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleFav.mutate({ mangaId: manga.id, favorite: false })}
                  className="flex flex-1 min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-primary/12 border border-primary/25 py-2.5 px-3 text-sm font-semibold text-primary touch-manipulation active:scale-[0.99] transition-transform"
                >
                  <Heart size={17} strokeWidth={1.75} fill="currentColor" /> In library
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCategorySheetMode('edit');
                    setCategorySheetOpen(true);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-secondary/80 text-secondary-foreground touch-manipulation"
                  aria-label="Edit library categories"
                >
                  <Tag size={18} strokeWidth={1.5} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleDownloadAllChapters}
              disabled={downloadingAll}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-secondary/80 text-secondary-foreground touch-manipulation disabled:opacity-50"
              aria-label="Download all chapters"
            >
              {downloadingAll ? <Loader2 size={18} strokeWidth={1.5} className="animate-spin" /> : <Download size={18} strokeWidth={1.5} />}
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-secondary/80 text-secondary-foreground touch-manipulation"
              aria-label="Share"
            >
              <Share2 size={18} strokeWidth={1.5} />
            </button>
          </div>
          {manga.inLibrary && libraryCategoryIds.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
              {libraryCategoryIds.map(id => (
                <span
                  key={id}
                  className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  {categoryNameById.get(id) ?? id}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Genres */}
      {cleanGenres.length > 0 && (
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {cleanGenres.map(g => (
              <span
                key={g}
                className="rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 text-[11px] font-medium text-secondary-foreground"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <p className={`text-sm text-muted-foreground leading-relaxed ${descExpanded ? '' : 'line-clamp-3'}`}>
            {manga.description}
          </p>
          {descExpanded && manga.altTitles && manga.altTitles.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border/40">
              <span className="text-sm text-foreground/90 block mb-1">Alternative Name:</span>
              <ul className="list-inside space-y-1 ml-1" style={{ listStyleType: 'disc' }}>
                {manga.altTitles.map((alt, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    {alt}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => setDescExpanded(!descExpanded)}
            className="mt-3 text-xs font-semibold text-primary touch-manipulation"
          >
            {descExpanded ? 'Show less' : 'Read more'}
          </button>
        </div>
      </div>

      {/* Chapter list header */}
      <div className="flex items-end justify-between gap-2 px-4 py-3 border-t border-border/80">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Chapters</h2>
          <p className="text-lg font-bold text-foreground tabular-nums leading-tight mt-0.5">{chaptersWithProgress.length}</p>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar max-w-[58%] sm:max-w-none justify-end pb-0.5">
          {(['unread', 'downloaded', 'bookmarked'] as const).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setChapterFilter(f => ({ ...f, [key]: !f[key] }))}
              className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold touch-manipulation border ${chapterFilter[key]
                ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                : 'bg-secondary/70 text-secondary-foreground border-border/60'
                }`}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setChapterSort(s => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold bg-secondary/70 text-secondary-foreground border border-border/60 touch-manipulation"
          >
            {chapterSort.direction === 'desc' ? 'Newest' : 'Oldest'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMultiSelectMode(!multiSelectMode);
              if (multiSelectMode) setSelectedChapters(new Set());
            }}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold border touch-manipulation flex items-center gap-1",
              multiSelectMode ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20" : "bg-secondary/70 text-secondary-foreground border-border/60"
            )}
          >
            <ListChecks size={12} />
            Select
          </button>
        </div>
      </div>

      {/* Chapter list */}
      <div className="px-3 pb-6 space-y-1.5">
        {loadingChapters
          ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 px-3 py-3.5">
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-36 skeleton-shimmer rounded" />
                <div className="h-3 w-24 skeleton-shimmer rounded" />
              </div>
            </div>
          ))
          : chaptersWithProgress.map((ch, idx) => {
            const hasProgress = ch.read || ch.lastPageRead > 0;
            const hasFilters = chapterFilter.unread || chapterFilter.downloaded || chapterFilter.bookmarked;
            let missingCount = 0;

            if (!hasFilters && idx > 0) {
              const prevCh = chaptersWithProgress[idx - 1];
              if (typeof ch.number === 'number' && typeof prevCh.number === 'number') {
                if (ch.number >= 0 && prevCh.number >= 0) {
                  const diff = Math.abs(Math.floor(prevCh.number) - Math.floor(ch.number));
                  if (diff > 1) {
                    missingCount = diff - 1;
                  }
                }
              }
            }

            return (
              <React.Fragment key={ch.id || `${manga.id}-${ch.number}-${idx}`}>
                {missingCount > 0 && (
                  <div className="flex items-center justify-center py-1.5 px-2 opacity-80 pointer-events-none">
                    <div className="h-px bg-border/40 flex-1" />
                    <span className="px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      Missing {missingCount} {missingCount === 1 ? 'chapter' : 'chapters'}
                    </span>
                    <div className="h-px bg-border/40 flex-1" />
                  </div>
                )}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!ch.id) return;
                    if (multiSelectMode) {
                      setSelectedChapters(prev => {
                        const next = new Set(prev);
                        if (next.has(ch.id!)) next.delete(ch.id!);
                        else next.add(ch.id!);
                        return next;
                      });
                      return;
                    }
                    void queryClient.prefetchQuery({
                      queryKey: ['mangaChapters', manga.id, READER_CHAPTER_SORT_PARAMS],
                      queryFn: () => Backend.getMangaChapters(manga.id, READER_CHAPTER_SORT_PARAMS),
                    });
                    navigate(readerPath(manga.id, ch.id), {
                      state: {
                        chapterTitle: ch.title,
                        chapterNumber: inferChapterNumberForProgressList(ch) ?? ch.number,
                        chaptersSnapshot: chaptersAscSnapshot,
                        readerInLibrary: manga.inLibrary,
                      },
                    });
                  }}
                  onKeyDown={(e) => {
                    if (!ch.id) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (multiSelectMode) {
                        setSelectedChapters(prev => {
                          const next = new Set(prev);
                          if (next.has(ch.id!)) next.delete(ch.id!);
                          else next.add(ch.id!);
                          return next;
                        });
                        return;
                      }
                      void queryClient.prefetchQuery({
                        queryKey: ['mangaChapters', manga.id, READER_CHAPTER_SORT_PARAMS],
                        queryFn: () => Backend.getMangaChapters(manga.id, READER_CHAPTER_SORT_PARAMS),
                      });
                      navigate(readerPath(manga.id, ch.id), {
                        state: {
                          chapterTitle: ch.title,
                          chapterNumber: inferChapterNumberForProgressList(ch) ?? ch.number,
                          chaptersSnapshot: chaptersAscSnapshot,
                          readerInLibrary: manga.inLibrary,
                        },
                      });
                    }
                  }}
                  className={cn(
                    "group flex w-full overflow-hidden rounded-xl border border-border/50 text-left shadow-sm shadow-black/5 transition-all duration-200 touch-manipulation hover:border-primary/20 active:scale-[0.995]",
                    selectedChapters.has(ch.id!) ? "bg-primary/10 border-primary/40 shadow-primary/10" : "bg-card/25 hover:bg-muted/15"
                  )}
                >
                  <div
                    className={`w-1 shrink-0 self-stretch transition-colors ${selectedChapters.has(ch.id!)
                      ? 'bg-primary'
                      : hasProgress
                        ? 'bg-gradient-to-b from-primary via-primary/80 to-primary/50'
                        : 'bg-muted/40'
                      }`}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-3 pr-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-[0.9375rem] font-semibold leading-snug tracking-tight line-clamp-2 ${hasProgress ? 'text-muted-foreground' : 'text-foreground'
                          }`}
                      >
                        {ch.title}
                      </p>
                      {ch.lastPageRead > 0 && (
                        <p className="mt-1 text-xs font-semibold text-foreground tabular-nums tracking-wide">
                          {(() => {
                            const p = ch.lastPageRead;
                            const t = ch.totalPages > 0 ? ch.totalPages : null;
                            const progress = t != null ? `p.${p} / ${t}` : `p.${p}`;
                            return ch.read ? `Read · ${progress}` : progress;
                          })()}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/90 tabular-nums">
                        {ch.scanlator && `${ch.scanlator} · `}
                        {formatDate(ch.uploadDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (!ch.id) return;
                          setChapterBookmark.mutate({ chapterId: ch.id, bookmarked: !ch.bookmarked });
                        }}
                        disabled={!ch.id}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full touch-manipulation transition-colors',
                          ch.bookmarked
                            ? 'bg-primary/20 text-primary'
                            : 'bg-secondary text-secondary-foreground hover:bg-muted',
                        )}
                        aria-label={ch.bookmarked ? `Remove bookmark from ${ch.title}` : `Bookmark ${ch.title}`}
                      >
                        <Bookmark size={12} strokeWidth={2} className={ch.bookmarked ? 'fill-current' : ''} />
                      </button>
                      {(() => {
                        const dl = ch.id ? downloadStatusByChapterId.get(ch.id) : undefined;
                        const isDownloaded = ch.downloaded || (dl != null && dl.progress >= 100);
                        const isQueuedOrActive =
                          dl != null &&
                          (dl.status === 'queued' || dl.status === 'downloading' || dl.status === 'paused') &&
                          dl.progress < 100;

                        if (isDownloaded) {
                          return (
                            <>
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <Check size={12} />
                              </span>
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuChapterId((prev) => (prev === ch.id ? null : ch.id));
                                  }}
                                  className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-secondary-foreground touch-manipulation"
                                  aria-label={`More actions for ${ch.title}`}
                                >
                                  <MoreVertical size={12} />
                                </button>
                                {openMenuChapterId === ch.id && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteDownloadedChapter(ch);
                                    }}
                                    disabled={deletingChapterId === ch.id}
                                    className="absolute right-0 top-7 z-10 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-red-400 shadow-md"
                                    aria-label={`Delete download for ${ch.title}`}
                                  >
                                    <Trash2 size={11} />
                                    {deletingChapterId === ch.id ? 'Deleting...' : 'Delete'}
                                  </button>
                                )}
                              </div>
                            </>
                          );
                        }

                        if (isQueuedOrActive) {
                          return (
                            <span
                              className={cn(
                                'flex h-6 min-w-10 items-center justify-center rounded-full px-2 text-[10px] font-semibold tabular-nums',
                                'border border-primary/25 bg-primary/10 text-primary',
                              )}
                              aria-label={`Download ${dl?.status ?? 'queued'} ${dl?.progress ?? 0}%`}
                              title={`Download ${dl?.status ?? 'queued'} ${dl?.progress ?? 0}%`}
                            >
                              {dl?.status === 'paused' ? 'Paused' : dl?.status === 'queued' ? 'Queued' : `${dl?.progress ?? 0}%`}
                            </span>
                          );
                        }

                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadChapter(ch); }}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-secondary-foreground touch-manipulation"
                            aria-label={`Download ${ch.title}`}
                            disabled={downloadingChapterId === ch.id || enqueueDl.isPending}
                          >
                            {downloadingChapterId === ch.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Download size={12} />
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
      </div>

      {multiSelectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col bg-background/90 backdrop-blur-xl border-t border-border shadow-[0_-10px_40px_rgba(0,0,0,0.3)] pb-4 safe-bottom animate-in slide-in-from-bottom-full duration-300 max-w-lg mx-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/20">
            <span className="text-sm font-semibold">{selectedChapters.size} selected</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedChapters.size === chaptersWithProgress.length) {
                    setSelectedChapters(new Set());
                  } else {
                    setSelectedChapters(new Set(chaptersWithProgress.map(c => c.id).filter(Boolean) as string[]));
                  }
                }}
                className="text-xs font-semibold text-primary px-3 py-1.5 rounded-lg bg-primary/10 active:bg-primary/20 touch-manipulation"
              >
                {selectedChapters.size === chaptersWithProgress.length && chaptersWithProgress.length
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-around p-3 pt-4">
            <button
              onClick={() => handleBulkMarkRead(true)}
              disabled={selectedChapters.size === 0 || markingBulk}
              className="flex flex-col items-center gap-1.5 text-foreground disabled:opacity-50 touch-manipulation transition-transform active:scale-95"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-primary">
                {markingBulk ? <Loader2 size={20} strokeWidth={2.5} className="animate-spin" /> : <Check size={20} strokeWidth={2.5} />}
              </div>
              <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Mark read</span>
            </button>
            <button
              onClick={() => handleBulkMarkRead(false)}
              disabled={selectedChapters.size === 0 || markingBulk}
              className="flex flex-col items-center gap-1.5 text-foreground disabled:opacity-50 touch-manipulation transition-transform active:scale-95"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                {markingBulk ? <Loader2 size={18} strokeWidth={2.5} className="animate-spin" /> : <RefreshCw size={18} strokeWidth={2.5} />}
              </div>
              <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Mark unread</span>
            </button>
            <button
              onClick={() => {
                setMultiSelectMode(false);
                setSelectedChapters(new Set());
              }}
              className="flex flex-col items-center gap-1.5 text-foreground touch-manipulation transition-transform active:scale-95"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border/80 bg-transparent text-muted-foreground">
                <X size={20} strokeWidth={2.5} />
              </div>
              <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Cancel</span>
            </button>
          </div>
        </div>
      )}

      {migrateConfirmOpen && migratePreviewFrom && mangaId ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[82] bg-black/70"
            aria-label="Dismiss"
            disabled={migrateBusy}
            onClick={() => !migrateBusy && setMigrateConfirmOpen(false)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="details-migrate-confirm-title"
            className="fixed left-1/2 top-1/2 z-[83] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/80 bg-card p-4 shadow-2xl"
          >
            <h3 id="details-migrate-confirm-title" className="text-base font-semibold text-foreground">
              Migrate to this entry?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{manga.title}</span>
              <span className="text-muted-foreground"> · {migrateSourceLabel}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Replacing <span className="font-medium text-foreground">{migrateFromTitle}</span> in your library.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground leading-relaxed">
              <li>
                Progress and bookmarks follow chapter numbers. This catalog becomes your library entry (metadata and
                chapters from this source).
              </li>
              <li>Library categories from your previous entry are applied automatically.</li>
            </ul>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={migrateBusy}
                onClick={() => setMigrateConfirmOpen(false)}
                className="rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-medium touch-manipulation disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={migrateBusy}
                onClick={() => void runMigrateFromPreview()}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground touch-manipulation disabled:opacity-50"
              >
                {migrateBusy ? 'Migrating…' : 'Migrate'}
              </button>
            </div>
          </div>
        </>
      ) : null}
      {toastMessage && (
        <div className="fixed left-1/2 bottom-24 z-50 -translate-x-1/2 rounded-full bg-card border border-border px-4 py-2 text-xs text-foreground shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default MangaDetailsScreen;
