import type { ReactNode } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { ISAuthContext } from './authTypes';
import { setRepositoryAccessToken } from '../services/sensenet';
export function ISAuthProvider({ children }: { children: ReactNode }) {
  const { oidcUser, login, logout } = useOidcAuthentication();
  return <ISAuthContext.Provider value={{ user: oidcUser?.profile, isAuthenticated: !!oidcUser,
    login: async () => { if (!login) throw new Error('Login unavailable'); await login(); },
    logout: async () => { setRepositoryAccessToken(''); if (!logout) throw new Error('Logout unavailable'); await logout(); },
    accessToken: oidcUser?.access_token, isLoading: false }}>{children}</ISAuthContext.Provider>;
}
