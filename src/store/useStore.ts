import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode, ReadingDirection } from '../types';

interface UIState {
  theme: ThemeMode;
  gridColumns: number;
  readerDirection: ReadingDirection;
  /** Per-library-manga reading direction; falls back to `readerDirection` when absent. */
  readerDirectionByMangaId: Record<string, ReadingDirection>;
  /** Placeholder for future cloud sync; persisted UI toggle. */
  profileSyncEnabled: boolean;
  /** Local-only profile photo (data URL). */
  profilePhotoDataUrl: string | null;
  readerContinuous: boolean;
  brightness: number;
  brightnessLock: boolean;
  keepScreenOn: boolean;
  searchQuery: string;
  libraryView: 'grid' | 'list';
  setTheme: (theme: ThemeMode) => void;
  setGridColumns: (cols: number) => void;
  setReaderDirection: (dir: ReadingDirection) => void;
  setReaderDirectionForManga: (mangaId: string, dir: ReadingDirection) => void;
  clearReaderDirectionForManga: (mangaId: string) => void;
  setProfileSyncEnabled: (v: boolean) => void;
  setProfilePhotoDataUrl: (v: string | null) => void;
  setReaderContinuous: (v: boolean) => void;
  setBrightness: (v: number) => void;
  setBrightnessLock: (v: boolean) => void;
  setKeepScreenOn: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setLibraryView: (v: 'grid' | 'list') => void;
  migrationSearchQuery: string;
  migrationLibraryQuery: string;
  setMigrationSearchQuery: (q: string) => void;
  setMigrationLibraryQuery: (q: string) => void;
  migratingFromMangaId: string | null;
  setMigratingFromMangaId: (id: string | null) => void;
  migrationScrollPos: number;
  setMigrationScrollPos: (pos: number) => void;
}

let systemThemeMql: MediaQueryList | null = null;
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('dark', 'amoled');

  if (theme === 'dark') {
    root.classList.add('dark');
    return;
  }
  if (theme === 'amoled') {
    root.classList.add('amoled');
    return;
  }
  if (theme === 'light') return;

  // system
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (mql.matches) root.classList.add('dark');
}

function attachSystemThemeListener(getTheme: () => ThemeMode) {
  if (systemThemeMql && systemThemeListener) return;
  systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeListener = () => {
    if (getTheme() !== 'system') return;
    applyTheme('system');
  };
  systemThemeMql.addEventListener('change', systemThemeListener);
}

function detachSystemThemeListener() {
  if (!systemThemeMql || !systemThemeListener) return;
  systemThemeMql.removeEventListener('change', systemThemeListener);
  systemThemeMql = null;
  systemThemeListener = null;
}

export const useStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      gridColumns: 3,
      readerDirection: 'ltr',
      readerDirectionByMangaId: {},
      profileSyncEnabled: true,
      profilePhotoDataUrl: null,
      readerContinuous: false,
      brightness: 1,
      brightnessLock: false,
      keepScreenOn: true,
      searchQuery: '',
      libraryView: 'grid',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);

        if (theme === 'system') attachSystemThemeListener(() => get().theme);
        else detachSystemThemeListener();
      },
      setGridColumns: (gridColumns) => set({ gridColumns }),
      setReaderDirection: (readerDirection) => {
        if (readerDirection === 'vertical') {
          set({ readerDirection: 'vertical', readerContinuous: true });
          return;
        }
        set({ readerDirection, readerContinuous: false });
      },
      setReaderDirectionForManga: (mangaId, readerDirection) =>
        set(s => ({
          readerDirectionByMangaId: { ...s.readerDirectionByMangaId, [mangaId]: readerDirection },
        })),
      clearReaderDirectionForManga: mangaId =>
        set(s => {
          const { [mangaId]: _, ...rest } = s.readerDirectionByMangaId;
          return { readerDirectionByMangaId: rest };
        }),
      setProfileSyncEnabled: (profileSyncEnabled) => set({ profileSyncEnabled }),
      setProfilePhotoDataUrl: (profilePhotoDataUrl) => set({ profilePhotoDataUrl }),
      setReaderContinuous: (readerContinuous) => set({ readerContinuous }),
      setBrightness: (brightness) => set({ brightness }),
      setBrightnessLock: (brightnessLock) => set({ brightnessLock }),
      setKeepScreenOn: (keepScreenOn) => set({ keepScreenOn }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setLibraryView: (libraryView) => set({ libraryView }),
      migrationSearchQuery: '',
      migrationLibraryQuery: '',
      setMigrationSearchQuery: (migrationSearchQuery) => set({ migrationSearchQuery }),
      setMigrationLibraryQuery: (migrationLibraryQuery) => set({ migrationLibraryQuery }),
      migratingFromMangaId: null,
      setMigratingFromMangaId: (migratingFromMangaId) => set({ migratingFromMangaId }),
      migrationScrollPos: 0,
      setMigrationScrollPos: (migrationScrollPos) => set({ migrationScrollPos }),
    }),
    {
      name: 'mihon-ui',
      partialize: (state) => ({
        theme: state.theme,
        gridColumns: state.gridColumns,
        readerDirection: state.readerDirection,
        readerDirectionByMangaId: state.readerDirectionByMangaId,
        profileSyncEnabled: state.profileSyncEnabled,
        profilePhotoDataUrl: state.profilePhotoDataUrl,
        readerContinuous: state.readerContinuous,
        brightness: state.brightness,
        brightnessLock: state.brightnessLock,
        keepScreenOn: state.keepScreenOn,
        libraryView: state.libraryView,
        migrationSearchQuery: state.migrationSearchQuery,
        migrationLibraryQuery: state.migrationLibraryQuery,
      }),
      onRehydrateStorage: () => (state) => {
        // Apply theme after state is restored from storage.
        if (state) {
          applyTheme(state.theme);
          if (state.theme === 'system') attachSystemThemeListener(() => state.theme);
        }
      },
    }
  )
);
