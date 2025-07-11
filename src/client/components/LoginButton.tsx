import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { setRepositoryAccessToken } from '../services/sensenet';

console.log('[LoginButton] Component loaded');

export const LoginButton: React.FC = () => {
  console.log('[LoginButton] Component rendering...');
  
  // React hooks must be called at the top level
  console.log('[LoginButton] About to call useOidcAuthentication...');
  
  const oidcResult = useOidcAuthentication();
  console.log('[LoginButton] useOidcAuthentication returned:', oidcResult);

  const { oidcUser, login, logout, isLoading, error } = oidcResult;

  // Debug logging for OIDC state
  console.log('[LoginButton] isLoading:', isLoading);
  console.log('[LoginButton] oidcUser:', oidcUser);
  console.log('[LoginButton] error:', error);
  console.log('[LoginButton] login:', typeof login);
  console.log('[LoginButton] logout:', typeof logout);

  // Log all available methods in the oidcResult
  console.log('[LoginButton] Available OIDC methods:', Object.keys(oidcResult));

  // Check if there's a userManager or other logout methods
  if (oidcResult.userManager) {
    console.log('[LoginButton] UserManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(oidcResult.userManager)));
  }

  try {
    // PROVEN LOGOUT SOLUTION from SNBooking repository
    const handleLogout = async () => {
      console.log('[LoginButton] Starting proven SNBooking logout pattern...');
      
      try {
        // Step 1: Clear localStorage FIRST (like SNBooking did)
        localStorage.clear();
        console.log('[LoginButton] localStorage cleared');
        
        // Step 2: Clear repository token immediately
        setRepositoryAccessToken('');
        console.log('[LoginButton] Repository token cleared');
        
        // Step 3: Call official logout().then() pattern (like SNBooking)
        logout().then(() => {
          console.log('[LoginButton] Official logout completed');
          // Step 4: Clear sessionStorage after logout completes
          sessionStorage.clear();
          console.log('[LoginButton] sessionStorage cleared - logout complete');
        }).catch((err: unknown) => {
          console.warn('[LoginButton] Official logout failed, but continuing:', err);
          // Fallback: clear sessionStorage anyway
          sessionStorage.clear();
          console.log('[LoginButton] sessionStorage cleared (fallback)');
        });
        
      } catch (err) {
        console.error('[LoginButton] Logout error:', err);
        // Last resort: clear everything and redirect
        localStorage.clear();
        sessionStorage.clear();
        setRepositoryAccessToken('');
        window.location.href = '/';
      }
    };

    // Skip the loading state entirely - just show login/logout based on user state
    if (error) {
      console.log('[LoginButton] Rendering: OIDC Error', error);
      return <div style={{ color: 'red', padding: '8px', border: '1px solid red' }}>OIDC Error: {error}</div>;
    }

    if (oidcUser) {
      console.log('[LoginButton] Rendering: Logout button');
      return <button onClick={handleLogout} style={{ backgroundColor: 'red', color: 'white', padding: '8px 16px' }}>Logout</button>;
    } else {
      console.log('[LoginButton] Rendering: Login button');
      return <button onClick={login} style={{ backgroundColor: 'blue', color: 'white', padding: '8px 16px' }}>Login with SenseNet</button>;
    }
  } catch (err) {
    console.error('[LoginButton] Error in render:', err);
    return <div style={{ color: 'red', padding: '8px', border: '1px solid red' }}>LoginButton Error: {String(err)}</div>;
  }
};
