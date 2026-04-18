// ── Library & Manga ──

export interface LibrarySection {
  id: string;
  name: string;
  order: number;
}

/** Library toolbar: reading progress / offline data. */
export type LibraryActivityFilter = 'all' | 'read' | 'unread' | 'downloaded';

/** Library toolbar: series publication status (from source). */
export type LibraryMangaStatusFilter = 'all' | 'Ongoing' | 'Completed' | 'Hiatus' | 'Cancelled';

export interface LibraryFilter {
  activity?: LibraryActivityFilter;
  mangaStatus?: LibraryMangaStatusFilter;
}

export interface Sort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ChapterFilter {
  unread?: boolean;
  read?: boolean;
  bookmarked?: boolean;
  downloaded?: boolean;
}

export interface Manga {
  id: string;
  title: string;
  coverUrl: string;
  author: string;
  /** Present when cached from details; used for library sort / badges. */
  source?: string;
  artist?: string;
  status: 'Ongoing' | 'Completed' | 'Hiatus' | 'Cancelled' | 'Unknown';
  unreadCount: number;
  downloadedCount: number;
  totalChapters: number;
  lastReadChapter?: number;
  lastUpdated: string;
  inLibrary: boolean;
  categoryIds: string[];
  anilistId?: number;
  anilistLastCount?: number;
}

export interface MangaDetails extends Manga {
  description: string;
  genres: string[];
  source: string;
  url: string;
  altTitles?: string[];
  bannerUrl?: string;
  averageScore?: number;
}

export interface Chapter {
  id: string;
  mangaId: string;
  number: number;
  title: string;
  scanlator?: string;
  uploadDate: string;
  read: boolean;
  bookmarked: boolean;
  downloaded: boolean;
  lastPageRead: number;
  totalPages: number;
}

// ── Reader ──

export interface Page {
  index: number;
  url: string;
  width?: number;
  height?: number;
}

export type ReadingDirection = 'ltr' | 'rtl' | 'vertical';

export interface ReaderSettings {
  direction: ReadingDirection;
  continuousVertical: boolean;
  keepScreenOn: boolean;
  backgroundColor: string;
  imageScaling: 'fit' | 'fill' | 'original';
  brightnessLock: boolean;
  brightness: number;
}

// ── Browse / Sources ──

export interface Source {
  id: string;
  name: string;
  lang: string;
  iconUrl: string;
  supportsLatest: boolean;
}

export interface SourceFilter {
  id: string;
  value: string | string[] | boolean | [number, number];
}

export type SourceFilterType = 'text' | 'select' | 'multi-select' | 'tri-state' | 'range';

export interface SourceFilterOption {
  label: string;
  value: string;
}

export interface SourceFilterDefinition {
  id: string;
  name: string;
  type: SourceFilterType;
  options?: SourceFilterOption[];
  default?: string | string[] | boolean | [number, number];
}

export interface MangaPage {
  manga: Manga[];
  hasNextPage: boolean;
  page: number;
}

// ── Updates / History / Downloads ──

export interface UpdateItem {
  id: string;
  manga: Manga;
  chapter: Chapter;
  date: string;
}

export interface HistoryItem {
  id: string;
  manga: Manga;
  chapter: Chapter;
  lastRead: string;
  progress: number; // 0-1
}

export interface DownloadItem {
  id: string;
  manga: Manga;
  chapter: Chapter;
  progress: number; // 0-100
  status: 'downloading' | 'queued' | 'paused' | 'error';
}

// ── Settings ──

export type ThemeMode = 'light' | 'dark' | 'amoled' | 'system';

/** Chapter downloads: full image cache on device vs list-only (read pages still load over the network). */
export type DownloadStorageMode = 'device' | 'cloud';

export interface AppSettings {
  theme: ThemeMode;
  accentColor: string;
  gridColumns: number;
  readerDirection: ReadingDirection;
  readerContinuous: boolean;
  keepScreenOn: boolean;
  downloadWifiOnly: boolean;
  /** `device` = cache images for offline read. `cloud` = keep page URLs only; reading requires internet. */
  downloadStorage: DownloadStorageMode;
  deleteAfterRead: boolean;
  debugLogs: boolean;
}
