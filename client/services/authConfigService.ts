import { environment } from '../configuration';
export type AuthServerType = 'SNAuth' | 'IdentityServer';
export interface AuthServerSettings { type: AuthServerType; authority?: string; issuer?: string; }
export interface AuthConfig { authServerSettings: AuthServerSettings; }
export async function getAuthConfig(repoUrl: string): Promise<AuthConfig> {
  if (repoUrl.replace(/\/$/, '') !== environment.repositoryUrl) throw new Error('Repository/profile mismatch');
  return { authServerSettings: { type: environment.authType, authority: environment.authority } };
}
export async function detectAuthType(repoUrl: string): Promise<AuthServerType> { return (await getAuthConfig(repoUrl)).authServerSettings.type; }
