import { useEffect } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();

  useEffect(() => {
    if (oidcUser && oidcUser.access_token) {
      setRepositoryAccessToken(oidcUser.access_token);
    } else {
      setRepositoryAccessToken('');
    }
  }, [oidcUser]);

  return null;
};
