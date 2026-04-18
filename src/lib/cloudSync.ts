import type { Session } from '@supabase/supabase-js';
import type { Manga } from '../types';
import { supabase, supabaseConfigured } from './supabase';
import { useStore } from '../store/useStore';
import type { ThemeMode, ReadingDirection } from '../types';
import { getLibraryIds, getMangaCache, initLibraryPersistence, setLibraryIds, setMangaCache } from '../storage/libraryStore';
import {
  getAllProgressRows,
  initReadProgressPersistence,
  replaceAllProgressFromCloud,
  type ProgressRow,
} from '../storage/readProgressStore';
import { getBookmarkChapterIds, replaceBookmarksFromCloud } from '../storage/chapterBookmarkStore';
import { queryClient } from '../queryClient';

type LibraryRow = {
  manga_id: string;
  category_ids: string[] | null;
  manga_json: Manga | Record<string, unknown> | null;
  updated_at: string;
};

type ProgressCloudRow = {
  chapter_id: string;
  manga_id: string;
  last_page: number;
  total_pages: number;
  finished: boolean;
  updated_at_ms: number;
  chapter_title: string;
  chapter_number: number;
  manga_title: string;
  manga_cover_url: string;
};

function isVolatileCoverUrl(u: string | undefined | null): boolean {
  const s = String(u ?? '').trim();
  return !s || s.startsWith('blob:') || s.startsWith('data:');
}

/** When merging local + cloud, keep the newer read state but prefer a stable title/cover from either side. */
function mergeProgressRowPair(a: ProgressRow, b: ProgressRow): ProgressRow {
  const primary = a.updatedAt >= b.updatedAt ? a : b;
  const secondary = a.updatedAt >= b.updatedAt ? b : a;
  const titleP = primary.mangaTitle?.trim() ?? '';
  const titleS = secondary.mangaTitle?.trim() ?? '';
  const pickTitle =
    titleP && titleP !== 'Unknown series'
      ? titleP
      : titleS && titleS !== 'Unknown series'
        ? titleS
        : titleP || titleS || '';
  const coverP = primary.mangaCoverUrl?.trim() ?? '';
  const coverS = secondary.mangaCoverUrl?.trim() ?? '';
  const pickCover =
    coverP && !isVolatileCoverUrl(coverP)
      ? coverP
      : coverS && !isVolatileCoverUrl(coverS)
        ? coverS
        : coverP || coverS || '';
  return { ...primary, mangaTitle: pickTitle, mangaCoverUrl: pickCover };
}

function mergeProgressMaps(
  local: Record<string, ProgressRow>,
  cloud: ProgressCloudRow[],
): Record<string, ProgressRow> {
  const cloudMap: Record<string, ProgressRow> = {};
  for (const r of cloud) {
    cloudMap[r.chapter_id] = {
      mangaId: r.manga_id,
      lastPage: r.last_page,
      totalPages: r.total_pages,
      finished: r.finished,
      updatedAt: r.updated_at_ms,
      chapterTitle: r.chapter_title ?? '',
      chapterNumber: r.chapter_number ?? 0,
      mangaTitle: r.manga_title ?? '',
      mangaCoverUrl: r.manga_cover_url ?? '',
    };
  }
  const keys = new Set([...Object.keys(local), ...Object.keys(cloudMap)]);
  const out: Record<string, ProgressRow> = {};
  for (const k of keys) {
    const a = local[k];
    const b = cloudMap[k];
    if (!a) out[k] = b!;
    else if (!b) out[k] = a;
    else out[k] = mergeProgressRowPair(a, b);
  }
  return out;
}

function mergeLibraryWithCloud(localIds: string[], localManga: Record<string, Manga>, cloud: LibraryRow[]): { ids: string[]; manga: Record<string, Manga> } {
  const manga: Record<string, Manga> = { ...localManga };
  const cloudIds: string[] = [];
  for (const row of cloud) {
    cloudIds.push(row.manga_id);
    const mj = row.manga_json as Manga | null | undefined;
    if (mj && typeof mj === 'object' && 'id' in mj && (mj as Manga).id) {
      if (!manga[row.manga_id]) {
        manga[row.manga_id] = mj as Manga;
      }
    }
  }
  // Only use actual library IDs (local + cloud rows), NOT Object.keys(manga)
  // which would include all browse/read cache entries.
  const ids = [...new Set([...localIds, ...cloudIds])];
  return { ids, manga };
}

function mergeBookmarks(local: string[], cloud: string[]): string[] {
  return [...new Set([...local, ...cloud])];
}

type PrefsPayload = {
  theme?: ThemeMode;
  gridColumns?: number;
  readerDirection?: ReadingDirection;
  readerDirectionByMangaId?: Record<string, ReadingDirection>;
  readerContinuous?: boolean;
  brightness?: number;
  brightnessLock?: boolean;
  keepScreenOn?: boolean;
  libraryView?: 'grid' | 'list';
};

function applyPreferencesPayload(p: PrefsPayload) {
  const s = useStore.getState();
  if (p.theme != null) s.setTheme(p.theme);
  if (typeof p.gridColumns === 'number') s.setGridColumns(p.gridColumns);
  if (p.readerDirection != null) s.setReaderDirection(p.readerDirection);
  if (p.readerDirectionByMangaId && typeof p.readerDirectionByMangaId === 'object') {
    for (const [mid, dir] of Object.entries(p.readerDirectionByMangaId)) {
      s.setReaderDirectionForManga(mid, dir);
    }
  }
  if (typeof p.readerContinuous === 'boolean') s.setReaderContinuous(p.readerContinuous);
  if (typeof p.brightness === 'number') s.setBrightness(p.brightness);
  if (typeof p.brightnessLock === 'boolean') s.setBrightnessLock(p.brightnessLock);
  if (typeof p.keepScreenOn === 'boolean') s.setKeepScreenOn(p.keepScreenOn);
  if (p.libraryView === 'grid' || p.libraryView === 'list') s.setLibraryView(p.libraryView);
}

function collectPreferencesPayload(): PrefsPayload {
  const st = useStore.getState();
  return {
    theme: st.theme,
    gridColumns: st.gridColumns,
    readerDirection: st.readerDirection,
    readerDirectionByMangaId: st.readerDirectionByMangaId,
    readerContinuous: st.readerContinuous,
    brightness: st.brightness,
    brightnessLock: st.brightnessLock,
    keepScreenOn: st.keepScreenOn,
    libraryView: st.libraryView,
  };
}

/**
 * Pull remote rows, merge with local (progress: max timestamp; library: union + fill missing from cloud), apply.
 */
export async function pullCloudIntoLocal(session: Session): Promise<void> {
  const uid = session.user.id;

  const [{ data: libRows, error: e1 }, { data: progRows, error: e2 }, { data: bmRows, error: e3 }, { data: prefRow, error: e4 }] =
    await Promise.all([
      supabase.from('library_items').select('manga_id, category_ids, manga_json, updated_at').eq('user_id', uid),
      supabase.from('reading_progress').select('*').eq('user_id', uid),
      supabase.from('bookmarked_chapters').select('chapter_id').eq('user_id', uid),
      supabase.from('user_preferences').select('payload, updated_at').eq('user_id', uid).maybeSingle(),
    ]);

  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;

  await initLibraryPersistence();
  await initReadProgressPersistence();

  const localIds = getLibraryIds();
  const localManga = getMangaCache();
  const mergedLib = mergeLibraryWithCloud(localIds, localManga, (libRows ?? []) as LibraryRow[]);
  setLibraryIds(mergedLib.ids);
  setMangaCache(mergedLib.manga);

  const localProg = getAllProgressRows();
  const mergedProg = mergeProgressMaps(localProg, (progRows ?? []) as ProgressCloudRow[]);
  await replaceAllProgressFromCloud(mergedProg);

  const cloudBm = (bmRows ?? []).map(r => r.chapter_id).filter(Boolean);
  const mergedBm = mergeBookmarks(getBookmarkChapterIds(), cloudBm);
  replaceBookmarksFromCloud(mergedBm);

  const payload = prefRow?.payload as PrefsPayload | undefined;
  if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
    applyPreferencesPayload(payload);
  }
}

async function deleteReadingProgressNotIn(session: Session, keepIds: Set<string>): Promise<void> {
  const uid = session.user.id;
  const { data: remote, error } = await supabase.from('reading_progress').select('chapter_id').eq('user_id', uid);
  if (error) throw error;
  for (const r of remote ?? []) {
    const cid = r.chapter_id as string;
    if (!keepIds.has(cid)) {
      const { error: delErr } = await supabase.from('reading_progress').delete().eq('user_id', uid).eq('chapter_id', cid);
      if (delErr) throw delErr;
    }
  }
}

async function deleteLibraryItemsNotIn(session: Session, keepIds: Set<string>): Promise<void> {
  const uid = session.user.id;
  const { data: remote, error } = await supabase.from('library_items').select('manga_id').eq('user_id', uid);
  if (error) throw error;
  for (const r of remote ?? []) {
    const mid = r.manga_id as string;
    if (!keepIds.has(mid)) {
      const { error: delErr } = await supabase.from('library_items').delete().eq('user_id', uid).eq('manga_id', mid);
      if (delErr) throw delErr;
    }
  }
}

/** Push current local state to Supabase (full sync). */
export async function pushLocalToCloud(session: Session): Promise<void> {
  const uid = session.user.id;
  const now = new Date().toISOString();

  const ids = getLibraryIds();
  const mangaMap = getMangaCache();
  const progress = getAllProgressRows();
  const bookmarks = getBookmarkChapterIds();

  const libPayload = ids.map(manga_id => {
    const m = mangaMap[manga_id];
    const category_ids = m?.categoryIds ?? [];
    const manga_json = m ?? ({ id: manga_id, title: '', coverUrl: '', author: '', status: 'Unknown', unreadCount: 0, downloadedCount: 0, totalChapters: 0, lastUpdated: now, inLibrary: true, categoryIds: [] } as Manga);
    return {
      user_id: uid,
      manga_id,
      category_ids,
      manga_json,
      updated_at: now,
    };
  });

  if (libPayload.length > 0) {
    const { error } = await supabase.from('library_items').upsert(libPayload, { onConflict: 'user_id,manga_id' });
    if (error) throw error;
  }
  await deleteLibraryItemsNotIn(session, new Set(ids));

  const progPayload = Object.entries(progress).map(([chapter_id, row]) => ({
    user_id: uid,
    chapter_id,
    manga_id: row.mangaId,
    last_page: row.lastPage,
    total_pages: row.totalPages,
    finished: row.finished,
    updated_at_ms: row.updatedAt,
    chapter_title: row.chapterTitle,
    chapter_number: row.chapterNumber,
    manga_title: row.mangaTitle,
    manga_cover_url: row.mangaCoverUrl,
    updated_at: now,
  }));

  if (progPayload.length > 0) {
    const chunk = 80;
    for (let i = 0; i < progPayload.length; i += chunk) {
      const { error } = await supabase
        .from('reading_progress')
        .upsert(progPayload.slice(i, i + chunk), { onConflict: 'user_id,chapter_id' });
      if (error) throw error;
    }
  }
  await deleteReadingProgressNotIn(session, new Set(Object.keys(progress)));

  await supabase.from('bookmarked_chapters').delete().eq('user_id', uid);
  if (bookmarks.length > 0) {
    const bmIns = bookmarks.map(chapter_id => ({ user_id: uid, chapter_id }));
    const chunk = 200;
    for (let i = 0; i < bmIns.length; i += chunk) {
      const { error } = await supabase.from('bookmarked_chapters').insert(bmIns.slice(i, i + chunk));
      if (error) throw error;
    }
  }

  const prefs = collectPreferencesPayload();
  const { error: pe } = await supabase.from('user_preferences').upsert(
    { user_id: uid, payload: prefs as Record<string, unknown>, updated_at: now },
    { onConflict: 'user_id' },
  );
  if (pe) throw pe;
}

/** Upsert a single reading progress row (for real-time cross-device resume). */
export async function pushSingleReadingProgress(
  session: Session,
  row: {
    chapter_id: string;
    manga_id: string;
    last_page: number;
    total_pages: number;
    finished: boolean;
    updated_at_ms: number;
    chapter_title: string;
    chapter_number: number;
    manga_title: string;
    manga_cover_url: string;
  },
): Promise<void> {
  if (!session?.user?.id || !supabaseConfigured()) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const uid = session.user.id;
  const now = new Date().toISOString();
  const payload = {
    user_id: uid,
    ...row,
    updated_at: now,
  };
  await supabase.from('reading_progress').upsert(payload, { onConflict: 'user_id,chapter_id' });
}

/** Remove one chapter from cloud progress (keeps History clear after refresh when sync is on). */
export async function deleteCloudReadingProgressChapter(session: Session, chapterId: string): Promise<void> {
  if (!session?.user?.id || !supabaseConfigured() || !chapterId) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const uid = session.user.id;
  const { error } = await supabase.from('reading_progress').delete().eq('user_id', uid).eq('chapter_id', chapterId);
  if (error) throw error;
}

const CLOUD_PROGRESS_DELETE_CHUNK = 60;

/** Batch-delete by chapter id (PostgREST `in` limit–friendly). */
export async function deleteCloudReadingProgressChapters(session: Session, chapterIds: string[]): Promise<void> {
  if (!session?.user?.id || !supabaseConfigured()) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const uid = session.user.id;
  const ids = [...new Set(chapterIds.filter(Boolean))];
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += CLOUD_PROGRESS_DELETE_CHUNK) {
    const chunk = ids.slice(i, i + CLOUD_PROGRESS_DELETE_CHUNK);
    const { error } = await supabase.from('reading_progress').delete().eq('user_id', uid).in('chapter_id', chunk);
    if (error) throw error;
  }
}

/** Remove all chapters for a manga from cloud progress. */
export async function deleteCloudReadingProgressForManga(session: Session, mangaId: string): Promise<void> {
  if (!session?.user?.id || !supabaseConfigured() || !mangaId) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const uid = session.user.id;
  const { error } = await supabase.from('reading_progress').delete().eq('user_id', uid).eq('manga_id', mangaId);
  if (error) throw error;
}

/** Remove one title from cloud library (so pull/refresh cannot restore it after local removal). */
export async function deleteCloudLibraryItem(session: Session, mangaId: string): Promise<void> {
  if (!session?.user?.id || !supabaseConfigured() || !mangaId) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const uid = session.user.id;
  const { error } = await supabase.from('library_items').delete().eq('user_id', uid).eq('manga_id', mangaId);
  if (error) throw error;
}

/** Fetch one chapter's reading progress from cloud (for instant resume when local is missing). */
export async function fetchSingleReadingProgress(
  session: Session,
  chapterId: string,
): Promise<ProgressRow | null> {
  if (!session?.user?.id || !supabaseConfigured()) return null;
  if (!useStore.getState().profileSyncEnabled) return null;
  if (!chapterId) return null;
  const uid = session.user.id;
  const { data, error } = await supabase
    .from('reading_progress')
    .select('*')
    .eq('user_id', uid)
    .eq('chapter_id', chapterId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    mangaId: String(data.manga_id ?? ''),
    lastPage: Number(data.last_page ?? 1),
    totalPages: Number(data.total_pages ?? 0),
    finished: Boolean(data.finished ?? false),
    updatedAt: Number(data.updated_at_ms ?? Date.now()),
    chapterTitle: String(data.chapter_title ?? ''),
    chapterNumber: Number(data.chapter_number ?? 0),
    mangaTitle: String(data.manga_title ?? ''),
    mangaCoverUrl: String(data.manga_cover_url ?? ''),
  };
}

/** Pull merge, then push (keeps devices aligned). */
export async function runFullCloudSync(session: Session | null): Promise<{ ok: boolean; error?: string }> {
  if (!session || !supabaseConfigured()) {
    return { ok: false, error: 'Not signed in or Supabase not configured' };
  }
  if (!useStore.getState().profileSyncEnabled) {
    return { ok: false, error: 'Cloud sync is off in Profile' };
  }
  try {
    await pullCloudIntoLocal(session);
    await pushLocalToCloud(session);
    await queryClient.invalidateQueries();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info('[cloudSync] OK', {
        library: getLibraryIds().length,
        progress: Object.keys(getAllProgressRows()).length,
        bookmarks: getBookmarkChapterIds().length,
      });
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[cloudSync]', e);
    }
    return { ok: false, error: msg };
  }
}
