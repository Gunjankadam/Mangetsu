import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, Loader2, LogOut, Pencil, Trash2, X } from 'lucide-react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useAuth } from '../../auth/AuthProvider';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { useStore } from '../../store/useStore';
import { Switch } from '../../components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { runFullCloudSync } from '../../lib/cloudSync';

function ProfileAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-24 right-[-20%] h-[min(18rem,48vw)] w-[min(18rem,48vw)] rounded-full bg-primary/[0.11] blur-[92px]" />
      <div className="absolute top-[34%] -left-[14%] h-44 w-44 rounded-full bg-[hsl(290_60%_44%/0.1)] blur-[76px]" />
      <div className="absolute bottom-28 right-[-10%] h-40 w-40 rounded-full bg-primary/[0.07] blur-[72px]" />
    </div>
  );
}

const card =
  'rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.65)]';

export default function ProfileScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const user = session?.user;
  const email = user?.email ?? '';
  const { profileSyncEnabled, setProfileSyncEnabled, profilePhotoDataUrl, setProfilePhotoDataUrl } = useStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const metaUsername = useMemo(() => {
    const m = user?.user_metadata as Record<string, unknown> | undefined;
    const u = m?.username;
    return typeof u === 'string' ? u.trim() : '';
  }, [user]);

  const [username, setUsername] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fallbackName = useMemo(
    () => metaUsername || (email ? email.split('@')[0] : '') || 'Reader',
    [metaUsername, email],
  );

  const initials = useMemo(() => {
    const base = (username || fallbackName || '').trim();
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? 'M';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : (parts[0]?.[1] ?? '');
    return (a + b).toUpperCase();
  }, [username, fallbackName]);

  const loadProfile = useCallback(async () => {
    if (!user?.id) {
      setUsername(fallbackName);
      setLoadingProfile(false);
      return;
    }
    if (!supabaseConfigured()) {
      setUsername(fallbackName);
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      const fromDb = data?.username?.trim();
      setUsername(fromDb || fallbackName);
    } catch {
      setUsername(fallbackName);
    } finally {
      setLoadingProfile(false);
    }
  }, [user?.id, fallbackName]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  function startEdit() {
    setDraft(username);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft('');
  }

  function pickPhoto() {
    fileRef.current?.click();
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Unsupported file', description: 'Please pick an image.' });
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast({ title: 'Too large', description: 'Pick an image under 3MB.' });
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Failed to read file'));
      r.onload = () => resolve(String(r.result ?? ''));
      r.readAsDataURL(file);
    });
    setProfilePhotoDataUrl(dataUrl);
    toast({ title: 'Profile photo updated' });
  }

  function deletePhoto() {
    setProfilePhotoDataUrl(null);
    toast({ title: 'Profile photo removed' });
  }

  async function saveUsername() {
    const next = draft.trim();
    if (!next) {
      toast({ title: 'Username required', description: 'Choose a non-empty name.' });
      return;
    }
    if (!user?.id) return;
    if (!supabaseConfigured()) {
      toast({ title: 'Not configured', description: 'Supabase env vars are missing.' });
      return;
    }
    setSaving(true);
    try {
      const { error: metaErr } = await supabase.auth.updateUser({ data: { username: next } });
      if (metaErr) throw metaErr;

      const { error: rowErr } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          username: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (rowErr) {
        toast({
          title: 'Username saved',
          description:
            'Updated on your account. Create the `profiles` table in Supabase (see user-backend/schema.sql) to store it in Postgres too.',
        });
      } else {
        toast({ title: 'Profile updated', description: 'Username saved.' });
      }
      setUsername(next);
      setEditing(false);
      setDraft('');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Could not save';
      toast({ title: 'Could not save', description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    if (!session) {
      toast({ title: 'Sign in required', description: 'Sign in to sync your library to the cloud.' });
      return;
    }
    if (!supabaseConfigured()) {
      toast({ title: 'Not configured', description: 'Add Supabase URL and anon key to your environment.' });
      return;
    }
    if (!profileSyncEnabled) {
      toast({ title: 'Sync is off', description: 'Turn on Sync first.' });
      return;
    }
    setSyncing(true);
    try {
      const r = await runFullCloudSync(session);
      if (r.ok) {
        toast({ title: 'Synced', description: 'Library, reading progress, and settings are up to date.' });
      } else {
        toast({
          title: 'Sync failed',
          description: r.error ?? 'Unknown error',
          variant: 'destructive',
        });
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      toast({ title: 'Signed out' });
      navigate('/auth', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col pb-16">
      <ProfileAmbient />
      <ScreenHeader title="Profile" showBack />

      <main className="relative flex-1 space-y-5 px-3 pb-6 pt-4">
        <section
          className={cn(
            card,
            'relative overflow-hidden p-4',
            'shadow-[0_18px_54px_-24px_hsl(var(--primary)/0.25),inset_0_1px_0_0_rgba(255,255,255,0.08)]',
          )}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            aria-hidden
            style={{
              background:
                'radial-gradient(120% 85% at 20% 10%, hsl(var(--primary)/0.16), transparent 52%), radial-gradient(90% 80% at 120% 30%, hsl(285 60% 50% / 0.10), transparent 60%)',
            }}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => void onPickFile(e.target.files?.[0] ?? null)}
          />

          <div className="relative flex items-center gap-4">
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-primary/20 blur-xl" aria-hidden />
              <div className="relative h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                {profilePhotoDataUrl ? (
                  <img
                    src={profilePhotoDataUrl}
                    alt="Profile"
                    className="h-full w-full object-cover"
                    decoding="async"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.08] to-white/[0.02]">
                    <span className="text-sm font-bold tracking-wide text-foreground/90">{initials}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Profile</p>
              <p className="mt-1 truncate text-base font-semibold text-foreground">{loadingProfile ? '…' : username}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{email || '—'}</p>
            </div>

            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={pickPhoto}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-foreground',
                  'touch-manipulation active:scale-[0.98] transition-colors',
                  '[@media(hover:hover)]:hover:border-primary/30 [@media(hover:hover)]:hover:bg-primary/10',
                )}
              >
                <Camera size={14} strokeWidth={2} />
                Edit
              </button>
              <button
                type="button"
                disabled={!profilePhotoDataUrl}
                onClick={deletePhoto}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-foreground/90',
                  'touch-manipulation active:scale-[0.98] transition-colors disabled:opacity-40',
                  '[@media(hover:hover)]:hover:border-red-500/35 [@media(hover:hover)]:hover:bg-red-500/10 [@media(hover:hover)]:hover:text-red-200',
                )}
              >
                <Trash2 size={14} strokeWidth={2} />
                Delete
              </button>
            </div>
          </div>

          <div className="relative mt-4 space-y-3 rounded-2xl border border-white/[0.08] bg-black/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">Cloud sync</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Library, chapters, bookmarks, and reader settings (Supabase).
                </p>
              </div>
              <Switch
                checked={profileSyncEnabled}
                disabled={syncing}
                onCheckedChange={async v => {
                  setProfileSyncEnabled(v);
                  if (!v || !session || !supabaseConfigured()) return;
                  setSyncing(true);
                  try {
                    const r = await runFullCloudSync(session);
                    if (r.ok) {
                      toast({ title: 'Cloud sync on', description: 'Merged with your cloud library.' });
                    } else {
                      toast({
                        title: 'Sync failed',
                        description: r.error ?? 'Could not reach Supabase.',
                        variant: 'destructive',
                      });
                    }
                  } finally {
                    setSyncing(false);
                  }
                }}
                className="data-[state=checked]:shadow-[0_0_0_6px_hsl(var(--primary)/0.12)]"
              />
            </div>
            <button
              type="button"
              disabled={!session || !supabaseConfigured() || !profileSyncEnabled || syncing}
              onClick={() => void syncNow()}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2.5 text-xs font-semibold text-foreground',
                'touch-manipulation transition-colors disabled:opacity-40',
                '[@media(hover:hover)]:hover:border-primary/30 [@media(hover:hover)]:hover:bg-primary/10',
              )}
            >
              {syncing ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </section>

        <section className={cn(card, 'overflow-hidden p-4')}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Username</h2>
              <p className="mt-2 min-w-0 truncate text-sm font-semibold text-foreground">{username || fallbackName}</p>
            </div>
            {!editing && (
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-foreground touch-manipulation active:scale-[0.98]"
              >
                <Pencil size={14} strokeWidth={2} />
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-background/80 px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/60"
                placeholder="Display name"
              />
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveUsername}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 sm:flex-none"
                >
                  <Check size={16} strokeWidth={2.5} />
                  Save
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-secondary/70 px-3 py-2.5 text-sm font-semibold text-secondary-foreground disabled:opacity-40 sm:flex-none"
                >
                  <X size={16} strokeWidth={2.5} />
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className={cn(card, 'overflow-hidden p-4')}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</h2>
          <p className="mt-2 break-all text-sm font-medium text-foreground">{email || '—'}</p>
        </section>

        <button
          type="button"
          disabled={signingOut}
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/35 bg-red-500/[0.12] px-4 py-3.5 text-sm font-semibold text-red-200 touch-manipulation backdrop-blur-sm transition-colors active:scale-[0.99] disabled:opacity-50"
        >
          <LogOut size={18} strokeWidth={2} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </main>
    </div>
  );
}
