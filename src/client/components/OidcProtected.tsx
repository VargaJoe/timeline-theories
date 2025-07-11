import React from 'react';
import { OidcSecure } from '@sensenet/authentication-oidc-react';
import { browserHistory } from '../browserHistory';

export const OidcProtected: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <OidcSecure history={browserHistory}>{children}</OidcSecure>
);
