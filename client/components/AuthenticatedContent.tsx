import React from 'react';
import { useSharedAuth } from '../context/useSharedAuth';

interface AuthenticatedContentProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const AuthenticatedContent: React.FC<AuthenticatedContentProps> = ({ 
  children, 
  fallback 
}) => {
  const { user, isLoading } = useSharedAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
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
