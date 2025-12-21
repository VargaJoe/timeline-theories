import React, { useState } from 'react';
import { setRepositoryAccessToken } from '../services/sensenet';

// Unified auth hook - works for both SNAuth and OIDC
import { useAuth as useSNAuth } from '../context/SNAuthProvider';
import { useAuth as useOidcAuth } from '../context/ISAuthProvider';

console.log('[LoginButton] Component loaded');

/**
 * Unified Login Button Component
 * Uses the unified useAuth hook from either SNAuthProvider or ISAuthProvider
 */
export const LoginButton: React.FC = () => {
  console.log('[LoginButton] Component rendering...');
  
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Try to get auth from SNAuthProvider
  let auth: any = null;
  let isSNAuthMode = false;

  try {
    auth = useSNAuth();
    isSNAuthMode = true;
  } catch (e) {
    console.log('[LoginButton] SNAuth not available, trying OIDC');
    try {
      auth = useOidcAuth();
      isSNAuthMode = false;
    } catch (e2) {
      console.log('[LoginButton] Neither auth method available');
      auth = null;
    }
  }

  if (!auth) {
    return (
      <button 
        disabled
        style={{ 
          backgroundColor: '#ccc', 
          color: '#999', 
          padding: '8px 16px', 
          border: 'none', 
          borderRadius: '4px', 
          cursor: 'not-allowed'
        }}
      >
        Auth Not Available
      </button>
    );
  }

  const { user, isAuthenticated, login, logout, error } = auth;

  console.log('[LoginButton] Auth state:', {
    isSNAuthMode,
    isAuthenticated,
  });

  // Login handler - unified for both auth types
  const handleLogin = async () => {
    console.log('[LoginButton] Attempting login');
    
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await login();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[LoginButton] Login failed:', err);
      setAuthError(errorMessage);
      setIsLoggingIn(false);
    }
    // Note: For redirect-based auth (OIDC/SNAuth), page will navigate away on success
  };

  // Logout handler - unified for both auth types
  const handleLogout = async () => {
    console.log('[LoginButton] Logging out');
    setRepositoryAccessToken('');
    
    try {
      await logout();
    } catch (err) {
      console.error('[LoginButton] Logout error:', err);
    }
    
    // Force reload to clear session
    window.location.reload();
  };

  // Logged in state - show user and logout button
  if (isAuthenticated && user) {
    const userName = user.Name || user.name || 'User';
    console.log('[LoginButton] Rendering: Logout button for user', userName);
    return (
      <button 
        onClick={handleLogout} 
        style={{ 
          backgroundColor: '#d32f2f', 
          color: 'white', 
          padding: '8px 16px', 
          border: 'none', 
          borderRadius: '4px', 
          cursor: 'pointer',
          fontWeight: 'bold'
        }}
        title="Click to logout"
      >
        Logout ({userName})
      </button>
    );
  }

  // Not logged in - show login button
  console.log('[LoginButton] Rendering: Login button');
  const authTypeLabel = isSNAuthMode ? 'SNAuth' : 'IdentityServer';
  
  return (
    <div>
      {(authError || error) && (
        <div style={{ 
          color: '#d32f2f', 
          marginBottom: '10px', 
          padding: '8px', 
          backgroundColor: '#ffebee', 
          borderRadius: '4px',
          fontSize: '12px'
        }}>
          ❌ {authError || error}
        </div>
      )}
      <button 
        onClick={handleLogin}
        disabled={isLoggingIn}
        style={{ 
          backgroundColor: '#2a4d8f', 
          color: 'white', 
          padding: '8px 16px', 
          border: 'none', 
          borderRadius: '4px', 
          cursor: isLoggingIn ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          opacity: isLoggingIn ? 0.6 : 1
        }}
        title={`Redirects to ${authTypeLabel} for login`}
      >
        {isLoggingIn ? `Redirecting to ${authTypeLabel}...` : `Login with ${authTypeLabel}`}
      </button>
    </div>
  );
};
