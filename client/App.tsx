import { Fragment, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType, useParams } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { TopNavigationBar } from './components/TopNavigationBar';
import { PermissionContent } from './components/PermissionContent';
import { environment } from './configuration';
import { timelinesPath, mediaLibraryPath } from './projectPaths';
import { useSharedAuth } from './context/useSharedAuth';

function IdentityBoundary({ children }: { children: ReactNode }) {
  const { accessToken, isAuthenticated, user } = useSharedAuth();
  // Remount read pages on identity changes, discarding previous data and async results.
  return <Fragment key={JSON.stringify([accessToken, isAuthenticated, user])}>{children}</Fragment>;
}
function MediaReadRoute() {
  const { id } = useParams();
  const target = id && /^\d+$/.test(id) ? Number(id) : `${mediaLibraryPath}/${id}`;
  return <PermissionContent operations={[{ target, action: 'read' }]}><MediaItemViewPage /></PermissionContent>;
}

function EntryCreateRoute() {
  const { timelineId } = useParams();
  const target = timelineId && /^\d+$/.test(timelineId) ? Number(timelineId) : `${timelinesPath}/${timelineId}`;
  return <PermissionContent operations={[{ target, action: 'create', contentType: 'TimelineEntry' }]}><TimelineEntryCreatePage /></PermissionContent>;
}

import { TimelineCreatePage } from './pages/TimelineCreatePage';
import { TimelineViewPage } from './pages/TimelineViewPage';
import { TimelineListPage } from './pages/TimelineListPage.tsx';
import MediaLibraryPage from './pages/MediaLibraryPage';
import MediaItemCreatePage from './pages/MediaItemCreatePage';
import { MediaItemViewPage } from './pages/MediaItemViewPage';
import { OidcTokenInjector } from './components/OidcTokenInjector';
import TimelineEntryCreatePage from './pages/TimelineEntryCreatePage';
import AuthCallbackPage from './pages/AuthCallbackPage';

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

  return (
    <AppProviders>
      <OidcTokenInjector />
      <BrowserRouter>
        <ScrollToTopOnRouteChange />
        <div style={{ minHeight: '100vh', background: '#f8f9fa' }}>
          <TopNavigationBar />
          <div role="status" style={{ padding: '8px 16px', fontSize: 12, background: environment.writable ? '#e9f5ec' : '#fff0ce', overflowWrap: 'anywhere' }}>
            {environment.mode} · {environment.writable ? 'Local writes enabled' : 'Read only'} · Repository: {environment.repositoryUrl} · Auth: {environment.authority}
          </div>
          <main>
            <IdentityBoundary><Routes>
              <Route path="/authentication/callback" element={<AuthCallbackPage />} />
              <Route path="/timelines" element={<PermissionContent operations={[{ target: timelinesPath, action: 'read' }]}><TimelineListPage /></PermissionContent>} />
              <Route path="/timelines/:id" element={<TimelineViewPage />} />
              <Route path="/media-library" element={<PermissionContent operations={[{ target: mediaLibraryPath, action: 'read' }]}><MediaLibraryPage /></PermissionContent>} />
              <Route path="/media-library/:id" element={<MediaReadRoute />} />
              <Route
                path="/media-library/create"
                element={
                  <PermissionContent operations={[{ target: mediaLibraryPath, action: 'create', contentType: 'MediaItem' }]}>
                    <MediaItemCreatePage />
                  </PermissionContent>
                }
              />
              <Route
                path="/create"
                element={
                  <PermissionContent operations={[{ target: timelinesPath, action: 'create', contentType: 'Timeline' }]}>
                    <TimelineCreatePage />
                  </PermissionContent>
                }
              />
              <Route path="/timelines/:timelineId/add-entry" element={<EntryCreateRoute />} />
              <Route path="*" element={<Navigate to="/timelines" />} />
            </Routes></IdentityBoundary>
          </main>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
