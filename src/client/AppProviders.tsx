import React from 'react';
// @ts-ignore
import { AuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { configuration } from './configuration';
import { browserHistory } from './browserHistory';

console.log('[AppProviders] Mounting AuthenticationProvider');
console.log('[AppProviders] configuration:', configuration);
console.log('[AppProviders] browserHistory:', browserHistory);

export const AppProviders = ({ children }: { children: React.ReactNode }) => (
  <AuthenticationProvider configuration={configuration} history={browserHistory}>
    {children}
  </AuthenticationProvider>
);
