import React, { useEffect, useState } from 'react';
import { AuthenticationProvider as SNAuthenticationProvider } from '@sensenet/sn-auth-react';
import { AuthenticationProvider as OidcAuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { environment, configuration } from './configuration';
import { ISAuthProvider } from './context/ISAuthProvider';
import { SNAuthProvider } from './context/SNAuthProvider';
import { AuthTypeContext } from './context/authTypeContext';
import { browserHistory } from './browserHistory';
import { bindSnAuthStorage } from './context/snAuthStorage.mjs';
import { getAuthConfig, type AuthServerType } from './services/authConfigService';

// Run before the SDK provider can read/send unscoped legacy tokens.
if (environment.authType === 'SNAuth') bindSnAuthStorage(window.localStorage, environment);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<AuthServerType | null>(environment.authType === 'auto' ? null : environment.authType);
  const [error, setError] = useState('');
  useEffect(() => {
    if (environment.authType !== 'auto') return;
    let active = true;
    getAuthConfig(environment.repositoryUrl).then(config => {
      if (!active) return;
      if (config.authServerSettings.type === 'SNAuth') bindSnAuthStorage(window.localStorage, environment);
      setProvider(config.authServerSettings.type);
    }).catch(() => { if (active) setError('Authentication configuration could not be loaded.'); });
    return () => { active = false; };
  }, []);
  if (error) return <div role="alert">{error}</div>;
  if (!provider) return <div role="status">Loading authentication configuration...</div>;
  const authConfig = { callbackUri: configuration.redirect_uri, authServerUrl: environment.authority, repoUrl: environment.repositoryUrl };
  if (provider === 'IdentityServer') return (
    <AuthTypeContext.Provider value={{ authType: 'IdentityServer' }}>
      <OidcAuthenticationProvider configuration={{ ...configuration, scope: 'openid profile sensenet', loadUserInfo: true }} history={browserHistory}>
        <ISAuthProvider>{children}</ISAuthProvider>
      </OidcAuthenticationProvider>
    </AuthTypeContext.Provider>
  );
  return (
    <AuthTypeContext.Provider value={{ authType: 'SNAuth' }}>
      <SNAuthenticationProvider snAuthConfiguration={{ callbackUri: authConfig.callbackUri }} repoUrl={authConfig.repoUrl} authServerUrl={authConfig.authServerUrl}>
        <SNAuthProvider>{children}</SNAuthProvider>
      </SNAuthenticationProvider>
    </AuthTypeContext.Provider>
  );
}
