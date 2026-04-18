import { methodNotAllowed, readBody, sendJson, supabaseForRequest, unauthorized } from './_utils.js';

// Table: library_items
// - id uuid (pk)
// - user_id uuid (auth.uid())
// - manga_id text
// - category_ids text[]
// - created_at timestamptz
// - updated_at timestamptz

export default async function handler(req: any, res: any) {
  const auth = req.headers?.authorization as string | undefined;
  if (!auth) return unauthorized(res);

  const supabase = supabaseForRequest(auth);
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) return unauthorized(res);

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('library_items')
      .select('manga_id, category_ids, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) return sendJson(res, 500, { error: error.message });
    return sendJson(res, 200, { items: data ?? [] });
  }

  if (req.method === 'PUT') {
    let body: any;
    try {
      body = await readBody(req);
    } catch (e: any) {
      return sendJson(res, 400, { error: e?.message ?? 'Invalid body' });
    }
    const mangaId = String(body?.mangaId ?? '').trim();
    const categoryIds = Array.isArray(body?.categoryIds)
      ? body.categoryIds.map((x: any) => String(x)).filter(Boolean)
      : [];
    const inLibrary = Boolean(body?.inLibrary);
    if (!mangaId) return sendJson(res, 400, { error: 'Missing mangaId' });

    if (!inLibrary) {
      const { error } = await supabase.from('library_items').delete().eq('manga_id', mangaId);
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { ok: true });
    }

    const { error } = await supabase.from('library_items').upsert(
      {
        manga_id: mangaId,
        category_ids: categoryIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,manga_id' },
    );
    if (error) return sendJson(res, 500, { error: error.message });
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}

