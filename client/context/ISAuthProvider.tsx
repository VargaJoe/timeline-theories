/**
 * IdentityServer/OIDC Authentication Provider
 * Wraps @sensenet/authentication-oidc-react for use in unified auth context
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

export interface AuthContextModel {
  user?: any;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  accessToken?: string;
  isLoading: boolean;
  error?: string;
}

const AuthContext = createContext<AuthContextModel>({
  user: undefined,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  isLoading: false,
});

// Export AuthContext for shared auth hooks
export { AuthContext as ISAuthContext };

/**
 * Provider component for IdentityServer/OIDC authentication
 */
export function ISAuthProvider({ children }: { children: ReactNode }) {
  const { oidcUser, login, logout } = useOidcAuthentication();

  const isAuthenticated = !!oidcUser;

  const handleLogin = async () => {
    try {
      await login();
    } catch (error) {
      console.error('[ISAuthProvider] Login failed:', error);
      throw error;
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('[ISAuthProvider] Logout failed:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: oidcUser?.profile,
        isAuthenticated,
        login: handleLogin,
        logout: handleLogout,
        accessToken: oidcUser?.access_token,
        isLoading: false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to use authentication context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an ISAuthProvider');
  }
  return context;
}
