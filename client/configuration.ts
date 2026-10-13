import type { Profile } from './profile.mjs';
declare const __TIMELINE_PROFILE__: Profile;
export const environment = Object.freeze(__TIMELINE_PROFILE__);
export const repositoryUrl = environment.repositoryUrl;
export const traktApiKey = '';

// Authentication type: 'oidc' or 'jwt'
export const authType = environment.authType;

// Base paths for content organization
export const contentPaths = {
  timelines: environment.projectRoot,
  get assets() { return `${this.timelines}/(structure)/style`; }
};

// Site configuration
export const siteConfig = {
  // Site branding
  siteTitle: 'Timeline Theories',
  
  // Background image: base path + relative path
  headerBackgroundImagePath: `${contentPaths.assets}/${'background.webp'}`,
  headerBackgroundFallback: null, // Use gradient fallback instead of external image
  headerOverlayOpacity: 0.3, // 0.0 = no overlay (full image), 1.0 = full overlay (no image)

  // Default cover image dimensions for binary upload (px)
  coverImageDefaultWidth: 360,
  coverImageDefaultHeight: 480,

  // Timeline list configuration
  timelineList: {
    // Enable/disable ABC pagination (character-based filtering)
    enableAbcPagination: true, // Default: true
    // Enable/disable "All" view with pagination (can be disabled for performance reasons)
    enableAllView: true, // Default: true
    // Number of timelines to load per page in "All" view
    allViewPageSize: 20, // Default: 20
  },

  // Image caching configuration
  imageCache: {
    ttl: 3600000, // 1 hour default
    concurrencyLimit: 2,
  }
};

export const configuration = {
  client_id: environment.clientId,
  authority: environment.authority,
  redirect_uri: `${window.location.origin}/authentication/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'sensenet',
  silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
  automaticSilentRenew: true,
  extraQueryParams: { snrepo: repositoryUrl },
  // Try to disable automatic logout redirects
  monitorSession: false,
  checkSessionInterval: 2000,
  revokeAccessTokenOnSignout: true,
};
