import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { LoginButton } from './components/LoginButton';
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

function App() {
  useEffect(() => {
    // Setup MediaLibrary folder structure on app load
    setupMediaLibrary();
  }, []);

  return (
    <AppProviders>
      <OidcTokenInjector />
      <BrowserRouter>
        <div className="app-container">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <h1>TimelineVerse</h1>
              <nav style={{ display: 'flex', gap: 16 }}>
                <Link to="/timelines" style={{ textDecoration: 'none', color: '#2a4d8f', fontWeight: 500 }}>
                  Browse Timelines
                </Link>
                <Link to="/media-library" style={{ textDecoration: 'none', color: '#2a4d8f', fontWeight: 500 }}>
                  Media Library
                </Link>
                <Link to="/create" style={{ textDecoration: 'none', color: '#2a4d8f', fontWeight: 500 }}>
                  Create Timeline
                </Link>
              </nav>
            </div>
            <LoginButton />
          </header>
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
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
