export const repositoryUrl = import.meta.env.VITE_SENSENET_REPO_URL || 'https://your-sensenet-repo-url';
export const traktApiKey = import.meta.env.VITE_TRAKT_API_KEY || '';
export const sensenetApiKey = import.meta.env.VITE_SENSENET_API_KEY || '';

// Authentication type: 'oidc' or 'jwt'
export const authType = import.meta.env.VITE_AUTH_TYPE || 'oidc';

// Base paths for content organization
export const contentPaths = {
  timelines: import.meta.env.VITE_PROJECT_ROOT_PATH || '/Root/Content',
  get assets() { return import.meta.env.VITE_ASSETS_BASE_PATH || `${this.timelines}/(structure)/style`; }
};

// Site configuration
export const siteConfig = {
  // Site branding
  siteTitle: import.meta.env.VITE_SITE_TITLE || 'Timeline Theories',
  
  // Background image: base path + relative path
  headerBackgroundImagePath: `${contentPaths.assets}/${import.meta.env.VITE_HEADER_BACKGROUND_IMAGE || 'background.webp'}`,
  headerBackgroundFallback: null, // Use gradient fallback instead of external image
  headerOverlayOpacity: parseFloat(import.meta.env.VITE_HEADER_OVERLAY_OPACITY || '0.3'), // 0.0 = no overlay (full image), 1.0 = full overlay (no image)

  // Default cover image dimensions for binary upload (px)
  coverImageDefaultWidth: 360,
  coverImageDefaultHeight: 480,

  // Admin emails for restricted access
  adminEmails: (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map((email: string) => email.trim()).filter(Boolean),

  // Timeline list configuration
  timelineList: {
    // Enable/disable ABC pagination (character-based filtering)
    enableAbcPagination: import.meta.env.VITE_ENABLE_ABC_PAGINATION !== 'false', // Default: true
    // Enable/disable "All" view with pagination (can be disabled for performance reasons)
    enableAllView: import.meta.env.VITE_ENABLE_ALL_TIMELINE_VIEW !== 'false', // Default: true
    // Number of timelines to load per page in "All" view
    allViewPageSize: parseInt(import.meta.env.VITE_ALL_TIMELINE_PAGE_SIZE || '20'), // Default: 20
  },

  // Image caching configuration
  imageCache: {
    ttl: parseInt(import.meta.env.VITE_LOCAL_STORAGE_TTL || '3600000'), // 1 hour default
    concurrencyLimit: parseInt(import.meta.env.VITE_IMAGE_CONCURRENCY_LIMIT || '2'),
  }
};

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
  // Try to disable automatic logout redirects
  monitorSession: false,
  checkSessionInterval: 2000,
  revokeAccessTokenOnSignout: true,
};
