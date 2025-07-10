export const repositoryUrl = 'https://mcp-sandbox.test.sensenet.cloud'; // 'https://insql-daily.test.sensenet.cloud';
export const configuration = {
  client_id: 'LCNi1qxzo2q9YjNU',
  authority: 'https://mcp-sandbox-is.test.sensenet.cloud',//'https://insql-daily-is.test.sensenet.cloud',
  redirect_uri: `${window.location.origin}/authentication/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'sensenet',
  silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
  automaticSilentRenew: true,
  extraQueryParams: { snrepo: repositoryUrl },
};
