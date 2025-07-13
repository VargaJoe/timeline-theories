export const repositoryUrl = import.meta.env.VITE_SENSENET_REPO_URL || 'https://your-sensenet-repo-url';
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
