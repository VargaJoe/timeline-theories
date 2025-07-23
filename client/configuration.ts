export const repositoryUrl = import.meta.env.VITE_SENSENET_REPO_URL || 'https://your-sensenet-repo-url';
export const traktApiKey = import.meta.env.VITE_TRAKT_API_KEY || '';

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
  coverImageDefaultHeight: 480
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
