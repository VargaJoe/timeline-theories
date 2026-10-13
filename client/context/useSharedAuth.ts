/**
 * Shared auth hook that works with both SNAuth and OIDC providers
 * Uses the active provider's context
 */

import { useContext } from 'react';
import type { AuthContextModel } from './authTypes';

// Import both contexts
import { SNAuthContext } from './authTypes';
import { ISAuthContext } from './authTypes';

/**
 * Use auth from whichever provider is active
 * This hook checks which context has a valid value and returns it
 */
export function useSharedAuth(): AuthContextModel {
  const snAuth = useContext(SNAuthContext);
  const isAuth = useContext(ISAuthContext);

  // Check ISAuth first (IdentityServer)
  if (isAuth !== undefined) {
    return isAuth;
  }

  // Check SNAuth
  if (snAuth !== undefined) {
    return snAuth;
  }

  // Fallback if neither provider is active
  return {
    user: undefined,
    isAuthenticated: false,
    login: async () => { throw new Error('No auth provider available'); },
    logout: async () => { throw new Error('No auth provider available'); },
    isLoading: false,
  };
}

