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
 * This hook checks which context has a valid value and returns it
 */
export function useSharedAuth(): AuthContextModel {
  const snAuth = useContext(SNAuthContext);
  const isAuth = useContext(ISAuthContext);

  // Check ISAuth first (IdentityServer)
  if (isAuth !== undefined) {
    console.log('[useSharedAuth] Using IdentityServer auth context');
    return isAuth;
  }

  // Check SNAuth
  if (snAuth !== undefined) {
    console.log('[useSharedAuth] Using SNAuth context');
    return snAuth;
  }

  // Fallback if neither provider is active
  console.warn('[useSharedAuth] No auth provider available, returning fallback');
  return {
    user: undefined,
    isAuthenticated: false,
    login: async () => { throw new Error('No auth provider available'); },
    logout: async () => { throw new Error('No auth provider available'); },
    isLoading: false,
  };
}

