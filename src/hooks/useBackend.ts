import type { Session } from '@supabase/supabase-js';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { Backend, applyCachedCoverToManga, getCurrentBackendBaseUrl } from '../native/Backend';
import type { LibraryFilter, Sort, ChapterFilter, SourceFilter, Manga, Chapter } from '../types';

/** Same params ReaderScreen uses for next/prev; prefetch from details with this key so the reader cache is warm. */
export const READER_CHAPTER_SORT_PARAMS = {
  sort: { field: 'number' as const, direction: 'asc' as const },
};
import { useAuth } from '../auth/AuthProvider';
import { supabaseConfigured } from '../lib/supabase';
import {
  deleteCloudReadingProgressChapter,
  deleteCloudReadingProgressChapters,
  deleteCloudReadingProgressForManga,
} from '../lib/cloudSync';
import { getAllProgressRows, initReadProgressPersistence } from '../storage/readProgressStore';
import { useStore } from '../store/useStore';

// ── Library ──

export function useLibrarySections() {
  return useQuery({ queryKey: ['librarySections'], queryFn: Backend.getLibrarySections });
}

export function useLibraryManga(
  params: { sectionId?: string; query?: string; filter?: LibraryFilter; sort?: Sort },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['libraryManga', params],
    queryFn: () => Backend.getLibraryManga(params),
    enabled: options?.enabled !== false,
  });
}

export function useMangaDetails(mangaId: string) {
  return useQuery({
    queryKey: ['mangaDetails', mangaId],
    queryFn: async () => applyCachedCoverToManga(await Backend.getMangaDetails(mangaId)),
    enabled: !!mangaId,
  });
}

export function useMangaChapters(mangaId: string, params: { filter?: ChapterFilter; sort?: Sort }) {
  return useQuery({
    queryKey: ['mangaChapters', mangaId, params],
    queryFn: () => Backend.getMangaChapters(mangaId, params),
    enabled: !!mangaId,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      mangaId,
      favorite,
      categoryIds,
    }: {
      mangaId: string;
      favorite: boolean;
      categoryIds?: string[];
    }) => Backend.toggleMangaFavorite(mangaId, favorite, categoryIds?.length ? { categoryIds } : undefined),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['libraryManga'] });
      qc.invalidateQueries({ queryKey: ['mangaDetails'] });
      if (!vars.favorite) {
        qc.invalidateQueries({ queryKey: ['history'] });
        qc.invalidateQueries({ queryKey: ['mangaChapters', vars.mangaId] });
      }
    },
  });
}

export function useSetMangaCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mangaId, categoryIds }: { mangaId: string; categoryIds: string[] }) =>
      Backend.setMangaCategories(mangaId, categoryIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['libraryManga'] });
      qc.invalidateQueries({ queryKey: ['mangaDetails'] });
    },
  });
}

export function useSetChapterBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chapterId, bookmarked }: { chapterId: string; bookmarked: boolean }) =>
      Backend.setChapterBookmarked(chapterId, bookmarked),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mangaChapters'] });
    },
  });
}

// ── Reader ──

export function useChapterPages(chapterId: string) {
  return useQuery({
    queryKey: ['chapterPages', chapterId],
    queryFn: () => Backend.getChapterPages(chapterId),
    enabled: !!chapterId,
  });
}

export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.saveReaderProgress,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['mangaChapters', vars.mangaId] });
      qc.invalidateQueries({ queryKey: ['mangaDetails', vars.mangaId] });
      qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

async function maybeDeleteCloudProgressChapter(session: Session | null, chapterId: string) {
  if (!session || !supabaseConfigured() || !useStore.getState().profileSyncEnabled) return;
  await deleteCloudReadingProgressChapter(session, chapterId);
}

/** Delete remote reading_progress for a manga (before clearing local, avoids pull re-seeding). */
async function purgeCloudReadingProgressForManga(session: Session | null, mangaId: string) {
  if (!session || !supabaseConfigured() || !useStore.getState().profileSyncEnabled) return;
  await initReadProgressPersistence();
  const chapterIds = Object.entries(getAllProgressRows())
    .filter(([, row]) => row.mangaId === mangaId)
    .map(([chapterId]) => chapterId);
  await deleteCloudReadingProgressChapters(session, chapterIds);
  await deleteCloudReadingProgressForManga(session, mangaId);
}

export function useMarkChapterRead() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ chapterId, read }: { chapterId: string; read: boolean }) => {
      // Cloud first: if we clear local then a concurrent pull merges remote rows, history comes back.
      if (!read) await maybeDeleteCloudProgressChapter(session, chapterId);
      await Backend.markChapterRead(chapterId, read);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mangaChapters'] });
      qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useReaderSettings() {
  return useQuery({ queryKey: ['readerSettings'], queryFn: Backend.getReaderSettings });
}

// ── Browse ──

export function useSources(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['sources'],
    queryFn: Backend.getSources,
    enabled: options?.enabled ?? true,
  });
}

export function useSourcePopular(
  sourceId: string,
  page = 1,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['sourcePopular', sourceId, page],
    queryFn: () => Backend.getSourcePopular(sourceId, page),
    enabled: !!sourceId && (options?.enabled !== false),
  });
}

export function useSourceLatest(
  sourceId: string,
  page = 1,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['sourceLatest', sourceId, page],
    queryFn: () => Backend.getSourceLatest(sourceId, page),
    enabled: !!sourceId && (options?.enabled !== false),
  });
}

export function useSearchSource(params: { sourceId: string; query: string; filters?: SourceFilter[]; page?: number }) {
  const q = params.query.trim();
  return useQuery({
    queryKey: ['searchSource', params.sourceId, q, params.filters, params.page],
    queryFn: () => Backend.searchSource({ ...params, query: q }),
    enabled: !!params.sourceId && q.length > 0,
  });
}

/** Parallel search across all sources (e.g. library global search). */
export function useGlobalSourceSearch(query: string, options: { enabled: boolean }) {
  const trimmed = query.trim();
  const hasBackend = !!getCurrentBackendBaseUrl().trim();
  const shouldRun = options.enabled && hasBackend && trimmed.length > 0;

  const { data: sources, isLoading: loadingSources, isError: sourcesError } = useSources({
    enabled: shouldRun,
  });

  const queries = useQueries({
    queries: (sources ?? []).map(s => ({
      queryKey: ['globalSourceSearch', s.id, trimmed] as const,
      queryFn: () => Backend.searchSource({ sourceId: s.id, query: trimmed, page: 1 }),
      enabled: shouldRun && !!sources?.length,
      staleTime: 60_000,
      retry: 1,
    })),
  });

  return { hasBackend, sources, loadingSources, sourcesError, queries };
}

export function useSourceFilters(sourceId: string) {
  return useQuery({
    queryKey: ['sourceFilters', sourceId],
    queryFn: () => Backend.getSourceFilters(sourceId),
    enabled: !!sourceId,
  });
}

// ── Updates / History / Downloads ──

export function useUpdates(params: { sinceDays?: number; onlyUnread?: boolean } = {}) {
  return useQuery({
    queryKey: ['updates', params],
    queryFn: () => Backend.getUpdates(params),
  });
}

export function useRefreshUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.refreshUpdates,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['updates'] });
    },
  });
}

export function useHistory(params: { sinceDays?: number } = {}) {
  return useQuery({
    queryKey: ['history', params],
    queryFn: () => Backend.getHistory(params),
  });
}

export function useResetHistoryChapter() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (chapterId: string) => {
      await maybeDeleteCloudProgressChapter(session, chapterId);
      await Backend.resetHistoryChapter(chapterId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['libraryManga'] });
      qc.invalidateQueries({ queryKey: ['mangaChapters'] });
      qc.invalidateQueries({ queryKey: ['mangaDetails'] });
    },
  });
}

export function useClearHistoryForManga() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (mangaId: string) => {
      await purgeCloudReadingProgressForManga(session, mangaId);
      await Backend.clearHistoryForManga(mangaId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['libraryManga'] });
      qc.invalidateQueries({ queryKey: ['mangaChapters'] });
      qc.invalidateQueries({ queryKey: ['mangaDetails'] });
    },
  });
}

export function useDownloads() {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: Backend.getDownloads,
    refetchInterval: 3000,
  });
}

export function useEnqueueChapterDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { manga: Manga; chapter: Chapter }) => Backend.enqueueChapterDownload(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function usePauseAllDownloads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.pauseAllDownloads,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function useResumeAllDownloads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.resumeAllDownloads,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function useCancelDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.cancelDownload,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function usePauseDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (downloadId: string) => Backend.pauseDownload(downloadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function useResumeDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (downloadId: string) => Backend.resumeDownload(downloadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

export function useDeleteDownloadedChapter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chapterId: string) => Backend.deleteDownloadedChapter(chapterId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloads'] }),
  });
}

// ── Settings ──

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: Backend.getSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Backend.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
