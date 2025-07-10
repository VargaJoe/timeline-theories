# SenseNet OIDC Authentication - AI Agent Implementation Guide

**Critical for AI agents implementing SenseNet OIDC authentication in React apps**

---

## 🚨 CRITICAL PITFALLS TO AVOID

1. **LOGOUT REDIRECT ISSUE** - Default `logout()` redirects to external identity server
   - ✅ **Solution: Use local logout with manual storage clearing**
2. **ROUTER CONFLICTS** - OIDC provider + BrowserRouter can conflict  
   - ✅ **Solution: Use BrowserRouter + custom AuthenticatedContent**
3. **LOADING STATE TRAP** - `isLoading` can persist indefinitely
   - ✅ **Solution: Show login button immediately, ignore loading states**
4. **REACT VERSION** - Material-UI v4 requires React v17.0.2
   - ✅ **Solution: Downgrade React if using Material-UI**

---

## Quick Setup Checklist

```bash
# 1. Install packages
npm install @sensenet/authentication-oidc-react @sensenet/client-core history react-router-dom

# 2. If using Material-UI, downgrade React
npm install react@17.0.2 react-dom@17.0.2 @types/react@17.0.87 @types/react-dom@17.0.17
```

---

## Essential Files

### configuration.ts
```ts
import { createBrowserHistory } from 'history';

export const repositoryUrl = import.meta.env.VITE_SENSENET_REPO_URL || 'https://your-sensenet-repo-url';
export const browserHistory = createBrowserHistory();
export const configuration = {
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID || 'your-client-id',
  authority: import.meta.env.VITE_OIDC_AUTHORITY || 'https://your-identity-server-url',
  redirect_uri: `${window.location.origin}/authentication/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'sensenet',
  silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
  automaticSilentRenew: true,
  extraQueryParams: { snrepo: repositoryUrl },
  monitorSession: false,
  revokeAccessTokenOnSignout: true,
};
```

### AppProviders.tsx
```tsx
import { AuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { configuration, browserHistory } from './configuration';

export const AppProviders = ({ children }: { children: React.ReactNode }) => (
  <AuthenticationProvider configuration={configuration} history={browserHistory}>
    {children}
  </AuthenticationProvider>
);
```

### App.tsx (Recommended Pattern)
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { LoginButton } from './components/LoginButton';
import { AuthenticatedContent } from './components/AuthenticatedContent';
import { OidcTokenInjector } from './components/OidcTokenInjector';

function App() {
  return (
    <AppProviders>
      <OidcTokenInjector />
      <BrowserRouter>
        <header>
          <LoginButton />
        </header>
        <Routes>
          <Route path="/protected" element={
            <AuthenticatedContent>
              <ProtectedPage />
            </AuthenticatedContent>
          } />
        </Routes>
      </BrowserRouter>
    </AppProviders>
  );
}
```

### LoginButton.tsx (WITH LOCAL LOGOUT)
```tsx
import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

export const LoginButton: React.FC = () => {
  const { oidcUser, login, error } = useOidcAuthentication();
  
  // 🚨 CRITICAL: Use local logout to avoid external redirect
  const handleLocalLogout = async () => {
    try {
      setRepositoryAccessToken('');
      
      // Clear OIDC storage manually
      const authority = import.meta.env.VITE_OIDC_AUTHORITY || 'https://your-identity-server-url';
      const clientId = import.meta.env.VITE_OIDC_CLIENT_ID || 'your-client-id';
      const storageKey = `oidc.user:${authority}:${clientId}`;
      
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      window.location.reload();
    } catch (err) {
      localStorage.clear();
      window.location.href = '/';
    }
  };

  if (error) return <div>Auth Error: {error}</div>;
  
  return oidcUser ? (
    <button onClick={handleLocalLogout}>Logout</button>
  ) : (
    <button onClick={login}>Login</button>
  );
};
```

### AuthenticatedContent.tsx
```tsx
import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

export const AuthenticatedContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { oidcUser, isLoading } = useOidcAuthentication();
  
  if (isLoading) return <div>Loading...</div>;
  if (!oidcUser) return <div>Please log in to access this page.</div>;
  
  return <>{children}</>;
};
```

### OidcTokenInjector.tsx
```tsx
import { useEffect } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();

  useEffect(() => {
    setRepositoryAccessToken(oidcUser?.access_token || '');
  }, [oidcUser]);

  return null;
};
```

### services/sensenet.ts
```ts
import { Repository } from '@sensenet/client-core';
import { repositoryUrl } from '../configuration';

export const repository = new Repository({ repositoryUrl });

export const setRepositoryAccessToken = (token: string) => {
  const origFetch = repository.fetch;
  repository.fetch = (input, init) => {
    const headers = new Headers(init?.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return origFetch.call(repository, input, { ...init, headers });
  };
};
```

---

## Implementation Checklist

- [ ] Install packages with correct React version
- [ ] Create configuration with real OIDC values
- [ ] Set up AppProviders with AuthenticationProvider
- [ ] Use BrowserRouter + AuthenticatedContent pattern
- [ ] **Implement LOCAL LOGOUT (not default logout)**
- [ ] Add OidcTokenInjector for automatic token injection
- [ ] Test: Login → Check storage → Logout → Verify no external redirect

---

## Debugging Commands

```js
// In browser console - check OIDC state
localStorage.getItem('oidc.user:https://your-identity-server-url:your-client-id')

// Check available methods
console.log(Object.keys(useOidcAuthentication()))
```

---

## Key Success Patterns

1. **Always use local logout** - Never use default `logout()` function
2. **BrowserRouter + AuthenticatedContent** - Most reliable routing pattern  
3. **Ignore isLoading for UI** - Show login button immediately
4. **Single AuthenticationProvider** - Wrap entire app once
5. **Force page refresh after logout** - Ensures clean state

This guide provides everything needed to implement working SenseNet OIDC authentication without the common pitfalls.
