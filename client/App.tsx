import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { TopNavigationBar } from './components/TopNavigationBar';
import { AuthenticatedContent } from './components/AuthenticatedContent';

import { TimelineCreatePage } from './pages/TimelineCreatePage';
import { TimelineViewPage } from './pages/TimelineViewPage';
import { TimelineListPage } from './pages/TimelineListPage.tsx';
import MediaLibraryPage from './pages/MediaLibraryPage';
import MediaItemCreatePage from './pages/MediaItemCreatePage';
import { MediaItemViewPage } from './pages/MediaItemViewPage';
import { OidcTokenInjector } from './components/OidcTokenInjector';
import { setupMediaLibrary } from './scripts/setupMediaLibrary';
import TimelineEntryCreatePage from './pages/TimelineEntryCreatePage';

function ScrollToTopOnRouteChange() {
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    // Only scroll to top on PUSH or REPLACE (not POP/back/forward)
    if (navigationType === 'PUSH' || navigationType === 'REPLACE') {
      window.scrollTo(0, 0);
    }
  }, [location, navigationType]);
  return null;
}

function App() {
  // Ensure browser doesn't interfere with polyfill
  if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
  useEffect(() => {
    // Setup MediaLibrary folder structure on app load
    setupMediaLibrary();
  }, []);

  return (
    <AppProviders>
      <OidcTokenInjector />
      <BrowserRouter>
        <ScrollToTopOnRouteChange />
        <div style={{ minHeight: '100vh', background: '#f8f9fa' }}>
          <TopNavigationBar />
          <main>
            <Routes>
              <Route path="/timelines" element={<TimelineListPage />} />
              <Route path="/timelines/:id" element={<TimelineViewPage />} />
              <Route path="/media-library" element={<MediaLibraryPage />} />
              <Route path="/media-library/:id" element={<MediaItemViewPage />} />
              <Route
                path="/media-library/create"
                element={
                  <AuthenticatedContent>
                    <MediaItemCreatePage />
                  </AuthenticatedContent>
                }
              />
              <Route
                path="/create"
                element={
                  <AuthenticatedContent>
                    <TimelineCreatePage />
                  </AuthenticatedContent>
                }
              />
              <Route path="/timelines/:timelineId/add-entry" element={<TimelineEntryCreatePage />} />
              <Route path="*" element={<Navigate to="/timelines" />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
