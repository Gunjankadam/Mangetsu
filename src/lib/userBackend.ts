const DEFAULT_USER_BACKEND = 'https://mangetsu-backend-user.vercel.app';

export function getUserBackendBaseUrl(): string {
  const v = (import.meta.env.VITE_USER_BACKEND_URL as string | undefined) ?? DEFAULT_USER_BACKEND;
  return String(v).trim().replace(/\/+$/, '');
}

export async function userBackendHealth(): Promise<boolean> {
  const base = getUserBackendBaseUrl();
  const r = await fetch(`${base}/api/health`, { cache: 'no-store' });
  return r.ok;
}

