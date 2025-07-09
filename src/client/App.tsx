import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { LoginButton } from './components/LoginButton';
import { OidcProtected } from './components/OidcProtected';
import { setRepositoryAccessToken } from './services/sensenet';
import { TimelineCreatePage } from './pages/TimelineCreatePage';
import { TimelineViewPage } from './pages/TimelineViewPage';
import { TimelineListPage } from './pages/TimelineListPage.tsx';

function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h1>TimelineVerse</h1>
            <LoginButton />
          </header>
          <Routes>
            <Route path="/timelines" element={<TimelineListPage />} />
            <Route path="/timelines/:id" element={<TimelineViewPage />} />
            <Route
              path="/create"
              element={
                <OidcProtected>
                  <TimelineCreatePage />
                </OidcProtected>
              }
            />
            <Route path="*" element={<Navigate to="/timelines" />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
