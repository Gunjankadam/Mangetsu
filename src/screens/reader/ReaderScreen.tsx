import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import {
  useChapterPages,
  useMangaChapters,
  useMangaDetails,
  useSaveProgress,
  READER_CHAPTER_SORT_PARAMS,
} from '../../hooks/useBackend';
import { Backend } from '../../native/Backend';
import { useStore } from '../../store/useStore';
import {
  chapterIdsReferToSameChapter,
  getChapterProgressRow,
  initReadProgressPersistence,
  saveReaderProgressToStore,
} from '../../storage/readProgressStore';
import { formatChapterDisplayTitle } from '../../utils/chapterDisplay';
import type { Chapter, Page, ReadingDirection } from '../../types';
import { useAuth } from '../../auth/AuthProvider';
import { supabaseConfigured } from '../../lib/supabase';
import { fetchSingleReadingProgress, pushSingleReadingProgress } from '../../lib/cloudSync';
import { readerPath } from '../../lib/readerPath';

export type ReaderLocationState = {
  chapterTitle?: string;
  chapterNumber?: number;
  /** Optional chapter list from details screen for reliable next/prev even off-library. */
  chaptersSnapshot?: { id: string; number: number; title: string; totalPages?: number }[];
  /** Passed from details page; used to decide whether to rely on snapshot for continuation. */
  readerInLibrary?: boolean;
  /** Open first manga page (skip title) — e.g. advanced from previous chapter. */
  readerEnterNext?: boolean;
  /** Open last manga page — e.g. went back from next chapter. */
  readerEnterEnd?: boolean;
  /** Set via History to resume chapter exactly on the last read page */
  startPage?: number;
  /** Override back-button destination (e.g. manga details page when opened from Downloads). */
  backTo?: string;
};

type ReaderSegment = { chapterId: string; heading: string; pages: Page[] };

// Non-library continuity: cache chapter snapshots per manga so next/prev keeps working
// even when the reader is opened from History or state is lost between navigations.
const chapterSnapshotCache = new Map<string, { id: string; number: number; title: string; totalPages?: number }[]>();

function chapterHeading(nav: ReaderLocationState): string {
  const n = nav.chapterNumber;
  const t = nav.chapterTitle?.trim();
  if (n != null && Number.isFinite(Number(n))) {
    return formatChapterDisplayTitle(Number(n), t ?? '');
  }
  if (t) return t;
  return 'Chapter';
}

function queryReaderSlot(root: HTMLElement | null, chapterId: string, spread: number): HTMLElement | null {
  if (!root) return null;
  const nodes = root.querySelectorAll('[data-reader-chapter-id][data-reader-spread]');
  for (const n of nodes) {
    const el = n as HTMLElement;
    const cid = el.dataset.readerChapterId;
    if (
      cid != null &&
      el.dataset.readerSpread != null &&
      chapterIdsReferToSameChapter(cid, chapterId) &&
      el.dataset.readerSpread === String(spread)
    ) {
      return el;
    }
  }
  return null;
}

/** Black intro spread; not counted as a manga page. */
const ChapterTitleSlide: React.FC<{ chapterId: string; title: string }> = ({ chapterId, title }) => (
  <div
    data-reader-chapter-id={chapterId}
    data-reader-spread="0"
    className="flex h-full min-h-[100dvh] w-full shrink-0 flex-col items-center justify-center bg-black px-6 text-center"
  >
    <p className="text-balance text-lg font-semibold tracking-tight text-white/95 sm:text-xl">{title}</p>
  </div>
);

/** Black end slide; not counted as a manga page. Used as a reliable trigger for continuous next. */
const ChapterEndSlide: React.FC<{ chapterId: string; spread: number; title: string }> = ({
  chapterId,
  spread,
  title,
}) => (
  <div
    data-reader-chapter-id={chapterId}
    data-reader-spread={spread}
    className="flex h-full min-h-[100dvh] w-full shrink-0 flex-col items-center justify-center bg-black px-6 text-center"
  >
    <p className="text-balance text-xs font-semibold tracking-[0.22em] text-white/75 uppercase">
      END OF CHAPTER
    </p>
    <p className="mt-2 text-balance text-lg font-semibold tracking-tight text-white/95 sm:text-xl">{title}</p>
  </div>
);

/** Centered phone-width column on wide viewports; brightness dims page content (store 0.2–1). */
const ReaderShell: React.FC<{ children: React.ReactNode; brightness?: number }> = ({ children, brightness = 1 }) => (
  <div className="flex min-h-[100dvh] w-full justify-center bg-black">
    <div
      className="relative flex min-h-[100dvh] w-full max-w-md flex-col bg-background shadow-[0_0_80px_rgba(0,0,0,0.5)] border-x border-white/5"
      style={{ filter: `brightness(${brightness})` }}
    >
      {children}
    </div>
  </div>
);

type ChapterNav = Pick<Chapter, 'id' | 'number' | 'title' | 'totalPages'>;

const ReaderScreen: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as ReaderLocationState | null) ?? {};
  const qc = useQueryClient();
  const { session } = useAuth();
  const { data: pages, isLoading } = useChapterPages(chapterId!);
  const { data: rawChapters } = useMangaChapters(mangaId!, READER_CHAPTER_SORT_PARAMS);
  const { data: mangaDetails } = useMangaDetails(mangaId ?? '');
  const saveProgress = useSaveProgress();
  const {
    readerDirection,
    readerDirectionByMangaId,
    setReaderDirection,
    setReaderDirectionForManga,
    brightness,
  } = useStore();

  const inLibrary = mangaDetails?.inLibrary === true || navState.readerInLibrary === true;
  const effectiveReaderDirection: ReadingDirection = useMemo(() => {
    if (mangaId && inLibrary && readerDirectionByMangaId[mangaId]) {
      return readerDirectionByMangaId[mangaId];
    }
    return readerDirection;
  }, [mangaId, inLibrary, readerDirection, readerDirectionByMangaId]);

  // Cache snapshot whenever it's provided.
  useEffect(() => {
    if (!mangaId) return;
    const snap = navState.chaptersSnapshot;
    if (snap?.length) chapterSnapshotCache.set(mangaId, snap);
  }, [mangaId, navState.chaptersSnapshot]);

  const orderedChapters = useMemo(() => {
    const fromQuery: ChapterNav[] =
      rawChapters?.length
        ? rawChapters
            .filter(c => !!c?.id)
            .map(c => ({ id: c.id, number: c.number, title: c.title, totalPages: c.totalPages ?? 0 }))
        : [];
    const fromSnapshot: ChapterNav[] =
      !fromQuery.length && navState.chaptersSnapshot?.length
        ? navState.chaptersSnapshot
            .filter(c => !!c?.id)
            .map(c => ({
              id: c.id,
              number: c.number,
              title: c.title,
              totalPages: typeof c.totalPages === 'number' ? c.totalPages : 0,
            }))
        : [];
    const src = fromQuery.length ? fromQuery : fromSnapshot;
    if (!src.length) return [];
    return [...src].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  }, [rawChapters, navState.chaptersSnapshot]);

  // Non-library continuation should prefer the snapshot from the details page,
  // because `useMangaChapters()` can be incomplete or return unusable ids for some sources.
  const orderedChaptersNonLibrary = useMemo((): ChapterNav[] => {
    const snap = navState.chaptersSnapshot?.length
      ? navState.chaptersSnapshot
      : (mangaId ? chapterSnapshotCache.get(mangaId) : undefined);
    if (!snap?.length) return [];
    return [...snap]
      .filter(c => !!c?.id)
      .map(c => ({
        id: c.id,
        number: c.number,
        title: c.title,
        totalPages: 'totalPages' in c && typeof (c as ChapterNav).totalPages === 'number' ? (c as ChapterNav).totalPages : 0,
      }))
      .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  }, [navState.chaptersSnapshot, mangaId]);

  const isNonLibrary =
    navState.readerInLibrary === false ||
    (navState.readerInLibrary == null && mangaDetails?.inLibrary === false);
  const hasNonLibrarySnapshot = orderedChaptersNonLibrary.length > 0;
  const hasApiChapterList = orderedChapters.length > 0;
  // Prefer API chapter list whenever it exists (library + most non-library). Use snapshot-only nav
  // only when off-library and the chapters API returned nothing (some sources) but we have a details snapshot.
  const useNonLibraryNav = isNonLibrary && hasNonLibrarySnapshot && !hasApiChapterList;
  const orderedChaptersNav = useNonLibraryNav ? orderedChaptersNonLibrary : orderedChapters;
  const continuationEnabled = !isNonLibrary || hasNonLibrarySnapshot || hasApiChapterList;
  const showNonLibraryEndSlide = isNonLibrary && hasNonLibrarySnapshot;

  const chapterListIndex = useMemo(
    () => orderedChaptersNav.findIndex(c => chapterIdsReferToSameChapter(c.id, chapterId)),
    [orderedChaptersNav, chapterId],
  );
  const nextChapterCandidate: ChapterNav | null =
    chapterListIndex >= 0 && chapterListIndex < orderedChaptersNav.length - 1
      ? orderedChaptersNav[chapterListIndex + 1]
      : null;
  const prevChapterCandidate: ChapterNav | null =
    chapterListIndex > 0 ? orderedChaptersNav[chapterListIndex - 1] : null;
  const nextChapter: ChapterNav | null = continuationEnabled ? nextChapterCandidate : null;
  const prevChapter: ChapterNav | null = continuationEnabled ? prevChapterCandidate : null;

  /** 0 = chapter title slide (not a page); 1..pages.length = manga pages — paged modes only. */
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [showChrome, setShowChrome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [readyPaged, setReadyPaged] = useState(false);
  const [readyVertical, setReadyVertical] = useState(false);
  const [progressReady, setProgressReady] = useState(false);
  const lastCloudPushAtRef = useRef(0);
  const [resumeResolved, setResumeResolved] = useState(false);
  const [resumeSyncing, setResumeSyncing] = useState(false);
  /** Vertical scroll: stacked chapters */
  const [segments, setSegments] = useState<ReaderSegment[]>([]);
  /** Vertical scroll: visible slot for chrome + save */
  const [activeRead, setActiveRead] = useState<{ chapterId: string; spread: number } | null>(null);
  const [appendingNext, setAppendingNext] = useState(false);

  const chromeTimer = useRef<ReturnType<typeof setTimeout>>();
  const continuousRootRef = useRef<HTMLDivElement>(null);
  const progressHydrated = useRef(false);
  const continuousInitialScrollDone = useRef(false);
  const appendedChapterIdsRef = useRef<Set<string>>(new Set());
  const appendingNextRef = useRef(false);
  const resumeLockRef = useRef<{ chapterId: string; spread: number } | null>(null);

  const totalPages = pages?.length ?? 0;
  const maxSpreadIndex = totalPages;
  /** Vertical reading is always continuous scroll (no tap-to-page). */
  const verticalScroll = effectiveReaderDirection === 'vertical';
  const heading = chapterHeading(navState);

  const flatSlots = useMemo(() => {
    const out: { chapterId: string; spread: number }[] = [];
    for (const seg of segments) {
      out.push({ chapterId: seg.chapterId, spread: 0 });
      for (let i = 0; i < seg.pages.length; i++) {
        out.push({ chapterId: seg.chapterId, spread: i + 1 });
      }
    }
    return out;
  }, [segments]);

  const activeSegmentPages = useMemo(() => {
    if (!activeRead) return totalPages;
    const seg = segments.find(s => chapterIdsReferToSameChapter(s.chapterId, activeRead.chapterId));
    return seg?.pages.length ?? totalPages;
  }, [activeRead, segments, totalPages]);

  const scrollToReaderSlot = useCallback((cid: string, spread: number, behavior: ScrollBehavior = 'smooth') => {
    const el = queryReaderSlot(continuousRootRef.current, cid, spread);
    el?.scrollIntoView({ behavior, block: 'start' });
  }, []);

  const navigateToNextChapter = useCallback(() => {
    if (!nextChapter || !mangaId) return;
    navigate(readerPath(mangaId, nextChapter.id), {
      replace: true,
      state: {
        chapterTitle: nextChapter.title,
        chapterNumber: nextChapter.number,
        ...(useNonLibraryNav
          ? {
              chaptersSnapshot:
                navState.chaptersSnapshot?.length
                  ? navState.chaptersSnapshot
                  : chapterSnapshotCache.get(mangaId),
              readerInLibrary: false,
            }
          : {}),
        readerEnterNext: true,
      },
    });
  }, [mangaId, navigate, nextChapter, navState.chaptersSnapshot, useNonLibraryNav]);

  const navigateToPrevChapter = useCallback(() => {
    if (!prevChapter || !mangaId) return;
    navigate(readerPath(mangaId, prevChapter.id), {
      replace: true,
      state: {
        chapterTitle: prevChapter.title,
        chapterNumber: prevChapter.number,
        ...(useNonLibraryNav
          ? {
              chaptersSnapshot:
                navState.chaptersSnapshot?.length
                  ? navState.chaptersSnapshot
                  : chapterSnapshotCache.get(mangaId),
              readerInLibrary: false,
            }
          : {}),
        readerEnterEnd: true,
      },
    });
  }, [mangaId, navigate, prevChapter, navState.chaptersSnapshot, useNonLibraryNav]);

  useEffect(() => {
    progressHydrated.current = false;
    continuousInitialScrollDone.current = false;
    setSegments([]);
    appendedChapterIdsRef.current.clear();
    setActiveRead(null);
    setReadyPaged(false);
    setReadyVertical(false);
    setProgressReady(false);
    setResumeResolved(false);
    setResumeSyncing(false);
  }, [chapterId]);

  // Ensure progress store is hydrated before computing resume targets (critical on native).
  useEffect(() => {
    let alive = true;
    void initReadProgressPersistence()
      .then(() => {
        if (alive) setProgressReady(true);
      })
      .catch(() => {
        // Even if init fails, allow reader to proceed (resume may fall back to page 1).
        if (alive) setProgressReady(true);
      });
    return () => {
      alive = false;
    };
  }, [chapterId]);

  // Block interaction until first visible content is loaded.
  // - paged: wait for the current page image to load
  // - vertical: wait for the first page image of the chapter to load
  const blockWhileLoading = isLoading || (verticalScroll ? !readyVertical : (spreadIndex > 0 && !readyPaged));

  useEffect(() => {
    if (!chapterId || !pages?.length) return;
    const h = chapterHeading(navState);
    setSegments(prev => {
      if (prev.length === 0 || !chapterIdsReferToSameChapter(prev[0].chapterId, chapterId)) {
        appendedChapterIdsRef.current = new Set([chapterId]);
        return [{ chapterId, heading: h, pages }];
      }
      if (chapterIdsReferToSameChapter(prev[0].chapterId, chapterId)) {
        const next = [...prev];
        next[0] = { ...next[0], heading: h, pages };
        return next;
      }
      return prev;
    });
  }, [chapterId, pages, navState.chapterTitle, navState.chapterNumber]);

  // Mihon-style resume: wait for progress store hydration, then compute target page deterministically.
  useEffect(() => {
    if (!progressReady || !chapterId || !pages?.length || resumeResolved) return;
    if (navState.readerEnterEnd) {
      setSpreadIndex(pages.length);
      setResumeResolved(true);
      return;
    }
    if (navState.readerEnterNext) {
      setSpreadIndex(1);
      setResumeResolved(true);
      return;
    }
    if (navState.startPage && navState.startPage > 1) {
      setSpreadIndex(Math.min(pages.length, navState.startPage));
      setResumeResolved(true);
      return;
    }

    const local = getChapterProgressRow(chapterId);
    if (local?.lastPage != null && Number(local.lastPage) > 1) {
      const last = Math.max(1, Number(local.lastPage ?? 1));
      setSpreadIndex(Math.min(pages.length, last));
      setResumeResolved(true);
      return;
    }

    // If local row is missing (or just default 1), try cloud once (best-effort).
    if (session && supabaseConfigured() && useStore.getState().profileSyncEnabled) {
      setResumeSyncing(true);
      void fetchSingleReadingProgress(session, chapterId)
        .then((cloudRow) => {
          if (cloudRow && Number(cloudRow.lastPage) > 1) {
            // Seed local store so subsequent opens are instant.
            void saveReaderProgressToStore({
              mangaId: cloudRow.mangaId || mangaId || '',
              chapterId,
              pageIndex: Math.max(0, Number(cloudRow.lastPage) - 1),
              totalPages: Math.max(0, Number(cloudRow.totalPages) || pages.length),
              chapterTitle: cloudRow.chapterTitle,
              chapterNumber: cloudRow.chapterNumber,
              mangaTitle: cloudRow.mangaTitle,
              mangaCoverUrl: cloudRow.mangaCoverUrl,
            });
            setSpreadIndex(Math.min(pages.length, Math.max(1, Number(cloudRow.lastPage))));
          } else {
            setSpreadIndex(1);
          }
        })
        .finally(() => {
          setResumeResolved(true);
          setResumeSyncing(false);
        });
      return;
    }

    setSpreadIndex(1);
    setResumeResolved(true);
  }, [progressReady, chapterId, pages, navState.readerEnterEnd, navState.readerEnterNext, resumeResolved, session, mangaId]);

  // Reset paged image readiness when page changes.
  useEffect(() => {
    if (verticalScroll) return;
    setReadyPaged(false);
  }, [verticalScroll, chapterId, spreadIndex, pages?.[spreadIndex - 1]?.url]);

  useEffect(() => {
    continuousInitialScrollDone.current = false;
  }, [verticalScroll]);

  useEffect(() => {
    if (showChrome) {
      chromeTimer.current = setTimeout(() => setShowChrome(false), 3000);
      return () => clearTimeout(chromeTimer.current);
    }
  }, [showChrome, spreadIndex, activeRead?.chapterId, activeRead?.spread]);

  const saveChapterId = verticalScroll ? activeRead?.chapterId ?? chapterId! : chapterId!;
  /** Vertical: `activeRead` is set after layout/scroll; until then use `spreadIndex` from resume (same numbering as spreads). */
  const saveSpread = verticalScroll ? (activeRead?.spread ?? spreadIndex) : spreadIndex;

  const flushProgressNow = useCallback(() => {
    if (!mangaId || !saveChapterId) return;
    const seg = segments.find(s => chapterIdsReferToSameChapter(s.chapterId, saveChapterId));
    const meta = orderedChaptersNav.find(c => c.id === saveChapterId);
    const fromPages = seg?.pages.length ?? totalPages;
    const fromChapterList = meta && meta.totalPages > 0 ? meta.totalPages : 0;
    const tp = fromPages > 0 ? fromPages : fromChapterList;
    if (tp <= 0 || saveSpread < 1 || saveSpread > tp) return;
    const contentPageIndex = saveSpread - 1;
    const updatedAtMs = Date.now();
    const lastPage = Math.min(tp, Math.max(1, contentPageIndex + 1));
    const finished = lastPage >= tp;

    // Always write directly to local store so refresh/reload cannot lose the last page.
    void saveReaderProgressToStore({
      mangaId,
      chapterId: saveChapterId,
      pageIndex: contentPageIndex,
      totalPages: tp,
      chapterTitle: meta?.title ?? navState.chapterTitle,
      chapterNumber: meta?.number ?? navState.chapterNumber,
      mangaTitle: mangaDetails?.title,
      mangaCoverUrl: mangaDetails?.coverUrl,
    });

    // Upsert to cloud (best-effort) — throttle to avoid spamming network.
    const now = Date.now();
    if (session && supabaseConfigured() && useStore.getState().profileSyncEnabled) {
      if (now - lastCloudPushAtRef.current > 1200) {
        lastCloudPushAtRef.current = now;
        void pushSingleReadingProgress(session, {
          chapter_id: saveChapterId,
          manga_id: mangaId,
          last_page: lastPage,
          total_pages: tp,
          finished,
          updated_at_ms: updatedAtMs,
          chapter_title: meta?.title ?? navState.chapterTitle ?? '',
          chapter_number: meta?.number ?? navState.chapterNumber ?? 0,
          manga_title: mangaDetails?.title ?? '',
          manga_cover_url: mangaDetails?.coverUrl ?? '',
        });
      }
    }
  }, [
    mangaId,
    saveChapterId,
    saveSpread,
    segments,
    totalPages,
    orderedChaptersNav,
    navState.chapterTitle,
    navState.chapterNumber,
    mangaDetails?.title,
    mangaDetails?.coverUrl,
    session,
  ]);

  useEffect(() => {
    if (!mangaId || !saveChapterId) return;
    const seg = segments.find(s => chapterIdsReferToSameChapter(s.chapterId, saveChapterId));
    const meta = orderedChaptersNav.find(c => c.id === saveChapterId);
    const fromPages = seg?.pages.length ?? totalPages;
    const fromChapterList = meta && meta.totalPages > 0 ? meta.totalPages : 0;
    const tp = fromPages > 0 ? fromPages : fromChapterList;
    // Chapter end slide is synthetic (spread = tp + 1). Don't persist progress for it.
    if (tp <= 0 || saveSpread < 1 || saveSpread > tp) return;

    // Do not persist progress before we have fully resolved the resumption state,
    // otherwise the initial render at page 1 will overwrite the stored progress.
    if (!resumeResolved) return;

    // Persist on *every* page change (Mihon-style robust resume).
    flushProgressNow();
    const contentPageIndex = saveSpread - 1;
    const t = setTimeout(() => {
      saveProgress.mutate({
        mangaId,
        chapterId: saveChapterId,
        pageIndex: contentPageIndex,
        totalPages: tp,
        chapterTitle: meta?.title ?? navState.chapterTitle,
        chapterNumber: meta?.number ?? navState.chapterNumber,
        mangaTitle: mangaDetails?.title,
        mangaCoverUrl: mangaDetails?.coverUrl,
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [
    saveSpread,
    saveChapterId,
    mangaId,
    resumeResolved,
    flushProgressNow,
    saveProgress,
    segments,
    totalPages,
    orderedChaptersNav,
    navState.chapterTitle,
    navState.chapterNumber,
    mangaDetails?.title,
    mangaDetails?.coverUrl,
  ]);

  // Refresh/reload can cancel the debounced progress save. Flush immediately on pagehide/background.
  useEffect(() => {
    const bumpQueries = () => {
      if (!mangaId) return;
      qc.invalidateQueries({ queryKey: ['mangaChapters', mangaId] });
      qc.invalidateQueries({ queryKey: ['mangaDetails', mangaId] });
    };
    const onPageHide = () => {
      flushProgressNow();
      bumpQueries();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        flushProgressNow();
        bumpQueries();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [flushProgressNow, mangaId, qc]);

  // When the user reaches the last page, mark the chapter as read immediately in the UI.
  useEffect(() => {
    if (!chapterId || !pages?.length || verticalScroll) return;
    if (spreadIndex >= pages.length && pages.length > 0) {
      // This relies on the backend/store applying progress to chapters as "read" when lastPage >= totalPages.
      // We trigger a progress write by letting the existing saveProgress effect run (it does), so this is just UI.
    }
  }, [chapterId, pages?.length, spreadIndex, verticalScroll]);

  const appendNextChapter = useCallback(async (): Promise<ChapterNav | null> => {
    if (!segments.length || appendingNextRef.current || !continuationEnabled) return null;
    const lastSeg = segments[segments.length - 1];
    const idx = orderedChaptersNav.findIndex(c => chapterIdsReferToSameChapter(c.id, lastSeg.chapterId));
    const nextCh =
      idx >= 0 && idx < orderedChaptersNav.length - 1 ? orderedChaptersNav[idx + 1] : null;
    if (!nextCh || appendedChapterIdsRef.current.has(nextCh.id)) return null;
    appendingNextRef.current = true;
    setAppendingNext(true);
    try {
      const nextPages = await qc.fetchQuery({
        queryKey: ['chapterPages', nextCh.id],
        queryFn: () => Backend.getChapterPages(nextCh.id),
      });
      if (!nextPages?.length) return null;
      appendedChapterIdsRef.current.add(nextCh.id);
      const h = formatChapterDisplayTitle(nextCh.number, nextCh.title);
      setSegments(s => [...s, { chapterId: nextCh.id, heading: h, pages: nextPages }]);
      return nextCh;
    } catch {
      return null;
    } finally {
      appendingNextRef.current = false;
      setAppendingNext(false);
    }
  }, [segments, orderedChaptersNav, qc, continuationEnabled]);

  // IntersectionObserver only reports *changed* entries per callback; picking "best" from that
  // batch often leaves the page counter stuck on 1. Track the slot with the largest visible
  // overlap with the scrollport on scroll + resize instead.
  useEffect(() => {
    if (!verticalScroll || !segments.length || !continuousRootRef.current) return;
    const root = continuousRootRef.current;

    const pickActiveFromScroll = () => {
      const rootRect = root.getBoundingClientRect();
      const nodes = [...root.querySelectorAll('[data-reader-chapter-id][data-reader-spread]')] as HTMLElement[];
      if (!nodes.length) return;
      let best: HTMLElement | null = null;
      let bestVis = 0;
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        const visTop = Math.max(r.top, rootRect.top);
        const visBot = Math.min(r.bottom, rootRect.bottom);
        const vis = Math.max(0, visBot - visTop);
        if (vis > bestVis) {
          bestVis = vis;
          best = el;
        }
      }
      if (!best) return;
      const cid = best.dataset.readerChapterId;
      const sp = best.dataset.readerSpread;
      if (cid == null || sp == null) return;
      const spread = Number(sp);
      setActiveRead(prev =>
        prev && chapterIdsReferToSameChapter(prev.chapterId, cid) && prev.spread === spread
          ? prev
          : { chapterId: cid, spread },
      );
    };

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        pickActiveFromScroll();
      });
    };

    pickActiveFromScroll();
    root.addEventListener('scroll', schedule, { passive: true });
    
    const stopLock = () => { resumeLockRef.current = null; };
    root.addEventListener('touchstart', stopLock, { passive: true, once: true });
    root.addEventListener('mousedown', stopLock, { passive: true, once: true });
    root.addEventListener('wheel', stopLock, { passive: true, once: true });

    const ro = new ResizeObserver(() => {
      schedule();
    });
    ro.observe(root);

    return () => {
      root.removeEventListener('scroll', schedule);
      root.removeEventListener('touchstart', stopLock);
      root.removeEventListener('mousedown', stopLock);
      root.removeEventListener('wheel', stopLock);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [verticalScroll, segments, scrollToReaderSlot]);

  useEffect(() => {
    if (!verticalScroll || !segments.length || !chapterId || continuousInitialScrollDone.current) return;
    const first = segments[0];
    if (!first || !chapterIdsReferToSameChapter(first.chapterId, chapterId)) return;
    if (!progressReady) return;
    continuousInitialScrollDone.current = true;
    const row = getChapterProgressRow(chapterId);
    let last = Math.max(1, Number(row?.lastPage ?? 1));
    if (navState.startPage && navState.startPage > 1) {
      last = navState.startPage;
    }
    const spread = Math.min(first.pages.length, last);
    const target =
      navState.readerEnterEnd ? { chapterId, spread: first.pages.length }
      : navState.readerEnterNext ? { chapterId, spread: 1 }
      : { chapterId, spread };
    setActiveRead({ chapterId: target.chapterId, spread: target.spread });
    resumeLockRef.current = { chapterId: target.chapterId, spread: target.spread };
    requestAnimationFrame(() => {
      // Avoid visible “speed scrolling” when resuming mid-chapter.
      requestAnimationFrame(() => scrollToReaderSlot(target.chapterId, target.spread, 'auto'));
    });

    // Failsafe: drop the loading curtain after 1.5s just in case image events fail or user breaks lock
    const timer = setTimeout(() => {
      setReadyVertical(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [verticalScroll, segments, chapterId, progressReady, scrollToReaderSlot, navState.readerEnterEnd, navState.readerEnterNext, navState.startPage]);

  useLayoutEffect(() => {
    if (!verticalScroll || segments.length === 0) return;
    let io: IntersectionObserver | null = null;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;

    const disconnect = () => {
      if (io) {
        io.disconnect();
        io = null;
      }
    };

    const tryAttach = () => {
      if (cancelled) return;
      const root = continuousRootRef.current;
      const lastSeg = segments[segments.length - 1];
      if (!root || !lastSeg?.pages.length) return;
      const lastSpread = lastSeg.pages.length + (showNonLibraryEndSlide ? 1 : 0);
      const lastEl = queryReaderSlot(root, lastSeg.chapterId, lastSpread);
      if (!lastEl) {
        attempts += 1;
        if (attempts < 80) {
          raf = requestAnimationFrame(tryAttach);
        }
        return;
      }
      disconnect();
      io = new IntersectionObserver(
        entries => {
          if (entries.some(e => e.isIntersecting)) void appendNextChapter();
        },
        { root, rootMargin: '0px 0px 480px 0px', threshold: 0 },
      );
      io.observe(lastEl);
    };

    tryAttach();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      disconnect();
    };
  }, [verticalScroll, segments, appendNextChapter, showNonLibraryEndSlide]);

  const goSpreadPaged = useCallback(
    (delta: number) => {
      const next = spreadIndex + delta;
      if (next >= 0 && next <= maxSpreadIndex) {
        setSpreadIndex(next);
        return;
      }
      if (next > maxSpreadIndex && delta > 0 && nextChapter) {
        navigateToNextChapter();
        return;
      }
      if (next < 0 && delta < 0 && prevChapter) {
        navigateToPrevChapter();
      }
    },
    [spreadIndex, maxSpreadIndex, nextChapter, prevChapter, navigateToNextChapter, navigateToPrevChapter],
  );

  const goSpreadVerticalSlot = useCallback(
    (delta: number) => {
      if (!activeRead || flatSlots.length === 0) return;
      const i = flatSlots.findIndex(
        s => chapterIdsReferToSameChapter(s.chapterId, activeRead.chapterId) && s.spread === activeRead.spread,
      );
      if (i < 0) return;
      const ni = i + delta;
      if (ni >= 0 && ni < flatSlots.length) {
        const t = flatSlots[ni];
        scrollToReaderSlot(t.chapterId, t.spread);
        return;
      }
      if (ni >= flatSlots.length && delta > 0) {
        void appendNextChapter().then(ch => {
          if (!ch) return;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollToReaderSlot(ch.id, 0));
          });
        });
        return;
      }
      if (ni < 0 && delta < 0 && prevChapter) {
        navigateToPrevChapter();
      }
    },
    [activeRead, flatSlots, scrollToReaderSlot, prevChapter, appendNextChapter, navigateToPrevChapter],
  );

  const handleTapZone = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clientX = 'touches' in e ? e.changedTouches[0].clientX : (e as React.MouseEvent).clientX;
      const relX = (clientX - rect.left) / rect.width;
      if (relX < 0.35) goSpreadPaged(effectiveReaderDirection === 'rtl' ? 1 : -1);
      else if (relX > 0.65) goSpreadPaged(effectiveReaderDirection === 'rtl' ? -1 : 1);
      else setShowChrome(v => !v);
    },
    [goSpreadPaged, effectiveReaderDirection],
  );

  const pagedSwipeRef = useRef({ x: 0, y: 0, active: false });
  const suppressPagedClickRef = useRef(false);

  const onPagedPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pagedSwipeRef.current = { x: e.clientX, y: e.clientY, active: true };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPagedPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!pagedSwipeRef.current.active) return;
      pagedSwipeRef.current.active = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const dx = e.clientX - pagedSwipeRef.current.x;
      const dy = e.clientY - pagedSwipeRef.current.y;
      const min = 56;
      if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      suppressPagedClickRef.current = true;
      window.setTimeout(() => {
        suppressPagedClickRef.current = false;
      }, 400);
      const rtl = effectiveReaderDirection === 'rtl';
      if (!rtl) {
        if (dx < -min) goSpreadPaged(1);
        else if (dx > min) goSpreadPaged(-1);
      } else {
        if (dx > min) goSpreadPaged(1);
        else if (dx < -min) goSpreadPaged(-1);
      }
    },
    [goSpreadPaged, effectiveReaderDirection],
  );

  const onPagedPointerCancel = useCallback(() => {
    pagedSwipeRef.current.active = false;
  }, []);

  const onPagedClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressPagedClickRef.current) return;
      handleTapZone(e);
    },
    [handleTapZone],
  );

  const flatIndex =
    activeRead && flatSlots.length > 0
      ? flatSlots.findIndex(
          s => chapterIdsReferToSameChapter(s.chapterId, activeRead.chapterId) && s.spread === activeRead.spread,
        )
      : -1;

  const lastSegNextExists = useMemo(() => {
    if (!segments.length || !orderedChaptersNav.length) return false;
    const li = orderedChaptersNav.findIndex(c =>
      chapterIdsReferToSameChapter(c.id, segments[segments.length - 1].chapterId),
    );
    return li >= 0 && li < orderedChaptersNav.length - 1;
  }, [segments, orderedChaptersNav]);

  const barSpreadIndex = verticalScroll ? activeRead?.spread ?? 0 : spreadIndex;
  const barContentTotal = verticalScroll ? activeSegmentPages : totalPages;
  const barPrevDisabled = verticalScroll
    ? flatIndex <= 0 && !prevChapter
    : spreadIndex <= 0 && !prevChapter;
  const barNextDisabled = verticalScroll
    ? flatIndex >= 0 && flatIndex >= flatSlots.length - 1 && !lastSegNextExists
    : spreadIndex >= maxSpreadIndex && !nextChapter;

  if (isLoading) {
    return (
      <ReaderShell brightness={brightness}>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </ReaderShell>
    );
  }

  const handleBack = () => {
    if (navState.backTo) navigate(navState.backTo, { replace: true });
    else navigate(-1);
  };

  if (verticalScroll) {
    return (
      <ReaderShell brightness={brightness}>
        <div className="relative min-h-[100dvh] w-full">
          {showChrome && <ReaderTopBar onBack={handleBack} />}
          <div
            ref={continuousRootRef}
            className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden touch-manipulation"
            onClick={() => setShowChrome(v => !v)}
          >
            {segments.map(seg => (
              <React.Fragment key={seg.chapterId}>
                <ChapterTitleSlide chapterId={seg.chapterId} title={seg.heading} />
                {seg.pages.map((page, i) => (
                  <img
                    key={`${seg.chapterId}-${i}`}
                    data-reader-chapter-id={seg.chapterId}
                    data-reader-spread={i + 1}
                    src={page.url}
                    alt={`Page ${i + 1}`}
                    className="w-full"
                    loading={i < 2 ? 'eager' : 'lazy'}
                    onLoad={() => {
                      const lock = resumeLockRef.current;
                      if (!readyVertical && chapterIdsReferToSameChapter(seg.chapterId, chapterId)) {
                        if (lock && chapterIdsReferToSameChapter(lock.chapterId, seg.chapterId)) {
                          if (i + 1 === lock.spread) setReadyVertical(true);
                        } else if (i === 0) {
                          setReadyVertical(true);
                        }
                      }
                      if (lock) {
                        scrollToReaderSlot(lock.chapterId, lock.spread, 'auto');
                      }
                    }}
                    onError={() => {
                      const lock = resumeLockRef.current;
                      if (!readyVertical && chapterIdsReferToSameChapter(seg.chapterId, chapterId)) {
                        if (lock && chapterIdsReferToSameChapter(lock.chapterId, seg.chapterId)) {
                          if (i + 1 === lock.spread) setReadyVertical(true);
                        } else if (i === 0) {
                          setReadyVertical(true);
                        }
                      }
                    }}
                  />
                ))}
                {showNonLibraryEndSlide && (
                  <ChapterEndSlide
                    chapterId={seg.chapterId}
                    spread={seg.pages.length + 1}
                    title={seg.heading}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          {blockWhileLoading ? (
            <div
              className="absolute inset-0 z-[58] flex items-center justify-center bg-background"
              aria-hidden
            >
              <div className="h-12 w-12 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : null}
          {verticalScroll && appendingNext && (
            <div className="absolute bottom-0 left-0 right-0 z-[60] px-3 pb-4 safe-bottom pointer-events-none">
              <div className="mx-auto max-w-[min(100%,20rem)] rounded-full border border-border bg-background/65 backdrop-blur-md px-4 py-2 flex items-center gap-2 justify-center">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs font-medium text-muted-foreground">Loading next chapter…</span>
              </div>
            </div>
          )}
          {showChrome && activeRead && (
            <ReaderBottomBar
              spreadIndex={barSpreadIndex}
              contentTotal={barContentTotal}
              onStep={goSpreadVerticalSlot}
              prevDisabled={barPrevDisabled}
              nextDisabled={barNextDisabled}
              onSettings={() => setShowSettings(!showSettings)}
            />
          )}
          {showSettings && (
            <ReaderSettingsSheet
              onClose={() => setShowSettings(false)}
              direction={effectiveReaderDirection}
              onDirectionChange={d => {
                if (mangaId && inLibrary) setReaderDirectionForManga(mangaId, d);
                else setReaderDirection(d);
              }}
            />
          )}
        </div>
      </ReaderShell>
    );
  }

  // Don't render paged content until resume target is resolved (Mihon-style; avoids flashes).
  if (!verticalScroll && pages?.length && progressReady && !resumeResolved) {
    return (
      <ReaderShell brightness={brightness}>
        <div className="flex h-[100dvh] w-full items-center justify-center bg-black">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </ReaderShell>
    );
  }

  return (
    <ReaderShell brightness={brightness}>
      <div className="relative h-[100dvh] w-full overflow-hidden select-none">
        <div
          className="flex h-full w-full items-center justify-center px-1 touch-manipulation"
          onClick={onPagedClick}
          onPointerDown={onPagedPointerDown}
          onPointerUp={onPagedPointerUp}
          onPointerCancel={onPagedPointerCancel}
        >
          {spreadIndex === 0 ? (
            <ChapterTitleSlide chapterId={chapterId!} title={heading} />
          ) : (
            pages &&
            pages[spreadIndex - 1] && (
              <div className="relative flex h-full w-full items-center justify-center">
                {!readyPaged ? (
                  <div className="absolute inset-0 z-[1] flex items-center justify-center">
                    <div className="h-12 w-12 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : null}
                <img
                  src={pages[spreadIndex - 1].url}
                  alt={`Page ${spreadIndex}`}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                  onLoad={() => setReadyPaged(true)}
                  onError={() => setReadyPaged(true)}
                />
              </div>
            )
          )}
        </div>

        {showChrome && (
          <>
            <ReaderTopBar onBack={handleBack} />
            <ReaderBottomBar
              spreadIndex={spreadIndex}
              contentTotal={totalPages}
              onStep={goSpreadPaged}
              prevDisabled={spreadIndex <= 0 && !prevChapter}
              nextDisabled={spreadIndex >= maxSpreadIndex && !nextChapter}
              onSettings={() => setShowSettings(!showSettings)}
            />
          </>
        )}

        {showSettings && (
          <ReaderSettingsSheet
            onClose={() => setShowSettings(false)}
            direction={effectiveReaderDirection}
            onDirectionChange={d => {
              if (mangaId && inLibrary) setReaderDirectionForManga(mangaId, d);
              else setReaderDirection(d);
            }}
          />
        )}
      </div>
    </ReaderShell>
  );
};

const ReaderTopBar: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="absolute top-0 left-0 right-0 z-50 flex h-12 items-center px-3 bg-background/85 backdrop-blur-md animate-fade-in safe-top">
    <button
      type="button"
      onClick={onBack}
      className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground touch-manipulation -ml-1"
      aria-label="Back"
    >
      <ArrowLeft size={22} strokeWidth={1.75} />
    </button>
  </div>
);

const ReaderBottomBar: React.FC<{
  spreadIndex: number;
  contentTotal: number;
  onStep: (delta: -1 | 1) => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onSettings: () => void;
}> = ({ spreadIndex, contentTotal, onStep, prevDisabled, nextDisabled, onSettings }) => (
  <div className="absolute bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md px-3 pt-3 pb-4 animate-fade-in safe-bottom">
    <div className="mx-auto flex max-w-[min(100%,20rem)] items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={prevDisabled}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground touch-manipulation active:opacity-80 disabled:pointer-events-none disabled:opacity-30"
        aria-label="Previous"
      >
        <ChevronLeft size={24} strokeWidth={2} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-2">
        {spreadIndex >= 1 && contentTotal > 0 && spreadIndex >= contentTotal ? (
          <span className="text-sm font-semibold text-foreground">Read</span>
        ) : spreadIndex === 0 ? (
          <span className="text-sm font-medium text-muted-foreground">Chapter</span>
        ) : (
          <span className="text-lg font-semibold tabular-nums leading-tight text-foreground">
            {spreadIndex}
            <span className="text-base font-normal text-muted-foreground"> / {contentTotal}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={nextDisabled}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground touch-manipulation active:opacity-80 disabled:pointer-events-none disabled:opacity-30"
        aria-label="Next page"
      >
        <ChevronRight size={24} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onSettings}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground touch-manipulation active:opacity-80"
        aria-label="Reader settings"
      >
        <Settings size={22} strokeWidth={1.75} />
      </button>
    </div>
  </div>
);

const ReaderSettingsSheet: React.FC<{
  onClose: () => void;
  direction: ReadingDirection;
  onDirectionChange: (d: ReadingDirection) => void;
}> = ({ onClose, direction, onDirectionChange }) => {
  const brightness = useStore(s => s.brightness);
  const setBrightness = useStore(s => s.setBrightness);
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-md rounded-t-2xl bg-card border-t border-border px-5 pt-3 pb-6 animate-slide-up safe-bottom shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
        <h3 className="text-base font-bold text-foreground mb-4">Reader Settings</h3>
        <div className="space-y-5">
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Reading Direction</label>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {(['ltr', 'rtl', 'vertical'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onDirectionChange(d)}
                    className={`flex-1 rounded-xl py-3 text-xs font-medium touch-manipulation min-h-[44px] ${
                      direction === d ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {d === 'ltr' ? 'Left → Right' : d === 'rtl' ? 'Right → Left' : 'Vertical'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Left/Right: tap screen edges or swipe horizontally. Vertical: scroll only (webtoon).
                Library series remember their own direction.
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Brightness</label>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={brightness}
              onChange={e => setBrightness(Number(e.target.value))}
              className="w-full accent-primary h-2 py-3"
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default ReaderScreen;
