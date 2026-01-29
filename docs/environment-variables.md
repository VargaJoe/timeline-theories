# Environment Variables Configuration Guide

## Overview

This document describes all environment variables used in the Timeline Theories application, including authentication configuration, API keys, and feature flags.

---

## File Priority (Vite)

Vite loads environment files in the following order (highest priority first):

1. `.env.local` - Local overrides (gitignored, for development)
2. `.env.development` - Development-specific settings
3. `.env` - Base configuration (committed to git)

**Best Practice:** Use `.env.local` for local development with sensitive values. Never commit `.env.local` to git.

---

## Authentication Configuration

### API Key (Visitor Mode)

```bash
# Optional: Enable unauthenticated access with API key
VITE_SENSENET_API_KEY=your-pre-generated-api-key-here
```

**Purpose:** Allows visitors to browse public content without login  
**Default:** Empty (disabled)  
**Required:** No  
**When to use:**
- Public-facing timeline sites
- Demo/preview environments
- Read-only access for unauthenticated users

**Security Notes:**
- API key should have limited "visitor" permissions in SenseNet
- Typically read-only access to public content
- User authentication takes precedence when active
- Binary URLs (images) use apikey even when user is authenticated (SNAuth limitation)

---

### SNAuth Configuration

```bash
# SNAuth authentication (native SenseNet auth)
# No additional environment variables required
# Configuration is auto-detected from SenseNet API
```

**Purpose:** Native SenseNet authentication with JWT tokens  
**Auto-configured:** Yes (via `/odata.svc/('Root')/GetClientRequestParameters`)  
**Storage:** localStorage (`sn-auth-access-token`, `sn-auth-refresh-token`, `sn-auth-user-details`)

---

### IdentityServer OIDC Configuration

```bash
# IdentityServer/OIDC authentication
VITE_OIDC_CLIENT_ID=your-client-id
VITE_OIDC_AUTHORITY=https://your-identity-server-url
```

**Purpose:** External identity provider integration (SSO)  
**Required:** Only if using IdentityServer authentication mode  
**Default:** `your-client-id`, `https://your-identity-server-url`

**Additional OIDC Settings:**
- `redirect_uri`: Auto-generated as `${window.location.origin}/authentication/callback`
- `post_logout_redirect_uri`: Auto-generated as `${window.location.origin}/`
- `response_type`: `code`
- `scope`: `sensenet`
- `automaticSilentRenew`: `true`

---

## SenseNet Repository Configuration

```bash
# SenseNet repository URL
VITE_SENSENET_REPO_URL=https://localhost:41016

# Content organization paths
VITE_PROJECT_ROOT_PATH=/Root/Content/timelines
VITE_ASSETS_BASE_PATH=/Root/Content/timelines/(structure)/style
```

**Purpose:** Connection to SenseNet ECM backend  
**Required:** Yes  
**Default:** 
- Repository URL: `https://your-sensenet-repo-url`
- Root Path: `/Root/Content`
- Assets Path: Auto-generated from root path + `/(structure)/style`

---

## Site Configuration

```bash
# Site branding
VITE_SITE_TITLE=Timeline Theories

# Header background image
VITE_HEADER_BACKGROUND_IMAGE=background.webp
VITE_HEADER_OVERLAY_OPACITY=0.3

# Admin access control
VITE_ADMIN_EMAILS=admin@example.com,user@example.com
```

**VITE_SITE_TITLE:**
- Purpose: Application title shown in header and browser tab
- Default: `Timeline Theories`

**VITE_HEADER_BACKGROUND_IMAGE:**
- Purpose: Background image filename in assets path
- Default: `background.webp`

**VITE_HEADER_OVERLAY_OPACITY:**
- Purpose: Overlay opacity for header background (0.0 = full image, 1.0 = no image)
- Default: `0.3`
- Range: 0.0 to 1.0

**VITE_ADMIN_EMAILS:**
- Purpose: Comma-separated list of admin email addresses for restricted features
- Default: Empty
- Format: `email1@domain.com,email2@domain.com`

---

## Feature Flags

```bash
# Timeline list features
VITE_ENABLE_ABC_PAGINATION=true
VITE_ENABLE_ALL_TIMELINE_VIEW=true
VITE_ALL_TIMELINE_PAGE_SIZE=20

# Image caching
VITE_LOCAL_STORAGE_TTL=3600000
VITE_IMAGE_CONCURRENCY_LIMIT=2
```

**VITE_ENABLE_ABC_PAGINATION:**
- Purpose: Enable/disable character-based filtering (A, B, C, etc.)
- Default: `true`
- Values: `true` or `false`

**VITE_ENABLE_ALL_TIMELINE_VIEW:**
- Purpose: Enable/disable "All" view with pagination
- Default: `true`
- Values: `true` or `false`
- Note: Can be disabled for performance on large datasets

**VITE_ALL_TIMELINE_PAGE_SIZE:**
- Purpose: Number of timelines to load per page in "All" view
- Default: `20`
- Type: Integer

**VITE_LOCAL_STORAGE_TTL:**
- Purpose: Time-to-live for cached images in localStorage (milliseconds)
- Default: `3600000` (1 hour)
- Type: Integer (milliseconds)

**VITE_IMAGE_CONCURRENCY_LIMIT:**
- Purpose: Maximum concurrent image downloads
- Default: `2`
- Type: Integer

---

## Media Configuration

```bash
# Cover image defaults
# (Currently hardcoded in configuration.ts, not environment variables)
# coverImageDefaultWidth: 360
# coverImageDefaultHeight: 480
```

---

## External API Keys

```bash
# Trakt TV API (for media import)
VITE_TRAKT_API_KEY=your-trakt-api-key
```

**Purpose:** Import TV shows and movies from Trakt.tv  
**Required:** Only if using Trakt import feature  
**Default:** Empty

---

## Example .env.local File

```bash
# SenseNet connection
VITE_SENSENET_REPO_URL=https://localhost:41016
VITE_PROJECT_ROOT_PATH=/Root/Content/timelines

# API Key authentication (visitor mode)
VITE_SENSENET_API_KEY=pr3Gen3R4Tedpr3Gen3R4Tedpr3Gen3R4Tedpr3Gen3R4Tedpr3Gen3R4Tedpr3Gen3R4Tedpr3Gen3R4Ted

# OIDC authentication (if using IdentityServer)
VITE_OIDC_CLIENT_ID=timeline-theories
VITE_OIDC_AUTHORITY=https://localhost:51017

# Site configuration
VITE_SITE_TITLE=My Timeline Site
VITE_ADMIN_EMAILS=admin@mysite.com

# External APIs
VITE_TRAKT_API_KEY=your-trakt-api-key

# Feature flags
VITE_ENABLE_ABC_PAGINATION=true
VITE_ENABLE_ALL_TIMELINE_VIEW=true
VITE_ALL_TIMELINE_PAGE_SIZE=20

# Performance
VITE_LOCAL_STORAGE_TTL=3600000
VITE_IMAGE_CONCURRENCY_LIMIT=2
```

---

## Docker Compose Environment Variables

For local development with Docker, configure in `deployment/docker-compose.yml`:

```yaml
environment:
  # CORS configuration
  - sensenet__cors__AllowedOrigins=https://localhost:8080,http://localhost:5173,https://localhost:5173
  - sensenet__cors__AllowedHeaders=apikey,content-type,authorization,x-requested-with,accept
  - sensenet__cors__AllowCredentials=true
  
  # Repository configuration
  - sensenet__repository__Url=https://localhost:41016
  
  # Authentication (configured via SenseNet admin UI)
  # API keys are generated and managed in SenseNet backend
```

---

## Security Checklist

- [ ] Never commit `.env.local` to git
- [ ] Add `.env.local` to `.gitignore`
- [ ] Use different API keys for development, staging, and production
- [ ] Limit API key permissions in SenseNet (visitor-level read-only)
- [ ] Rotate API keys periodically
- [ ] Use HTTPS in production (required for OIDC)
- [ ] Configure CORS properly in docker-compose.yml
- [ ] Validate admin emails list matches actual admin users

---

## Troubleshooting

### API Key Not Working

**Symptoms:** 404 errors on images or API calls, no apikey in Network tab URLs

**Check:**
1. Is `VITE_SENSENET_API_KEY` set in `.env.local`?
2. Did you restart Vite dev server after adding it?
3. Check console logs for `[sensenet] Global fetch patched...` message
4. Verify apikey is valid in SenseNet admin UI
5. Check CORS configuration allows `apikey` header

### OIDC Login Not Working

**Symptoms:** Login button doesn't work, blank page, OIDC errors

**Check:**
1. Are `VITE_OIDC_CLIENT_ID` and `VITE_OIDC_AUTHORITY` configured?
2. Is OIDC client registered in IdentityServer?
3. Does redirect URI match: `${origin}/authentication/callback`?
4. Is IdentityServer accessible from browser?

### Images Not Loading When Authenticated

**Symptoms:** Images load when logged out, fail when logged in

**Check:**
1. This is expected if `VITE_SENSENET_API_KEY` is not set
2. SNAuth mode requires apikey for images (Bearer tokens don't work in `<img>` tags)
3. Verify `appendApiKeyToUrl()` is called on all binary handler URLs
4. Check Network tab - binary URLs should have `?apikey=xxx` even when logged in

---

**Last Updated:** January 29, 2026  
**Author:** Development Team
