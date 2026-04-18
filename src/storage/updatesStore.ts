import { Capacitor } from '@capacitor/core';
import type { UpdateItem } from '../types';

const LS_UPDATES_ITEMS = 'mf.updates.items';
const LS_UPDATES_LAST_CHECKED = 'mf.updates.lastCheckedByManga';

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
    /* ignore quota */
  }
}

// For now we persist in localStorage for both web + native; can be moved to SQLite later.
let loaded = false;
let memItems: UpdateItem[] = [];
let memLastChecked: Record<string, number> = {};

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  memItems = readLsJson<UpdateItem[]>(LS_UPDATES_ITEMS, []);
  memLastChecked = readLsJson<Record<string, number>>(LS_UPDATES_LAST_CHECKED, {});
}

function persist(): void {
  // Capacitor native still supports localStorage; keep behavior consistent across platforms.
  // (The code is shared; SQLite migration can come later if needed.)
  void Capacitor; // keep import used (tree-shake safe)
  writeLsJson(LS_UPDATES_ITEMS, memItems);
  writeLsJson(LS_UPDATES_LAST_CHECKED, memLastChecked);
}

export function getStoredUpdates(): UpdateItem[] {
  ensureLoaded();
  return memItems;
}

export function setStoredUpdates(items: UpdateItem[]): void {
  ensureLoaded();
  memItems = items;
  persist();
}

export function getLastCheckedAt(mangaId: string): number {
  ensureLoaded();
  return Number(memLastChecked[mangaId] ?? 0) || 0;
}

export function setLastCheckedAt(mangaId: string, ts: number): void {
  ensureLoaded();
  if (!mangaId) return;
  memLastChecked[mangaId] = ts;
  persist();
}

/** Point update notifications from old library id to the migrated manga. */
export function migrateMangaIdInUpdates(fromMangaId: string, newManga: Manga): void {
  ensureLoaded();
  let changed = false;
  memItems = memItems.map(it => {
    if (it.manga.id !== fromMangaId) return it;
    changed = true;
    return {
      ...it,
      manga: { ...newManga },
      chapter: { ...it.chapter, mangaId: newManga.id },
    };
  });
  if (changed) persist();
}

export function migrateLastCheckedMangaId(fromMangaId: string, toMangaId: string): void {
  ensureLoaded();
  const ts = memLastChecked[fromMangaId];
  if (ts == null) return;
  const prev = memLastChecked[toMangaId] ?? 0;
  memLastChecked[toMangaId] = Math.max(prev, ts);
  delete memLastChecked[fromMangaId];
  persist();
}

