import { useEffect } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();

  useEffect(() => {
    console.log('[OidcTokenInjector] OIDC user state changed:', {
      hasUser: !!oidcUser,
      hasAccessToken: oidcUser?.access_token ? 'yes' : 'no',
      tokenLength: oidcUser?.access_token?.length || 0
    });
    
    if (oidcUser && oidcUser.access_token) {
      setRepositoryAccessToken(oidcUser.access_token);
    } else {
      setRepositoryAccessToken('');
    }
  }, [oidcUser]);

  return null;
};
