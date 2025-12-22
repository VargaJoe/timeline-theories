/**
 * Service to fetch and detect authentication configuration from SenseNet repository
 * Automatically detects whether the repository uses SNAuth or IdentityServer
 */

export type AuthServerType = 'SNAuth' | 'IdentityServer';

export interface AuthServerSettings {
  type: AuthServerType;
  authority?: string;
  [key: string]: any;
}

export interface AuthConfig {
  authServerSettings: AuthServerSettings;
  userManagerSettings?: {
    [key: string]: any;
  };
}

/**
 * Fetches auth configuration from SenseNet repository
 * Uses the GetClientRequestParameters endpoint to detect auth type
 */
export async function getAuthConfig(repoUrl: string): Promise<AuthConfig> {
  const trimmedRepoUrl = repoUrl.replace(/\/\s*$/, '');
  
  try {
    const response = await fetch(
      `${trimmedRepoUrl}/odata.svc/('Root')/GetClientRequestParameters?clientType=adminui`
    );
    
    if (!response.ok) {
      throw new Error(`Could not load auth settings from repository: ${response.statusText}`);
    }

    const settings = await response.json();
    
    // The response contains auth server information
    // If it has 'type' field, it indicates the auth server type
    const authServerSettings: AuthServerSettings = {
      type: settings.type || 'SNAuth', // Default to SNAuth if not specified
      ...settings,
    };

    const userManagerSettings = {
      ...settings,
      automaticSilentRenew: true,
      redirect_uri: `${window.location.origin}/authentication/callback`,
      response_type: 'code',
      scope: 'openid profile sensenet',
      post_logout_redirect_uri: `${window.location.origin}/`,
      silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
      extraQueryParams: { snrepo: trimmedRepoUrl },
    };

    return {
      authServerSettings,
      userManagerSettings,
    };
  } catch (error) {
    console.error('[authConfigService] Failed to fetch auth config:', error);
    throw error;
  }
}

/**
 * Detects which authentication server type is used
 * @returns 'SNAuth' or 'IdentityServer'
 */
export async function detectAuthType(repoUrl: string): Promise<AuthServerType> {
  try {
    const config = await getAuthConfig(repoUrl);
    return config.authServerSettings.type as AuthServerType;
  } catch (error) {
    console.error('[authConfigService] Failed to detect auth type:', error);
    // Default to SNAuth if detection fails
    return 'SNAuth';
  }
}
