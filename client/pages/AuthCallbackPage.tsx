import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSnAuth } from '@sensenet/sn-auth-react';

/**
 * Callback handler page for SNAuth authentication
 * Processes the callback from SNAuth server and stores token in localStorage
 */
export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, accessToken, error } = useSnAuth();

  console.log('[AuthCallbackPage] Mounted');
  console.log('[AuthCallbackPage] URL:', window.location.href);
  console.log('[AuthCallbackPage] Search params:', location.search);
  console.log('[AuthCallbackPage] useSnAuth state:', {
    user: user ? { UserName: user.UserName, DisplayName: user.DisplayName } : null,
    isLoading,
    accessToken: accessToken ? `exists (${accessToken.length} chars)` : 'missing',
    error: error?.message || 'none'
  });

  // Check localStorage for tokens
  console.log('[AuthCallbackPage] Checking localStorage for tokens...');
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.includes('sn-auth')) {
      const value = window.localStorage.getItem(key);
      console.log(`[AuthCallbackPage] localStorage['${key}']:`, value?.substring(0, 100));
    }
  }

  useEffect(() => {
    console.log('[AuthCallbackPage] useEffect triggered');
    
    // Wait for auth to finish loading
    if (isLoading) {
      console.log('[AuthCallbackPage] Still loading...');
      return;
    }

    console.log('[AuthCallbackPage] Loading complete');
    console.log('[AuthCallbackPage] User:', user ? user.UserName || user.DisplayName : 'none');
    console.log('[AuthCallbackPage] AccessToken:', accessToken ? 'exists' : 'missing');

    // If we have a user or accessToken, redirect to timelines
    if (user && accessToken) {
      console.log('[AuthCallbackPage] User authenticated, redirecting to timelines');
      navigate('/timelines', { replace: true });
    } else if (error) {
      console.error('[AuthCallbackPage] Authentication error:', error);
      // Redirect to timelines even if there's an error
      navigate('/timelines', { replace: true });
    } else {
      console.log('[AuthCallbackPage] No user or token yet');
      // Still redirect back to timelines after a delay
      setTimeout(() => {
        console.log('[AuthCallbackPage] Timeout redirect to timelines');
        navigate('/timelines', { replace: true });
      }, 2000);
    }
  }, [user, isLoading, accessToken, error, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8f9fa',
      color: '#333',
    }}>
      <div style={{
        background: '#fff',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        maxWidth: '500px',
        textAlign: 'center'
      }}>
        <h1 style={{ margin: '0 0 20px 0', color: '#2a4d8f' }}>Processing Login</h1>
        <p style={{ margin: '0 0 20px 0', fontSize: '16px', lineHeight: '1.5' }}>
          {isLoading ? 'Authenticating...' : 'Redirecting...'}
        </p>
        <div style={{ fontSize: '48px', margin: '20px 0' }}>⏳</div>
      </div>
    </div>
  );
};

export default AuthCallbackPage;
