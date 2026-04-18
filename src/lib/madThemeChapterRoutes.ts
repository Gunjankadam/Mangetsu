/**
 * Mad-theme chapter APIs from `mountMadThemeSource` in `backend/server.js`.
 * When adding a site to `MAD_THEME_SITES` on the server, add `{ route, chapterPrefix }` here
 * so `Backend.getChapterPages` can resolve pages without a long if-chain entry.
 */
export const MAD_THEME_CHAPTER_ROUTES: readonly { route: string; chapterPrefix: string }[] = [
  { route: 'mangaspin', chapterPrefix: 'mgspch' },
];
