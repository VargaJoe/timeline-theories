import React from 'react';
import { AuthenticationProvider as SNAuthenticationProvider } from '@sensenet/sn-auth-react';
import { AuthenticationProvider as OidcAuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { environment, configuration } from './configuration';
import { ISAuthProvider } from './context/ISAuthProvider';
import { SNAuthProvider } from './context/SNAuthProvider';
import { AuthTypeContext } from './context/authTypeContext';
import { browserHistory } from './browserHistory';
import { bindSnAuthStorage } from './context/snAuthStorage.mjs';

// Run before the SDK provider can read/send unscoped legacy tokens.
if (environment.authType === 'SNAuth') bindSnAuthStorage(window.localStorage, environment);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const authConfig = { callbackUri: configuration.redirect_uri, authServerUrl: environment.authority, repoUrl: environment.repositoryUrl };
  if (environment.authType === 'IdentityServer') return (
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
