import React, { useEffect, useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';
import type { LibrarySection } from '../types';

export type LibraryCategorySheetProps = {
  open: boolean;
  onClose: () => void;
  sections: LibrarySection[];
  /** Pre-selected category ids (excluding `all`) */
  initialSelectedIds: string[];
  mode: 'add' | 'edit';
  onConfirm: (categoryIds: string[]) => void;
  isPending?: boolean;
};

const LibraryCategorySheet: React.FC<LibraryCategorySheetProps> = ({
  open,
  onClose,
  sections,
  initialSelectedIds,
  mode,
  onConfirm,
  isPending,
}) => {
  const pickable = useMemo(
    () => [...sections].filter(s => s.id !== 'all').sort((a, b) => a.order - b.order),
    [sections],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const initialKey = [...initialSelectedIds].sort().join('|');

  useEffect(() => {
    if (!open) return;
    const next = new Set(initialSelectedIds.filter(id => pickable.some(p => p.id === id)));
    if (next.size === 0 && mode === 'add') next.add('reading');
    setSelected(next);
  }, [open, mode, pickable, initialKey]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        if (n.size === 0) n.add('reading');
      } else {
        n.add(id);
      }
      return n;
    });
  };

  const handleConfirm = () => {
    const ids = [...selected];
    onConfirm(ids.length ? ids : ['reading']);
  };

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm animate-fade-in"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-[61] flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div
          className="pointer-events-auto flex w-full max-w-sm flex-col rounded-t-2xl border border-border/80 bg-card shadow-[0_-12px_40px_-12px_hsl(var(--primary)/0.35)] animate-slide-up max-h-[min(78dvh,440px)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-category-sheet-title"
        >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 pb-2.5 pt-1.5 sm:px-4">
          <div className="min-w-0 pr-1">
            <h2 id="library-category-sheet-title" className="text-sm font-semibold text-foreground tracking-tight">
              {mode === 'add' ? 'Add to library' : 'Categories'}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
              {mode === 'add' ? 'Choose where this series lives in your library.' : 'Update library categories.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground touch-manipulation"
            aria-label="Close"
          >
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Select one or more</p>
          <div className="flex flex-wrap gap-1.5">
            {pickable.map(s => {
              const on = selected.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all touch-manipulation ${
                    on
                      ? 'border-primary/50 bg-primary/15 text-primary shadow-sm shadow-primary/10'
                      : 'border-border/80 bg-secondary/60 text-secondary-foreground hover:bg-secondary'
                  }`}
                >
                  {on && <Check size={13} strokeWidth={2.5} className="opacity-90" />}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border/60 p-3 sm:p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-secondary/40 py-2.5 text-xs font-medium text-foreground touch-manipulation sm:text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleConfirm}
            className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/25 touch-manipulation disabled:opacity-50 sm:text-sm"
          >
            {isPending ? 'Saving…' : mode === 'add' ? 'Add to library' : 'Save'}
          </button>
        </div>
        </div>
      </div>
    </>
  );
};

export default LibraryCategorySheet;
