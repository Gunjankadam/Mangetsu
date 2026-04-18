import { Capacitor } from '@capacitor/core';
import type { Chapter, HistoryItem, Manga } from '../types';
import { formatChapterDisplayTitle } from '../utils/chapterDisplay';
import { getMangaCache } from './libraryStore';

/** Calendar bucket label for history grouping/dedupe (local timezone, matches History screen). */
function historyCalendarDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Collapse titles so duplicate library/source rows for the same series merge in history. */
function normalizeHistoryTitleForDedupe(title: string): string {
  let t = String(title ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\s*\(official[^)]*$/i, '').trim();
  return t;
}

/** True when a cover URL is missing, ephemeral, or a known placeholder graphic. */
export function isUnreliableHistoryCoverUrl(u: string | undefined | null): boolean {
  const s = String(u ?? '').trim();
  if (!s) return true;
  if (s.startsWith('blob:') || s.startsWith('data:')) return true;
  if (/read\s*manga\s*online|manga\s*online|placeholder|via\.placeholder|picsum\.photos/i.test(s)) return true;
  return false;
}

function findCrossTitleCoverInMangaCache(mangaId: string, mangaTitle: string): string {
  const rowTitle = (mangaTitle || '').trim();
  const n = normalizeHistoryTitleForDedupe(rowTitle);
  if (n.length < 8) return '';
  const cache = getMangaCache();
  for (const m of Object.values(cache)) {
    if (!m?.coverUrl?.trim() || m.id === mangaId) continue;
    if (normalizeHistoryTitleForDedupe(m.title) !== n) continue;
    const c = m.coverUrl.trim();
    if (!isUnreliableHistoryCoverUrl(c)) return c;
  }
  return '';
}

function pickBetterHistoryDup(a: HistoryItem, b: HistoryItem): HistoryItem {
  const ta = new Date(a.lastRead).getTime();
  const tb = new Date(b.lastRead).getTime();
  if (tb !== ta) return tb > ta ? b : a;
  const ga = !isUnreliableHistoryCoverUrl(a.manga.coverUrl);
  const gb = !isUnreliableHistoryCoverUrl(b.manga.coverUrl);
  if (ga !== gb) return ga ? a : b;
  return b;
}

/** First URL-style segment (e.g. `mpl`, `mp`) so same title from different sources stays separate in history. */
function historySourcePrefixFromMangaId(mangaId: string): string {
  const s = String(mangaId ?? '').trim();
  const i = s.indexOf(':');
  return i < 0 ? (s || 'id') : s.slice(0, i);
}

/**
 * One row per manga id per calendar day, then merge rows that share the same normalized title
 * **and** the same source prefix on the same day (duplicate IDs for one catalogue entry).
 */
function dedupeHistoryItems(items: HistoryItem[]): HistoryItem[] {
  if (items.length <= 1) return items;
  const sorted = [...items].sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());

  const byMangaDay = new Map<string, HistoryItem>();
  for (const h of sorted) {
    const day = historyCalendarDayKey(h.lastRead);
    const k = `${day}\0${h.manga.id}`;
    const prev = byMangaDay.get(k);
    if (!prev || new Date(h.lastRead) > new Date(prev.lastRead)) byMangaDay.set(k, h);
  }
  const pass1 = Array.from(byMangaDay.values()).sort(
    (a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime(),
  );

  const groups = new Map<string, HistoryItem[]>();
  for (const h of pass1) {
    const t = normalizeHistoryTitleForDedupe(h.manga.title);
    if (t.length < 8) continue;
    const day = historyCalendarDayKey(h.lastRead);
    const src = historySourcePrefixFromMangaId(h.manga.id);
    const k = `${day}\0${src}\0${t}`;
    const g = groups.get(k);
    if (g) g.push(h);
    else groups.set(k, [h]);
  }
  const drop = new Set<string>();
  for (const g of groups.values()) {
    if (g.length <= 1) continue;
    const w = g.reduce((acc, h) => pickBetterHistoryDup(acc, h));
    for (const h of g) {
      if (h.id !== w.id) drop.add(h.id);
    }
  }
  return pass1.filter(h => !drop.has(h.id)).sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());
}

const LS_PROGRESS = 'mf.reading.chapterProgress';

const DB_NAME = 'manga_flow_reading';

export type SaveReaderProgressInput = {
  mangaId: string;
  chapterId: string;
  /** 0-based page index from reader */
  pageIndex: number;
  totalPages: number;
  chapterTitle?: string;
  chapterNumber?: number;
  /** Snapshot for history when manga is not in the library cache */
  mangaTitle?: string;
  mangaCoverUrl?: string;
};

export type ProgressRow = {
  mangaId: string;
  lastPage: number;
  totalPages: number;
  finished: boolean;
  updatedAt: number;
  chapterTitle: string;
  chapterNumber: number;
  mangaTitle: string;
  mangaCoverUrl: string;
};

function isVolatileCoverUrl(u: string | undefined | null): boolean {
  const s = String(u ?? '').trim();
  return !s || s.startsWith('blob:') || s.startsWith('data:');
}

function readLsJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLsJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

let mem: Record<string, ProgressRow> = {};
let initPromise: Promise<void> | null = null;
let webLoaded = false;

/** Bumps when chapter progress changes so library cards can re-render unread badges. */
let libraryProgressEpoch = 0;
const libraryProgressListeners = new Set<() => void>();

export function subscribeLibraryProgress(listener: () => void): () => void {
  libraryProgressListeners.add(listener);
  return () => libraryProgressListeners.delete(listener);
}

export function getLibraryProgressEpoch(): number {
  return libraryProgressEpoch;
}

function notifyLibraryProgressChanged(): void {
  libraryProgressEpoch += 1;
  libraryProgressListeners.forEach(l => {
    try {
      l();
    } catch {
      /* ignore subscriber errors */
    }
  });
}
let nativeDb: import('@capacitor-community/sqlite').SQLiteDBConnection | null = null;
let nativeSqlite: import('@capacitor-community/sqlite').SQLiteConnection | null = null;

function ensureWebLoaded(): void {
  if (Capacitor.isNativePlatform() || webLoaded) return;
  webLoaded = true;
  hydrateMemFromLs(readLsJson<Record<string, ProgressRow>>(LS_PROGRESS, {}));
}

function persistWeb(): void {
  writeLsJson(LS_PROGRESS, mem);
}

function placeholderManga(mangaId: string): Manga {
  return {
    id: mangaId,
    title: 'Unknown series',
    coverUrl: '',
    author: '',
    status: 'Unknown',
    unreadCount: 0,
    downloadedCount: 0,
    totalChapters: 0,
    lastUpdated: new Date().toISOString(),
    inLibrary: false,
    categoryIds: [],
  };
}

function rowFromDb(values: Record<string, unknown>): ProgressRow | null {
  const chapterId = String(values.chapter_id ?? '');
  if (!chapterId) return null;
  return {
    mangaId: String(values.manga_id ?? ''),
    lastPage: Number(values.last_page ?? 0),
    totalPages: Number(values.total_pages ?? 0),
    finished: Number(values.finished ?? 0) === 1,
    updatedAt: Number(values.updated_at ?? 0),
    chapterTitle: String(values.chapter_title ?? ''),
    chapterNumber: Number(values.chapter_number ?? 0),
    mangaTitle: String(values.manga_title ?? ''),
    mangaCoverUrl: String(values.manga_cover_url ?? ''),
  };
}

function normalizeProgressRow(r: ProgressRow): ProgressRow {
  return {
    ...r,
    mangaTitle: typeof r.mangaTitle === 'string' ? r.mangaTitle : '',
    mangaCoverUrl: typeof r.mangaCoverUrl === 'string' ? r.mangaCoverUrl : '',
  };
}

function hydrateMemFromLs(raw: Record<string, ProgressRow>): void {
  mem = {};
  for (const [id, row] of Object.entries(raw)) {
    if (!id || !row?.mangaId) continue;
    mem[id] = normalizeProgressRow({
      ...row,
      mangaTitle: row.mangaTitle ?? '',
      mangaCoverUrl: row.mangaCoverUrl ?? '',
    });
  }
}

export function initReadProgressPersistence(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!Capacitor.isNativePlatform()) {
        webLoaded = true;
        hydrateMemFromLs(readLsJson<Record<string, ProgressRow>>(LS_PROGRESS, {}));
        return;
      }
      const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
      nativeSqlite = new SQLiteConnection(CapacitorSQLite);
      nativeDb = await nativeSqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      await nativeDb.open();
      await nativeDb.execute(
        `CREATE TABLE IF NOT EXISTS chapter_progress (
          chapter_id TEXT PRIMARY KEY NOT NULL,
          manga_id TEXT NOT NULL,
          last_page INTEGER NOT NULL,
          total_pages INTEGER NOT NULL DEFAULT 0,
          finished INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          chapter_title TEXT NOT NULL DEFAULT '',
          chapter_number INTEGER NOT NULL DEFAULT 0,
          manga_title TEXT NOT NULL DEFAULT '',
          manga_cover_url TEXT NOT NULL DEFAULT ''
        );`,
        false,
      );
      for (const stmt of [
        `ALTER TABLE chapter_progress ADD COLUMN manga_title TEXT NOT NULL DEFAULT '';`,
        `ALTER TABLE chapter_progress ADD COLUMN manga_cover_url TEXT NOT NULL DEFAULT '';`,
      ]) {
        try {
          await nativeDb.execute(stmt, false);
        } catch {
          /* column already present */
        }
      }
      const q = await nativeDb.query('SELECT * FROM chapter_progress;', []);
      mem = {};
      const rows = (q.values as Record<string, unknown>[]) ?? [];
      for (const v of rows) {
        const id = String(v.chapter_id ?? '');
        const r = rowFromDb(v);
        if (id && r) mem[id] = normalizeProgressRow(r);
      }
    })();
  }
  return initPromise;
}

async function persistNativeRow(chapterId: string, row: ProgressRow): Promise<void> {
  if (!nativeDb) return;
  await nativeDb.run(
    `INSERT INTO chapter_progress (chapter_id, manga_id, last_page, total_pages, finished, updated_at, chapter_title, chapter_number, manga_title, manga_cover_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET
       manga_id = excluded.manga_id,
       last_page = excluded.last_page,
       total_pages = excluded.total_pages,
       finished = excluded.finished,
       updated_at = excluded.updated_at,
       chapter_title = excluded.chapter_title,
       chapter_number = excluded.chapter_number,
       manga_title = excluded.manga_title,
       manga_cover_url = excluded.manga_cover_url;`,
    [
      chapterId,
      row.mangaId,
      row.lastPage,
      row.totalPages,
      row.finished ? 1 : 0,
      row.updatedAt,
      row.chapterTitle,
      row.chapterNumber,
      row.mangaTitle,
      row.mangaCoverUrl,
    ],
  );
}

async function deleteNativeRow(chapterId: string): Promise<void> {
  if (!nativeDb) return;
  await nativeDb.run('DELETE FROM chapter_progress WHERE chapter_id = ?;', [chapterId]);
}

/** 0-based index to open reader at; clamped to [0, totalPages-1]. */
export function getResumePageIndex(chapterId: string, totalPages: number): number {
  ensureWebLoaded();
  const row = mem[chapterId];
  if (!row || totalPages <= 0) return 0;
  const idx = row.lastPage - 1;
  if (idx < 0) return 0;
  if (idx >= totalPages) return Math.max(0, totalPages - 1);
  return idx;
}

/** Returns the persisted progress row for a chapter (if any). */
export function getChapterProgressRow(chapterId: string): ProgressRow | undefined {
  ensureWebLoaded();
  return mem[chapterId];
}

/**
 * Library grid badge: `totalChapters − locally finished` (sources usually send unreadCount: 0).
 */
export function getLibraryUnreadBadgeCount(
  manga: Pick<Manga, 'id' | 'totalChapters' | 'unreadCount'>,
): number {
  ensureWebLoaded();
  const total = Math.max(0, Math.floor(Number(manga.totalChapters) || 0));
  let finished = 0;
  for (const row of Object.values(mem)) {
    if (row.mangaId === manga.id && row.finished) finished += 1;
  }
  if (total > 0) {
    return Math.max(0, total - finished);
  }
  const apiUnread = Math.max(0, Math.floor(Number(manga.unreadCount) || 0));
  if (apiUnread > 0) return apiUnread;
  let partial = 0;
  for (const row of Object.values(mem)) {
    if (row.mangaId === manga.id && !row.finished) partial += 1;
  }
  return partial;
}

/** Same idea as chapter ids: manga ids sometimes differ only by URL-encoding. */
function mangaIdLookupCandidates(id: string): Set<string> {
  const out = new Set<string>();
  const s = String(id ?? '').trim();
  if (!s) return out;
  out.add(s);
  let cur = s;
  for (let i = 0; i < 4 && cur && /%[0-9A-Fa-f]{2}/i.test(cur); i += 1) {
    try {
      const next = decodeURIComponent(cur);
      if (!next || next === cur) break;
      out.add(next);
      cur = next;
    } catch {
      break;
    }
  }
  return out;
}

function mangaIdsMatchForProgress(rowMangaId: string, hint: string): boolean {
  const a = String(rowMangaId ?? '').trim();
  const b = String(hint ?? '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = mangaIdLookupCandidates(a);
  const sb = mangaIdLookupCandidates(b);
  for (const x of sa) {
    if (sb.has(x)) return true;
  }
  return false;
}

/** Keys to try when matching stored progress to a chapter from the API (encoding can differ per source). */
function collectChapterIdLookupKeys(id: string): string[] {
  const s = String(id ?? '').trim();
  const keys = new Set<string>();
  if (s) keys.add(s);
  let cur = s;
  for (let i = 0; i < 4 && cur && /%[0-9A-Fa-f]{2}/i.test(cur); i += 1) {
    try {
      const next = decodeURIComponent(cur);
      if (!next || next === cur) break;
      keys.add(next);
      cur = next;
    } catch {
      break;
    }
  }
  try {
    const enc = encodeURIComponent(s);
    if (enc && enc !== s) keys.add(enc);
  } catch {
    /* ignore */
  }
  return [...keys];
}

/** True when list vs reader route use different encodings for the same chapter id (breaks next-chapter index). */
export function chapterIdsReferToSameChapter(a: string | undefined, b: string | undefined): boolean {
  const sA = String(a ?? '').trim();
  const sB = String(b ?? '').trim();
  if (!sA || !sB) return false;
  if (sA === sB) return true;
  const setB = new Set(collectChapterIdLookupKeys(sB));
  for (const k of collectChapterIdLookupKeys(sA)) {
    if (setB.has(k)) return true;
  }
  return false;
}

function normalizeChapterTitleForMatch(title: string): string {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse "Chapter 12" / "Episode 3" from a stored or API title when `chapterNumber` was missing. */
export function inferChapterNumberFromTitleString(title: string): number | null {
  const t = String(title ?? '');
  const patterns = [/(?:chapter|ch\.?)\s*([\d.]+)/i, /(?:episode|ep\.?)\s*([\d.]+)/i];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

export function inferChapterNumberForProgressList(ch: Pick<Chapter, 'number' | 'title'>): number | null {
  const n = Number(ch.number);
  if (Number.isFinite(n) && n > 0) return n;
  return inferChapterNumberFromTitleString(String(ch.title ?? ''));
}

/** Same string the UI uses for a list row — aligns with history’s `formatChapterDisplayTitle` line. */
function canonicalChapterLabelFromList(ch: Pick<Chapter, 'number' | 'title'>): string {
  const n = inferChapterNumberForProgressList(ch) ?? Number(ch.number);
  if (Number.isFinite(n) && n > 0) {
    return normalizeChapterTitleForMatch(formatChapterDisplayTitle(n, ch.title));
  }
  return normalizeChapterTitleForMatch(String(ch.title ?? ''));
}

function canonicalChapterLabelFromRow(row: ProgressRow): string {
  const n =
    row.chapterNumber > 0
      ? row.chapterNumber
      : inferChapterNumberFromTitleString(row.chapterTitle) ?? 0;
  if (Number.isFinite(n) && n > 0) {
    return normalizeChapterTitleForMatch(formatChapterDisplayTitle(n, row.chapterTitle));
  }
  return normalizeChapterTitleForMatch(row.chapterTitle || '');
}

/**
 * Resolve a progress row for a chapter list row.
 * Some sources (e.g. MangaPlus) can disagree on chapter `id` strings between the list and the reader URL;
 * we then fall back to mangaId + chapter number (from `number` or parsed title), then normalized chapter title.
 */
export function resolveReadingProgressRowForChapter(ch: Chapter, mangaIdHint?: string): ProgressRow | undefined {
  ensureWebLoaded();
  for (const k of collectChapterIdLookupKeys(ch.id)) {
    const hit = mem[k];
    if (hit) return hit;
  }
  const mid = (ch.mangaId?.trim() || mangaIdHint?.trim() || '') || '';
  if (!mid) return undefined;

  const nList = inferChapterNumberForProgressList(ch);
  const titleList = normalizeChapterTitleForMatch(String(ch.title ?? ''));
  const listCanonical = canonicalChapterLabelFromList(ch);

  let best: ProgressRow | undefined;
  let bestAt = -1;
  const consider = (row: ProgressRow) => {
    if (row.updatedAt >= bestAt) {
      best = row;
      bestAt = row.updatedAt;
    }
  };

  for (const row of Object.values(mem)) {
    if (!row.mangaId || !mangaIdsMatchForProgress(row.mangaId, mid)) continue;

    let match = false;
    if (nList != null) {
      if (Number(row.chapterNumber) === nList) match = true;
      else {
        const rNum = inferChapterNumberFromTitleString(row.chapterTitle);
        if (rNum != null && rNum === nList) match = true;
      }
    }
    if (!match && titleList.length >= 8) {
      const rt = normalizeChapterTitleForMatch(row.chapterTitle);
      if (rt && rt === titleList) match = true;
      else if (row.chapterNumber > 0) {
        const composed = normalizeChapterTitleForMatch(
          formatChapterDisplayTitle(row.chapterNumber, row.chapterTitle),
        );
        if (composed === titleList) match = true;
      }
    }
    if (!match && listCanonical.length >= 10) {
      const rowCanonical = canonicalChapterLabelFromRow(row);
      if (rowCanonical.length >= 10 && rowCanonical === listCanonical) match = true;
    }
    if (match) consider(row);
  }
  return best;
}

function mergeChapterProgressFields(ch: Chapter, row: ProgressRow): Chapter {
  const listTp = Math.max(0, Math.floor(Number(ch.totalPages) || 0));
  const rowTp = Math.max(0, Math.floor(Number(row.totalPages) || 0));
  const total = rowTp > 0 ? rowTp : listTp;
  const lastPage = row.lastPage;
  const effectiveTotal = total > 0 ? total : listTp;
  const read =
    row.finished || (effectiveTotal > 0 && lastPage >= effectiveTotal);
  return {
    ...ch,
    read,
    lastPageRead: lastPage,
    totalPages: effectiveTotal > 0 ? effectiveTotal : ch.totalPages,
  };
}

/**
 * Attach local reading progress to API chapter rows.
 * Primary match: chapter id variants + manga id + numbers/titles.
 * Fallback: any progress row for this manga whose canonical label equals the list row (history-style),
 * if that row was not already consumed by id-based resolution.
 */
export function applyReadingProgressToChapters(chapters: Chapter[], mangaIdHint?: string): Chapter[] {
  ensureWebLoaded();
  const hint = mangaIdHint ?? '';
  const resolvedRows = chapters.map(ch => resolveReadingProgressRowForChapter(ch, hint));
  let out = chapters.map((ch, i) => {
    const row = resolvedRows[i];
    return row ? mergeChapterProgressFields(ch, row) : ch;
  });

  const usedMemKeys = new Set<string>();
  for (const row of resolvedRows) {
    if (!row) continue;
    for (const [k, v] of Object.entries(mem)) {
      if (v === row) usedMemKeys.add(k);
    }
  }

  for (const [memKey, row] of Object.entries(mem)) {
    if (!hint || !mangaIdsMatchForProgress(row.mangaId, hint)) continue;
    if (usedMemKeys.has(memKey)) continue;
    const rc = canonicalChapterLabelFromRow(row);
    if (rc.length < 10) continue;
    const idx = out.findIndex(ch => {
      if (canonicalChapterLabelFromList(ch) !== rc) return false;
      const m = mergeChapterProgressFields(ch, row);
      return m.lastPageRead !== ch.lastPageRead || m.read !== ch.read;
    });
    if (idx >= 0) {
      out[idx] = mergeChapterProgressFields(out[idx], row);
      usedMemKeys.add(memKey);
    }
  }

  return out;
}

export async function saveReaderProgressToStore(input: SaveReaderProgressInput): Promise<void> {
  await initReadProgressPersistence();
  ensureWebLoaded();
  const { mangaId, chapterId, pageIndex, totalPages } = input;
  if (!chapterId || !mangaId || totalPages <= 0) return;
  const humanPage = Math.min(totalPages, Math.max(1, pageIndex + 1));
  const reachedEnd = humanPage >= totalPages;
  const prev = mem[chapterId];
  const chapterTitle =
    input.chapterTitle !== undefined && input.chapterTitle !== ''
      ? input.chapterTitle
      : (prev?.chapterTitle ?? '');
  let chapterNumber =
    input.chapterNumber !== undefined && !Number.isNaN(input.chapterNumber)
      ? Number(input.chapterNumber)
      : (prev?.chapterNumber ?? 0);
  if (!chapterNumber || chapterNumber === 0) {
    const inferred = inferChapterNumberFromTitleString(chapterTitle);
    if (inferred != null) chapterNumber = inferred;
  }
  const incomingTitle = input.mangaTitle?.trim();
  const incomingCover = input.mangaCoverUrl?.trim();
  let mangaTitle =
    incomingTitle !== undefined && incomingTitle !== ''
      ? incomingTitle
      : (prev?.mangaTitle ?? '');
  let mangaCoverUrl =
    incomingCover !== undefined && incomingCover !== ''
      ? incomingCover
      : (prev?.mangaCoverUrl ?? '');
  // Fill from browse/library cache when the reader did not pass metadata (common off-library).
  const cache = getMangaCache()[mangaId];
  const cacheTitle = cache?.title?.trim() ?? '';
  const cacheCover = cache?.coverUrl?.trim() ?? '';
  if ((!mangaTitle.trim() || mangaTitle === 'Unknown series') && cacheTitle && cacheTitle !== 'Unknown series') {
    mangaTitle = cacheTitle;
  }
  if ((!mangaCoverUrl.trim() || isUnreliableHistoryCoverUrl(mangaCoverUrl)) && cacheCover && !isUnreliableHistoryCoverUrl(cacheCover)) {
    mangaCoverUrl = cacheCover;
  }
  if (isUnreliableHistoryCoverUrl(mangaCoverUrl)) {
    const alt = findCrossTitleCoverInMangaCache(mangaId, mangaTitle);
    if (alt) mangaCoverUrl = alt;
  }
  let lastPage = humanPage;
  let finished = reachedEnd || (prev?.finished ?? false);
  if (reachedEnd) {
    finished = true;
    lastPage = totalPages;
  }
  const row: ProgressRow = {
    mangaId,
    lastPage,
    totalPages,
    finished,
    updatedAt: Date.now(),
    chapterTitle,
    chapterNumber,
    mangaTitle,
    mangaCoverUrl,
  };
  mem[chapterId] = row;
  if (Capacitor.isNativePlatform()) {
    await persistNativeRow(chapterId, row);
  } else {
    persistWeb();
  }
  notifyLibraryProgressChanged();
}

/** Removes stored progress for one chapter (history + resume). */
export async function clearChapterReadingProgress(chapterId: string): Promise<void> {
  await markChapterReadInStore(chapterId, false);
}

/** Removes all chapter progress rows for a manga. */
export async function clearAllReadingProgressForManga(mangaId: string): Promise<void> {
  await initReadProgressPersistence();
  ensureWebLoaded();
  if (!mangaId) return;
  if (Capacitor.isNativePlatform() && nativeDb) {
    await nativeDb.run('DELETE FROM chapter_progress WHERE manga_id = ?;', [mangaId]);
  }
  for (const chapterId of Object.keys(mem)) {
    if (mem[chapterId]?.mangaId === mangaId) {
      delete mem[chapterId];
    }
  }
  if (!Capacitor.isNativePlatform()) persistWeb();
  notifyLibraryProgressChanged();
}

function mergeProgressRowsForMigration(a: ProgressRow, b: ProgressRow): ProgressRow {
  const primary = a.updatedAt >= b.updatedAt ? a : b;
  const secondary = a.updatedAt >= b.updatedAt ? b : a;
  const tp = Math.max(a.totalPages || 0, b.totalPages || 0, primary.totalPages || 0) || primary.totalPages || 0;
  return {
    ...primary,
    lastPage: Math.max(a.lastPage || 0, b.lastPage || 0),
    finished: a.finished || b.finished,
    totalPages: tp,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    mangaTitle: primary.mangaTitle || secondary.mangaTitle,
    mangaCoverUrl: primary.mangaCoverUrl || secondary.mangaCoverUrl,
  };
}

/**
 * Mihon-style source migration: remap chapter progress to new chapter IDs by pairing old/new chapters (same number).
 */
export async function migrateReadingProgressBetweenMangas(
  fromMangaId: string,
  toMangaId: string,
  pairs: { oldChapterId: string; newChapter: Chapter }[],
  meta: { mangaTitle: string; mangaCoverUrl: string },
): Promise<void> {
  await initReadProgressPersistence();
  ensureWebLoaded();
  if (!fromMangaId || !toMangaId || fromMangaId === toMangaId) return;

  const byOldId = new Map(pairs.map(p => [p.oldChapterId, p.newChapter]));
  const byNumber = new Map<number, Chapter>();
  for (const p of pairs) {
    if (!byNumber.has(p.newChapter.number)) byNumber.set(p.newChapter.number, p.newChapter);
  }

  type Target = { targetCh: Chapter; row: ProgressRow };
  const targets: Target[] = [];

  for (const [chapterId, row] of Object.entries(mem)) {
    if (row.mangaId !== fromMangaId) continue;
    let targetCh: Chapter | undefined = byOldId.get(chapterId);
    if (!targetCh && row.chapterNumber > 0) {
      targetCh = byNumber.get(row.chapterNumber);
    }
    if (!targetCh) continue;
    const adapted: ProgressRow = {
      ...row,
      mangaId: toMangaId,
      chapterNumber: targetCh.number,
      chapterTitle: targetCh.title || row.chapterTitle,
      mangaTitle: meta.mangaTitle,
      mangaCoverUrl: meta.mangaCoverUrl,
      totalPages:
        row.totalPages > 0
          ? row.totalPages
          : targetCh.totalPages > 0
            ? targetCh.totalPages
            : row.totalPages,
    };
    targets.push({ targetCh, row: adapted });
  }

  for (const chapterId of Object.keys(mem)) {
    if (mem[chapterId]?.mangaId !== fromMangaId) continue;
    delete mem[chapterId];
    if (Capacitor.isNativePlatform()) await deleteNativeRow(chapterId);
  }

  const mergedByNewChapterId = new Map<string, ProgressRow>();
  for (const { targetCh, row } of targets) {
    const existing = mergedByNewChapterId.get(targetCh.id);
    mergedByNewChapterId.set(
      targetCh.id,
      existing ? mergeProgressRowsForMigration(existing, row) : row,
    );
  }

  for (const [newCid, row] of mergedByNewChapterId) {
    mem[newCid] = row;
    if (Capacitor.isNativePlatform()) await persistNativeRow(newCid, row);
  }

  if (!Capacitor.isNativePlatform()) persistWeb();
  notifyLibraryProgressChanged();
}

export async function markChapterReadInStore(chapterId: string, read: boolean): Promise<void> {
  await initReadProgressPersistence();
  ensureWebLoaded();
  const prev = mem[chapterId];
  if (!read) {
    delete mem[chapterId];
    if (Capacitor.isNativePlatform()) await deleteNativeRow(chapterId);
    else persistWeb();
    notifyLibraryProgressChanged();
    return;
  }
  if (!prev) return;
  const total = prev.totalPages || 1;
  const row: ProgressRow = {
    ...prev,
    mangaTitle: prev.mangaTitle ?? '',
    mangaCoverUrl: prev.mangaCoverUrl ?? '',
    finished: true,
    lastPage: total,
    updatedAt: Date.now(),
  };
  mem[chapterId] = row;
  if (Capacitor.isNativePlatform()) await persistNativeRow(chapterId, row);
  else persistWeb();
  notifyLibraryProgressChanged();
}

function historyProgress(row: ProgressRow): number {
  const total = row.totalPages || 1;
  if (row.finished || (row.totalPages > 0 && row.lastPage >= row.totalPages)) return 1;
  return Math.min(1, Math.max(0, row.lastPage / total));
}

/** Prefer a real remote cover for list UI; blob/data/placeholder URLs are a last resort. */
function pickHistoryCoverUrl(row: ProgressRow, cached: Manga | undefined): string {
  const fromRow = row.mangaCoverUrl?.trim() ?? '';
  const fromCache = cached?.coverUrl?.trim() ?? '';
  const fromCross = findCrossTitleCoverInMangaCache(row.mangaId, row.mangaTitle);

  const good = [fromRow, fromCache, fromCross].find(c => c && !isUnreliableHistoryCoverUrl(c));
  if (good) return good;

  if (fromRow && !isVolatileCoverUrl(fromRow)) return fromRow;
  if (fromCache && !isVolatileCoverUrl(fromCache)) return fromCache;
  if (fromCross) return fromCross;
  if (fromRow) return fromRow;
  if (fromCache) return fromCache;
  return '';
}

/** Manga row for history: merge progress snapshot with cache so removing a title from the library does not drop covers. */
function mangaForHistoryRow(row: ProgressRow): Manga {
  const cached = getMangaCache()[row.mangaId];
  const coverUrl = pickHistoryCoverUrl(row, cached);
  const rowTitle = row.mangaTitle?.trim() ?? '';
  const cacheTitle = cached?.title?.trim() ?? '';
  const pickHistoryTitle = (primary: string, secondary: string): string => {
    const p = primary.trim();
    const s = secondary.trim();
    if (p && p !== 'Unknown series') return p;
    if (s && s !== 'Unknown series') return s;
    return p || s || 'Unknown series';
  };
  const title = pickHistoryTitle(rowTitle, cacheTitle);
  if (cached) {
    return { ...cached, title, coverUrl };
  }
  if (title !== 'Unknown series' || coverUrl) {
    return {
      id: row.mangaId,
      title: title || 'Unknown series',
      coverUrl,
      author: '',
      status: 'Unknown',
      unreadCount: 0,
      downloadedCount: 0,
      totalChapters: 0,
      lastUpdated: new Date().toISOString(),
      inLibrary: false,
      categoryIds: [],
    };
  }
  return placeholderManga(row.mangaId);
}

export function getReadingHistoryItems(params: { sinceDays?: number }): HistoryItem[] {
  ensureWebLoaded();
  const sinceMs =
    params.sinceDays != null && params.sinceDays > 0
      ? Date.now() - params.sinceDays * 86400000
      : 0;
  const items: HistoryItem[] = [];
  for (const [chapterId, row] of Object.entries(mem)) {
    if (row.updatedAt < sinceMs) continue;
    const manga = mangaForHistoryRow(normalizeProgressRow(row));
    const num = row.chapterNumber > 0 ? row.chapterNumber : 1;
    const title = formatChapterDisplayTitle(num, row.chapterTitle || '');
    const ch: Chapter = {
      id: chapterId,
      mangaId: row.mangaId,
      number: row.chapterNumber > 0 ? row.chapterNumber : num,
      title,
      uploadDate: new Date(row.updatedAt).toISOString(),
      read: row.finished || (row.totalPages > 0 && row.lastPage >= row.totalPages),
      bookmarked: false,
      downloaded: false,
      lastPageRead: row.lastPage,
      totalPages: row.totalPages,
    };
    items.push({
      id: `hp-${chapterId}`,
      manga,
      chapter: ch,
      lastRead: new Date(row.updatedAt).toISOString(),
      progress: historyProgress(row),
    });
  }
  items.sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());
  return dedupeHistoryItems(items);
}

/** Snapshot of all chapter progress (for cloud sync). */
export function getAllProgressRows(): Record<string, ProgressRow> {
  ensureWebLoaded();
  return { ...mem };
}

/** Replace local progress from cloud (merge happens in cloudSync before calling this). */
export async function replaceAllProgressFromCloud(rows: Record<string, ProgressRow>): Promise<void> {
  await initReadProgressPersistence();
  ensureWebLoaded();
  mem = {};
  for (const [cid, row] of Object.entries(rows)) {
    if (!cid || !row?.mangaId) continue;
    mem[cid] = normalizeProgressRow(row);
  }
  if (Capacitor.isNativePlatform() && nativeDb) {
    await nativeDb.run('DELETE FROM chapter_progress;', []);
    for (const [chapterId, row] of Object.entries(mem)) {
      await persistNativeRow(chapterId, row);
    }
  } else {
    persistWeb();
  }
  notifyLibraryProgressChanged();
}
