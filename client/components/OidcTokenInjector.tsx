import { useEffect } from 'react';
import { useSnAuth } from '@sensenet/sn-auth-react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  // Try to use SNAuth hook (for SNAuth mode)
  let snAuthToken: string | undefined = undefined;
  let snAuthUser: any = undefined;
  
  try {
    const snAuth = useSnAuth();
    snAuthToken = snAuth?.accessToken;
    snAuthUser = snAuth?.user;
  } catch (e) {
    // SNAuth not available (probably OIDC mode)
  }

  // Try to use OIDC hook (for IdentityServer mode)
  let oidcToken: string | undefined = undefined;
  let oidcUser: any = undefined;

  try {
    const oidcAuth = useOidcAuthentication();
    oidcToken = oidcAuth?.oidcUser?.access_token;
    oidcUser = oidcAuth?.oidcUser?.profile;
  } catch (e) {
    // OIDC not available (probably SNAuth mode)
  }

  // Use whichever token is available
  const accessToken = snAuthToken || oidcToken;
  const user = snAuthUser || oidcUser;

  useEffect(() => {
    console.log('[OidcTokenInjector] Auth state changed:', {
      hasUser: !!user,
      hasAccessToken: !!accessToken
    });

    if (accessToken) {
      setRepositoryAccessToken(accessToken);
    } else {
      setRepositoryAccessToken('');
    }
  }, [user, accessToken]);

  return null;
};
