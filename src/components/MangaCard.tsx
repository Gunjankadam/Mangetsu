import React, { useState, useSyncExternalStore } from 'react';
import type { Manga } from '../types';
import { useNavigate } from 'react-router-dom';
import coverFallbackImage from '../assets/fallback-cover.png';
import { cn } from '@/lib/utils';
import { mangaDetailsPath } from '@/lib/readerPath';
import {
  getLibraryProgressEpoch,
  getLibraryUnreadBadgeCount,
  subscribeLibraryProgress,
} from '../storage/readProgressStore';

const COVER_FALLBACK = coverFallbackImage;

interface MangaCardProps {
  manga: Manga;
  columns?: number;
  /** Unread pill (top-right). Off for browse/source grids where counts are not meaningful. */
  showUnreadBadge?: boolean;
}

export const MangaCard: React.FC<MangaCardProps> = ({ manga, columns = 3, showUnreadBadge = true }) => {
  const navigate = useNavigate();
  const [coverLoaded, setCoverLoaded] = useState(false);

  useSyncExternalStore(subscribeLibraryProgress, getLibraryProgressEpoch, getLibraryProgressEpoch);
  const unreadCount = getLibraryUnreadBadgeCount(manga);
  const hasUnread = unreadCount > 0;
  const unreadLabel = String(unreadCount);

  return (
    <button
      type="button"
      onClick={() => navigate(mangaDetailsPath(manga.id))}
      className={cn(
        'group relative flex w-full touch-manipulation flex-col overflow-hidden rounded-2xl text-left',
        'border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.02]',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_10px_36px_-14px_rgba(0,0,0,0.75)]',
        'backdrop-blur-sm transition-all duration-300 ease-out',
        'hover:border-primary/35 hover:shadow-[0_14px_40px_-12px_hsl(var(--primary)/0.35),inset_0_1px_0_0_rgba(255,255,255,0.16)]',
        'active:scale-[0.98] active:duration-150',
      )}
      aria-label={showUnreadBadge ? `${manga.title}, ${unreadCount} unread` : manga.title}
    >
      {/* Inner crystal rim */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.06]" aria-hidden />

      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[14px] m-[3px] mt-[3px]">
        {/* Placeholder while cover loads / decodes */}
        <div
          className={cn(
            'absolute inset-0 z-[1] rounded-[13px] bg-muted transition-opacity duration-300',
            coverLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100',
          )}
          aria-hidden
        >
          <div className="h-full w-full skeleton-shimmer rounded-[13px]" />
        </div>

        <img
          src={manga.coverUrl}
          alt={manga.title}
          decoding="async"
          loading="lazy"
          className={cn(
            'relative z-0 h-full w-full object-cover transition-all duration-500 ease-out',
            coverLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-[1.04] blur-sm',
            'group-hover:scale-[1.03]',
            'group-active:scale-[1.01]',
          )}
          onLoad={() => setCoverLoaded(true)}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== COVER_FALLBACK) {
              img.src = COVER_FALLBACK;
              return;
            }
            setCoverLoaded(true);
          }}
        />

        <div
          className="pointer-events-none absolute inset-0 z-[2] rounded-[13px] ring-1 ring-inset ring-white/[0.08]"
          aria-hidden
        />

        {/* Readability + depth */}
        <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/85 via-black/15 to-transparent" />

        {showUnreadBadge && (
          <div
            className={cn(
              'absolute top-2 right-2 z-[3] flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-full px-1.5 tabular-nums',
              'border text-[11px] font-bold leading-none tracking-tight',
              'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)] transition-transform duration-300 group-hover:scale-[1.04]',
              hasUnread
                ? cn(
                    'border-white/30 bg-gradient-to-b from-primary via-primary to-primary/75',
                    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_6px_20px_-6px_hsl(var(--primary)/0.65)]',
                  )
                : cn(
                    'border-white/25 bg-black/55 backdrop-blur-md',
                    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_4px_14px_-6px_rgba(0,0,0,0.5)]',
                  ),
            )}
          >
            <span className="min-w-[1ch] text-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              {unreadLabel}
            </span>
          </div>
        )}

        {/* Downloaded indicator */}
        {manga.downloadedCount > 0 && (
          <span className="absolute top-2 left-2 z-[3] flex h-6 items-center gap-0.5 rounded-lg border border-white/20 bg-gradient-to-b from-primary/95 to-primary/70 px-1.5 text-[10px] font-bold text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_4px_14px_-6px_hsl(var(--primary)/0.5)]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {manga.downloadedCount}
          </span>
        )}

        {/* Title — glass strip */}
        <div className="absolute bottom-0 left-0 right-0 z-[3] border-t border-white/10 bg-black/35 p-2 backdrop-blur-md">
          <p
            className={cn(
              'font-sans font-bold uppercase leading-tight tracking-[0.07em] text-primary-foreground line-clamp-2 drop-shadow-sm',
              columns >= 4 ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            {manga.title}
          </p>
        </div>
      </div>
    </button>
  );
};

export const MangaCardSkeleton: React.FC = () => (
  <div
    className={cn(
      'flex flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-b from-white/[0.06] to-transparent p-[3px]',
      'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_8px_28px_-12px_rgba(0,0,0,0.65)]',
    )}
  >
    <div className="aspect-[2/3] w-full rounded-[13px] skeleton-shimmer" />
  </div>
);

interface MangaListItemProps {
  manga: Manga;
}

export const MangaListItem: React.FC<MangaListItemProps> = ({ manga }) => {
  const navigate = useNavigate();
  const [thumbLoaded, setThumbLoaded] = useState(false);

  useSyncExternalStore(subscribeLibraryProgress, getLibraryProgressEpoch, getLibraryProgressEpoch);
  const unreadCount = getLibraryUnreadBadgeCount(manga);
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <button
      type="button"
      onClick={() => navigate(mangaDetailsPath(manga.id))}
      className={cn(
        'flex w-full touch-manipulation items-center gap-3 px-4 py-3 text-left transition-colors duration-200',
        'rounded-xl border border-border/35 bg-transparent',
        /* Avoid sticky “hover border” on touch: only style hover when the device supports real hover */
        '[@media(hover:hover)]:hover:border-primary/30 [@media(hover:hover)]:hover:bg-muted/40',
        'active:scale-[0.99] active:bg-muted/35',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
      aria-label={`${manga.title}, ${unreadCount} unread`}
    >
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 shadow-md">
        {!thumbLoaded && <div className="absolute inset-0 skeleton-shimmer" aria-hidden />}
        <img
          src={manga.coverUrl}
          alt=""
          decoding="async"
          loading="lazy"
          className={cn(
            'h-full w-full object-cover transition-opacity duration-300',
            thumbLoaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setThumbLoaded(true)}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== COVER_FALLBACK) img.src = COVER_FALLBACK;
            else setThumbLoaded(true);
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{manga.title}</p>
        <p className="text-xs text-muted-foreground">
          {manga.author} · {manga.status}
        </p>
      </div>
      <span
        className={cn(
          'flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full border px-1.5 text-[10px] font-bold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
          unreadCount > 0
            ? 'border-primary/40 bg-gradient-to-b from-primary/90 to-primary/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]'
            : 'border-white/15 bg-black/50',
        )}
      >
        {unreadLabel}
      </span>
    </button>
  );
};
