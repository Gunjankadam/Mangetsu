import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { BottomTabBar } from "./components/BottomTabBar";
import LibraryHome from "./screens/library/LibraryHome";
import MangaDetailsScreen from "./screens/library/MangaDetailsScreen";
import BrowseHome from "./screens/browse/BrowseHome";
import UpdatesScreen from "./screens/updates/UpdatesScreen";
import HistoryScreen from "./screens/history/HistoryScreen";
import MoreHome from "./screens/more/MoreHome";
import DownloadsScreen from "./screens/more/DownloadsScreen";
import SettingsScreen from "./screens/more/SettingsScreen";
import AboutScreen from "./screens/more/AboutScreen";
import AccountScreen from "./screens/more/AccountScreen";
import ReaderScreen from "./screens/reader/ReaderScreen";
import NotFound from "./pages/NotFound";
import { Toaster } from "./components/ui/toaster";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import ProfileScreen from "./screens/more/ProfileScreen";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, session } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen bg-background" aria-busy="true" />;
  if (!session) return <Navigate to="/auth" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function AppRoutes() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const listener = CapacitorApp.addListener('backButton', () => {
      const path = window.location.pathname;
      const isRoot = ['/library', '/browse', '/updates', '/history', '/more', '/auth', '/'].includes(path);
      
      if (isRoot) {
        CapacitorApp.exitApp();
      } else {
        navigate(-1);
      }
    });

    return () => {
      listener.then(l => l.remove()).catch(() => {});
    };
  }, [navigate]);

  const showTabs = !loading && !!session;
  return (
    <div className="mx-auto max-w-lg min-h-screen bg-background">
      <Routes>
        <Route
          path="/"
          element={
            loading ? (
              <div className="min-h-screen bg-background" aria-busy="true" />
            ) : session ? (
              <Navigate to="/library" replace />
            ) : (
              <Navigate to="/auth" replace />
            )
          }
        />
        <Route path="/auth" element={<AccountScreen />} />

        <Route
          path="/library"
          element={
            <RequireAuth>
              <LibraryHome />
            </RequireAuth>
          }
        />
        <Route
          path="/manga/:mangaId"
          element={
            <RequireAuth>
              <MangaDetailsScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/browse/*"
          element={
            <RequireAuth>
              <BrowseHome />
            </RequireAuth>
          }
        />
        <Route
          path="/updates"
          element={
            <RequireAuth>
              <UpdatesScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <HistoryScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/more"
          element={
            <RequireAuth>
              <MoreHome />
            </RequireAuth>
          }
        />
        <Route
          path="/more/account"
          element={
            <RequireAuth>
              <ProfileScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/more/downloads"
          element={
            <RequireAuth>
              <DownloadsScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/more/settings"
          element={
            <RequireAuth>
              <SettingsScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/more/about"
          element={
            <RequireAuth>
              <AboutScreen />
            </RequireAuth>
          }
        />
        <Route
          path="/reader/:mangaId/:chapterId"
          element={
            <RequireAuth>
              <ReaderScreen />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {showTabs && <BottomTabBar />}
      <Toaster />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
