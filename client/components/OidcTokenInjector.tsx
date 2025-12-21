import { useEffect } from 'react';
import { useSharedAuth } from '../context/useSharedAuth';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  // Use unified auth context
  const { user, accessToken } = useSharedAuth();

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
