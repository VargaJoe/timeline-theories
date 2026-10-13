import { useEffect } from 'react';
import { useSharedAuth } from '../context/useSharedAuth';
import { setRepositoryAccessToken } from '../services/sensenet';

export const OidcTokenInjector: React.FC = () => {
  // Use unified auth context
  const { accessToken } = useSharedAuth();

  useEffect(() => {
    if (accessToken) {
      setRepositoryAccessToken(accessToken);
    } else {
      setRepositoryAccessToken('');
    }
  }, [accessToken]);

  return null;
};
