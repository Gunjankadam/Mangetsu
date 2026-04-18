import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, Grid3X3, List, X, Globe } from 'lucide-react';
import { useLibraryManga, useLibrarySections } from '../../hooks/useBackend';
import { useStore } from '../../store/useStore';
import { MangaCard, MangaCardSkeleton, MangaListItem } from '../../components/MangaCard';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import { LibraryGlobalSearch } from '../../components/LibraryGlobalSearch';
import { HeaderIconButton } from '../../components/HeaderIconButton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { cn } from '@/lib/utils';
import type { LibraryActivityFilter, LibraryFilter, LibraryMangaStatusFilter, Sort } from '../../types';

const pillSelectTrigger =
  'h-10 w-full rounded-full border border-border/60 bg-secondary/90 px-4 text-xs font-semibold tracking-wide shadow-sm transition-all hover:bg-secondary hover:border-border data-[state=open]:border-primary/50 data-[state=open]:ring-2 data-[state=open]:ring-primary/20';

const LibraryHome: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const patchSearchParams = useCallback(
    (mutate: (n: URLSearchParams) => void) => {
      setSearchParams(
        prev => {
          const n = new URLSearchParams(prev);
          mutate(n);
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const searchOpen =
    searchParams.get('search') === '1' || (searchParams.get('q')?.length ?? 0) > 0;
  const query = searchParams.get('q') ?? '';
  const globalActive = searchParams.get('global') === '1';

  const openSearch = useCallback(() => {
    patchSearchParams(n => {
      n.set('search', '1');
    });
  }, [patchSearchParams]);

  const closeSearch = useCallback(() => {
    patchSearchParams(n => {
      n.delete('search');
      n.delete('q');
      n.delete('global');
    });
  }, [patchSearchParams]);

  const setQuery = useCallback(
    (q: string) => {
      patchSearchParams(n => {
        n.set('search', '1');
        if (q) n.set('q', q);
        else n.delete('q');
        n.delete('global');
      });
    },
    [patchSearchParams],
  );

  const startGlobalSearch = useCallback(() => {
    patchSearchParams(n => {
      n.set('search', '1');
      n.set('global', '1');
    });
  }, [patchSearchParams]);

  const secFromUrl = searchParams.get('sec') ?? 'all';

  const setActiveSection = useCallback(
    (id: string) => {
      patchSearchParams(n => {
        if (id === 'all') n.delete('sec');
        else n.set('sec', id);
      });
    },
    [patchSearchParams],
  );

  const [showFilters, setShowFilters] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>({
    activity: 'all',
    mangaStatus: 'all',
  });
  const [sort, setSort] = useState<Sort>({ field: 'none', direction: 'asc' });
  const { gridColumns, libraryView, setLibraryView, setGridColumns } = useStore();

  const { data: sections } = useLibrarySections();

  const activeSection = useMemo(() => {
    if (!sections?.length) return secFromUrl;
    const ok = sections.some(s => s.id === secFromUrl);
    return ok ? secFromUrl : 'all';
  }, [sections, secFromUrl]);

  const { data: manga, isLoading, isError, refetch } = useLibraryManga({
    sectionId: activeSection,
    query: query || undefined,
    filter:
      filter.activity !== 'all' || filter.mangaStatus !== 'all' ? filter : undefined,
    sort,
  });

  const showGlobalSearchButton =
    searchOpen &&
    query.trim().length > 0 &&
    !isLoading &&
    (manga?.length ?? 0) === 0 &&
    !globalActive;

  const showGlobalSection =
    globalActive && searchOpen && query.trim().length > 0 && !isLoading && (manga?.length ?? 0) === 0;

  const gridClass = useMemo(() => {
    if (gridColumns === 2) return 'grid-cols-2';
    if (gridColumns === 4) return 'grid-cols-4';
    return 'grid-cols-3';
  }, [gridColumns]);

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Sticky shell: header + filters overlay (filters do not push grid) */}
      <div className="sticky top-0 z-40 relative">
      <header
        className={cn(
          'bg-background/95 backdrop-blur-xl safe-top',
          !showFilters && 'border-b border-border',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          {searchOpen ? (
            <div className="flex flex-1 items-center gap-2 animate-fade-in">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <Search size={18} strokeWidth={2} className="drop-shadow-[0_0_8px_hsl(var(--primary)/0.35)]" />
              </div>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search library…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              <HeaderIconButton
                onClick={closeSearch}
                aria-label="Close search"
                className="h-9 w-9 rounded-lg"
              >
                <X size={18} strokeWidth={2} />
              </HeaderIconButton>
            </div>
          ) : (
            <>
              <h1 className="flex-1 text-xl font-bold tracking-tight text-foreground">Library</h1>
              <div className="flex items-center gap-1.5">
                <HeaderIconButton onClick={openSearch} aria-label="Search">
                  <Search size={20} strokeWidth={2} />
                </HeaderIconButton>
                <HeaderIconButton
                  pressed={showFilters}
                  onClick={() => setShowFilters(!showFilters)}
                  aria-label="Filters"
                >
                  <SlidersHorizontal size={20} strokeWidth={2} />
                </HeaderIconButton>
                <HeaderIconButton
                  onClick={() => setLibraryView(libraryView === 'grid' ? 'list' : 'grid')}
                  aria-label={libraryView === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                >
                  {libraryView === 'grid' ? <List size={20} strokeWidth={2} /> : <Grid3X3 size={20} strokeWidth={2} />}
                </HeaderIconButton>
              </div>
            </>
          )}
        </div>

        {/* Category rail — crystal glass to match HeaderIconButton; header row above untouched */}
        {sections && (
          <div className="relative px-4 pb-3 pt-1">
            <div
              className="pointer-events-none absolute inset-x-4 top-0 bottom-3 rounded-xl bg-gradient-to-r from-primary/[0.05] via-transparent to-primary/[0.05] blur-xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-x-8 bottom-3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
              aria-hidden
            />
            <div className="relative flex w-full gap-1.5 pb-0.5">
              {sections.map(s => {
                const active = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSection(s.id)}
                    aria-pressed={active}
                    className={cn(
                      'group/cat relative min-w-0 flex-1 basis-0 overflow-hidden rounded-xl px-2 py-2.5 text-center transition-all duration-300 ease-out touch-manipulation',
                      'text-[10px] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em]',
                      active
                        ? cn(
                            'border border-white/25 text-primary-foreground',
                            'bg-gradient-to-b from-primary via-primary to-primary/70',
                            'backdrop-blur-md',
                            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),inset_0_-8px_20px_-8px_rgba(0,0,0,0.2),0_8px_26px_-8px_hsl(var(--primary)/0.52)]',
                            'hover:border-white/35',
                          )
                        : cn(
                            'border border-white/[0.12] bg-gradient-to-b from-white/[0.1] to-white/[0.02]',
                            'text-muted-foreground backdrop-blur-md',
                            'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_4px_18px_-6px_rgba(0,0,0,0.55)]',
                            'hover:border-primary/50 hover:text-foreground',
                            'hover:shadow-[0_6px_26px_-8px_hsl(var(--primary)/0.42),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
                            'active:scale-[0.97] active:duration-150',
                          ),
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-white/22 to-transparent transition-opacity duration-300',
                        active ? 'opacity-100' : 'opacity-[0.55] group-hover/cat:opacity-80',
                      )}
                      aria-hidden
                    />
                    {active && (
                      <span
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_-10%,rgba(255,255,255,0.28),transparent_65%)]"
                        aria-hidden
                      />
                    )}
                    <span className="relative z-[1] block truncate leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {showFilters && (
        <div
          className="absolute left-0 right-0 top-full z-[60] flex justify-center px-4 pb-3 pt-1 animate-fade-in"
          role="region"
          aria-label="Library filters"
        >
          <div
            className={cn(
              'w-full max-w-lg max-h-[min(72vh,32rem)] overflow-y-auto overscroll-contain rounded-b-2xl px-4 py-3',
              'pointer-events-auto',
              'border border-t-0 border-border',
              'bg-card',
              'shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)]',
            )}
          >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                User activity
              </span>
              <Select
                value={filter.activity ?? 'all'}
                onValueChange={(v) =>
                  setFilter((f) => ({ ...f, activity: v as LibraryActivityFilter }))
                }
              >
                <SelectTrigger className={cn(pillSelectTrigger, 'touch-manipulation')}>
                  <SelectValue placeholder="All activity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All
                  </SelectItem>
                  <SelectItem value="read" className="text-xs">
                    Read
                  </SelectItem>
                  <SelectItem value="unread" className="text-xs">
                    Unread
                  </SelectItem>
                  <SelectItem value="downloaded" className="text-xs">
                    Downloaded
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Manga status
              </span>
              <Select
                value={filter.mangaStatus ?? 'all'}
                onValueChange={(v) =>
                  setFilter((f) => ({ ...f, mangaStatus: v as LibraryMangaStatusFilter }))
                }
              >
                <SelectTrigger className={cn(pillSelectTrigger, 'touch-manipulation')}>
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All
                  </SelectItem>
                  <SelectItem value="Ongoing" className="text-xs">
                    Ongoing
                  </SelectItem>
                  <SelectItem value="Completed" className="text-xs">
                    Completed
                  </SelectItem>
                  <SelectItem value="Hiatus" className="text-xs">
                    Hiatus
                  </SelectItem>
                  <SelectItem value="Cancelled" className="text-xs">
                    Cancelled
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Sort by</span>
            {([
              { field: 'none', label: 'None' },
              { field: 'title', label: 'Title' },
              { field: 'author', label: 'Author' },
              { field: 'totalChapters', label: 'Chapters' },
              { field: 'source', label: 'Source' },
            ] as const).map(({ field, label }) => (
              <button
                key={field}
                onClick={() =>
                  setSort((s) =>
                    field === 'none'
                      ? { field: 'none', direction: 'asc' }
                      : {
                          field,
                          direction: s.field === field && s.direction === 'asc' ? 'desc' : 'asc',
                        },
                  )
                }
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors touch-manipulation ${
                  sort.field === field ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {label}
                {field !== 'none' && sort.field === field && (sort.direction === 'asc' ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground">Columns:</span>
            {[2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => setGridColumns(n)}
                className={`h-7 w-7 rounded-md text-xs font-medium transition-colors touch-manipulation ${
                  gridColumns === n ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setFilter({ activity: 'all', mangaStatus: 'all' });
              setSort({ field: 'none', direction: 'asc' });
            }}
            className="mt-3 text-xs text-primary font-medium touch-manipulation"
          >
            Reset filters
          </button>
          </div>
        </div>
      )}
      </div>

      {/* Content */}
      <main className="relative z-0 flex-1 px-3 pt-3">
        {isLoading ? (
          <div className={`grid ${gridClass} gap-2`}>
            {Array.from({ length: 12 }).map((_, i) => <MangaCardSkeleton key={i} />)}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !manga?.length ? (
          <>
            {query.trim() ? (
              <div className="mb-4 space-y-3">
                <p className="text-center text-sm text-muted-foreground">No matches in your library</p>
                {showGlobalSearchButton ? (
                  <button
                    type="button"
                    onClick={startGlobalSearch}
                    className={cn(
                      'mx-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-primary/35 bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground',
                      'touch-manipulation transition-colors active:scale-[0.99]',
                      '[@media(hover:hover)]:hover:bg-primary/15',
                    )}
                  >
                    <Globe size={18} strokeWidth={2} className="text-primary" aria-hidden />
                    Search all sources
                  </button>
                ) : null}
              </div>
            ) : (
              <EmptyState title="Your library is empty" description="Browse sources to add manga" />
            )}
            {showGlobalSection ? (
              <LibraryGlobalSearch query={query} enabled={showGlobalSection} />
            ) : null}
          </>
        ) : libraryView === 'grid' ? (
          <div className={`grid ${gridClass} gap-2 animate-fade-in`}>
            {manga.map(m => <MangaCard key={m.id} manga={m} columns={gridColumns} />)}
          </div>
        ) : (
          <div className="animate-fade-in divide-y divide-border">
            {manga.map(m => <MangaListItem key={m.id} manga={m} />)}
          </div>
        )}
      </main>
    </div>
  );
};

export default LibraryHome;
