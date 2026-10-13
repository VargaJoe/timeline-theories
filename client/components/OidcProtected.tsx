import React from 'react';
import { OidcSecure } from '@sensenet/authentication-oidc-react';
import { browserHistory } from '../browserHistory';
import { authType } from '../configuration';

export const OidcProtected: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Only use OidcSecure for OIDC auth type
  if (authType === 'IdentityServer') {
    return <OidcSecure history={browserHistory}>{children}</OidcSecure>;
  }

  // For JWT auth type, render children directly
  return <>{children}</>;
};
