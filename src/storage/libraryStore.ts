import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Manga } from '../types';

const LS_LIBRARY_IDS = 'mf.library.ids';
const LS_MANGA_CACHE = 'mf.library.mangaCache';

const DB_NAME = 'manga_flow_library';
const COVERS_DIR = 'mf_covers';

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

function safeCoverFileId(mangaId: string): string {
  return mangaId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160) || 'cover';
}

/** In-memory mirror (sync reads for Backend). Filled before first paint on native. */
let memIds: string[] = [];
let memManga: Record<string, Manga> = {};
let initPromise: Promise<void> | null = null;
/** Web: lazy-load from localStorage so tests / early imports work without awaiting init. */
let webMemLoaded = false;

function ensureWebLoadedOnce(): void {
  if (Capacitor.isNativePlatform() || webMemLoaded) return;
  webMemLoaded = true;
  memIds = readLsJson<string[]>(LS_LIBRARY_IDS, []);
  memManga = readLsJson<Record<string, Manga>>(LS_MANGA_CACHE, {});
}
let nativeDb: import('@capacitor-community/sqlite').SQLiteDBConnection | null = null;
let nativeSqlite: import('@capacitor-community/sqlite').SQLiteConnection | null = null;

function isBlobOrDataUrl(url: string | undefined | null): boolean {
  const u = String(url ?? '');
  return u.startsWith('blob:') || u.startsWith('data:');
}

function storableManga(m: Manga, previousRemoteCover?: string): Manga {
  const u = m.coverUrl ?? '';
  if (!isBlobOrDataUrl(u)) return m;
  const fallback = previousRemoteCover && !isBlobOrDataUrl(previousRemoteCover) ? previousRemoteCover : '';
  return { ...m, coverUrl: fallback };
}

export function isNativeLibraryPersistence(): boolean {
  return Capacitor.isNativePlatform();
}

export function initLibraryPersistence(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!Capacitor.isNativePlatform()) {
        webMemLoaded = true;
        memIds = readLsJson<string[]>(LS_LIBRARY_IDS, []);
        memManga = readLsJson<Record<string, Manga>>(LS_MANGA_CACHE, {});
        return;
      }
      const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
      const { Filesystem, Directory } = await import('@capacitor/filesystem');

      nativeSqlite = new SQLiteConnection(CapacitorSQLite);
      nativeDb = await nativeSqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      await nativeDb.open();
      await nativeDb.execute(
        `CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
        false,
      );
      await nativeDb.execute(
        `CREATE TABLE IF NOT EXISTS library_manga (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          cover_source_url TEXT,
          cover_path TEXT,
          updated_at INTEGER NOT NULL
        );`,
        false,
      );

      try {
        await Filesystem.mkdir({
          path: COVERS_DIR,
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        /* exists */
      }

      const rowCount = await nativeDb.query('SELECT COUNT(*) AS c FROM library_manga;', []);
      const row0 = (rowCount.values ?? [])[0] as Record<string, unknown> | undefined;
      const n = Number(row0?.c ?? 0);
      if (n === 0) {
        const legacyIds = readLsJson<string[]>(LS_LIBRARY_IDS, []);
        const legacyManga = readLsJson<Record<string, Manga>>(LS_MANGA_CACHE, {});
        if (legacyIds.length || Object.keys(legacyManga).length) {
          memIds = [...legacyIds];
          memManga = { ...legacyManga };
          await persistNativeIds();
          for (const id of Object.keys(memManga)) {
            await persistNativeMangaRow(memManga[id]!, memManga[id]!.coverUrl);
          }
        } else {
          memIds = [];
          memManga = {};
        }
      } else {
        await hydrateNativeFromDb();
      }
    })();
  }
  return initPromise;
}

async function hydrateNativeFromDb(): Promise<void> {
  if (!nativeDb) return;
  const idsRes = await nativeDb.query(`SELECT value FROM library_meta WHERE key = 'library_ids' LIMIT 1;`, []);
  const raw = (idsRes.values as { value?: string }[] | undefined)?.[0]?.value;
  memIds = raw ? (JSON.parse(raw) as string[]) : [];
  const all = await nativeDb.query('SELECT id, payload, cover_source_url FROM library_manga;', []);
  memManga = {};
  const rows = (all.values as { id?: string; payload?: string; cover_source_url?: string }[]) ?? [];
  for (const r of rows) {
    if (!r.id || !r.payload) continue;
    try {
      const m = JSON.parse(r.payload) as Manga;
      if (r.cover_source_url && !m.coverUrl) m.coverUrl = r.cover_source_url;
      memManga[r.id] = m;
    } catch {
      /* skip */
    }
  }
}

async function persistNativeIds(): Promise<void> {
  if (!nativeDb) return;
  const json = JSON.stringify(memIds);
  await nativeDb.run(
    `INSERT OR REPLACE INTO library_meta (key, value) VALUES ('library_ids', ?);`,
    [json],
  );
}

async function persistNativeMangaRow(m: Manga, coverSourceUrl: string): Promise<void> {
  if (!nativeDb) return;
  const payload = JSON.stringify(m);
  const now = Date.now();
  const src = coverSourceUrl || '';
  await nativeDb.run(
    `INSERT INTO library_manga (id, payload, cover_source_url, cover_path, updated_at)
     VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       cover_source_url = COALESCE(NULLIF(excluded.cover_source_url, ''), library_manga.cover_source_url),
       updated_at = excluded.updated_at;`,
    [m.id, payload, src, now],
  );
}

async function readCoverPathForManga(mangaId: string): Promise<string | null> {
  if (!nativeDb) return null;
  const q = await nativeDb.query('SELECT cover_path FROM library_manga WHERE id = ? LIMIT 1;', [mangaId]);
  const p = (q.values as { cover_path?: string }[] | undefined)?.[0]?.cover_path;
  return p ?? null;
}

async function updateCoverPath(mangaId: string, relativePath: string): Promise<void> {
  if (!nativeDb) return;
  await nativeDb.run(`UPDATE library_manga SET cover_path = ? WHERE id = ?;`, [relativePath, mangaId]);
}

async function deleteNativeMangaRow(mangaId: string): Promise<void> {
  if (!nativeDb) return;
  const rel = await readCoverPathForManga(mangaId);
  await nativeDb.run(`DELETE FROM library_manga WHERE id = ?;`, [mangaId]);
  if (rel) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({ path: rel, directory: Directory.Data });
    } catch {
      /* missing */
    }
  }
}

async function saveCoverToDevice(mangaId: string, fetchUrl: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !fetchUrl || isBlobOrDataUrl(fetchUrl)) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    // WebView is https; fetch() to http:// dev PC is blocked as mixed content. Native HTTP still works.
    const httpRes = await CapacitorHttp.get({
      url: fetchUrl,
      responseType: 'blob',
    });
    if (httpRes.status < 200 || httpRes.status >= 300) return;
    const base64 = typeof httpRes.data === 'string' ? httpRes.data : '';
    if (!base64) return;
    const hdr = httpRes.headers ?? {};
    const ct = String(
      hdr['Content-Type'] ?? hdr['content-type'] ?? hdr['Content-type'] ?? '',
    );
    const ext = ct.includes('png') ? 'png' : 'jpg';
    const rel = `${COVERS_DIR}/${safeCoverFileId(mangaId)}.${ext}`;
    await Filesystem.writeFile({
      path: rel,
      data: base64,
      directory: Directory.Data,
    });
    await updateCoverPath(mangaId, rel);
  } catch {
    /* network / storage */
  }
}

function persistWeb(): void {
  writeLsJson(LS_LIBRARY_IDS, memIds);
  writeLsJson(LS_MANGA_CACHE, memManga);
}

export function getLibraryIds(): string[] {
  ensureWebLoadedOnce();
  return memIds;
}

export function setLibraryIds(ids: string[]): void {
  ensureWebLoadedOnce();
  memIds = Array.from(new Set(ids));
  if (Capacitor.isNativePlatform()) {
    void persistNativeIds();
  } else {
    persistWeb();
  }
}

export function getMangaCache(): Record<string, Manga> {
  ensureWebLoadedOnce();
  return memManga;
}

export function setMangaCache(cache: Record<string, Manga>): void {
  ensureWebLoadedOnce();
  memManga = { ...cache };
  if (Capacitor.isNativePlatform()) {
    void (async () => {
      await persistNativeIds();
      for (const id of Object.keys(memManga)) {
        const m = memManga[id]!;
        const src = m.coverUrl && !isBlobOrDataUrl(m.coverUrl) ? m.coverUrl : '';
        await persistNativeMangaRow(m, src);
        if (src) void saveCoverToDevice(id, src);
      }
    })();
  } else {
    persistWeb();
  }
}

export function upsertManga(m: Manga): void {
  ensureWebLoadedOnce();
  const prev = memManga[m.id];
  const incoming = String(m.coverUrl ?? '').trim();
  const remote =
    incoming && !isBlobOrDataUrl(incoming)
      ? incoming
      : prev?.coverUrl && !isBlobOrDataUrl(prev.coverUrl)
        ? prev.coverUrl
        : '';
  const toStore = storableManga(m, remote);
  if (remote) toStore.coverUrl = remote;
  else if (
    !String(toStore.coverUrl ?? '').trim() &&
    prev?.coverUrl &&
    !isBlobOrDataUrl(prev.coverUrl)
  ) {
    toStore.coverUrl = prev.coverUrl;
  }
  // API / browse payloads often use categoryIds: ["all"] or omit categories; never replace real library tabs with that.
  const inLibrary = memIds.includes(m.id);
  const incomingCats = Array.isArray(m.categoryIds) ? m.categoryIds : [];
  const incomingNoAll = [...new Set(incomingCats.filter(id => id && String(id) !== 'all'))];
  const prevCats = prev?.categoryIds;
  const prevNoAll =
    Array.isArray(prevCats) ? [...new Set(prevCats.filter(id => id && String(id) !== 'all'))] : [];

  if (incomingNoAll.length > 0) {
    toStore.categoryIds = incomingNoAll;
  } else if (prevNoAll.length > 0) {
    toStore.categoryIds = prevNoAll;
  } else if (inLibrary && (incomingCats.length === 0 || incomingCats.every(id => String(id) === 'all'))) {
    toStore.categoryIds = ['reading'];
  } else if (incomingCats.length > 0) {
    toStore.categoryIds = [...new Set(incomingCats)];
  } else {
    toStore.categoryIds = [];
  }
  memManga[m.id] = toStore;

  if (Capacitor.isNativePlatform()) {
    void (async () => {
      await persistNativeMangaRow(toStore, remote);
      if (remote) await saveCoverToDevice(m.id, remote);
    })();
  } else {
    persistWeb();
    void saveCoverToDevice(m.id, remote); // no-op on web
  }
}


/** Call when removing a title from the library (frees SQLite row + cover file on native). */
export function removeMangaFromLibraryStore(mangaId: string): void {
  delete memManga[mangaId];
  if (Capacitor.isNativePlatform()) {
    void deleteNativeMangaRow(mangaId);
  } else {
    persistWeb();
  }
}

/**
 * On native, if a cover file exists for this manga, return a data-URL for offline display.
 */
export async function attachNativeOfflineCover<T extends Manga>(m: T): Promise<T> {
  if (!Capacitor.isNativePlatform()) return m;
  try {
    const rel = await readCoverPathForManga(m.id);
    if (!rel) return m;
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const file = await Filesystem.readFile({
      path: rel,
      directory: Directory.Data,
    });
    const data = typeof file.data === 'string' ? file.data : '';
    if (!data) return m;
    const mime = rel.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { ...m, coverUrl: `data:${mime};base64,${data}` };
  } catch {
    return m;
  }
}
