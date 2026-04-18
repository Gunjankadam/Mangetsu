import { createClient } from '@supabase/supabase-js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function supabaseForRequest(authHeader: string | undefined) {
  // Use the anon key and forward the end-user JWT (Authorization header).
  // This makes Supabase apply RLS using auth.uid().
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function sendJson(res: any, status: number, body: unknown) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res: any) {
  sendJson(res, 405, { error: 'Method not allowed' });
}

export function unauthorized(res: any) {
  sendJson(res, 401, { error: 'Unauthorized' });
}

export async function readBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

