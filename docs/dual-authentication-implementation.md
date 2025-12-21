# Dual Authentication Implementation Guide

## Overview

This document describes the implementation of dual authentication support (SNAuth and IdentityServer OIDC) in the Timeline Theories application. It covers critical pitfalls, solutions, and lessons learned during development.

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

## Provider Hierarchy

```
AppProviders
  └─ AuthTypeDetector (fetch auth config)
      ├─ SNAuthProviderWrapper (if SNAuth)
      │   └─ SNAuthenticationProvider (@sensenet/sn-auth-react)
      │       └─ SNAuthProvider (our wrapper)
      │           └─ children
      │
      └─ ISAuthProviderWrapper (if IdentityServer)
          └─ OidcAuthenticationProvider (@sensenet/authentication-oidc-react)
              └─ ISAuthProvider (our wrapper)
                  └─ children
```

**Key Point:** We wrap BOTH the package provider AND add our own context provider for unified interface.

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

### 2025-12-21 - Initial Implementation
- Implemented dual auth detection
- Added manual SNAuth token exchange
- Created unified auth context interface
- Fixed callback URL processing
- Resolved 404 endpoint issues

---

**Last Updated:** December 21, 2025  
**Author:** Development Team  
**Status:** Active Development
