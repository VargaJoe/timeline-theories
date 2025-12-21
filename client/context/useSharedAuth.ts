/**
 * Shared auth hook that works with both SNAuth and OIDC providers
 * Uses the active provider's context
 */

import { useContext } from 'react';
import type { AuthContextModel } from './SNAuthProvider';

// Import both contexts
import { SNAuthContext } from './SNAuthProvider';
import { ISAuthContext } from './ISAuthProvider';

/**
 * Use auth from whichever provider is active
 * This hook tries SNAuth first, then OIDC
 */
export function useSharedAuth(): AuthContextModel {
  let auth: AuthContextModel | null = null;

  try {
    auth = useContext(SNAuthContext);
    if (auth && auth.isAuthenticated !== undefined) {
      return auth;
    }
  } catch (e) {
    // SNAuth not available
  }

  try {
    auth = useContext(ISAuthContext);
    if (auth && auth.isAuthenticated !== undefined) {
      return auth;
    }
  } catch (e) {
    // OIDC not available
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

