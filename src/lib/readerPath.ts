/**
 * Build a reader URL with encoded path segments so chapter/manga ids that contain
 * `/`, `:`, spaces, etc. never split the route (which would hit the app 404 page).
 */
export function readerPath(mangaId: string, chapterId: string): string {
  const m = encodeURIComponent(String(mangaId ?? '').trim());
  const c = encodeURIComponent(String(chapterId ?? '').trim());
  return `/reader/${m}/${c}`;
}

export function mangaDetailsPath(mangaId: string): string {
  return `/manga/${encodeURIComponent(String(mangaId ?? '').trim())}`;
}
