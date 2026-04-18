## Manga Flow User Backend (Vercel + Supabase)

This service stores **user metadata** (library/history/progress/settings) in **Supabase Postgres** and is deployed as **Vercel Serverless Functions**.

### Deploy (Vercel)
- Import the repo in Vercel
- Set **Root Directory** to `user-backend`
- Add env vars:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

### Supabase setup
1. Create a Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Use Supabase Auth (email/password or OTP) on the client

### Test
- `GET /api/health`
- `GET /api/library` (requires `Authorization: Bearer <supabase_jwt>`)
- `PUT /api/library` body:

```json
{ "mangaId": "as:slug", "inLibrary": true, "categoryIds": ["all"] }
```

