import { environment } from '../configuration';
export type AuthServerType = 'SNAuth' | 'IdentityServer';
export interface AuthServerSettings { type: AuthServerType; authority?: string; issuer?: string; }
export interface AuthConfig { authServerSettings: AuthServerSettings; }
export async function getAuthConfig(repoUrl: string): Promise<AuthConfig> {
  if (repoUrl.replace(/\/$/, '') !== environment.repositoryUrl) throw new Error('Repository/profile mismatch');
  let type = environment.authType;
  if (type === 'auto') {
    const response = await fetch(`${environment.repositoryUrl}/odata.svc/('Root')/GetClientRequestParameters?clientType=adminui`, { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error(`Authentication discovery failed: HTTP ${response.status}`);
    const settings = await response.json();
    type = settings.authServerSettings?.type ?? settings.type;
    if (type !== 'SNAuth' && type !== 'IdentityServer') throw new Error('Unsupported authentication server type');
  }
  // Discovery chooses only the provider; .env still owns authority and client ID.
  return { authServerSettings: { type: type as AuthServerType, authority: environment.authority } };
}
export async function detectAuthType(repoUrl: string): Promise<AuthServerType> { return (await getAuthConfig(repoUrl)).authServerSettings.type; }
