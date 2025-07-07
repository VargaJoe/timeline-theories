# SenseNet Authentication Integration Guide

## Overview
This guide provides step-by-step instructions for implementing authentication in a client application using the SenseNet repository and OIDC (OpenID Connect) with `@sensenet/authentication-oidc-react`. It covers best practices, common pitfalls, and all the details a developer or AI agent needs to build a robust login/logout experience from scratch.

---

## 1. Prerequisites
- **React** (v18+ recommended)
- **TypeScript** (recommended)
- **Material-UI** (for UI, optional)
- **SenseNet repository** (cloud or on-prem)
- **OIDC provider** (SenseNet IdentityServer or compatible)

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

## 5. Set Up Authentication Provider
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
- **Traps:**
  - Do not create a new history object on every render.
  - Always use the same instance for both OIDC and React Router.

---

## 6. Implement Login/Logout UI
Use the `useOidcAuthentication` hook for login state:
```tsx
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

const { oidcUser, login, logout, isLoading, error } = useOidcAuthentication();
```
- Show a login button if not authenticated, logout if authenticated.
- Show loading and error states for better UX.

---

## 7. Protect Routes
Use the `OidcSecure` component to protect routes:
```tsx
import { OidcSecure } from '@sensenet/authentication-oidc-react';

<OidcSecure history={browserHistory}>
  <YourProtectedComponent />
</OidcSecure>
```
- **Traps:**
  - If you see a spinner that never disappears, check your history object and OIDC config.

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

## 9. Common Pitfalls & Troubleshooting
- **Spinner never disappears:**
  - Ensure you use a singleton history object for both OIDC and React Router.
  - Check redirect URIs and OIDC config.
- **Login button does not work:**
  - Make sure the login function is called from a user action (e.g., button click).
- **Token not sent to API:**
  - Ensure you patch the repository fetch method with the access token after login.
- **Multiple login attempts or silent renew issues:**
  - Only wrap your app once with the OIDC provider.

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
- [ ] OidcSecure wraps protected routes
- [ ] Access token injected into SenseNet client
- [ ] No deprecated local login code remains

---

With this guide, any developer or AI agent can implement robust SenseNet authentication from scratch, avoid common traps, and deliver a secure, user-friendly login experience.
