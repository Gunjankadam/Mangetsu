import type { Chapter } from '../types';

const LS_KEY = 'mf.chapter.bookmarkIds';

let bookmarkIds = new Set<string>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) bookmarkIds = new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    bookmarkIds = new Set();
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify([...bookmarkIds]));
  } catch {
    /* quota */
  }
}

export function initChapterBookmarkPersistence(): Promise<void> {
  load();
  return Promise.resolve();
}

export function applyChapterBookmarksToChapters(chapters: Chapter[]): Chapter[] {
  load();
  return chapters.map(ch => ({
    ...ch,
    bookmarked: bookmarkIds.has(ch.id) || !!ch.bookmarked,
  }));
}

export async function persistChapterBookmark(chapterId: string, bookmarked: boolean): Promise<void> {
  load();
  if (bookmarked) bookmarkIds.add(chapterId);
  else bookmarkIds.delete(chapterId);
  persist();
}

export function getBookmarkChapterIds(): string[] {
  load();
  return [...bookmarkIds];
}

/** Replace all bookmarks (e.g. after cloud pull). */
export function replaceBookmarksFromCloud(chapterIds: string[]): void {
  load();
  bookmarkIds = new Set(chapterIds.filter(id => typeof id === 'string' && id.length > 0));
  persist();
}

/** Remap bookmarked chapter IDs after source migration (old chapter id → new). */
export function migrateChapterBookmarksForPairs(pairs: { oldChapterId: string; newChapterId: string }[]): void {
  load();
  let changed = false;
  for (const { oldChapterId, newChapterId } of pairs) {
    if (!oldChapterId || !newChapterId || oldChapterId === newChapterId) continue;
    if (bookmarkIds.has(oldChapterId)) {
      bookmarkIds.delete(oldChapterId);
      bookmarkIds.add(newChapterId);
      changed = true;
    }
  }
  if (changed) persist();
}
