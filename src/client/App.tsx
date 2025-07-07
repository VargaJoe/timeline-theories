import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { LoginButton } from './components/LoginButton';
import { OidcProtected } from './components/OidcProtected';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from './services/sensenet';
import { TimelineCreatePage } from './pages/TimelineCreatePage';
import { TimelineViewPage } from './pages/TimelineViewPage';

const ProtectedContent = () => {
  const { oidcUser } = useOidcAuthentication();
  useEffect(() => {
    if (oidcUser?.access_token) setRepositoryAccessToken(oidcUser.access_token);
  }, [oidcUser]);
  return <div>Protected: You are logged in with SenseNet OIDC!</div>;
};

function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          <h1>TimelineVerse</h1>
          <LoginButton />
          <OidcProtected>
            <Routes>
              <Route path="/create" element={<TimelineCreatePage />} />
              <Route path="/timelines/:id" element={<TimelineViewPage />} />
              <Route path="*" element={<Navigate to="/create" />} />
            </Routes>
          </OidcProtected>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
