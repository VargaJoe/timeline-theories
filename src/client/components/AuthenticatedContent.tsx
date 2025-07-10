import React from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';

interface AuthenticatedContentProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const AuthenticatedContent: React.FC<AuthenticatedContentProps> = ({ 
  children, 
  fallback 
}) => {
  const { oidcUser, isLoading } = useOidcAuthentication();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!oidcUser) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        {fallback || (
          <>
            <h2>Authentication Required</h2>
            <p>Please log in to access this page. Click the "Login" button in the header.</p>
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
};
