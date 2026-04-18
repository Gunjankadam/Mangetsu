import React, { useCallback, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams, Navigate, useSearchParams } from 'react-router-dom';
import { Search, Globe, ChevronRight, ArrowLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useSources, useSourcePopular, useSourceLatest, useSearchSource } from '../../hooks/useBackend';
import type { Source } from '../../types';
import { MangaCard, MangaCardSkeleton } from '../../components/MangaCard';
import { EmptyState } from '../../components/EmptyState';
import { getCurrentBackendBaseUrl, getStoredBackendUrl, setStoredBackendUrl } from '../../native/Backend';

/** Soft primary/violet glow — matches tab bar & manga cards */
function BrowseAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-28 right-[-20%] h-[min(22rem,55vw)] w-[min(22rem,55vw)] rounded-full bg-primary/[0.14] blur-[100px]" />
      <div className="absolute top-[28%] -left-[15%] h-56 w-56 rounded-full bg-[hsl(285_65%_48%/0.12)] blur-[88px]" />
      <div className="absolute bottom-24 right-[-10%] h-40 w-40 rounded-full bg-primary/[0.08] blur-[72px]" />
    </div>
  );
}

function sourceDisplayName(s: Source): string {
  return s.id === 'mangapill' ? 'MangaPill' : s.name;
}

/** Alphabetical source list — tap opens Popular/Latest/Search for that source. */
const BrowseSourceList: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [backendInput, setBackendInput] = useState<string>(() => getStoredBackendUrl() ?? '');
  /** Bumps after save/clear so we re-read `localStorage` / env default for `getCurrentBackendBaseUrl()`. */
  const [backendLinkEpoch, setBackendLinkEpoch] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const hasBackend = !!getCurrentBackendBaseUrl().trim();
  void backendLinkEpoch;

  const { data: sources, isLoading, isError } = useSources({ enabled: hasBackend });

  const sorted = useMemo(() => {
    if (!sources?.length) return [];
    return [...sources].sort((a, b) =>
      sourceDisplayName(a).localeCompare(sourceDisplayName(b), undefined, { sensitivity: 'base' }),
    );
  }, [sources]);

  return (
    <div className="relative flex flex-col min-h-screen pb-16">
      <BrowseAmbient />

      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border safe-top">
        <div className="flex h-14 items-center px-4">
          <h1 className="text-lg font-bold tracking-tight text-foreground">Browse</h1>
        </div>
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-snug">
          Choose a source, then browse Popular, Latest, or Search.
        </p>
      </header>

      <main className="relative flex-1 px-3 pt-4">
        {!hasBackend ? (
          <div className="mx-auto max-w-md space-y-4">
            <div className="rounded-2xl border border-white/[0.12] bg-gradient-to-br from-white/[0.06] to-white/[0.015] p-4 backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_16px_40px_-18px_rgba(0,0,0,0.8)]">
              <h2 className="text-sm font-semibold tracking-tight text-foreground mb-1.5">
                Connect to backend
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Paste your backend link (for example `http://192.168.0.10:8787`). We&apos;ll use this
                for all browse and library calls. For static hosting (e.g. Render), set{' '}
                <span className="font-mono text-[10px]">VITE_MANGA_FLOW_BACKEND_URL</span> at build time instead.
              </p>
              <form
                className="space-y-2"
                onSubmit={async e => {
                  e.preventDefault();
                  const value = backendInput.trim();
                  if (!value) return;
                  setConnecting(true);
                  setStoredBackendUrl(value);
                  try {
                    setBackendLinkEpoch(x => x + 1);
                    qc.invalidateQueries({ queryKey: ['sources'] });
                    await qc.refetchQueries({ queryKey: ['sources'] });
                  } finally {
                    setConnecting(false);
                  }
                }}
              >
                <input
                  value={backendInput}
                  onChange={e => setBackendInput(e.target.value)}
                  placeholder="http://your-backend-host:8787"
                  className="w-full rounded-xl border border-white/15 bg-background/80 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/60"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={connecting}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_-18px_hsl(var(--primary)/0.9)] hover:opacity-95 active:scale-[0.99] transition"
                >
                  Save &amp; load sources
                </button>
                {getStoredBackendUrl() && (
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() => {
                      setBackendInput('');
                      setStoredBackendUrl('');
                      setBackendLinkEpoch(x => x + 1);
                      qc.invalidateQueries({ queryKey: ['sources'] });
                    }}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-secondary/70 px-3 py-2.5 text-sm font-semibold text-secondary-foreground hover:opacity-95 active:scale-[0.99] transition"
                  >
                    Clear saved link
                  </button>
                )}
              </form>
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-[4.25rem] rounded-2xl border border-white/[0.06] skeleton-shimmer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              />
            ))}
          </div>
        ) : isError ? (
          <EmptyState title="Couldn’t load sources" description="Check your backend link" />
        ) : !sorted.length ? (
          <EmptyState icon={<Globe size={48} strokeWidth={1} />} title="No sources" />
        ) : (
          <ul className="flex flex-col gap-3 pb-2 animate-fade-in">
            {sorted.map(s => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/browse/${encodeURIComponent(s.id)}`)}
                  className={cn(
                    'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-3.5 text-left touch-manipulation',
                    'border border-white/[0.12] bg-gradient-to-br from-white/[0.09] to-white/[0.02]',
                    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.11),0_12px_40px_-18px_rgba(0,0,0,0.75)]',
                    'backdrop-blur-md transition-all duration-300 ease-out',
                    'hover:border-primary/40 hover:shadow-[0_16px_48px_-14px_hsl(var(--primary)/0.32),inset_0_1px_0_0_rgba(255,255,255,0.14)]',
                    'active:scale-[0.985] active:duration-150',
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      background:
                        'radial-gradient(120% 80% at 0% 50%, hsl(var(--primary) / 0.12), transparent 55%)',
                    }}
                  />
                  <div className="relative shrink-0">
                    <div className="pointer-events-none absolute inset-0 rounded-full bg-primary/25 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100" />
                    <img
                      src={s.iconUrl}
                      alt=""
                      className="relative h-11 w-11 rounded-full border border-white/20 object-cover shadow-md ring-2 ring-white/[0.06] transition-all duration-300 group-hover:border-primary/35 group-hover:ring-primary/25"
                    />
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground tracking-tight">{sourceDisplayName(s)}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-primary/50">
                      {s.id}
                    </p>
                  </div>
                  <ChevronRight
                    size={20}
                    strokeWidth={2}
                    className="relative shrink-0 text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

/** Popular / Latest / Search for one source. */
const BrowseSourceDetail: React.FC = () => {
  const { sourceId: rawId } = useParams<{ sourceId: string }>();
  const sourceId = rawId ? decodeURIComponent(rawId) : '';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const patchParams = useCallback(
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

  const rawTab = searchParams.get('tab');
  const tab: 'popular' | 'latest' | 'search' =
    rawTab === 'latest' || rawTab === 'search' || rawTab === 'popular' ? rawTab : 'popular';
  const searchQuery = searchParams.get('q') ?? '';

  const setTab = useCallback(
    (t: 'popular' | 'latest' | 'search') => {
      patchParams(n => {
        n.set('tab', t);
        if (t !== 'search') n.delete('q');
      });
    },
    [patchParams],
  );

  const setSearchQuery = useCallback(
    (q: string) => {
      patchParams(n => {
        n.set('tab', 'search');
        if (q.trim()) n.set('q', q);
        else n.delete('q');
      });
    },
    [patchParams],
  );

  const hasBackend = !!getCurrentBackendBaseUrl().trim();

  const { data: sources } = useSources({ enabled: hasBackend });
  const source = sources?.find(s => s.id === sourceId);

  const { data: popular, isLoading: loadingPopular } = useSourcePopular(sourceId, 1, {
    enabled: hasBackend && !!sourceId && tab === 'popular',
  });
  const { data: latest, isLoading: loadingLatest } = useSourceLatest(sourceId, 1, {
    enabled: hasBackend && !!sourceId && tab === 'latest',
  });
  const { data: searchResults, isLoading: loadingSearch } = useSearchSource({
    sourceId,
    query: searchQuery,
    // filters/page left default
  });

  const activeManga = tab === 'popular' ? popular?.manga : tab === 'latest' ? latest?.manga : searchResults?.manga;
  const isLoading = tab === 'popular' ? loadingPopular : tab === 'latest' ? loadingLatest : loadingSearch;

  if (!hasBackend) {
    return <Navigate to="/browse" replace />;
  }

  if (sources && sources.length > 0 && sourceId && !source) {
    return <Navigate to="/browse" replace />;
  }

  return (
    <div className="relative flex flex-col min-h-screen pb-16">
      <BrowseAmbient />

      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border safe-top">
        <div className="flex h-14 items-center gap-2 px-2">
          <button
            type="button"
            onClick={() => navigate('/browse')}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-foreground touch-manipulation active:bg-muted/60"
            aria-label="Back to sources"
          >
            <ArrowLeft size={22} strokeWidth={1.75} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {source && (
              <img src={source.iconUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-border/60" />
            )}
            <h1 className="truncate text-base font-bold tracking-tight text-foreground">
              {source ? sourceDisplayName(source) : '…'}
            </h1>
          </div>
        </div>

        <div className="flex border-b border-border">
          {(['popular', 'latest', 'search'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium touch-manipulation transition-colors border-b-2 ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {tab === 'search' && (
        <div className="px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5">
            <Search size={16} className="text-muted-foreground shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search manga…"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>
      )}

      <main className="relative flex-1 px-3 pt-3">
        {!sourceId ? (
          <EmptyState title="No source selected" />
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <MangaCardSkeleton key={i} />
            ))}
          </div>
        ) : !activeManga?.length ? (
          <EmptyState
            icon={<Globe size={48} strokeWidth={1} />}
            title={
              tab === 'search' && !searchQuery.trim()
                ? 'Type to search manga'
                : tab === 'search'
                  ? 'No results found'
                  : 'No manga available'
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-2 animate-fade-in">
            {activeManga.map(m => (
              <MangaCard key={m.id} manga={m} showUnreadBadge={false} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const BrowseHome: React.FC = () => (
  <Routes>
    <Route index element={<BrowseSourceList />} />
    <Route path=":sourceId" element={<BrowseSourceDetail />} />
  </Routes>
);

export default BrowseHome;
