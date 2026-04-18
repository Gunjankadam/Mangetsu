import React, { useMemo, useState } from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useStore } from '../../store/useStore';
import type { ThemeMode, ReadingDirection, DownloadStorageMode } from '../../types';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings, useUpdateSettings } from '../../hooks/useBackend';
import { cn } from '@/lib/utils';

function SettingsAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-24 right-[-20%] h-[min(18rem,48vw)] w-[min(18rem,48vw)] rounded-full bg-primary/[0.11] blur-[92px]" />
      <div className="absolute top-[34%] -left-[14%] h-44 w-44 rounded-full bg-[hsl(290_60%_44%/0.1)] blur-[76px]" />
      <div className="absolute bottom-28 right-[-10%] h-40 w-40 rounded-full bg-primary/[0.07] blur-[72px]" />
    </div>
  );
}

import { getStoredBackendUrl, setStoredBackendUrl } from '../../native/Backend';

const SettingsScreen: React.FC = () => {
  const store = useStore();
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();

  const [backendUrl, setBackendUrl] = useState(() => getStoredBackendUrl() ?? '');

  const downloadStorage: DownloadStorageMode = settings?.downloadStorage ?? 'device';
  const downloadWifiOnly = settings?.downloadWifiOnly ?? false;
  const deleteAfterRead = settings?.deleteAfterRead ?? false;

  const downloadModeOptions = useMemo(
    () =>
      [
        {
          value: 'device' as const,
          label: 'This device',
          hint: 'Caches page images here so you can read downloaded chapters offline.',
        },
        {
          value: 'cloud' as const,
          label: 'Cloud',
          hint: 'Only stores the chapter’s page list on this device. Page images are still loaded from the source when you read — you need an internet connection.',
        },
      ] as const,
    [],
  );

  const themeOptions = useMemo(() => (['light', 'dark', 'amoled', 'system'] as ThemeMode[]), []);

  return (
    <div className="relative flex flex-col min-h-screen pb-16">
      <SettingsAmbient />
      <ScreenHeader title="Settings" showBack />

      <main className="relative flex-1 px-3 pt-4 pb-6 space-y-6">
        <Section title="Appearance">
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.65)] overflow-hidden">
            <SettingRow label="Theme">
              <div className="flex gap-1.5">
                {themeOptions.map(t => (
                  <button
                    key={t}
                    onClick={() => store.setTheme(t)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold touch-manipulation border transition-colors',
                      store.theme === t
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                        : 'bg-secondary/70 text-secondary-foreground border-border/60',
                    )}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </SettingRow>
            <Divider />
            <SettingRow label="Grid columns">
              <div className="flex gap-1.5">
                {[2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => store.setGridColumns(n)}
                    className={cn(
                      'h-8 w-8 rounded-xl text-xs font-semibold touch-manipulation border transition-colors',
                      store.gridColumns === n
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                        : 'bg-secondary/70 text-secondary-foreground border-border/60',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>
        </Section>

        <Section title="Reader">
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.65)] overflow-hidden">
            <SettingRow label="Direction" subLabel="Vertical scroll (webtoon), LTR/RTL tap or swipe">
              <div className="flex flex-wrap gap-1.5 justify-end">
                {(['ltr', 'rtl', 'vertical'] as ReadingDirection[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => store.setReaderDirection(d)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold touch-manipulation border transition-colors',
                      store.readerDirection === d
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                        : 'bg-secondary/70 text-secondary-foreground border-border/60',
                    )}
                  >
                    {d === 'ltr' ? 'LTR' : d === 'rtl' ? 'RTL' : 'Vertical'}
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>
        </Section>

        <Section title="Backend">
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.65)] overflow-hidden">
            <SettingRow
              label="Backend link"
              subLabel="Used for Browse, Library, Updates and Downloads. Paste your API base URL, or set VITE_MANGA_FLOW_BACKEND_URL when building the web app (e.g. static deploy on Render)."
            >
              <div className="flex flex-col items-end gap-2 min-w-[10rem]">
                <input
                  value={backendUrl}
                  onChange={e => setBackendUrl(e.target.value)}
                  placeholder="http://your-backend-host:8787"
                  className="w-[min(70vw,260px)] rounded-xl border border-white/15 bg-background/80 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/60"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStoredBackendUrl(backendUrl);
                      qc.invalidateQueries();
                    }}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold touch-manipulation border bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBackendUrl('');
                      setStoredBackendUrl('');
                      qc.invalidateQueries();
                    }}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold touch-manipulation border bg-secondary/70 text-secondary-foreground border-border/70"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </SettingRow>
          </div>
        </Section>

        <Section title="Downloads">
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_10px_36px_-18px_rgba(0,0,0,0.65)] overflow-hidden">
            <div className="px-4 py-3 space-y-2">
              <div>
                <span className="text-sm font-medium text-foreground">Save downloads</span>
                <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                  Choose how chapter downloads use storage. You can change this anytime; chapters already cached on
                  this device stay until you remove them.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {downloadModeOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ downloadStorage: opt.value })}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-left touch-manipulation transition-colors',
                      downloadStorage === opt.value
                        ? 'border-primary/60 bg-primary/15 ring-1 ring-primary/25'
                        : 'border-border/60 bg-secondary/40 hover:border-primary/35',
                      update.isPending && 'opacity-50',
                    )}
                  >
                    <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                    <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{opt.hint}</p>
                  </button>
                ))}
              </div>
              {downloadStorage === 'cloud' ? (
                <p
                  className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100/95"
                  role="status"
                >
                  <span className="font-semibold text-amber-50">Reading still uses the network.</span> Cloud mode does
                  not keep a full offline copy of pages on this device. Opening a &quot;downloaded&quot; chapter will
                  fetch images from the source (or backend) like normal browsing.
                </p>
              ) : null}
            </div>
            <Divider />
            <SettingRow label="Wi‑Fi only" subLabel="Only download chapters on Wi‑Fi">
              <Toggle
                value={downloadWifiOnly}
                disabled={update.isPending}
                onChange={(v) => update.mutate({ downloadWifiOnly: v })}
              />
            </SettingRow>
            <Divider />
            <SettingRow label="Delete after read" subLabel="Automatically remove offline chapters after finishing">
              <Toggle
                value={deleteAfterRead}
                disabled={update.isPending}
                onChange={(v) => update.mutate({ deleteAfterRead: v })}
              />
            </SettingRow>
          </div>
        </Section>

      </main>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <p className="px-1 pb-2 text-[10px] font-bold text-muted-foreground/90 uppercase tracking-[0.2em]">{title}</p>
    {children}
  </section>
);

const Divider = () => <div className="h-px w-full bg-white/[0.06]" aria-hidden />;

const SettingRow: React.FC<{ label: string; subLabel?: string; children: React.ReactNode }> = ({ label, subLabel, children }) => (
  <div className="flex items-center justify-between gap-4 px-4 py-3">
    <div className="min-w-0">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {subLabel ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{subLabel}</p>
      ) : null}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ value: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ value, disabled, onChange }) => (
  <button
    onClick={() => !disabled && onChange(!value)}
    className={cn(
      'relative h-6 w-11 rounded-full transition-colors touch-manipulation',
      value ? 'bg-primary' : 'bg-muted',
      disabled && 'opacity-50 cursor-not-allowed',
    )}
    role="switch"
    aria-checked={value}
    aria-disabled={disabled}
  >
    <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-primary-foreground shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
  </button>
);

export default SettingsScreen;
