# Multi-Layer Authentication Implementation Guide

## Overview

This document describes the implementation of **three-layer authentication support** in the Timeline Theories application:

1. **Visitor Mode (API Key)** - Unauthenticated access with API key for public viewing
2. **SNAuth** - SenseNet authentication with Bearer tokens stored in localStorage
3. **IdentityServer OIDC** - External identity provider with token-based authentication

The system automatically detects and uses the appropriate authentication method based on configuration and user state. It covers critical pitfalls, solutions, and lessons learned during development.

---

## Authentication Layers

### Layer 1: Visitor Mode (API Key Authentication)

**Purpose:** Enable unauthenticated users to browse public content without requiring login.

**Implementation:** Query parameter-based API key authentication

**When Active:**
- User is NOT logged in (no Bearer token in repository.configuration)
- `VITE_SENSENET_API_KEY` environment variable is configured
- All SenseNet requests automatically include apikey as query parameter

**Key Features:**
- ✅ Bypasses CORS preflight (query params don't trigger OPTIONS requests)
- ✅ Works with both API requests and binary URLs (images, files)
- ✅ Automatically disabled when user logs in (to preserve user permissions)
- ✅ Completely optional - app works without it if not configured

**Configuration:**
```bash
# .env.local
VITE_SENSENET_API_KEY=your-api-key-here
```

**Critical Implementation Details:**

1. **Binary Handler URLs (images):** Always append apikey even when authenticated
   - Browsers cannot send Bearer tokens (SNAuth mode) in `<img>` tag requests
   - Binary URLs like `/binaryhandler.ashx?nodeid=X` require query parameter auth
   - Using apikey for images is safe - they're typically public content

2. **OData API URLs:** Only append apikey when NOT authenticated
   - When user is logged in, repository.fetch() sends Bearer token
   - This preserves user permission levels
   - Prevents security issue where apikey permissions bypass user permissions

**Implementation Location:** `client/services/sensenet.ts`

```typescript
// Global fetch wrapper - injects apikey for unauthenticated API requests
if (sensenetApiKey) {
  const originalGlobalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    
    if (url.startsWith(repositoryUrl)) {
      if (!isAuthenticated()) {
        // Add apikey as query parameter for unauthenticated requests
        const urlObj = new URL(url);
        urlObj.searchParams.set('apikey', sensenetApiKey);
        url = urlObj.toString();
        // Update input...
      }
    }
    return originalGlobalFetch(input, init);
  };
}

// Helper for binary URLs (images used in <img> tags)
export function appendApiKeyToUrl(url: string): string {
  if (!sensenetApiKey) return url;
  if (!url.startsWith(repositoryUrl)) return url;
  
  const isBinaryUrl = url.includes('/binaryhandler.ashx');
  const hasToken = (repository.configuration as { token?: string }).token;
  
  // Binary URLs: always append (browsers can't send Bearer tokens in img tags)
  // API URLs: only append when not authenticated (preserve user permissions)
  const shouldAppendApiKey = isBinaryUrl || !hasToken;
  
  if (!shouldAppendApiKey) return url;
  
  const urlObj = new URL(url);
  if (!urlObj.searchParams.has('apikey')) {
    urlObj.searchParams.set('apikey', sensenetApiKey);
  }
  return urlObj.toString();
}
```

**Security Considerations:**
- API key provides limited "visitor" level permissions configured in SenseNet
- User permissions take precedence when authenticated
- Binary URLs safely use apikey even when authenticated (images are typically public)
- Never exposes API key in client-side code (loaded from env variables)

**Usage:**
```typescript
// For binary URLs used in <img> tags
import { appendApiKeyToUrl } from './services/sensenet';

const imageUrl = appendApiKeyToUrl(binaryHandlerUrl);
// <img src={imageUrl} /> - Browser can load image with apikey parameter

// For API requests
// Global fetch wrapper handles this automatically when not authenticated
```

---

### Layer 2: SNAuth Authentication

**Purpose:** Native SenseNet authentication with JWT tokens.

**When Active:** 
- SenseNet server configured with SNAuth authentication mode
- User clicks "Login with SNAuth" button
- Tokens stored in localStorage, sent as Bearer tokens in API requests

**Limitations:**
- ⚠️ Bearer tokens in localStorage cannot be sent by browsers in `<img>` tag requests
- This is why binary URLs need apikey even when SNAuth authenticated

---

### Layer 3: IdentityServer OIDC Authentication

**Purpose:** External identity provider integration (e.g., company SSO, third-party auth).

**When Active:**
- SenseNet server configured with IdentityServer/OIDC authentication mode
- User clicks "Login with IdentityServer" button
- Tokens managed by OIDC library, sent as Bearer tokens in API requests

---

## Architecture

### Authentication Flow Detection

```typescript
// Auto-detect authentication type from SenseNet API
const authConfig = await fetch(`${repoUrl}/odata.svc/('Root')/GetClientRequestParameters?clientType=adminui`);
const authType = authConfig.authenticationMode; // "SNAuth" or "Windows"
```

**Key Points:**
- Detection happens at application startup in `AppProviders.tsx`
- Response determines which provider to render: `SNAuthProviderWrapper` or `ISAuthProviderWrapper`
- Configuration is cached in component state, not localStorage
- **API Key layer operates independently** - works with any auth mode or no auth at all

**Authentication Priority:**
1. **User authenticated** (SNAuth or OIDC) → Use Bearer token for API requests, apikey for images
2. **User not authenticated + apikey configured** → Use apikey for all requests
3. **User not authenticated + no apikey** → Requests may fail or work based on SenseNet permissions

---

## API Key Authentication (Visitor Mode)

### Configuration

Add to `.env.local`:
```bash
VITE_SENSENET_API_KEY=your-pre-generated-api-key-here
```

Add to `client/configuration.ts`:
```typescript
export const sensenetApiKey = import.meta.env.VITE_SENSENET_API_KEY || '';
```

### How It Works

1. **Global Fetch Wrapper:** Intercepts all fetch requests to SenseNet
2. **Authentication Check:** Determines if user has Bearer token
3. **Conditional Injection:**
   - If NOT authenticated → Append apikey to URL as query parameter
   - If authenticated → Skip apikey (use Bearer token instead)
4. **Binary URL Helper:** Always appends apikey to binary handler URLs (even when authenticated)

### Why Query Parameters?

**CORS Preflight Issue:**
- Custom headers (like `apikey: xxx`) trigger CORS preflight OPTIONS requests
- Preflight requests often fail or require additional server configuration
- Query parameters bypass CORS preflight entirely

**Verified Solution:**
```bash
# Both methods work, but query param avoids CORS:
curl -k -H "apikey: xxx" https://localhost:41016/odata.svc/('Root')/GetCurrentUser
curl -k "https://localhost:41016/odata.svc/('Root')/GetCurrentUser?apikey=xxx"
```

### Binary URLs and SNAuth Mode

**Critical Understanding:**

SNAuth authentication stores tokens in localStorage:
```javascript
localStorage.getItem('sn-auth-access-token'); // Bearer token
```

These tokens are sent in API requests via `Authorization: Bearer <token>` header.

**Problem:** Browsers **cannot** send custom headers (including Bearer tokens) in `<img>` tag requests.

**Solution:** Binary handler URLs must always include apikey parameter:
```html
<!-- This works - apikey in URL -->
<img src="/binaryhandler.ashx?nodeid=123&propertyname=CoverImageBin&apikey=xxx" />

<!-- This does NOT work - browser can't send Bearer token -->
<img src="/binaryhandler.ashx?nodeid=123&propertyname=CoverImageBin" />
```

**Note:** JWT authentication mode uses HTTP-only cookies which browsers DO send automatically in `<img>` tags. However, our implementation uses SNAuth mode.

### Implementation Files

**Modified Files:**
- `client/configuration.ts` - Added sensenetApiKey export
- `client/services/sensenet.ts` - Global fetch wrapper + appendApiKeyToUrl helper
- `client/services/mediaLibraryService.ts` - Uses appendApiKeyToUrl for cover images
- `client/pages/TimelineViewPage.tsx` - Uses appendApiKeyToUrl for timeline entry images
- `deployment/docker-compose.yml` - Added CORS configuration for apikey parameter

### Security Model

**API Key Permissions:**
- Configured in SenseNet as a limited "visitor" user
- Typically read-only access to public content
- Does not expose sensitive data or admin functions

**User Permissions:**
- When authenticated, API requests use user's Bearer token
- User sees content according to their permission level
- API key only used for images (public content)

**Permission Preservation:**
```typescript
// Authenticated user browsing timelines
// API request: Uses Bearer token → sees content per user permissions
fetch('/odata.svc/Root/Content/timelines', { 
  headers: { Authorization: 'Bearer user_token' } 
});

// Image in timeline: Uses apikey → loads image with visitor permissions
<img src="/binaryhandler.ashx?nodeid=123&apikey=xxx" />
```

This ensures authenticated users' permissions apply to API access while images remain accessible.

---

## SNAuth Implementation

### Critical Package Version Issue

**PROBLEM:** The published npm package `@sensenet/sn-auth-react@1.0.2` **DOES NOT INCLUDE** the automatic token exchange logic.

**Why:** The token exchange implementation exists in the `feature/sn-auth-package-extraimprovements` branch but **has not been merged to main** and is not published to npm.

**Solution:** Manual token exchange implementation required.

---

### Manual Token Exchange Implementation

The `@sensenet/sn-auth-react` package provides `SNAuthenticationProvider` and `useSnAuth` hook, but the provider in v1.0.2 **does not automatically process** the `auth_code` callback parameter.

#### Reference Implementation Location

The correct implementation exists here:
```
https://github.com/SenseNet/sn-client/blob/feature/sn-auth-package-extraimprovements/packages/sn-auth-react/src/components/authentication-provider.tsx
```

Key file: `authentication-provider.tsx` contains the `convertAuthToken()` function.

---

### Callback Flow (Manual Implementation)

Located in: `client/context/SNAuthProvider.tsx`

```typescript
useEffect(() => {
  const processCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('auth_code');
    
    if (!authCode) return;
    
    // 1. Get configuration from localStorage
    const authConfig = JSON.parse(window.localStorage.getItem('sn-auth-config'));
    
    // 2. Exchange auth_code for tokens
    const tokenResponse = await fetch(`${authConfig.authServerUrl}/api/auth/convert-auth-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: authCode }), // NOTE: key is "token", not "authCode"!
    });
    
    const tokenData = await tokenResponse.json();
    
    // 3. Store tokens in localStorage
    window.localStorage.setItem('sn-auth-access-token', tokenData.accessToken);
    window.localStorage.setItem('sn-auth-refresh-token', tokenData.refreshToken);
    
    // 4. Fetch user details
    const userResponse = await fetch(`${authConfig.repoUrl}/odata.svc/('Root')/GetCurrentUser`, {
      headers: { 'Authorization': `Bearer ${tokenData.accessToken}` },
    });
    
    const userData = await userResponse.json();
    window.localStorage.setItem('sn-auth-user-details', JSON.stringify(userData.d));
    
    // 5. Clean URL and redirect
    window.history.replaceState({}, '', '/timelines');
    window.location.href = '/timelines';
  };
  
  processCallback();
}, []);
```

---

### API Endpoints

**CRITICAL:** The correct endpoints differ from initial assumptions!

#### Token Exchange
```
POST ${authServerUrl}/api/auth/convert-auth-token
Content-Type: application/json

{
  "token": "<auth_code_value>"  // NOTE: Key is "token", NOT "authCode"!
}

Response:
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

#### User Details
```
GET ${repoUrl}/odata.svc/('Root')/GetCurrentUser
Authorization: Bearer <access_token>

Response:
{
  "d": {
    "Id": 123,
    "UserName": "admin",
    "DisplayName": "Administrator",
    ...
  }
}
```

**DO NOT USE:**
- ❌ `/api/authentication/token` (404)
- ❌ `/odata.svc/('Root')` (returns Root content, not user)
- ❌ Body key `authCode` (should be `token`)

---

### localStorage Keys

The package expects these exact keys:

```typescript
'sn-auth-config'         // Auth configuration (callbackUri, authServerUrl, repoUrl)
'sn-auth-access-token'   // JWT access token
'sn-auth-refresh-token'  // JWT refresh token
'sn-auth-user-details'   // User object from GetCurrentUser
```

**DO NOT** use custom naming - the package's internal hooks rely on these exact keys.

---

## Callback Route Configuration

### Route Definition

In `App.tsx`:
```tsx
<Route path="/authentication/callback" element={<AuthCallbackPage />} />
```

### Callback URI Configuration

Must match exactly:
```typescript
snAuthConfiguration={{
  callbackUri: `${window.location.origin}/authentication/callback`
}}
```

SNAuth server redirects to: `http://localhost:5173/authentication/callback?auth_code=<value>`

---

## Unified Auth Context Architecture

### AuthTypeContext

Provides global auth type information to all components:

```typescript
// AppProviders.tsx
export const AuthTypeContext = createContext<{ authType: AuthServerType | null }>({ authType: null });

export function useAuthType() {
  return useContext(AuthTypeContext);
}
```

**Usage in components:**
```typescript
const { authType } = useAuthType();
// authType is 'SNAuth' or 'IdentityServer'
```

### useSharedAuth Hook

Automatically detects and uses the active auth provider:

```typescript
// useSharedAuth.ts
export function useSharedAuth(): AuthContextModel {
  const snAuth = useContext(SNAuthContext);
  const isAuth = useContext(ISAuthContext);

  // Check ISAuth first (IdentityServer)
  if (isAuth !== undefined) {
    return isAuth;
  }

  // Check SNAuth
  if (snAuth !== undefined) {
    return snAuth;
  }

  // Fallback
  return {
    user: undefined,
    isAuthenticated: false,
    login: async () => { throw new Error('No auth provider available'); },
    logout: async () => { throw new Error('No auth provider available'); },
    isLoading: false,
  };
}
```

**Key points:**
- Returns the same `AuthContextModel` interface regardless of provider
- Components don't need to know which provider is active
- Simplifies component code (no try-catch for provider detection)

### Context Initialization with undefined

Both auth contexts use `undefined` as default to enable proper detection:

```typescript
// ISAuthProvider.tsx
const AuthContext = createContext<AuthContextModel | undefined>(undefined);

// SNAuthProvider.tsx  
const AuthContext = createContext<AuthContextModel | undefined>(undefined);
```

**Why?** This allows `useSharedAuth()` to distinguish between:
- Provider is active and mounted (context has value)
- Provider is not active (context is `undefined`)

Without this, both contexts would have default values making detection impossible.

---

## Provider Hierarchy

```
AppProviders
  └─ AuthTypeDetector (fetch auth config)
      └─ AuthTypeContext.Provider (provides authType to all children)
          ├─ SNAuthProviderWrapper (if SNAuth)
          │   └─ SNAuthenticationProvider (@sensenet/sn-auth-react)
          │       └─ SNAuthProvider (our wrapper)
          │           └─ SNAuthContext.Provider
          │               └─ children
          │
          └─ ISAuthProviderWrapper (if IdentityServer)
              └─ OidcAuthenticationProvider (@sensenet/authentication-oidc-react)
                  └─ ISAuthProvider (our wrapper)
                      └─ ISAuthContext.Provider
                          └─ children
```

**Key Points:** 
- We wrap BOTH the package provider AND add our own context provider for unified interface
- `AuthTypeContext` provides global auth type information to all child components
- Contexts use `undefined` as default value for proper provider detection
- `useSharedAuth()` hook automatically detects and uses the active provider

---

## Common Pitfalls & Solutions

### 1. "useSnAuth returns null user despite callback with auth_code"

**Cause:** Package v1.0.2 doesn't have automatic token exchange.

**Solution:** Implement manual token exchange as shown above.

---

### 2. "404 on /api/authentication/token"

**Cause:** Wrong endpoint URL.

**Solution:** Use `/api/auth/convert-auth-token` (note: `/api/auth/`, not `/api/authentication/`)

---

### 3. "User details not fetched correctly"

**Cause:** Using wrong OData endpoint.

**Solution:** 
- ❌ `${repoUrl}/odata.svc/('Root')` - returns Root folder content
- ✅ `${repoUrl}/odata.svc/('Root')/GetCurrentUser` - returns current user

---

### 4. "Tokens not persisting after page reload"

**Cause:** Using wrong localStorage keys.

**Solution:** Use exact keys expected by package:
- `sn-auth-access-token`
- `sn-auth-refresh-token`
- `sn-auth-user-details`

---

### 5. "Automatic login redirects visitors"

**Cause:** Implementing auto-login useEffect like in admin-ui reference.

**Solution:** 
- Admin UI auto-logs in because it's admin-only
- Public apps should NOT auto-redirect
- Only call `externalLogin()` when user clicks Login button

---

### 6. "Callback processes auth_code multiple times"

**Cause:** useEffect runs multiple times during React lifecycle.

**Solution:** Add processing guard state:
```typescript
const [isProcessingCallback, setIsProcessingCallback] = useState(false);

if (isProcessingCallback) return;
setIsProcessingCallback(true);
// ... process callback
```

---

### 7. "IdentityServer login shows SNAuth button"

**Cause:** LoginButton component tries to detect auth type by attempting to access both contexts.

**Solution:** Use centralized `AuthTypeContext` and `useSharedAuth()` hook:
```typescript
// AppProviders.tsx
export const AuthTypeContext = createContext<{ authType: AuthServerType | null }>({ authType: null });

// LoginButton.tsx
const { authType } = useAuthType();
const auth = useSharedAuth(); // Automatically detects active provider
```

---

### 8. "Cannot read properties of undefined (reading 'location')"

**Cause:** OIDC AuthenticationProvider needs a history object for navigation.

**Solution:** Pass `browserHistory` to OidcAuthenticationProvider:
```typescript
import { browserHistory } from './browserHistory';

<OidcAuthenticationProvider
  configuration={{...}}
  history={browserHistory}
>
```

---

### 9. "Wrong auth provider context being used"

**Cause:** Both SNAuthContext and ISAuthContext exist with default values, making detection ambiguous.

**Solution:** Initialize contexts with `undefined`:
```typescript
// ISAuthProvider.tsx & SNAuthProvider.tsx
const AuthContext = createContext<AuthContextModel | undefined>(undefined);

// useSharedAuth.ts
const isAuth = useContext(ISAuthContext);
if (isAuth !== undefined) {
  return isAuth; // Use IdentityServer
}
```

---

## Reference Implementations

### SenseNet Admin UI (OIDC)
```
https://github.com/SenseNet/sn-client/tree/main/apps/sensenet/src/context/repository-provider.tsx
```
- Uses OIDC/IdentityServer authentication
- Has automatic login for admin users

### SNAuth Feature Branch (SNAuth)
```
https://github.com/SenseNet/sn-client/tree/feature/sn-auth-package-extraimprovements/packages/sn-auth-react
```
- Contains token exchange implementation
- **NOT PUBLISHED TO NPM YET**
- Source of truth for SNAuth token exchange

### Server Actions Reference
```
https://github.com/SenseNet/sn-client/blob/feature/sn-auth-package-extraimprovements/packages/sn-auth-react/src/server-actions.ts
```
- All API endpoint definitions
- Request/response formats
- Error handling patterns

---

## Testing Checklist

### API Key (Visitor Mode) Flow
- [ ] Set `VITE_SENSENET_API_KEY` in `.env.local`
- [ ] Start app without logging in
- [ ] Open Network tab in browser DevTools
- [ ] Navigate to timeline list page
- [ ] Verify OData requests include `?apikey=xxx` in URL
- [ ] Verify images load successfully with `?apikey=xxx` in URL
- [ ] No CORS errors in console
- [ ] No 404 errors for images or API calls
- [ ] Login with SNAuth or OIDC
- [ ] After login, verify OData requests use `Authorization: Bearer` header (no apikey in URL)
- [ ] After login, verify images still include `?apikey=xxx` in URL
- [ ] Remove `VITE_SENSENET_API_KEY` from config
- [ ] Restart app - verify it works normally (with authentication required)

### SNAuth Flow
- [ ] Login button triggers externalLogin()
- [ ] SNAuth server page loads
- [ ] After login, redirects to `/authentication/callback?auth_code=...`
- [ ] Console logs show "🔑 auth_code found! Starting manual token exchange..."
- [ ] POST to `/api/auth/convert-auth-token` succeeds (200)
- [ ] GET to `/GetCurrentUser` succeeds (200)
- [ ] localStorage contains all 3 keys (config, access-token, refresh-token)
- [ ] User object appears in useSnAuth() hook
- [ ] Page redirects to /timelines
- [ ] User remains authenticated after page reload

### IdentityServer/OIDC Flow
- [ ] Login button shows "Login with IdentityServer"
- [ ] Login button triggers OIDC redirect
- [ ] IdentityServer login page loads
- [ ] After login, redirects to `/authentication/callback` with code
- [ ] OIDC library exchanges code for tokens automatically
- [ ] User object appears in useOidcAuthentication() hook
- [ ] User remains authenticated after page reload
- [ ] Logout works correctly

### Unified Auth Context
- [ ] `useSharedAuth()` returns correct provider based on auth type
- [ ] `useAuthType()` returns correct auth type ('SNAuth' or 'IdentityServer')
- [ ] LoginButton shows correct auth type label
- [ ] No context errors in console
- [ ] Switching between auth types works (by changing repository URL)

---

## Future Improvements

### When @sensenet/sn-auth-react updates

Once the feature branch is merged and published:

1. **Update package.json:**
   ```json
   "@sensenet/sn-auth-react": "^2.0.0"  // or whatever version includes token exchange
   ```

2. **Remove manual token exchange:**
   - Delete the `processCallback` useEffect from `SNAuthProvider.tsx`
   - The package will handle it automatically

3. **Simplify SNAuthProvider:**
   - Only need to wrap `useSnAuth()` hook
   - No manual localStorage manipulation needed

4. **Test thoroughly:**
   - Ensure automatic token exchange works
   - Verify localStorage keys match expectations

---

## Debugging Tips

### Enable verbose logging

All components log with prefixes:
```
[AppProviders]
[SNAuthProvider]
[SNAuthProviderWrapper]
[AuthCallbackPage]
[LoginButton]
```

### Check localStorage

```javascript
// In browser console
Object.keys(localStorage).filter(k => k.includes('auth') || k.includes('sn-'))
```

### Verify API responses

```javascript
// Token exchange
const resp = await fetch('https://localhost:51017/api/auth/convert-auth-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'YOUR_AUTH_CODE' })
});
console.log(await resp.json());

// User details
const user = await fetch('https://localhost:51016/odata.svc/(\'Root\')/GetCurrentUser', {
  headers: { 'Authorization': 'Bearer YOUR_ACCESS_TOKEN' }
});
console.log(await user.json());
```

---

## Contact & Support

For issues with:
- **SNAuth package:** https://github.com/SenseNet/sn-client/issues
- **This implementation:** Check git history or contact development team

---

## Changelog

### 2026-01-29 - API Key Authentication Layer
- Added visitor mode with API key authentication
- Implemented global fetch wrapper for automatic apikey injection
- Created `appendApiKeyToUrl()` helper for binary handler URLs
- Added SNAuth mode binary URL handling (images always use apikey)
- Implemented permission preservation (API requests use Bearer token when authenticated)
- Updated security model to handle three authentication layers
- Added CORS configuration for apikey query parameter
- Documented query parameter approach vs header approach
- Added comprehensive testing checklist for visitor mode

### 2025-12-21 - Context Architecture Improvements
- Added `AuthTypeContext` for global auth type tracking
- Refactored `LoginButton` to use `useSharedAuth()` and `useAuthType()`
- Fixed context initialization with `undefined` defaults for proper detection
- Updated `useSharedAuth()` to prioritize ISAuth, then SNAuth
- Added `browserHistory` to `OidcAuthenticationProvider` to fix login redirect
- Added comprehensive logging to `ISAuthProvider` for debugging
- Resolved "Cannot read properties of undefined (reading 'location')" error
- Fixed issue where IdentityServer login showed SNAuth button

### 2025-12-21 - Initial Implementation
- Implemented dual auth detection
- Added manual SNAuth token exchange
- Created unified auth context interface
- Fixed callback URL processing
- Resolved 404 endpoint issues

---

**Last Updated:** January 29, 2026  
**Author:** Development Team  
**Status:** Active Development

