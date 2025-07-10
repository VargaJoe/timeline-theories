# SenseNet Authentication Integration Guide

## Overview
This guide provides step-by-step instructions for implementing authentication in a client application using the SenseNet repository and OIDC (OpenID Connect) with `@sensenet/authentication-oidc-react`. It covers best practices, common pitfalls, and all the details a developer or AI agent needs to build a robust login/logout experience from scratch.

---

## 1. Prerequisites
- **React** (v17+ supported, v18+ recommended)
- **TypeScript** (recommended)
- **Material-UI** (for UI, optional) - Use v4 for React v17 compatibility
- **SenseNet repository** (cloud or on-prem)
- **OIDC provider** (SenseNet IdentityServer or compatible)

**Important React Version Notes:**
- If using Material-UI v4, you need React v17.0.2 for compatibility
- @sensenet/authentication-oidc-react works with both React v17 and v18
- Downgrade React if you encounter peer dependency conflicts with Material-UI

---

## 2. Install Required Packages
```
yarn add @sensenet/authentication-oidc-react @sensenet/client-core history react-router-dom
# or
npm install @sensenet/authentication-oidc-react @sensenet/client-core history react-router-dom
```

---

## 3. Configure OIDC Authentication
Create a `configuration.ts` file:
```ts
export const repositoryUrl = 'https://your-sensenet-repo-url';
export const configuration = {
  client_id: 'your-client-id',
  authority: 'https://your-identity-server-url',
  redirect_uri: `${window.location.origin}/authentication/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'sensenet',
  silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
  automaticSilentRenew: true,
  extraQueryParams: { snrepo: repositoryUrl },
};
```
- **Traps:**
  - Make sure `client_id` and `authority` match your OIDC provider setup.
  - All URIs must be registered in your OIDC provider.
  - Use environment variables for secrets in production.

---

## 4. Create a Singleton Browser History
OIDC authentication requires a singleton browser history object for compatibility with React Router v6+ and the OIDC provider:
```ts
import { createBrowserHistory } from 'history';
export const browserHistory = createBrowserHistory();
```

---

## 5. Set Up Authentication Provider and Router
Wrap your app with the OIDC provider in `AppProviders.tsx`:
```tsx
import { AuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { configuration, browserHistory } from './configuration';

export const AppProviders = ({ children }) => (
  <AuthenticationProvider configuration={configuration} history={browserHistory}>
    {children}
  </AuthenticationProvider>
);
```

**Router Setup - Two Approaches:**

**Approach A: BrowserRouter + Custom Authentication (Recommended for React v17)**
```tsx
// App.tsx
<AppProviders>
  <BrowserRouter>
    <Routes>
      <Route path="/protected" element={
        <AuthenticatedContent>
          <ProtectedPage />
        </AuthenticatedContent>
      } />
    </Routes>
  </BrowserRouter>
</AppProviders>
```

**Approach B: OIDC Provider Routing (Advanced)**
```tsx
// App.tsx - No BrowserRouter needed
<AppProviders>
  <Routes>
    <Route path="/protected" element={
      <OidcSecure history={browserHistory}>
        <ProtectedPage />
      </OidcSecure>
    } />
  </Routes>
</AppProviders>
```

- **Traps:**
  - Approach B can cause router context conflicts in some React Router v6 setups
  - If you get "useContext is null" errors, use Approach A
  - Always use the same browserHistory instance for consistency

---

## 6. Implement Login/Logout UI
Use the `useOidcAuthentication` hook for login state:
```tsx
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

const { oidcUser, login, logout, isLoading, error } = useOidcAuthentication();
```

**Loading State Handling:**
```tsx
// ❌ Avoid persistent loading states that block UI
if (isLoading) {
  return <button disabled>Loading...</button>; // Can get stuck!
}

// ✅ Better approach - show login button immediately
if (error) {
  return <div>Error: {error}</div>;
}
if (oidcUser) {
  return <button onClick={logout}>Logout</button>;
} else {
  return <button onClick={login}>Login</button>; // Always accessible
}
```

- Show a login button if not authenticated, logout if authenticated.
- Avoid showing loading states that can persist indefinitely.
- Handle errors gracefully with user-friendly messages.

---

## 7. Protect Routes - Two Approaches

**Approach A: Custom Authentication Component (Recommended)**
```tsx
// AuthenticatedContent.tsx
const AuthenticatedContent = ({ children, fallback }) => {
  const { oidcUser, isLoading } = useOidcAuthentication();
  
  if (isLoading) return <div>Loading...</div>;
  if (!oidcUser) {
    return fallback || <div>Please log in to access this page.</div>;
  }
  return <>{children}</>;
};

// Usage in routes
<Route path="/create" element={
  <AuthenticatedContent>
    <CreatePage />
  </AuthenticatedContent>
} />
```

**Approach B: OidcSecure Component**
```tsx
// Usage
<OidcSecure history={browserHistory}>
  <YourProtectedComponent />
</OidcSecure>
```

- **Traps:**
  - Approach B requires careful router context management
  - If you see router context errors, use Approach A
  - Custom components give you more control over the authentication UX

---

## 8. Pass Access Token to SenseNet Client
Update your SenseNet service to inject the OIDC access token:
```ts
import { Repository } from '@sensenet/client-core';
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
- Call `setRepositoryAccessToken(oidcUser.access_token)` when the user logs in.

---

## 8.1. Logout Implementation - Local vs External
**Problem:** Default OIDC logout redirects users to external identity server logout page, creating poor UX.

**Two Logout Approaches:**

**❌ External Logout (Default - Not Recommended)**
```tsx
// This redirects to external logout page
<button onClick={logout}>Logout</button>
```
**Issues:**
- Redirects to identity server logout confirmation page
- User must click "Yes" to confirm logout
- May not redirect back to your app reliably
- Creates confusing user experience

**✅ Local Logout (Recommended)**
```tsx
const handleLocalLogout = async () => {
  try {
    // Step 1: Clear repository token immediately
    setRepositoryAccessToken('');
    
    // Step 2: Clear OIDC storage manually
    const authority = 'https://your-identity-server-url';
    const clientId = 'your-client-id';
    const storageKey = `oidc.user:${authority}:${clientId}`;
    
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
    
    // Step 3: Try userManager.removeUser() if available
    if (oidcResult.userManager) {
      await oidcResult.userManager.removeUser();
    }
    
    // Step 4: Force page refresh to update UI
    window.location.reload();
  } catch (err) {
    // Fallback: nuclear option
    localStorage.clear();
    window.location.href = '/';
  }
};

// Use local logout in component
<button onClick={handleLocalLogout}>Logout</button>
```

**Configuration Options to Help with Logout:**
```ts
export const configuration = {
  // ... other config
  monitorSession: false,
  revokeAccessTokenOnSignout: true,
  // Don't rely on post_logout_redirect_uri for complex apps
};
```

---

## 9. Common Pitfalls & Troubleshooting
- **Router context errors ("useContext is null"):**
  - ❌ Mixing OIDC provider routing with BrowserRouter can cause conflicts
  - ✅ Use BrowserRouter + custom AuthenticatedContent for better compatibility
  - ✅ Or use OIDC provider routing without BrowserRouter (advanced)
- **Login button stuck on "Loading...":**
  - ❌ Persistent isLoading states can block the UI indefinitely
  - ✅ Show login button immediately, handle loading in background
- **Logout redirects to external identity server:**
  - ❌ Default OIDC logout() redirects to identity server logout page
  - ❌ User gets stuck on external logout confirmation page
  - ❌ post_logout_redirect_uri may not work reliably with all OIDC providers
  - ✅ **Solution: Implement local logout instead of external redirect**
  ```tsx
  const handleLocalLogout = async () => {
    try {
      // Clear repository token first
      setRepositoryAccessToken('');
      
      // Manual storage clearing approach
      const authority = 'https://your-identity-server';
      const clientId = 'your-client-id';
      const storageKey = `oidc.user:${authority}:${clientId}`;
      
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      
      // Try userManager.removeUser() if available
      if (userManager) {
        await userManager.removeUser();
      }
      
      // Force page refresh to update authentication state
      window.location.reload();
    } catch (err) {
      // Fallback: clear all storage and redirect
      localStorage.clear();
      window.location.href = '/';
    }
  };
  ```
- **Login button does not work:**
  - Make sure the login function is called from a user action (e.g., button click).
- **Token not sent to API:**
  - Ensure you patch the repository fetch method with the access token after login.
- **Multiple login attempts or silent renew issues:**
  - Only wrap your app once with the OIDC provider.
- **React version conflicts:**
  - Use React v17.0.2 if you need Material-UI v4 compatibility
  - Install matching @types/react and @types/react-dom versions
- **History object mismatches:**
  - Always use the same browserHistory instance across your app
  - Don't create new history objects on every render

---

## 9.1. Debugging Logout Issues

**Check Browser Console:**
```tsx
// Add debug logging to understand logout behavior
const { oidcUser, logout, userManager } = useOidcAuthentication();

console.log('Available OIDC methods:', Object.keys(oidcResult));
console.log('UserManager available:', !!userManager);
if (userManager) {
  console.log('UserManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(userManager)));
}
```

**Check Browser Storage:**
- Open DevTools → Application → Local Storage
- Look for keys like `oidc.user:authority:client_id`
- Verify storage is cleared after logout

**Common Logout Problems:**
1. **External redirect happens anyway:** 
   - OIDC provider forces external logout
   - Solution: Use manual storage clearing approach

2. **UI doesn't update after logout:**
   - Authentication state not refreshed
   - Solution: Force page reload or state refresh

3. **Token still sent to API after logout:**
   - Repository token not cleared
   - Solution: Call `setRepositoryAccessToken('')` immediately

4. **User appears logged in after refresh:**
   - Storage not fully cleared
   - Solution: Clear both localStorage and sessionStorage

**Testing Logout Flow:**
1. Log in and verify authentication state
2. Check browser storage contains OIDC user data
3. Click logout button
4. Verify no external redirect occurs
5. Check storage is cleared
6. Verify UI shows logged-out state
7. Verify API calls no longer include auth token

---

## 10. Example File Structure
```
src/
  App.tsx
  AppProviders.tsx
  components/
    LoginButton.tsx
    LoginPage.tsx
  configuration.ts
  services/
    sensenet.ts
```

---

## 11. Security Notes
- Never commit secrets or client secrets to source control.
- Use HTTPS for all OIDC and API endpoints.
- Use environment variables for sensitive config.

---

## 12. References
- [@sensenet/authentication-oidc-react docs](https://github.com/SenseNet/authentication-oidc-react)
- [SenseNet documentation](https://docs.sensenet.com/)
- [OpenID Connect](https://openid.net/connect/)
- [React Router](https://reactrouter.com/)
- [history package](https://www.npmjs.com/package/history)

---

## 13. Final Checklist
- [ ] OIDC config matches your provider
- [ ] Singleton history object used everywhere
- [ ] Login/logout UI implemented
- [ ] **Local logout implemented (not external redirect)**
- [ ] OidcSecure or AuthenticatedContent wraps protected routes
- [ ] Access token injected into SenseNet client
- [ ] **Repository token cleared on logout**
- [ ] **OIDC storage cleared manually on logout**
- [ ] No deprecated local login code remains
- [ ] **Logout doesn't redirect to external identity server**
- [ ] **Page refresh forces authentication state update after logout**

---

With this guide, any developer or AI agent can implement robust SenseNet authentication from scratch, avoid common traps, and deliver a secure, user-friendly login experience.
