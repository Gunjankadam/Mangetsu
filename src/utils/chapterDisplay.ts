import type { Chapter } from '../types';

/**
 * Strip common source-specific prefixes so we can show
 * `Chapter {n} - {subtitle}` with a single consistent format.
 */
function extractSubtitle(chapterNumber: number, rawTitle: string): string {
  let s = rawTitle.replace(/\u2014|\u2013|—|–/g, '-').trim();
  if (!s) return '';

  const n = chapterNumber;
  const escapeN = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const stripOnce = (input: string): string => {
    let t = input;
    const patterns: RegExp[] = [
      new RegExp(`^#\\s*${escapeN}\\s*[-:\\s]+`, 'i'),
      new RegExp(`^#\\s*${escapeN}\\b\\s*`, 'i'),
      new RegExp(`^chapter\\s*${escapeN}\\s*[-:.]+\\s*`, 'i'),
      new RegExp(`^ch\\.?\\s*${escapeN}\\s*[-:.]+\\s*`, 'i'),
      new RegExp(`^chapter\\s+${escapeN}\\s+`, 'i'),
      new RegExp(`^ch\\.?\\s+${escapeN}\\s+`, 'i'),
      new RegExp(`^(volume|vol)\\.?\\s*\\d+\\s*(chapter|ch)\\.?\\s*${escapeN}\\s*[-:.]+\\s*`, 'i'),
    ];
    for (const re of patterns) {
      const next = t.replace(re, '').trim();
      if (next !== t) return next;
    }
    return t;
  };

  let prev = '';
  while (prev !== s) {
    prev = s;
    s = stripOnce(s);
  }

  s = s.replace(/^#\d+\s*[-:]?\s*/i, '').trim();
  s = stripOnce(s);

  if (!s) return '';
  if (s === String(n) || new RegExp(`^chapter\\s*${escapeN}\\s*$`, 'i').test(s)) return '';
  if (new RegExp(`^#?\\s*${escapeN}\\s*$`).test(s)) return '';
  return s;
}

/** Canonical list label: `Chapter 12 - Subtitle` or `Chapter 12`. */
export function formatChapterDisplayTitle(
  chapterNumber: number,
  rawTitle: string | undefined | null,
): string {
  const n = Number(chapterNumber);
  const num = Number.isFinite(n) ? n : 0;
  const sub = extractSubtitle(num, (rawTitle ?? '').trim());
  if (sub) return `Chapter ${num} - ${sub}`;
  return `Chapter ${num}`;
}

export function withChapterDisplayTitle<T extends Chapter>(ch: T): T {
  return {
    ...ch,
    title: formatChapterDisplayTitle(ch.number, ch.title),
  };
}

export function mapChaptersDisplayTitles(chapters: Chapter[]): Chapter[] {
  return chapters.map(withChapterDisplayTitle);
}
