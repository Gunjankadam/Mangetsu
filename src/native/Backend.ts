import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { toast } from '../hooks/use-toast';
import type {
  LibrarySection, Manga, MangaDetails, Chapter, Page,
  ReaderSettings, Source, MangaPage, SourceFilterDefinition,
  UpdateItem, HistoryItem, DownloadItem, AppSettings,
  LibraryFilter, ChapterFilter, Sort, SourceFilter,
} from '../types';
import {
  attachNativeOfflineCover,
  getLibraryIds,
  getMangaCache,
  removeMangaFromLibraryStore,
  setLibraryIds,
  setMangaCache,
  upsertManga,
} from '../storage/libraryStore';
import { getLastCheckedAt, getStoredUpdates, setLastCheckedAt, setStoredUpdates } from '../storage/updatesStore';
import {
  applyReadingProgressToChapters,
  clearAllReadingProgressForManga,
  clearChapterReadingProgress,
  getAllProgressRows,
  getReadingHistoryItems,
  initReadProgressPersistence,
  markChapterReadInStore,
  saveReaderProgressToStore,
  type SaveReaderProgressInput,
} from '../storage/readProgressStore';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  deleteCloudLibraryItem,
  deleteCloudReadingProgressChapters,
  deleteCloudReadingProgressForManga,
} from '../lib/cloudSync';
import { useStore } from '../store/useStore';
import { mapChaptersDisplayTitles, withChapterDisplayTitle } from '../utils/chapterDisplay';
import {
  applyChapterBookmarksToChapters,
  persistChapterBookmark,
} from '../storage/chapterBookmarkStore';
import { searchAniList, fetchAniListDetails, stripHtml } from '../lib/anilist';
import { MAD_THEME_CHAPTER_ROUTES } from '../lib/madThemeChapterRoutes';

declare global {
  interface Window {
    // Android injects this via addJavascriptInterface(...)
    MihonBridge?: {
      request: (raw: string) => void;
    };
    __mihonBridgeResolve?: (id: string, payloadJson: string) => void;
    __mihonBridgeReject?: (id: string, message: string) => void;
  }
}

// ── Helpers ──

const delay = (ms = 400) => new Promise(r => setTimeout(r, ms + Math.random() * 300));

type BridgeMethod = 'getLibrarySections' | 'getLibraryManga';

// Optional override when running the backend on a custom host.
const LS_BACKEND_URL = 'mf.backend.url';

/**
 * Default API base for static web builds (e.g. Render static site + separate web service).
 * Set at build time: `VITE_MANGA_FLOW_BACKEND_URL=https://your-api.onrender.com`
 * `localStorage` (`mf.backend.url`) still wins when set (Settings → Backend link).
 */
function getBuildTimeBackendBaseUrl(): string {
  try {
    const v = import.meta.env.VITE_MANGA_FLOW_BACKEND_URL as string | undefined;
    if (typeof v !== 'string') return '';
    const t = v.trim().replace(/\/+$/, '');
    return t;
  } catch {
    return '';
  }
}

export function getStoredBackendUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_BACKEND_URL);
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Avoid duplicate trailing slashes so `${base}${path}` works reliably.
    return trimmed.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function setStoredBackendUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = url.trim();
    const clean = trimmed.replace(/\/+$/, '');
    if (!clean) {
      window.localStorage.removeItem(LS_BACKEND_URL);
      return;
    }
    window.localStorage.setItem(LS_BACKEND_URL, clean);
  } catch {
    // ignore
  }
}

export function getCurrentBackendBaseUrl(): string {
  const stored = getStoredBackendUrl();
  if (stored) return stored;

  const fromEnv = getBuildTimeBackendBaseUrl();
  if (fromEnv) return fromEnv;

  // SSR / native preflight: assume local Node backend during dev.
  if (typeof window === 'undefined') return 'http://localhost:8787';
  // Browser: no stored URL and no build default — Browse must ask for a link (or set env for deploy).
  return '';
}

function getNodeBackendBaseUrl(): string {
  return getCurrentBackendBaseUrl();
}

async function nodeTryGetJson<T>(path: string, timeoutMs = 15000): Promise<T> {
  const base = getNodeBackendBaseUrl();
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? ` - ${text}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

function absolutizeBackendUrl(maybeUrl: string | undefined | null): string {
  if (!maybeUrl) return '';
  if (maybeUrl.startsWith('data:') || maybeUrl.startsWith('blob:')) return maybeUrl;
  if (maybeUrl.startsWith('http://') || maybeUrl.startsWith('https://')) return maybeUrl;
  if (maybeUrl.startsWith('/')) return `${getNodeBackendBaseUrl()}${maybeUrl}`;
  return `${getNodeBackendBaseUrl()}/${maybeUrl}`;
}

function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && !!window.MihonBridge?.request;
}

function bridgeRequest<T>(method: BridgeMethod, params?: unknown): Promise<T> {
  if (!hasNativeBridge()) {
    return Promise.reject(new Error('Native bridge not available'));
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise<T>((resolve, reject) => {
    const prevResolve = window.__mihonBridgeResolve;
    const prevReject = window.__mihonBridgeReject;

    // We keep this simple for now: single in-flight overrides are unlikely in early POC,
    // and we chain to previous handlers to avoid breaking other code if it exists.
    window.__mihonBridgeResolve = (rid: string, payloadJson: string) => {
      try {
        if (rid === id) {
          resolve(JSON.parse(payloadJson) as T);
        } else {
          prevResolve?.(rid, payloadJson);
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        // Restore handlers when we resolve.
        window.__mihonBridgeResolve = prevResolve;
        window.__mihonBridgeReject = prevReject;
      }
    };

    window.__mihonBridgeReject = (rid: string, message: string) => {
      if (rid === id) {
        reject(new Error(message));
        window.__mihonBridgeResolve = prevResolve;
        window.__mihonBridgeReject = prevReject;
      } else {
        prevReject?.(rid, message);
      }
    };

    window.MihonBridge!.request(JSON.stringify({ id, method, params }));
  });
}

const mangaTitles = [
  "Chainsaw Man", "Jujutsu Kaisen", "One Piece", "Spy × Family", "Dandadan",
  "Blue Lock", "Sakamoto Days", "Kaiju No. 8", "My Hero Academia", "Vinland Saga",
  "Berserk", "Vagabond", "Slam Dunk", "Monster", "20th Century Boys",
  "Kingdom", "Tokyo Ghoul", "Attack on Titan", "Demon Slayer", "Naruto",
  "Bleach", "Hunter × Hunter", "Fullmetal Alchemist", "Death Note", "Dragon Ball",
  "One Punch Man", "Mob Psycho 100", "Haikyuu!!", "Dr. Stone", "The Promised Neverland",
  "Black Clover", "Fire Force", "Undead Unluck", "Mashle", "Witch Watch",
  "Elusive Samurai", "Akane-banashi", "Me & Roboco", "Kagurabachi", "Mission: Yozakura Family",
  "Gachiakuta", "Rooster Fighter", "Sousou no Frieren", "Oshi no Ko", "Solo Leveling",
  "Tower of God", "Omniscient Reader", "Nano Machine", "Return of the Mount Hua Sect", "Reaper of the Drifting Moon",
];

const authors = [
  "Tatsuki Fujimoto", "Gege Akutami", "Eiichiro Oda", "Tatsuya Endo",
  "Yukinobu Tatsu", "Muneyuki Kaneshiro", "Yuto Suzuki", "Naoya Matsumoto",
  "Kohei Horikoshi", "Makoto Yukimura", "Kentaro Miura", "Takehiko Inoue",
];

const genres = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
  "Mystery", "Romance", "Sci-Fi", "Seinen", "Shounen", "Slice of Life",
  "Supernatural", "Thriller", "Sports", "Martial Arts", "Isekai", "Mecha",
];

const scanlators = ["TCB Scans", "Flame Scans", "Asura Scans", "Reaper Scans", "Zero Scans"];

const statuses: Manga['status'][] = ['Ongoing', 'Completed', 'Hiatus', 'Cancelled', 'Unknown'];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makeManga(id: string, idx: number): Manga {
  const rand = seededRandom(idx + 42);
  const totalChapters = Math.floor(rand() * 300) + 10;
  const unread = Math.floor(rand() * Math.min(totalChapters, 20));
  const downloaded = Math.floor(rand() * Math.min(totalChapters, 10));
  const daysAgo = Math.floor(rand() * 60);
  return {
    id,
    title: mangaTitles[idx % mangaTitles.length],
    coverUrl: `https://picsum.photos/seed/manga${id}/400/600`,
    author: authors[idx % authors.length],
    artist: rand() > 0.5 ? authors[(idx + 3) % authors.length] : undefined,
    status: statuses[Math.floor(rand() * statuses.length)],
    unreadCount: unread,
    downloadedCount: downloaded,
    totalChapters,
    lastReadChapter: totalChapters - unread,
    lastUpdated: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    inLibrary: false,
    categoryIds: [['all', 'reading', 'plan-to-read', 'completed'][Math.floor(rand() * 4)]],
  };
}

function makeChapter(mangaId: string, num: number, total: number): Chapter {
  const rand = seededRandom(num * 7 + 13);
  const daysAgo = Math.floor((total - num) * 7 * rand());
  return {
    id: `${mangaId}-ch-${num}`,
    mangaId,
    number: num,
    title: rand() > 0.6 ? `Chapter ${num}: The ${['Beginning', 'Awakening', 'Clash', 'Revelation', 'Finale', 'Storm', 'Echo', 'Dawn'][num % 8]}` : `Chapter ${num}`,
    scanlator: scanlators[num % scanlators.length],
    uploadDate: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    read: num < total * 0.7,
    bookmarked: rand() > 0.9,
    downloaded: rand() > 0.8,
    lastPageRead: num < total * 0.7 ? 20 : Math.floor(rand() * 15),
    totalPages: Math.floor(rand() * 15) + 15,
  };
}

// ── Stored state ──
const allManga = Array.from({ length: 60 }, (_, i) => makeManga(String(i), i));

const LS_DOWNLOADED_CHAPTER_IDS = 'mf.downloaded.chapterIds';
const LS_CHAPTER_PAGE_MANIFEST = 'mf.downloaded.chapterPages';
const LS_DOWNLOADED_CHAPTER_META = 'mf.downloaded.chapterMeta';
const LS_DOWNLOAD_QUEUE = 'mf.downloads.queue';
const LS_APP_SETTINGS = 'mf.settings.app';
const PAGE_CACHE_NAME = 'mf-page-cache-v1';
const COVER_CACHE_NAME = 'mf-cover-cache-v1';

/** Blob display URLs keyed by manga; `abs` avoids recreating/revoking when library + details share the same cover. */
type CoverBlobEntry = { blobUrl: string; abs: string };
const coverBlobByMangaId = new Map<string, CoverBlobEntry>();

/** When the cover image changes, revoke the previous blob after a delay (in-flight <img> may still use it). */
function scheduleRevokeObjectURL(url: string | undefined): void {
  if (typeof window === 'undefined' || !url?.startsWith('blob:')) return;
  const u = url;
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }, 5000);
}

function revokeCoverBlobUrl(mangaId: string): void {
  const meta = coverBlobByMangaId.get(mangaId);
  if (meta?.blobUrl.startsWith('blob:')) URL.revokeObjectURL(meta.blobUrl);
  coverBlobByMangaId.delete(mangaId);
}

async function cacheCoverForManga(mangaId: string, coverUrl: string | undefined | null): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const abs = absolutizeBackendUrl(coverUrl);
  if (!abs || abs.startsWith('blob:') || abs.startsWith('data:')) return;
  try {
    const cache = await caches.open(COVER_CACHE_NAME);
    const req = new Request(abs, { mode: 'cors' });
    if (await cache.match(req)) return;
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
  } catch {
    /* CORS / network — skip */
  }
}

async function applyCachedCoverIfAvailable<T extends Manga>(m: T): Promise<T> {
  if (typeof window === 'undefined' || !('caches' in window)) return m;
  const raw = String(m.coverUrl ?? '');
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return m;
  const abs = absolutizeBackendUrl(m.coverUrl);
  if (!abs) return m;

  const existing = coverBlobByMangaId.get(m.id);
  if (existing && existing.abs === abs && existing.blobUrl.startsWith('blob:')) {
    return { ...m, coverUrl: existing.blobUrl };
  }

  try {
    const cache = await caches.open(COVER_CACHE_NAME);
    const res = await cache.match(new Request(abs, { mode: 'cors' }));
    if (!res) return m;
    const prevBlob = existing?.blobUrl;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    coverBlobByMangaId.set(m.id, { blobUrl, abs });
    if (prevBlob?.startsWith('blob:')) scheduleRevokeObjectURL(prevBlob);
    return { ...m, coverUrl: blobUrl };
  } catch {
    return m;
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota/storage errors for now
  }
}

function cacheManga(m: Manga): void {
  upsertManga(m);
  if (!Capacitor.isNativePlatform()) void cacheCoverForManga(m.id, m.coverUrl);
}

function cacheMangaList(list: Manga[]): void {
  if (!list.length) return;
  for (const x of list) cacheManga(x);
}

function sanitizeVizMangaList(list: Manga[]): Manga[] {
  return list.map((m) => {
    const title = String(m.title ?? '').trim();
    const bad = /^read now!?$/i.test(title) || /^free .* chapters!?$/i.test(title);
    if (!bad || !String(m.id).startsWith('vz:')) return m;
    try {
      const raw = decodeURIComponent(String(m.id).replace(/^vz:/, ''));
      const slug = raw.split('/').filter(Boolean).pop() ?? '';
      const pretty = slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      return { ...m, title: pretty || title };
    } catch {
      return m;
    }
  });
}

function isInLibrary(id: string): boolean {
  return getLibraryIds().includes(id);
}

/** API `getMangaDetails` responses omit `categoryIds`; overlay from library cache for the UI. */
function mergeLibraryFieldsFromCache<T extends Manga>(m: T): T {
  if (!isInLibrary(m.id)) return m;
  const cached = getMangaCache()[m.id];
  if (!cached) {
    return { ...m, inLibrary: true };
  }
  const categoryIds =
    Array.isArray(cached.categoryIds) && cached.categoryIds.length > 0
      ? [...cached.categoryIds]
      : Array.isArray(m.categoryIds) && m.categoryIds.length > 0
        ? [...m.categoryIds]
        : Array.isArray(cached.categoryIds)
          ? [...cached.categoryIds]
          : Array.isArray(m.categoryIds)
            ? [...m.categoryIds]
            : [];
  return {
    ...m,
    inLibrary: true,
    categoryIds,
  };
}

/** Longest `id` prefix wins (e.g. mplt: before mpl:). */
const SOURCE_PREFIX_TO_LABEL: Record<string, string> = {
  'arv:': 'ArvenScans',
  'aq:': 'AquaManga',
  'egg:': 'EggpornComics',
  'mh18:': 'Manhua18',
  'mcz:': 'MangaCrazy',
  'mcl:': 'MangaClash',
  'mbd:': 'MangaBuddy',
  'mnt:': 'Manganato',
  'hm2d:': 'HM2D',
  'zzm:': 'ZaZaManga',
  'vnl:': 'VanillaScans',
  'vz:': 'Viz Shonen Jump',
  'rac:': 'ReadAllComics',
  'wbt:': 'Webtoon',
  'fs:': 'FireScans',
  'mds:': 'MadaraScans',
  'mkt:': 'MangaKatana',
  'mfx:': 'MangaFox',
  'hds:': 'Hades Scans',
  'mhp:': 'ManhuaPlus',
  'm18f:': 'Manga18Free',
  'mfk:': 'MangaFreak',
  'msl:': 'MangaSail',
  'mgsp:': 'MangaSpin',
  'mplt:': 'Manga Planet',
  'mpl:': 'MANGA Plus',
  'mdft:': 'MangaDraft',
  'mbal:': 'Manga Ball',
  'flm:': 'Flame Comics',
  'as:': 'AsuraScans',
  'mfr:': 'MangaFire',
  'wc:': 'WeebCentral',
  'ck:': 'ComicK',
  'mp:': 'MangaPill',
};

function librarySourceSortKey(m: Manga): string {
  const s = m.source?.trim();
  if (s) return s;
  const id = m.id;
  let best = '';
  let bestLen = 0;
  for (const [prefix, label] of Object.entries(SOURCE_PREFIX_TO_LABEL)) {
    if (id.startsWith(prefix) && prefix.length > bestLen) {
      best = label;
      bestLen = prefix.length;
    }
  }
  return best;
}

function getDownloadedChapterIds(): string[] {
  return readJson<string[]>(LS_DOWNLOADED_CHAPTER_IDS, []);
}

function setDownloadedChapterIds(ids: string[]): void {
  writeJson(LS_DOWNLOADED_CHAPTER_IDS, Array.from(new Set(ids)));
}

function isChapterDownloaded(id: string): boolean {
  return getDownloadedChapterIds().includes(id);
}

/** Read without async getSettings — used from download pump. */
function getDownloadStoragePreference(): 'device' | 'cloud' {
  const stored = readJson<Partial<AppSettings>>(LS_APP_SETTINGS, {});
  return stored.downloadStorage === 'cloud' ? 'cloud' : 'device';
}

function getChapterPageManifest(): Record<string, string[]> {
  return readJson<Record<string, string[]>>(LS_CHAPTER_PAGE_MANIFEST, {});
}

function setChapterPageManifest(manifest: Record<string, string[]>): void {
  writeJson(LS_CHAPTER_PAGE_MANIFEST, manifest);
}

type DownloadedChapterMeta = {
  manga: Manga;
  chapter: Chapter;
  savedAt: number;
};

function getDownloadedChapterMeta(): Record<string, DownloadedChapterMeta> {
  return readJson<Record<string, DownloadedChapterMeta>>(LS_DOWNLOADED_CHAPTER_META, {});
}

function setDownloadedChapterMeta(meta: Record<string, DownloadedChapterMeta>): void {
  writeJson(LS_DOWNLOADED_CHAPTER_META, meta);
}

type DownloadQueueStatus = 'queued' | 'downloading' | 'paused' | 'error';
type DownloadQueueItem = {
  id: string; // stable download id
  manga: Manga;
  chapter: Chapter;
  progress: number; // 0-100
  status: DownloadQueueStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

let queueLoaded = false;
let queueMem: DownloadQueueItem[] = [];
let queuePumpRunning = false;

function loadQueueOnce(): void {
  if (queueLoaded) return;
  queueLoaded = true;
  queueMem = readJson<DownloadQueueItem[]>(LS_DOWNLOAD_QUEUE, []).map((x) => ({
    ...x,
    progress: Math.min(100, Math.max(0, Number(x.progress ?? 0))),
    status: (x.status as DownloadQueueStatus) || 'queued',
    createdAt: Number(x.createdAt ?? Date.now()),
    updatedAt: Number(x.updatedAt ?? Date.now()),
  }));
}

function persistQueue(): void {
  writeJson(LS_DOWNLOAD_QUEUE, queueMem);
}

function getQueueItem(id: string): DownloadQueueItem | undefined {
  loadQueueOnce();
  return queueMem.find((q) => q.id === id);
}

function upsertQueueItem(item: DownloadQueueItem): void {
  loadQueueOnce();
  const i = queueMem.findIndex((q) => q.id === item.id);
  if (i >= 0) queueMem[i] = item;
  else queueMem.unshift(item);
  persistQueue();
}

function removeQueueItem(id: string): void {
  loadQueueOnce();
  queueMem = queueMem.filter((q) => q.id !== id);
  persistQueue();
}

function listQueueItems(): DownloadQueueItem[] {
  loadQueueOnce();
  return queueMem;
}

async function downloadQueuePump(getPages: (chapterId: string) => Promise<Page[]>): Promise<void> {
  if (queuePumpRunning) return;
  queuePumpRunning = true;
  try {
    while (true) {
      loadQueueOnce();
      const next = queueMem.find((q) => q.status === 'queued');
      if (!next) return;

      // mark downloading
      const startItem: DownloadQueueItem = { ...next, status: 'downloading', error: undefined, updatedAt: Date.now() };
      upsertQueueItem(startItem);
      cacheManga({ ...startItem.manga, inLibrary: isInLibrary(startItem.manga.id) });

      try {
        const pages = await getPages(startItem.chapter.id);
        const normalizedPageUrls = pages.map((p) => absolutizeBackendUrl(p.url)).filter(Boolean);
        if (!normalizedPageUrls.length) throw new Error('No pages found');

        // Save manifest early (so offline reader can discover once cached)
        const manifest = getChapterPageManifest();
        manifest[startItem.chapter.id] = normalizedPageUrls;
        setChapterPageManifest(manifest);

        const storeImages = getDownloadStoragePreference() === 'device';
        if (storeImages) {
          for (let i = 0; i < normalizedPageUrls.length; i += 1) {
            // Check WiFi requirement again mid-download in case of network change
            const canProceed = await Backend.checkWifiRequirement({ silent: true });
            if (!canProceed) {
              const current = getQueueItem(startItem.id);
              if (current) upsertQueueItem({ ...current, status: 'paused', updatedAt: Date.now() });
              throw new Error('__PAUSED__');
            }

            const current = getQueueItem(startItem.id);
            if (!current) throw new Error('Download removed');
            if (current.status === 'paused') throw new Error('__PAUSED__');
            await cachePageUrl(normalizedPageUrls[i]);
            const pct = Math.round(((i + 1) / normalizedPageUrls.length) * 100);
            upsertQueueItem({ ...current, status: 'downloading', progress: pct, updatedAt: Date.now() });
          }
        } else {
          const current = getQueueItem(startItem.id);
          if (current) {
            upsertQueueItem({ ...current, status: 'downloading', progress: 100, updatedAt: Date.now() });
          }
        }

        // Mark as downloaded
        const ids = getDownloadedChapterIds();
        setDownloadedChapterIds([...ids, startItem.chapter.id]);
        const meta = getDownloadedChapterMeta();
        meta[startItem.chapter.id] = { manga: startItem.manga, chapter: startItem.chapter, savedAt: Date.now() };
        setDownloadedChapterMeta(meta);
        const doneItem = { ...(getQueueItem(startItem.id) ?? startItem), status: 'paused' as const, progress: 100, updatedAt: Date.now() };
        upsertQueueItem(doneItem);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === '__PAUSED__') {
          // Leave item paused, keep progress
          const cur = getQueueItem(startItem.id);
          if (cur) upsertQueueItem({ ...cur, status: 'paused', updatedAt: Date.now() });
          continue;
        }
        const cur = getQueueItem(startItem.id);
        if (cur) upsertQueueItem({ ...cur, status: 'error', error: msg, updatedAt: Date.now() });
      }
    }
  } finally {
    queuePumpRunning = false;
  }
}

async function removeCachedChapterPages(chapterId: string): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const manifest = getChapterPageManifest();
  const urls = manifest[chapterId] ?? [];
  if (!urls.length) return;
  const cache = await window.caches.open(PAGE_CACHE_NAME);
  for (const url of urls) {
    await cache.delete(url);
  }
}

async function cachePageUrl(url: string): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const cache = await window.caches.open(PAGE_CACHE_NAME);
  const req = new Request(url, { mode: 'cors' });
  const existing = await cache.match(req);
  if (existing) return;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
  }
}

async function getOfflineChapterPages(chapterId: string): Promise<Page[]> {
  if (typeof window === 'undefined' || !('caches' in window)) return [];
  const manifest = getChapterPageManifest();
  const urls = manifest[chapterId] ?? [];
  if (!urls.length) return [];
  const cache = await window.caches.open(PAGE_CACHE_NAME);
  const pages: Page[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const req = new Request(urls[i], { mode: 'cors' });
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    pages.push({ index: i, url: objectUrl });
  }
  return pages;
}

// ── API Implementation ──

/** Ignore placeholder `all` from browse/API; empty legacy rows still match Reading. */
function libraryTabCategoryIds(m: Manga): string[] {
  const raw = Array.isArray(m.categoryIds) ? m.categoryIds : [];
  const noAll = raw.filter(id => id && String(id) !== 'all');
  if (noAll.length > 0) return noAll;
  return ['reading'];
}

/**
 * When removing from library: delete cloud `library_items` + `reading_progress` first so
 * `pullCloudIntoLocal` cannot merge the title back in (mergeLibraryWithCloud unions local + cloud ids).
 */
async function purgeCloudWhenRemovingFromLibrary(mangaId: string): Promise<void> {
  if (!mangaId || !supabaseConfigured()) return;
  if (!useStore.getState().profileSyncEnabled) return;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.user?.id) return;
  await deleteCloudLibraryItem(session, mangaId);
  await initReadProgressPersistence();
  const chapterIds = Object.entries(getAllProgressRows())
    .filter(([, row]) => row.mangaId === mangaId)
    .map(([chapterId]) => chapterId);
  await deleteCloudReadingProgressChapters(session, chapterIds);
  await deleteCloudReadingProgressForManga(session, mangaId);
}

export const Backend = {
  async enrichMangaWithAniList(manga: MangaDetails): Promise<MangaDetails> {
    try {
      let alManga = null;
      if (manga.anilistId) {
        alManga = await fetchAniListDetails(manga.anilistId);
      } else {
        // Only auto-search if not already searched or if it's a library manga
        alManga = await searchAniList(manga.title);
      }

      if (alManga) {
        const originalTitle = manga.title;
        const englishTitle = alManga.title.english || alManga.title.romaji;
        
        if (englishTitle && englishTitle.toLowerCase() !== originalTitle.toLowerCase()) {
          manga.title = englishTitle;
        }

        manga.anilistId = alManga.id;
        if (alManga.chapters) {
          manga.anilistLastCount = alManga.chapters;
        }
        
        const alTags = [
          originalTitle,
          alManga.title.english,
          alManga.title.romaji,
          alManga.title.native,
          ...(alManga.synonyms || [])
        ].filter((t): t is string => !!t && t.toLowerCase() !== manga.title.toLowerCase());

        const existing = new Set((manga.altTitles || []).map(t => t.toLowerCase()));
        const newAltTitles = [...(manga.altTitles || [])];
        
        alTags.forEach(t => {
          if (!existing.has(t.toLowerCase())) {
            existing.add(t.toLowerCase());
            newAltTitles.push(t);
          }
        });
        
        manga.altTitles = newAltTitles;
        
        if (alManga.bannerImage) {
          manga.bannerUrl = alManga.bannerImage;
        }
        if (alManga.averageScore) {
          manga.averageScore = alManga.averageScore;
        }

        // Persist updates to the library cache
        if (manga.inLibrary) {
          upsertManga(manga);
        }
      }
    } catch (err) {
      console.error('Failed to enrich with AniList:', err);
    }
    return manga;
  },

  async isMangaUpToDate(manga: Manga): Promise<boolean> {
    if (!manga.anilistId || manga.anilistLastCount === undefined) return false;
    try {
      const al = await fetchAniListDetails(manga.anilistId);
      if (al && al.chapters !== null && al.chapters <= manga.anilistLastCount && al.status !== 'FINISHED') {
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  },

  updateAnilistLastCount(mangaId: string, chapters: Chapter[]) {
    const cache = getMangaCache();
    const m = cache[mangaId];
    if (m && m.anilistId) {
      const max = Math.max(...chapters.map(c => c.number), 0);
      if (max > (m.anilistLastCount || 0)) {
        m.anilistLastCount = max;
        upsertManga(m);
      }
    }
  },

  // Library
  async getLibrarySections(): Promise<LibrarySection[]> {
    if (hasNativeBridge()) {
      try {
        return await bridgeRequest<LibrarySection[]>('getLibrarySections');
      } catch {
        // fall back to mocks
      }
    }
    await delay(200);
    return [
      { id: 'all', name: 'All', order: 0 },
      { id: 'reading', name: 'Reading', order: 1 },
      { id: 'plan-to-read', name: 'Plan to Read', order: 2 },
      { id: 'completed', name: 'Completed', order: 3 },
    ];
  },

  async getLibraryManga(params: { sectionId?: string; query?: string; filter?: LibraryFilter; sort?: Sort }): Promise<Manga[]> {
    if (hasNativeBridge()) {
      try {
        return await bridgeRequest<Manga[]>('getLibraryManga', params);
      } catch {
        // fall back to mocks
      }
    }
    await delay();
    const libraryIds = getLibraryIds();
    const cache = getMangaCache();
    const cachedLibrary = libraryIds.map(id => cache[id]).filter(Boolean);
    let result = [...cachedLibrary]
      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i);
    if (params.sectionId && params.sectionId !== 'all') {
      const sid = params.sectionId;
      result = result.filter(m => libraryTabCategoryIds(m).includes(sid));
    }
    if (params.query) {
      const q = params.query.toLowerCase();
      result = result.filter(m =>
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.author ?? '').toLowerCase().includes(q),
      );
    }
    if (params.filter) {
      const act = params.filter.activity ?? 'all';
      if (act === 'read') result = result.filter(m => (m.lastReadChapter ?? 0) > 0);
      else if (act === 'unread') result = result.filter(m => m.unreadCount > 0);
      else if (act === 'downloaded') result = result.filter(m => m.downloadedCount > 0);

      const st = params.filter.mangaStatus ?? 'all';
      if (st !== 'all') result = result.filter(m => m.status === st);
    }
    if (params.sort && params.sort.field !== 'none') {
      const dir = params.sort.direction === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        switch (params.sort!.field) {
          case 'title': return dir * a.title.localeCompare(b.title);
          case 'author': return dir * a.author.localeCompare(b.author);
          case 'totalChapters': return dir * (a.totalChapters - b.totalChapters);
          case 'source': return dir * librarySourceSortKey(a).localeCompare(librarySourceSortKey(b));
          default: return 0;
        }
      });
    }
    return Promise.all(result.map(m => applyCachedCoverToManga(m)));
  },

  async getMangaDetails(mangaId: string): Promise<MangaDetails> {
    const details = await this._getMangaDetailsRaw(mangaId);
    if (details.description) {
      details.description = stripHtml(details.description);
    }
    return this.enrichMangaWithAniList(details);
  },

  async _getMangaDetailsRaw(mangaId: string): Promise<MangaDetails> {
    if (mangaId.startsWith('arv:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/arvenscans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'ArvenScans', url: '' } as MangaDetails;
        throw new Error('ArvenScans details unavailable');
      }
    }
    if (mangaId.startsWith('aq:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/aquamanga/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'AquaManga', url: '' } as MangaDetails;
        throw new Error('AquaManga details unavailable');
      }
    }
    if (mangaId.startsWith('egg:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/eggporncomics/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'EggpornComics', url: '' } as MangaDetails;
        throw new Error('EggpornComics details unavailable');
      }
    }
    if (mangaId.startsWith('mh18:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/manhua18/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'Manhua18', url: '' } as MangaDetails;
        throw new Error('Manhua18 details unavailable');
      }
    }
    if (mangaId.startsWith('mcz:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangacrazy/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MangaCrazy', url: '' } as MangaDetails;
        throw new Error('MangaCrazy details unavailable');
      }
    }
    if (mangaId.startsWith('mcl:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangaclash/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MangaClash', url: '' } as MangaDetails;
        throw new Error('MangaClash details unavailable');
      }
    }
    if (mangaId.startsWith('mbd:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangabuddy/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MangaBuddy', url: '' } as MangaDetails;
        throw new Error('MangaBuddy details unavailable');
      }
    }
    if (mangaId.startsWith('mnt:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/manganato/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'Manganato', url: '' } as MangaDetails;
        throw new Error('Manganato details unavailable');
      }
    }
    if (mangaId.startsWith('hm2d:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/hm2d/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'HM2D', url: '', altTitles: [`The Legendary ${cached.title}`, `Alternative ${cached.title}`] } as MangaDetails;
        throw new Error('HM2D details unavailable');
      }
    }
    if (mangaId.startsWith('zzm:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/zazamanga/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'ZaZaManga', url: '' } as MangaDetails;
        throw new Error('ZaZaManga details unavailable');
      }
    }
    if (mangaId.startsWith('vnl:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/vanillascans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'VanillaScans', url: '' } as MangaDetails;
        throw new Error('VanillaScans details unavailable');
      }
    }
    if (mangaId.startsWith('vz:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/vizshonenjump/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'Viz Shonen Jump', url: '' } as MangaDetails;
        throw new Error('Viz Shonen Jump details unavailable');
      }
    }
    if (mangaId.startsWith('rac:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/readallcomics/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'ReadAllComics', url: '' } as MangaDetails;
        throw new Error('ReadAllComics details unavailable');
      }
    }
    if (mangaId.startsWith('wbt:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/webtoon/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'Webtoon', url: '' } as MangaDetails;
        throw new Error('Webtoon details unavailable');
      }
    }
    if (mangaId.startsWith('fs:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/firescans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'FireScans', url: '' } as MangaDetails;
        throw new Error('FireScans details unavailable');
      }
    }
    if (mangaId.startsWith('mds:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/madarascans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MadaraScans', url: '' } as MangaDetails;
        throw new Error('MadaraScans details unavailable');
      }
    }
    if (mangaId.startsWith('mkt:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangakatana/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MangaKatana', url: '' } as MangaDetails;
        throw new Error('MangaKatana details unavailable');
      }
    }
    if (mangaId.startsWith('mfx:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangafox/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) return { ...cached, description: '', genres: [], source: 'MangaFox', url: '' } as MangaDetails;
        throw new Error('MangaFox details unavailable');
      }
    }
    if (mangaId.startsWith('hds:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/hadesscans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'Hades Scans',
            url: '',
          } as MangaDetails;
        }
        throw new Error('Hades Scans details unavailable');
      }
    }
    if (mangaId.startsWith('mhp:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/manhuaplus/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return { ...cached, description: '', genres: [], source: 'ManhuaPlus', url: '' } as MangaDetails;
        }
        throw new Error('ManhuaPlus details unavailable');
      }
    }
    if (mangaId.startsWith('m18f:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/manga18free/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return { ...cached, description: '', genres: [], source: 'Manga18Free', url: '' } as MangaDetails;
        }
        throw new Error('Manga18Free details unavailable');
      }
    }
    if (mangaId.startsWith('mfk:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangafreak/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'MangaFreak',
            url: '',
          } as MangaDetails;
        }
        throw new Error('MangaFreak details unavailable');
      }
    }
    if (mangaId.startsWith('msl:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangasail/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return { ...cached, description: '', genres: [], source: 'MangaSail', url: '' } as MangaDetails;
        }
        throw new Error('MangaSail details unavailable');
      }
    }
    if (mangaId.startsWith('mgsp:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangaspin/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return { ...cached, description: '', genres: [], source: 'MangaSpin', url: '' } as MangaDetails;
        }
        throw new Error('MangaSpin details unavailable');
      }
    }
    if (mangaId.startsWith('mplt:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangaplanet/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return { ...cached, description: '', genres: [], source: 'Manga Planet', url: '' } as MangaDetails;
        }
        throw new Error('Manga Planet details unavailable');
      }
    }
    if (mangaId.startsWith('mpl:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangaplus/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        throw new Error('MANGA Plus details unavailable');
      }
    }
    if (mangaId.startsWith('mdft:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangadraft/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        throw new Error('MangaDraft details unavailable');
      }
    }
    if (mangaId.startsWith('mbal:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangaball/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        throw new Error('Manga Ball details unavailable');
      }
    }
    if (mangaId.startsWith('flm:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/flamecomics/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        throw new Error('Flame Comics details unavailable');
      }
    }
    if (mangaId.startsWith('as:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/asurascans/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'AsuraScans',
            url: '',
          } as MangaDetails;
        }
        throw new Error('AsuraScans details unavailable');
      }
    }
    if (mangaId.startsWith('mfr:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangafire/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'MangaFire',
            url: '',
          } as MangaDetails;
        }
        throw new Error('MangaFire details unavailable');
      }
    }
    if (mangaId.startsWith('wc:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/weebcentral/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'WeebCentral',
            url: '',
          } as MangaDetails;
        }
        throw new Error('WeebCentral details unavailable');
      }
    }
    if (mangaId.startsWith('ck:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/comick/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        const cache = getMangaCache();
        const cached = cache[mangaId];
        if (cached) {
          return {
            ...cached,
            description: '',
            genres: [],
            source: 'ComicK',
            url: '',
          } as MangaDetails;
        }
        throw new Error('ComicK details unavailable');
      }
    }
    if (mangaId.startsWith('mp:')) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangapill/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        // fall back to mocks
      }
    }
    if (!/^\d+$/.test(mangaId)) {
      try {
        const details = await nodeTryGetJson<MangaDetails>(`/api/mangahere/manga/${encodeURIComponent(mangaId)}`);
        details.coverUrl = absolutizeBackendUrl(details.coverUrl);
        details.inLibrary = isInLibrary(details.id);
        cacheManga(details);
        return details;
      } catch {
        // fall back to mocks
      }
    }
    await delay(300);
    const m = allManga.find(m => m.id === mangaId) ?? makeManga(mangaId, parseInt(mangaId) || 0);
    const rand = seededRandom(parseInt(mangaId) || 0);
    const genreCount = Math.floor(rand() * 4) + 2;
    const selectedGenres = genres.sort(() => rand() - 0.5).slice(0, genreCount);
    return {
      ...m,
      description: `In a world where extraordinary powers determine one's fate, our protagonist embarks on a journey that will challenge everything they know. With breathtaking action sequences and deep character development, ${m.title} has captivated millions of readers worldwide. Follow the story as alliances form, enemies emerge, and the true nature of power is revealed.`,
      genres: selectedGenres,
      source: 'Online',
      url: '',
    };
  },

  async getMangaChapters(mangaId: string, params: { filter?: ChapterFilter; sort?: Sort }): Promise<Chapter[]> {
    const result = await (async (): Promise<Chapter[]> => {
    if (mangaId.startsWith('arv:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/arvenscans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('aq:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/aquamanga/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('egg:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/eggporncomics/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mh18:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/manhua18/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mcz:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangacrazy/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mcl:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangaclash/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mbd:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangabuddy/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mnt:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/manganato/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('hm2d:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/hm2d/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('zzm:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/zazamanga/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('vnl:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/vanillascans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('vz:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/vizshonenjump/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('rac:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/readallcomics/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('wbt:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/webtoon/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('fs:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/firescans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mds:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/madarascans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mkt:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangakatana/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('mfx:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangafox/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => params.sort?.field === 'uploadDate'
          ? dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
          : dir * (a.number - b.number));
        return chapters;
      } catch { return []; }
    }
    if (mangaId.startsWith('hds:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/hadesscans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mhp:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/manhuaplus/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('m18f:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/manga18free/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mfk:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangafreak/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('msl:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangasail/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mgsp:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangaspin/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mplt:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangaplanet/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mpl:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangaplus/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mdft:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangadraft/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mbal:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangaball/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('flm:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/flamecomics/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('as:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/asurascans/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mfr:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangafire/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('wc:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/weebcentral/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('ck:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/comick/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        return [];
      }
    }
    if (mangaId.startsWith('mp:')) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangapill/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        // fall back to mocks
      }
    }
    if (!/^\d+$/.test(mangaId)) {
      try {
        let chapters = await nodeTryGetJson<Chapter[]>(`/api/mangahere/manga/${encodeURIComponent(mangaId)}/chapters`);
        chapters = chapters.map(ch => ({ ...ch, downloaded: isChapterDownloaded(ch.id) }));
        if (params.filter) {
          if (params.filter.unread) chapters = chapters.filter(c => !c.read);
          if (params.filter.read) chapters = chapters.filter(c => c.read);
          if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
        }
        const dir = params.sort?.direction === 'asc' ? 1 : -1;
        chapters.sort((a, b) => {
          if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
          return dir * (a.number - b.number);
        });
        return chapters;
      } catch {
        // fall back to mocks
      }
    }
    await delay(300);
    const manga = allManga.find(m => m.id === mangaId);
    const total = manga?.totalChapters ?? 50;
    let chapters = Array.from({ length: total }, (_, i) => makeChapter(mangaId, i + 1, total));
    if (params.filter) {
      if (params.filter.unread) chapters = chapters.filter(c => !c.read);
      if (params.filter.read) chapters = chapters.filter(c => c.read);
      if (params.filter.downloaded) chapters = chapters.filter(c => c.downloaded);
    }
    const dir = params.sort?.direction === 'asc' ? 1 : -1;
    chapters.sort((a, b) => {
      if (params.sort?.field === 'uploadDate') return dir * (new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime());
      return dir * (a.number - b.number);
    });
    return chapters;
    })();
    const withMangaId = result.map(ch => ({ ...ch, mangaId: ch.mangaId || mangaId }));
    const titled = mapChaptersDisplayTitles(withMangaId);
    let withProgress = applyReadingProgressToChapters(titled, mangaId);
    let withBookmarks = applyChapterBookmarksToChapters(withProgress);
    if (params.filter) {
      if (params.filter.unread) withBookmarks = withBookmarks.filter(c => !c.read);
      if (params.filter.read) withBookmarks = withBookmarks.filter(c => c.read);
      if (params.filter.bookmarked) withBookmarks = withBookmarks.filter(c => c.bookmarked);
    }
    return withBookmarks;
  },

  async setChapterBookmarked(chapterId: string, bookmarked: boolean): Promise<void> {
    await persistChapterBookmark(chapterId, bookmarked);
  },

  async toggleMangaFavorite(
    mangaId: string,
    favorite: boolean,
    options?: { categoryIds?: string[] },
  ): Promise<void> {
    await delay(200);
    const m = allManga.find(x => x.id === mangaId);
    if (m) m.inLibrary = favorite;
    const ids = getLibraryIds();
    if (favorite) {
      const cats =
        options?.categoryIds?.length ? [...new Set(options.categoryIds)] : ['reading'];
      setLibraryIds([...new Set([...ids, mangaId])]);
      const cached = getMangaCache()[mangaId];
      const base = cached ?? m;
      if (base) cacheManga({ ...base, inLibrary: true, categoryIds: cats });
      if (m) {
        m.inLibrary = true;
        m.categoryIds = cats;
      }
    } else {
      await purgeCloudWhenRemovingFromLibrary(mangaId);
      await clearAllReadingProgressForManga(mangaId);
      setLibraryIds(ids.filter(id => id !== mangaId));
      revokeCoverBlobUrl(mangaId);
      const cachedOff = getMangaCache()[mangaId];
      if (Capacitor.isNativePlatform()) {
        removeMangaFromLibraryStore(mangaId);
      } else if (cachedOff) {
        cacheManga({ ...cachedOff, inLibrary: false });
      }
    }
  },

  async setMangaCategories(mangaId: string, categoryIds: string[]): Promise<void> {
    await delay(150);
    const unique = [...new Set(categoryIds.filter(Boolean))];
    const cached = getMangaCache()[mangaId];
    if (cached) cacheManga({ ...cached, categoryIds: unique.length ? unique : ['reading'] });
    const mock = allManga.find(x => x.id === mangaId);
    if (mock) mock.categoryIds = unique.length ? unique : ['reading'];
  },

  // Reader
  async getChapterPages(chapterId: string): Promise<Page[]> {
    const tryOffline = async () => {
      if (!isChapterDownloaded(chapterId)) return [] as Page[];
      return getOfflineChapterPages(chapterId);
    };
    if (chapterId.startsWith('arvch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/arvenscans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('aqch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/aquamanga/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('eggch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/eggporncomics/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mh18ch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/manhua18/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mczch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangacrazy/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mclch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangaclash/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mntch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/manganato/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('fsch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/firescans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mdsch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/madarascans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mktch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangakatana/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('mfxch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangafox/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch { return await tryOffline(); }
    }
    if (chapterId.startsWith('hdsch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/hadesscans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mhpch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/manhuaplus/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('m18fch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/manga18free/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mfkch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangafreak/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mslch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangasail/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mpltch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangaplanet/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mplch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangaplus/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mdftch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangadraft/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mbalch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangaball/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('flmch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/flamecomics/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('asch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/asurascans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('ckch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/comick/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mfrch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangafire/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mbdch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangabuddy/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('hm2dch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/hm2d/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('zzmch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/zazamanga/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('vnlch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/vanillascans/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('vzch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/vizshonenjump/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('racch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/readallcomics/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('wbtch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/webtoon/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('wcch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/weebcentral/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (chapterId.startsWith('mpch:')) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangapill/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    for (const site of MAD_THEME_CHAPTER_ROUTES) {
      if (!chapterId.startsWith(`${site.chapterPrefix}:`)) continue;
      try {
        const pages = await nodeTryGetJson<Page[]>(
          `/api/${site.route}/chapter/${encodeURIComponent(chapterId)}/pages`,
        );
        pages.forEach(p => {
          p.url = absolutizeBackendUrl(p.url);
        });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    if (!/^\d+$/.test(chapterId)) {
      try {
        const pages = await nodeTryGetJson<Page[]>(`/api/mangahere/chapter/${encodeURIComponent(chapterId)}/pages`);
        pages.forEach(p => { p.url = absolutizeBackendUrl(p.url); });
        return pages;
      } catch {
        return await tryOffline();
      }
    }
    await delay(500);
    const pageCount = Math.floor(Math.random() * 10) + 15;
    return Array.from({ length: pageCount }, (_, i) => ({
      index: i,
      url: `https://picsum.photos/seed/${chapterId}-p${i}/800/1200`,
    }));
  },

  async downloadChapterLocally(
    params: { manga: Manga; chapter: Chapter; pages: Page[] },
    options?: { exportFile?: boolean },
  ): Promise<void> {
    const exportFile = options?.exportFile ?? false;
    const normalizedPageUrls = params.pages.map(p => absolutizeBackendUrl(p.url));

    // Persist chapter->page mapping for offline retrieval.
    const manifest = getChapterPageManifest();
    manifest[params.chapter.id] = normalizedPageUrls;
    setChapterPageManifest(manifest);

    // Cache actual image responses for offline reading (device mode only).
    if (getDownloadStoragePreference() === 'device') {
      for (const pageUrl of normalizedPageUrls) {
        await cachePageUrl(pageUrl);
      }
    }

    const ids = getDownloadedChapterIds();
    setDownloadedChapterIds([...ids, params.chapter.id]);
    const meta = getDownloadedChapterMeta();
    meta[params.chapter.id] = { manga: params.manga, chapter: params.chapter, savedAt: Date.now() };
    setDownloadedChapterMeta(meta);
    cacheManga({ ...params.manga, inLibrary: isInLibrary(params.manga.id) });

    // Optional export artifact; disabled by default.
    if (exportFile && typeof window !== 'undefined') {
      const payload = {
        mangaId: params.manga.id,
        mangaTitle: params.manga.title,
        chapterId: params.chapter.id,
        chapterTitle: params.chapter.title,
        downloadedAt: new Date().toISOString(),
        pageCount: normalizedPageUrls.length,
        pages: normalizedPageUrls,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = `${params.manga.title}-${params.chapter.title}`.replace(/[^\w.-]+/g, '_');
      a.href = url;
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  },

  /** Check if we are on Wi-Fi if the setting is enabled. Returns true if we can proceed. */
  async checkWifiRequirement(options?: { silent?: boolean }): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return true;
    const settings = await this.getSettings();
    if (!settings.downloadWifiOnly) return true;

    const status = await Network.getStatus();
    if (status.connected && status.connectionType !== 'wifi') {
      if (!options?.silent) {
        toast({
          title: "Wi-Fi Only Enabled",
          description: "Please connect to Wi-Fi to start downloading chapters.",
        });
      }
      return false;
    }
    return true;
  },

  /** Enqueue a chapter for background download with pause/resume. */
  async enqueueChapterDownload(params: { manga: Manga; chapter: Chapter }): Promise<void> {
    const canDownload = await this.checkWifiRequirement();
    if (!canDownload) return;

    loadQueueOnce();
    const id = `q:${params.chapter.id}`;
    const existing = getQueueItem(id);
    const now = Date.now();
    if (existing) {
      // If previously errored/paused, requeue.
      upsertQueueItem({ ...existing, status: 'queued', error: undefined, updatedAt: now });
    } else {
      upsertQueueItem({
        id,
        manga: params.manga,
        chapter: params.chapter,
        progress: 0,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
    }
    void downloadQueuePump((chapterId) => Backend.getChapterPages(chapterId));
  },

  async pauseDownload(downloadId: string): Promise<void> {
    const it = getQueueItem(downloadId);
    if (!it) return;
    if (it.status === 'downloading' || it.status === 'queued') {
      upsertQueueItem({ ...it, status: 'paused', updatedAt: Date.now() });
    }
  },

  async resumeDownload(downloadId: string): Promise<void> {
    const canDownload = await this.checkWifiRequirement();
    if (!canDownload) return;

    const it = getQueueItem(downloadId);
    if (!it) return;
    if (it.status === 'paused' || it.status === 'error') {
      upsertQueueItem({ ...it, status: 'queued', error: undefined, updatedAt: Date.now() });
      void downloadQueuePump((chapterId) => Backend.getChapterPages(chapterId));
    }
  },

  async deleteDownloadedChapter(chapterId: string): Promise<void> {
    await removeCachedChapterPages(chapterId);

    const manifest = getChapterPageManifest();
    delete manifest[chapterId];
    setChapterPageManifest(manifest);

    const ids = getDownloadedChapterIds();
    setDownloadedChapterIds(ids.filter((id) => id !== chapterId));

    const meta = getDownloadedChapterMeta();
    if (meta[chapterId]) {
      delete meta[chapterId];
      setDownloadedChapterMeta(meta);
    }
  },

  async saveReaderProgress(params: SaveReaderProgressInput): Promise<void> {
    await saveReaderProgressToStore(params);
    
    // Auto-delete after read check
    const finished = params.pageIndex + 1 >= params.totalPages;
    if (finished && isChapterDownloaded(params.chapterId)) {
      const settings = await this.getSettings();
      if (settings.deleteAfterRead) {
        await this.deleteDownloadedChapter(params.chapterId);
        toast({
          title: "Chapter Deleted",
          description: `Finished reading ${params.chapterTitle || 'chapter'}, offline copy removed.`,
        });
      }
    }
  },

  async markChapterRead(chapterId: string, read: boolean): Promise<void> {
    await markChapterReadInStore(chapterId, read);
  },

  async getReaderSettings(): Promise<ReaderSettings> {
    await delay(100);
    return {
      direction: 'ltr',
      continuousVertical: false,
      keepScreenOn: true,
      backgroundColor: '#000000',
      imageScaling: 'fit',
      brightnessLock: false,
      brightness: 1,
    };
  },

  async setReaderSettings(settings: Partial<ReaderSettings>): Promise<void> {
    await delay(100);
  },

  // Browse / Sources
  async getSources(): Promise<Source[]> {
    // Fully delegated to backend. Try `/api/sources` first (recommended),
    // then fall back to `/sources` for backends that expose a flat route.
    let list: Source[];
    try {
      list = await nodeTryGetJson<Source[]>('/api/sources');
    } catch {
      list = await nodeTryGetJson<Source[]>('/sources');
    }
    return list.map(s => {
      const raw = String(s.iconUrl ?? '');
      let icon = raw;
      // Remote icons (http/https) should go through backend base URL handling.
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        icon = absolutizeBackendUrl(raw);
      }
      // Paths starting with `/` are treated as front-end public assets and left as-is
      // so they resolve against the React app origin (e.g. `/mangaplus-logo.png`).
      return {
        ...s,
        iconUrl: icon,
      };
    });
  },

  async searchSource(params: { sourceId: string; query: string; filters?: SourceFilter[]; page?: number }): Promise<MangaPage> {
    if (params.sourceId === 'arvenscans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/arvenscans/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'aquamanga') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/aquamanga/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'eggporncomics') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/eggporncomics/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'manhua18') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/manhua18/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangacrazy') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/mangacrazy/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangaclash') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaclash/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangabuddy') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/mangabuddy/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'manganato') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/manganato/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'hm2d') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/hm2d/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'zazamanga') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/zazamanga/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'vanillascans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/vanillascans/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'vizshonenjump') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/vizshonenjump/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga = sanitizeVizMangaList(result.manga);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'readallcomics') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/readallcomics/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'webtoon') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/webtoon/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'firescans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/firescans/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'madarascans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/madarascans/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangakatana') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/mangakatana/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangafox') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafox/search?query=${encodeURIComponent(params.query)}&page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'hadesscans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/hadesscans/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall through
      }
    }
    if (params.sourceId === 'manhuaplus') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/manhuaplus/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'manga18free') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/manga18free/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangafreak') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangafreak/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'mangasail') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangasail/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangaspin') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangaspin/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangaplanet') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangaplanet/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangaplus') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangaplus/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangadraft') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangadraft/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'mangaball') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangaball/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'flamecomics') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/flamecomics/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (params.sourceId === 'asurascans') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/asurascans/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'comick') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/comick/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'mangafire') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangafire/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'weebcentral') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/weebcentral/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'mangapill') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangapill/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (params.sourceId === 'mangahere') {
      try {
        const page = params.page ?? 1;
        const result = await nodeTryGetJson<MangaPage>(
          `/api/mangahere/search?query=${encodeURIComponent(params.query)}&page=${page}`,
        );
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    await delay(600);
    const page = params.page ?? 1;
    const results = allManga
      .filter(m => m.title.toLowerCase().includes(params.query.toLowerCase()))
      .map(m => ({ ...m, inLibrary: Math.random() > 0.5 }))
      .slice((page - 1) * 20, page * 20);
    return { manga: results, hasNextPage: results.length === 20, page };
  },

  async getSourcePopular(sourceId: string, page = 1): Promise<MangaPage> {
    if (sourceId === 'arvenscans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/arvenscans/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'aquamanga') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/aquamanga/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'eggporncomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/eggporncomics/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'manhua18') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manhua18/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangacrazy') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangacrazy/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangaclash') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaclash/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangabuddy') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangabuddy/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'manganato') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manganato/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'hm2d') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/hm2d/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'zazamanga') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/zazamanga/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'vanillascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/vanillascans/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'vizshonenjump') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/vizshonenjump/popular?page=${page}`);
        result.manga = sanitizeVizMangaList(result.manga);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'readallcomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/readallcomics/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'webtoon') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/webtoon/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'firescans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/firescans/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'madarascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/madarascans/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangakatana') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangakatana/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangafox') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafox/popular?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'hadesscans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/hadesscans/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall through
      }
    }
    if (sourceId === 'manhuaplus') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manhuaplus/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'manga18free') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manga18free/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangafreak') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafreak/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangasail') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangasail/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaspin') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaspin/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaplanet') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaplanet/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaplus') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaplus/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangadraft') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangadraft/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaball') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaball/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'flamecomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/flamecomics/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'asurascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/asurascans/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'comick') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/comick/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangafire') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafire/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'weebcentral') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/weebcentral/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangapill') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangapill/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangahere') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangahere/popular?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    await delay(500);
    const start = (page - 1) * 20;
    const items = allManga.slice(start, start + 20).map(m => ({ ...m, inLibrary: Math.random() > 0.6 }));
    return { manga: items, hasNextPage: start + 20 < allManga.length, page };
  },

  async getSourceLatest(sourceId: string, page = 1): Promise<MangaPage> {
    if (sourceId === 'arvenscans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/arvenscans/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'aquamanga') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/aquamanga/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'eggporncomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/eggporncomics/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'manhua18') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manhua18/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangacrazy') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangacrazy/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangaclash') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaclash/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangabuddy') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangabuddy/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'manganato') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manganato/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'hm2d') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/hm2d/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'zazamanga') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/zazamanga/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'vanillascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/vanillascans/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'vizshonenjump') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/vizshonenjump/latest?page=${page}`);
        result.manga = sanitizeVizMangaList(result.manga);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'readallcomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/readallcomics/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'webtoon') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/webtoon/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'firescans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/firescans/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'madarascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/madarascans/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangakatana') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangakatana/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'mangafox') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafox/latest?page=${page}`);
        result.manga.forEach(m => { m.coverUrl = absolutizeBackendUrl(m.coverUrl); m.inLibrary = isInLibrary(m.id); });
        cacheMangaList(result.manga); return result;
      } catch {}
    }
    if (sourceId === 'hadesscans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/hadesscans/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall through
      }
    }
    if (sourceId === 'manhuaplus') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manhuaplus/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'manga18free') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/manga18free/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangafreak') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafreak/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangasail') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangasail/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaspin') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaspin/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaplanet') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaplanet/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaplus') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaplus/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangadraft') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangadraft/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'mangaball') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangaball/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'flamecomics') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/flamecomics/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {}
    }
    if (sourceId === 'asurascans') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/asurascans/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'comick') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/comick/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangafire') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangafire/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'weebcentral') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/weebcentral/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangapill') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangapill/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    if (sourceId === 'mangahere') {
      try {
        const result = await nodeTryGetJson<MangaPage>(`/api/mangahere/latest?page=${page}`);
        result.manga.forEach(m => {
          m.coverUrl = absolutizeBackendUrl(m.coverUrl);
          m.inLibrary = isInLibrary(m.id);
        });
        cacheMangaList(result.manga);
        return result;
      } catch {
        // fall back to mocks
      }
    }
    await delay(500);
    const sorted = [...allManga].sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    const start = (page - 1) * 20;
    const items = sorted.slice(start, start + 20).map(m => ({ ...m, inLibrary: Math.random() > 0.6 }));
    return { manga: items, hasNextPage: start + 20 < sorted.length, page };
  },

  async getSourceFilters(sourceId: string): Promise<SourceFilterDefinition[]> {
    await delay(200);
    return [
      { id: 'status', name: 'Status', type: 'select', options: [
        { label: 'All', value: 'all' }, { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' }, { label: 'Hiatus', value: 'hiatus' },
      ], default: 'all' },
      { id: 'genre', name: 'Genre', type: 'multi-select', options: genres.map(g => ({ label: g, value: g.toLowerCase() })) },
      { id: 'sort', name: 'Sort by', type: 'select', options: [
        { label: 'Popular', value: 'popular' }, { label: 'Latest', value: 'latest' },
        { label: 'A-Z', value: 'alpha' },
      ], default: 'popular' },
    ];
  },

  // Updates / History / Downloads
  async getUpdates(params: { sinceDays?: number; onlyUnread?: boolean }): Promise<UpdateItem[]> {
    const sinceMs =
      params.sinceDays != null && params.sinceDays > 0
        ? Date.now() - params.sinceDays * 86400000
        : 0;
    let items = getStoredUpdates();
    if (sinceMs) items = items.filter(u => new Date(u.date).getTime() >= sinceMs);
    if (params.onlyUnread) items = items.filter(u => !u.chapter.read);
    // newest first
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  },

  /**
   * Mihon-style refresh: for each library manga, fetch latest chapters and keep
   * only chapters newer than the last check for that manga.
   */
  async refreshUpdates(): Promise<UpdateItem[]> {
    const libraryIds = getLibraryIds();
    if (!libraryIds.length) {
      setStoredUpdates([]);
      return [];
    }
    const cache = getMangaCache();
    const now = Date.now();
    const out: UpdateItem[] = [];

    // Keep existing items but drop ones for manga removed from library.
    const existing = getStoredUpdates().filter(u => libraryIds.includes(u.manga.id));
    const existingKey = new Set(existing.map(u => `${u.manga.id}\0${u.chapter.id}`));

    // Pre-check AniList to skip scraping where count hasn't changed
    const skipScrapingIds = new Set<string>();
    
    // Check AniList in parallel batches
    const batchSize = 10;
    for (let i = 0; i < libraryIds.length; i += batchSize) {
      const batch = libraryIds.slice(i, i + batchSize);
      await Promise.all(batch.map(async (id) => {
        const manga = cache[id];
        if (manga?.anilistId && manga.anilistLastCount !== undefined) {
          try {
            const al = await fetchAniListDetails(manga.anilistId);
            if (al && al.chapters !== null && al.chapters <= manga.anilistLastCount && al.status !== 'FINISHED') {
              // AniList says no new chapters since last check.
              // We skip if status is not FINISHED because if it's finished, counts might be static but accurate.
              // Actually, user said "check if a title has new chanpters ... if yes then hit update/refresh".
              // So if counts are <= local, we skip.
              skipScrapingIds.add(id);
            }
          } catch (e) { /* ignore anilist errors during updates */ }
        }
      }));
    }

    for (const id of libraryIds) {
      if (skipScrapingIds.has(id)) {
        setLastCheckedAt(id, now);
        continue;
      }

      const lastChecked = getLastCheckedAt(id);
      // Fetch a limited set of newest chapters
      try {
        const chapters = await this.getMangaChapters(id, { sort: { field: 'uploadDate', direction: 'desc' } });
        const latest = chapters.slice(0, 40);
        
        // Update anilist count if we discovered new chapters
        this.updateAnilistLastCount(id, chapters);

        for (const ch of latest) {
          const t = new Date(ch.uploadDate).getTime();
          if (!Number.isFinite(t) || t <= 0) continue;
          if (lastChecked && t <= lastChecked) continue;
          const key = `${id}\0${ch.id}`;
          if (existingKey.has(key)) continue;
          out.push({
            id: `upd-${id}-${ch.id}`,
            manga: cache[id] ?? makeManga(id, parseInt(id) || 0),
            chapter: ch,
            date: new Date(t).toISOString(),
          });
        }
      } catch (e) {
        console.error(`Update refresh failed for manga ${id}:`, e);
      }
      setLastCheckedAt(id, now);
    }

    const merged = [...out, ...existing];
    merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setStoredUpdates(merged.slice(0, 300));
    return getStoredUpdates();
  },

  async getHistory(params: { sinceDays?: number }): Promise<HistoryItem[]> {
    return getReadingHistoryItems(params);
  },

  async resetHistoryChapter(chapterId: string): Promise<void> {
    await clearChapterReadingProgress(chapterId);
  },

  async clearHistoryForManga(mangaId: string): Promise<void> {
    await clearAllReadingProgressForManga(mangaId);
  },

  async getDownloads(): Promise<DownloadItem[]> {
    loadQueueOnce();
    const queueItems = listQueueItems().map((q) => ({
      id: q.id,
      manga: q.manga,
      chapter: q.chapter,
      progress: q.progress,
      status: q.status === 'downloading' ? 'downloading' : q.status,
    })) as DownloadItem[];

    // Also show any downloaded chapters that aren't in the queue (older downloads).
    const downloadedIds = getDownloadedChapterIds();
    const downloadedMeta = getDownloadedChapterMeta();
    const inQueue = new Set(queueItems.map((q) => q.chapter.id));
    const cache = getMangaCache();
    const extras: DownloadItem[] = [];
    for (const chapterId of downloadedIds) {
      if (inQueue.has(chapterId)) continue;
      const meta = downloadedMeta[chapterId];
      if (meta?.manga?.id && meta?.chapter?.id) {
        extras.push({
          id: `q:${chapterId}`,
          manga: meta.manga,
          chapter: withChapterDisplayTitle(meta.chapter),
          progress: 100,
          status: 'paused',
        });
        continue;
      }
      const manga =
        Object.values(cache).find(m => m?.id && chapterId.includes(m.id)) ?? {
          id: 'offline',
          title: 'Unknown series',
          coverUrl: '',
          author: '',
          status: 'Unknown' as const,
          unreadCount: 0,
          downloadedCount: 0,
          totalChapters: 0,
          lastUpdated: new Date().toISOString(),
          inLibrary: false,
          categoryIds: [],
        };
      const ch: Chapter = {
        id: chapterId,
        mangaId: manga.id,
        number: 0,
        title: 'Downloaded chapter',
        uploadDate: new Date().toISOString(),
        read: false,
        bookmarked: false,
        downloaded: true,
        lastPageRead: 0,
        totalPages: 0,
      };
      extras.push({
        id: `q:${chapterId}`,
        manga,
        chapter: withChapterDisplayTitle(ch),
        progress: 100,
        status: 'paused',
      });
    }

    return [...queueItems, ...extras];
  },

  /** Remap download queue, offline page manifest, and downloaded-chapter metadata after library migration. */
  applyMangaMigrationDownloads(
    fromMangaId: string,
    toManga: Manga,
    pairs: { oldChapterId: string; newChapter: Chapter }[],
  ): void {
    const pmap = new Map(pairs.map(p => [p.oldChapterId, p.newChapter]));
    const inLib = getLibraryIds().includes(toManga.id);
    const toMangaLib = { ...toManga, inLibrary: inLib };

    loadQueueOnce();
    let queueChanged = false;
    const nextQ = queueMem.flatMap(q => {
      if (q.manga.id !== fromMangaId) return [q];
      const nc = pmap.get(q.chapter.id);
      if (!nc) {
        queueChanged = true;
        return [];
      }
      queueChanged = true;
      return [
        {
          ...q,
          id: `q:${nc.id}`,
          manga: toMangaLib,
          chapter: { ...nc, mangaId: toManga.id },
          updatedAt: Date.now(),
        },
      ];
    });
    if (queueChanged) {
      queueMem = nextQ;
      persistQueue();
    }

    const manifest = { ...getChapterPageManifest() };
    let mf = false;
    for (const [oldCid, newCh] of pmap) {
      if (manifest[oldCid]) {
        manifest[newCh.id] = manifest[oldCid];
        delete manifest[oldCid];
        mf = true;
      }
    }
    if (mf) setChapterPageManifest(manifest);

    const meta = { ...getDownloadedChapterMeta() };
    let mt = false;
    for (const oldCid of Object.keys(meta)) {
      const newCh = pmap.get(oldCid);
      const row = meta[oldCid];
      if (!newCh || !row || row.manga.id !== fromMangaId) continue;
      delete meta[oldCid];
      meta[newCh.id] = {
        manga: toMangaLib,
        chapter: { ...newCh, mangaId: toManga.id },
        savedAt: row.savedAt,
      };
      mt = true;
    }
    if (mt) setDownloadedChapterMeta(meta);

    const dlIds = getDownloadedChapterIds();
    let idc = false;
    const nextIds = dlIds.map(cid => {
      const nc = pmap.get(cid);
      if (nc) {
        idc = true;
        return nc.id;
      }
      return cid;
    });
    if (idc) setDownloadedChapterIds(nextIds);
  },

  revokeCoverBlobForManga(mangaId: string): void {
    revokeCoverBlobUrl(mangaId);
  },

  async pauseAllDownloads(): Promise<void> {
    loadQueueOnce();
    for (const it of listQueueItems()) {
      if (it.status === 'queued' || it.status === 'downloading') {
        upsertQueueItem({ ...it, status: 'paused', updatedAt: Date.now() });
      }
    }
  },

  async resumeAllDownloads(): Promise<void> {
    const canDownload = await this.checkWifiRequirement();
    if (!canDownload) return;

    loadQueueOnce();
    for (const it of listQueueItems()) {
      if (it.status === 'paused' || it.status === 'error') {
        upsertQueueItem({ ...it, status: 'queued', error: undefined, updatedAt: Date.now() });
      }
    }
    void downloadQueuePump((chapterId) => Backend.getChapterPages(chapterId));
  },

  async cancelDownload(downloadId: string): Promise<void> {
    // Remove from queue and clean up any partial offline data.
    const it = getQueueItem(downloadId);
    if (it) {
      await removeCachedChapterPages(it.chapter.id);
      const manifest = getChapterPageManifest();
      delete manifest[it.chapter.id];
      setChapterPageManifest(manifest);
    }
    removeQueueItem(downloadId);
  },

  // Settings
  async getSettings(): Promise<AppSettings> {
    await delay(50);
    const defaults: AppSettings = {
      theme: 'dark',
      accentColor: '#6366f1',
      gridColumns: 3,
      readerDirection: 'ltr',
      readerContinuous: false,
      keepScreenOn: true,
      downloadWifiOnly: false,
      downloadStorage: 'device',
      deleteAfterRead: false,
      debugLogs: false,
    };
    const stored = readJson<Partial<AppSettings>>(LS_APP_SETTINGS, {});
    return { ...defaults, ...stored };
  },

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    await delay(50);
    const current = await Backend.getSettings();
    const next: AppSettings = { ...current, ...patch };
    writeJson(LS_APP_SETTINGS, next);
  },
};

/** Use after fetching manga/details: library fields → native cover file → Cache API blob → remote URL. */
export async function applyCachedCoverToManga<T extends Manga>(m: T): Promise<T> {
  const merged = mergeLibraryFieldsFromCache(m);
  const withNative = await attachNativeOfflineCover(merged);
  return applyCachedCoverIfAvailable(withNative);
}
