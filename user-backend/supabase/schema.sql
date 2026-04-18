-- Manga Flow user metadata schema (Supabase/Postgres)
-- Run in Supabase SQL editor.

-- Extensions
create extension if not exists "pgcrypto";

-- Library items
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  manga_id text not null,
  category_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, manga_id)
);

alter table public.library_items enable row level security;

create policy "library_items_select_own"
on public.library_items for select
using (user_id = auth.uid());

create policy "library_items_insert_own"
on public.library_items for insert
with check (user_id = auth.uid());

create policy "library_items_update_own"
on public.library_items for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "library_items_delete_own"
on public.library_items for delete
using (user_id = auth.uid());

create index if not exists library_items_user_updated_at_idx
on public.library_items (user_id, updated_at desc);

-- User profile (username)
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid(),
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles for select
using (user_id = auth.uid());

create policy "profiles_insert_own"
on public.profiles for insert
with check (user_id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ── Cloud sync: library rows carry full manga JSON for restore ──
alter table public.library_items add column if not exists manga_json jsonb not null default '{}'::jsonb;

-- Per-chapter reading progress (history / resume)
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id text not null,
  manga_id text not null,
  last_page integer not null,
  total_pages integer not null default 0,
  finished boolean not null default false,
  updated_at_ms bigint not null,
  chapter_title text not null default '',
  chapter_number double precision not null default 0,
  manga_title text not null default '',
  manga_cover_url text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create index if not exists reading_progress_user_manga_idx on public.reading_progress (user_id, manga_id);

alter table public.reading_progress enable row level security;

create policy "reading_progress_select_own"
on public.reading_progress for select using (user_id = auth.uid());

create policy "reading_progress_insert_own"
on public.reading_progress for insert with check (user_id = auth.uid());

create policy "reading_progress_update_own"
on public.reading_progress for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "reading_progress_delete_own"
on public.reading_progress for delete using (user_id = auth.uid());

-- Bookmarked chapter ids
create table if not exists public.bookmarked_chapters (
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

alter table public.bookmarked_chapters enable row level security;

create policy "bookmarks_select_own"
on public.bookmarked_chapters for select using (user_id = auth.uid());

create policy "bookmarks_insert_own"
on public.bookmarked_chapters for insert with check (user_id = auth.uid());

create policy "bookmarks_delete_own"
on public.bookmarked_chapters for delete using (user_id = auth.uid());

-- UI preferences subset (theme, reader, grid, etc.)
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "user_preferences_select_own"
on public.user_preferences for select using (user_id = auth.uid());

create policy "user_preferences_insert_own"
on public.user_preferences for insert with check (user_id = auth.uid());

create policy "user_preferences_update_own"
on public.user_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());

