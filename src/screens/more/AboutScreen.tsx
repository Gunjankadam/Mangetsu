import React from 'react';
import { ScreenHeader } from '../../components/ScreenHeader';
import { BookOpen } from 'lucide-react';

const AboutScreen: React.FC = () => (
  <div className="flex flex-col min-h-screen pb-16">
    <ScreenHeader title="About" showBack />
    <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
        <BookOpen size={32} className="text-primary" />
      </div>
      <h2 className="text-xl font-bold text-foreground"></h2>
      <p className="text-sm text-muted-foreground mt-1">Version 1.0.0</p>
      <p className="text-xs text-muted-foreground mt-4 max-w-xs leading-relaxed">
        A premium manga reading experience. Built with precision and care.
      </p>
      
    </main>
  </div>
);

export default AboutScreen;
