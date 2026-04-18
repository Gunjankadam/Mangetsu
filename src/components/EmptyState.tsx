import React from 'react';
import { Frown, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-fade-in">
    <div className="mb-4 text-muted-foreground/50">{icon || <Frown size={48} strokeWidth={1} />}</div>
    <p className="text-base font-semibold text-foreground">{title}</p>
    {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    {action && (
      <button
        onClick={action.onClick}
        className="mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground active:scale-[0.98] touch-manipulation"
      >
        {action.label}
      </button>
    )}
  </div>
);

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message = 'Something went wrong', onRetry }) => (
  <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
    <Frown size={48} strokeWidth={1} className="text-destructive/50 mb-4" />
    <p className="text-base font-semibold text-foreground">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-4 flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground active:scale-[0.98] touch-manipulation"
      >
        <RefreshCw size={14} /> Retry
      </button>
    )}
  </div>
);
