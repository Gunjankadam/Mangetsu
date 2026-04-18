import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { runFullCloudSync } from '../lib/cloudSync';

type AuthState = {
  loading: boolean;
  session: Session | null;
};

const AuthContext = createContext<AuthState>({ loading: true, session: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  /** After login, merge library / progress / bookmarks / UI prefs with Supabase when sync is on (after UI prefs rehydrate). */
  useEffect(() => {
    if (!session?.user?.id || !supabaseConfigured()) return;

    let cancelled = false;

    const run = () => {
      if (!useStore.getState().profileSyncEnabled) return;
      void (async () => {
        const r = await runFullCloudSync(session);
        if (!cancelled && !r.ok && r.error && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[cloudSync]', r.error);
        }
      })();
    };

    let unsubHydration: (() => void) | undefined;
    if (useStore.persist.hasHydrated()) {
      run();
    } else {
      unsubHydration = useStore.persist.onFinishHydration(() => run());
    }

    return () => {
      cancelled = true;
      unsubHydration?.();
    };
  }, [session?.user?.id]);

  const value = useMemo(() => ({ loading, session }), [loading, session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

