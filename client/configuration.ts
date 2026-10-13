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
  get assets() { return import.meta.env.VITE_ASSETS_BASE_PATH || `${this.timelines}/(structure)/style`; }
};

// Site configuration
export const siteConfig = {
  // Site branding
  siteTitle: import.meta.env.VITE_SITE_TITLE || 'Timeline Theories',
  
  // Background image: base path + relative path
  headerBackgroundImagePath: `${contentPaths.assets}/${import.meta.env.VITE_HEADER_BACKGROUND_IMAGE || 'background.webp'}`,
  headerBackgroundFallback: null, // Use gradient fallback instead of external image
  headerOverlayOpacity: parseFloat(import.meta.env.VITE_HEADER_OVERLAY_OPACITY || '0.3'),

  // Default cover image dimensions for binary upload (px)
  coverImageDefaultWidth: 360,
  coverImageDefaultHeight: 480,

  // Timeline list configuration
  timelineList: {
    // Enable/disable ABC pagination (character-based filtering)
    enableAbcPagination: import.meta.env.VITE_ENABLE_ABC_PAGINATION !== 'false',
    // Enable/disable "All" view with pagination (can be disabled for performance reasons)
    enableAllView: import.meta.env.VITE_ENABLE_ALL_TIMELINE_VIEW !== 'false',
    // Number of timelines to load per page in "All" view
    allViewPageSize: parseInt(import.meta.env.VITE_ALL_TIMELINE_PAGE_SIZE || '20'),
  },

  // Image caching configuration
  imageCache: {
    ttl: parseInt(import.meta.env.VITE_LOCAL_STORAGE_TTL || '3600000'),
    concurrencyLimit: parseInt(import.meta.env.VITE_IMAGE_CONCURRENCY_LIMIT || '2'),
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
