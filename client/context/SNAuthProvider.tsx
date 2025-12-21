/**
 * SenseNet Auth (SNAuth) Provider
 * Wraps @sensenet/sn-auth-react for use in unified auth context
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSnAuth } from '@sensenet/sn-auth-react';

export interface AuthContextModel {
  user?: any;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  accessToken?: string;
  isLoading: boolean;
  error?: string;
}

const AuthContext = createContext<AuthContextModel | undefined>(undefined);

// Export AuthContext for shared auth hooks
export { AuthContext as SNAuthContext };

/**
 * Provider component for SenseNet Auth (SNAuth) authentication
 * Uses external login (redirect to SNAuth server)
 */
export function SNAuthProvider({ children }: { children: ReactNode }) {
  const { user, externalLogin, logout, accessToken, isLoading, error } = useSnAuth();
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);

  // Log complete auth state
  console.log('[SNAuthProvider] useSnAuth returned:', {
    user: user ? { UserName: user.UserName, DisplayName: user.DisplayName } : null,
    externalLogin: typeof externalLogin,
    logout: typeof logout,
    accessToken: accessToken ? `exists (${accessToken.length} chars)` : 'missing',
    isLoading,
    error: error?.message || 'none'
  });

  // **MANUAL TOKEN EXCHANGE** - Process auth_code callback
  // This is needed because @sensenet/sn-auth-react v1.0.2 doesn't have automatic token exchange
  useEffect(() => {
    const processCallback = async () => {
      console.log('[SNAuthProvider] Checking for auth_code callback');
      const urlParams = new URLSearchParams(window.location.search);
      const authCode = urlParams.get('auth_code');
      
      if (!authCode) {
        console.log('[SNAuthProvider] No auth_code found in URL');
        return;
      }

      if (isProcessingCallback) {
        console.log('[SNAuthProvider] Already processing callback, skipping');
        return;
      }

      console.log('[SNAuthProvider] 🔑 auth_code found! Starting manual token exchange...');
      console.log('[SNAuthProvider] auth_code:', authCode.substring(0, 50) + '...');

      setIsProcessingCallback(true);

      try {
        // Get configuration from localStorage
        const authConfigStr = window.localStorage.getItem('sn-auth-config');
        if (!authConfigStr) {
          throw new Error('No auth configuration found in localStorage');
        }

        const authConfig = JSON.parse(authConfigStr);
        console.log('[SNAuthProvider] Auth config:', authConfig);

        // Call SNAuth server to exchange auth_code for tokens
        console.log('[SNAuthProvider] POST to:', `${authConfig.authServerUrl}/api/auth/convert-auth-token`);
        const tokenResponse = await fetch(`${authConfig.authServerUrl}/api/auth/convert-auth-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: authCode }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('[SNAuthProvider] Token exchange failed:', tokenResponse.status, errorText);
          throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
        }

        const tokenData = await tokenResponse.json();
        console.log('[SNAuthProvider] ✅ Token exchange successful!');
        console.log('[SNAuthProvider] Response keys:', Object.keys(tokenData));

        // Store tokens in localStorage (matching @sensenet/sn-auth-react naming convention)
        if (tokenData.accessToken) {
          window.localStorage.setItem('sn-auth-access-token', tokenData.accessToken);
          console.log('[SNAuthProvider] ✅ Saved access token to localStorage');
        }
        
        if (tokenData.refreshToken) {
          window.localStorage.setItem('sn-auth-refresh-token', tokenData.refreshToken);
          console.log('[SNAuthProvider] ✅ Saved refresh token to localStorage');
        }

        // Fetch user details using access token
        console.log('[SNAuthProvider] Fetching user details from:', `${authConfig.repoUrl}/odata.svc/('Root')/GetCurrentUser`);
        const userResponse = await fetch(`${authConfig.repoUrl}/odata.svc/('Root')/GetCurrentUser`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          console.log('[SNAuthProvider] ✅ User details fetched:', userData.d);
          
          // Store user details in localStorage
          window.localStorage.setItem('sn-auth-user-details', JSON.stringify(userData.d));
          console.log('[SNAuthProvider] ✅ Saved user details to localStorage');
        }

        // Clear auth_code from URL and redirect to home
        console.log('[SNAuthProvider] Clearing auth_code from URL and redirecting to /timelines');
        window.history.replaceState({}, '', '/timelines');
        window.location.href = '/timelines';

      } catch (err) {
        console.error('[SNAuthProvider] ❌ Token exchange error:', err);
        setIsProcessingCallback(false);
        // Clear auth_code from URL even on error
        window.history.replaceState({}, '', window.location.pathname);
      }
    };

    processCallback();
  }, []); // Run only once on mount

  // Handle callback from SNAuth server after login
  useEffect(() => {
    console.log('[SNAuthProvider] useEffect triggered - checking for callback');
    console.log('[SNAuthProvider] Current URL:', window.location.href);
    console.log('[SNAuthProvider] Search params:', window.location.search);
    
    // Log all URL parameters
    const params = new URLSearchParams(window.location.search);
    const allParams: Record<string, string> = {};
    params.forEach((value, key) => {
      allParams[key] = value;
    });
    console.log('[SNAuthProvider] All URL parameters:', allParams);
    
    // Check for specific token parameters
    const possibleTokenKeys = ['accessToken', 'access_token', 'token', 'id_token', 'code'];
    possibleTokenKeys.forEach(key => {
      const value = params.get(key);
      if (value) {
        console.log(`[SNAuthProvider] Found ${key} in URL:`, value.substring(0, 50) + '...');
      }
    });
    
    console.log('[SNAuthProvider] Current state:', { 
      isLoading, 
      hasUser: !!user, 
      userName: user?.UserName || user?.DisplayName || 'undefined',
      accessToken: accessToken ? 'exists' : 'missing'
    });

    if (!isLoading && isInitialized) {
      console.log('[SNAuthProvider] Auth state updated after initialization');
      if (user) {
        console.log('[SNAuthProvider] User authenticated:', user.UserName || user.DisplayName);
      }
    }

    // Mark as initialized after first check
    if (!isInitialized) {
      console.log('[SNAuthProvider] Marking provider as initialized');
      setIsInitialized(true);
    }
  }, [user, isLoading, accessToken, isInitialized]);

  const isAuthenticated = !!user;

  const handleLogin = async () => {
    try {
      console.log('[SNAuthProvider] Calling externalLogin() for SNAuth redirect');
      console.log('[SNAuthProvider] Before redirect - Current URL:', window.location.href);
      const result = await externalLogin();
      console.log('[SNAuthProvider] externalLogin returned:', result);
      console.log('[SNAuthProvider] After redirect - Current URL:', window.location.href);
    } catch (loginError) {
      console.error('[SNAuthProvider] externalLogin failed:', loginError);
      throw loginError;
    }
  };

  const handleLogout = async () => {
    try {
      console.log('[SNAuthProvider] Logging out');
      await logout();
    } catch (logoutError) {
      console.error('[SNAuthProvider] Logout failed:', logoutError);
      throw logoutError;
    }
  };

  console.log('[SNAuthProvider] Rendering with state:', { 
    isAuthenticated, 
    isLoading, 
    hasUser: !!user 
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        login: handleLogin,
        logout: handleLogout,
        accessToken,
        isLoading,
        error: error?.message,
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
    throw new Error('useAuth must be used within an SNAuthProvider');
  }
  return context;
}
