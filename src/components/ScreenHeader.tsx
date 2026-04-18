import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ScreenHeaderProps {
  title: string;
  showBack?: boolean;
  right?: React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, showBack, right }) => {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 w-full flex flex-col border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="safe-top w-full" aria-hidden />
      <div className="flex h-14 items-center gap-3 px-4">
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground active:bg-muted touch-manipulation -ml-1"
            aria-label="Go back"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
        )}
        <h1 className="flex-1 text-lg font-bold tracking-tight text-foreground truncate">{title}</h1>
        {right && <div className="flex items-center gap-1">{right}</div>}
      </div>
    </header>
  );
};
