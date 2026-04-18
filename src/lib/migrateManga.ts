import type { Chapter, Manga, MangaDetails } from '../types';
import { Backend } from '../native/Backend';
import {
  getLibraryIds,
  getMangaCache,
  removeMangaFromLibraryStore,
  setLibraryIds,
  upsertManga,
  initLibraryPersistence,
} from '../storage/libraryStore';
import {
  initReadProgressPersistence,
  migrateReadingProgressBetweenMangas,
} from '../storage/readProgressStore';
import { initChapterBookmarkPersistence, migrateChapterBookmarksForPairs } from '../storage/chapterBookmarkStore';
import { migrateLastCheckedMangaId, migrateMangaIdInUpdates } from '../storage/updatesStore';
import { useStore } from '../store/useStore';

export type MangaMigrationResult = { ok: true; newMangaId: string } | { ok: false; error: string };

/** Pair chapters by number (first match per number on the target side). */
export function buildChapterMigrationPairs(oldList: Chapter[], newList: Chapter[]): { oldChapterId: string; newChapter: Chapter }[] {
  const byNum = new Map<number, Chapter>();
  for (const c of newList) {
    if (c?.id && !byNum.has(c.number)) byNum.set(c.number, c);
  }
  const out: { oldChapterId: string; newChapter: Chapter }[] = [];
  for (const oc of oldList) {
    if (!oc?.id) continue;
    const nc = byNum.get(oc.number);
    if (nc) out.push({ oldChapterId: oc.id, newChapter: nc });
  }
  return out;
}

function libraryCategoryIdsFromCache(mangaId: string): string[] {
  const prev = getMangaCache()[mangaId];
  const raw = prev?.categoryIds ?? [];
  const noAll = [...new Set(raw.filter(id => id && String(id) !== 'all'))];
  return noAll.length > 0 ? noAll : ['reading'];
}

/**
 * Mihon-style migration: move library entry + local metadata from `fromMangaId` to `toMangaId`
 * (same series on another source). Chapters are matched by chapter number.
 */
export async function runMangaMigration(fromMangaId: string, toMangaId: string): Promise<MangaMigrationResult> {
  if (!fromMangaId || !toMangaId || fromMangaId === toMangaId) {
    return { ok: false, error: 'Pick a different manga to migrate to.' };
  }

  await Promise.all([initLibraryPersistence(), initReadProgressPersistence(), initChapterBookmarkPersistence()]);

  let oldChapters: Chapter[];
  let details: MangaDetails;
  let newChapters: Chapter[];
  try {
    ;[oldChapters, details, newChapters] = await Promise.all([
      Backend.getMangaChapters(fromMangaId, { filter: {}, sort: { field: 'number', direction: 'asc' } }),
      Backend.getMangaDetails(toMangaId),
      Backend.getMangaChapters(toMangaId, { filter: {}, sort: { field: 'number', direction: 'asc' } }),
    ]);
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e);
    return { ok: false, error: msg || 'Could not load manga or chapters.' };
  }

  if (!details?.id) return { ok: false, error: 'Target manga not found.' };

  const pairs = buildChapterMigrationPairs(oldChapters ?? [], newChapters ?? []);

  await migrateReadingProgressBetweenMangas(fromMangaId, toMangaId, pairs, {
    mangaTitle: details.title,
    mangaCoverUrl: details.coverUrl ?? '',
  });

  migrateChapterBookmarksForPairs(pairs.map(p => ({ oldChapterId: p.oldChapterId, newChapterId: p.newChapter.id })));

  const cats = libraryCategoryIdsFromCache(fromMangaId);
  const ids = getLibraryIds().filter(id => id !== fromMangaId);
  if (!ids.includes(toMangaId)) ids.push(toMangaId);
  setLibraryIds(ids);
  removeMangaFromLibraryStore(fromMangaId);
  Backend.revokeCoverBlobForManga(fromMangaId);
  upsertManga({
    ...details,
    inLibrary: true,
    categoryIds: cats,
  });

  Backend.applyMangaMigrationDownloads(fromMangaId, details, pairs);

  migrateMangaIdInUpdates(fromMangaId, { ...details, inLibrary: true, categoryIds: cats });
  migrateLastCheckedMangaId(fromMangaId, toMangaId);

  const ui = useStore.getState();
  const dir = ui.readerDirectionByMangaId[fromMangaId];
  if (dir) {
    ui.setReaderDirectionForManga(toMangaId, dir);
    ui.clearReaderDirectionForManga(fromMangaId);
  }

  return { ok: true, newMangaId: toMangaId };
}
