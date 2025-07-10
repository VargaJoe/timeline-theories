import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

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

  try {
    // Skip the loading state entirely - just show login/logout based on user state
    if (error) {
      console.log('[LoginButton] Rendering: OIDC Error', error);
      return <div style={{ color: 'red', padding: '8px', border: '1px solid red' }}>OIDC Error: {error}</div>;
    }

    if (oidcUser) {
      console.log('[LoginButton] Rendering: Logout button');
      return <button onClick={logout} style={{ backgroundColor: 'red', color: 'white', padding: '8px 16px' }}>Logout</button>;
    } else {
      console.log('[LoginButton] Rendering: Login button');
      return <button onClick={login} style={{ backgroundColor: 'blue', color: 'white', padding: '8px 16px' }}>Login with SenseNet</button>;
    }
  } catch (err) {
    console.error('[LoginButton] Error in render:', err);
    return <div style={{ color: 'red', padding: '8px', border: '1px solid red' }}>LoginButton Error: {String(err)}</div>;
  }
};
