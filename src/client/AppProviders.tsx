import React from 'react';
// @ts-ignore
import { AuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { configuration } from './configuration';
import { browserHistory } from './browserHistory';

export const AppProviders = ({ children }: { children: React.ReactNode }) => (
  <AuthenticationProvider configuration={configuration} history={browserHistory}>
    {children}
  </AuthenticationProvider>
);
