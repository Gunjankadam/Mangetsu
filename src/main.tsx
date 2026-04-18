import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { useStore } from "./store/useStore";
import { initLibraryPersistence } from "./storage/libraryStore";
import { initReadProgressPersistence } from "./storage/readProgressStore";
import { initChapterBookmarkPersistence } from "./storage/chapterBookmarkStore";
import { getCurrentBackendBaseUrl } from "./native/Backend";

// Ensure theme classes are applied before first paint.
useStore.getState().setTheme(useStore.getState().theme);

function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      initLibraryPersistence(),
      initReadProgressPersistence(),
      initChapterBookmarkPersistence(),
    ])
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    const base = getCurrentBackendBaseUrl();
    if (!base) return;

    const ping = () => {
      try {
        void fetch(`${base}/api/ping`, { method: "GET", cache: "no-store" }).catch(() => {});
      } catch {
        // ignore
      }
    };

    ping();
    const t = window.setInterval(ping, 13 * 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  if (!ready) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
