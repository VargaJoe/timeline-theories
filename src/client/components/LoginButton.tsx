import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

export const LoginButton: React.FC = () => {
  const { oidcUser, login, logout, isLoading, error } = useOidcAuthentication();

  if (isLoading) return <button disabled>Loading...</button>;
  if (error) return <div style={{ color: 'red' }}>OIDC Error: {error}</div>;

  return oidcUser ? (
    <button onClick={logout}>Logout</button>
  ) : (
    <button onClick={login}>Login with SenseNet</button>
  );
};
