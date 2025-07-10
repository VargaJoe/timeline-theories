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
    // Create a completely local logout function that avoids external redirects
    const handleLogout = async () => {
      console.log('[LoginButton] Attempting complete local logout...');
      
      try {
        // Step 1: Clear the token from repository immediately
        setRepositoryAccessToken('');
        console.log('[LoginButton] Repository token cleared');
        
        // Step 2: Clear all OIDC-related storage manually
        const authority = 'https://mcp-sandbox-is.test.sensenet.cloud';
        const clientId = 'LCNi1qxzo2q9YjNU';
        const storageKey = `oidc.user:${authority}:${clientId}`;
        
        // Clear from both localStorage and sessionStorage
        localStorage.removeItem(storageKey);
        sessionStorage.removeItem(storageKey);
        console.log('[LoginButton] OIDC storage cleared manually');
        
        // Step 3: Try userManager.removeUser() if available (but don't rely on it)
        if (oidcResult.userManager) {
          try {
            await oidcResult.userManager.removeUser();
            console.log('[LoginButton] userManager.removeUser() completed');
          } catch (umErr) {
            console.warn('[LoginButton] userManager.removeUser() failed, but continuing:', umErr);
          }
        }
        
        // Step 4: Force refresh to update UI state
        console.log('[LoginButton] Forcing page refresh to update authentication state');
        window.location.reload();
        
      } catch (err) {
        console.error('[LoginButton] Complete local logout failed:', err);
        
        // Last resort: manual redirect to home page after clearing storage
        console.log('[LoginButton] Last resort: manual redirect to home');
        setRepositoryAccessToken('');
        localStorage.clear(); // Nuclear option
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
