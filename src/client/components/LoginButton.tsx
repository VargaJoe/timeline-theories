import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

console.log('[LoginButton] Component loaded');

export const LoginButton: React.FC = () => {
  const { oidcUser, login, logout, isLoading, error } = useOidcAuthentication();

  // Debug logging for OIDC state
  console.debug('[LoginButton] isLoading:', isLoading);
  console.debug('[LoginButton] oidcUser:', oidcUser);
  console.debug('[LoginButton] error:', error);
  console.debug('[LoginButton] login:', typeof login);
  console.debug('[LoginButton] logout:', typeof logout);

  if (isLoading) {
    console.debug('[LoginButton] Rendering: Loading...');
    return <button disabled>Loading...</button>;
  }
  if (error) {
    console.debug('[LoginButton] Rendering: OIDC Error', error);
    return <div style={{ color: 'red' }}>OIDC Error: {error}</div>;
  }

  if (oidcUser) {
    console.debug('[LoginButton] Rendering: Logout button');
    return <button onClick={logout}>Logout</button>;
  } else {
    console.debug('[LoginButton] Rendering: Login button');
    return <button onClick={login}>Login with SenseNet</button>;
  }
};
