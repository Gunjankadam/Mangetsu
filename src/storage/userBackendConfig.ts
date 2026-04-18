const LS_USER_BACKEND_URL = 'mf.userBackend.url';

export function getStoredUserBackendUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(LS_USER_BACKEND_URL) ?? '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setStoredUserBackendUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = String(url ?? '').trim().replace(/\/+$/, '');
    if (!clean) window.localStorage.removeItem(LS_USER_BACKEND_URL);
    else window.localStorage.setItem(LS_USER_BACKEND_URL, clean);
  } catch {
    // ignore
  }
}

