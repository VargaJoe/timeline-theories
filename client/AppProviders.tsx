import React, { useEffect, useState, Suspense, createContext, useContext } from 'react';
import { AuthenticationProvider as SNAuthenticationProvider } from '@sensenet/sn-auth-react';
import { AuthenticationProvider as OidcAuthenticationProvider } from '@sensenet/authentication-oidc-react';
import type { AuthServerType, AuthConfig } from './services/authConfigService';
import { getAuthConfig } from './services/authConfigService';
import { repositoryUrl } from './configuration';
import { ISAuthProvider } from './context/ISAuthProvider';
import { SNAuthProvider } from './context/SNAuthProvider';
import { browserHistory } from './browserHistory';

console.log('[AppProviders] Mounting AppProviders');
console.log('[AppProviders] repositoryUrl:', repositoryUrl);

// Auth Type Context
export const AuthTypeContext = createContext<{ authType: AuthServerType | null }>({ authType: null });

// Hook to use auth type
export function useAuthType() {
  return useContext(AuthTypeContext);
}

// Maintenance mode component
const MaintenanceMode = () => (
  <div style={{
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f8f9fa',
    color: '#333',
    textAlign: 'center',
    padding: '20px'
  }}>
    <div style={{
      background: '#fff',
      padding: '40px',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      maxWidth: '500px'
    }}>
      <h1 style={{ margin: '0 0 20px 0', color: '#2a4d8f' }}>Maintenance Mode</h1>
      <p style={{ margin: '0 0 20px 0', fontSize: '16px', lineHeight: '1.5' }}>
        The site is currently under maintenance. Please check back later.
      </p>
      <div style={{ fontSize: '48px', margin: '20px 0' }}>🔧</div>
    </div>
  </div>
);

// Loading component
const LoadingScreen = () => (
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
      <h1 style={{ margin: '0 0 20px 0', color: '#2a4d8f' }}>Loading</h1>
      <p style={{ margin: '0 0 20px 0', fontSize: '16px', lineHeight: '1.5' }}>
        Detecting authentication configuration...
      </p>
      <div style={{ fontSize: '48px', margin: '20px 0' }}>⚙️</div>
    </div>
  </div>
);

// Error component
interface ErrorScreenProps {
  message: string;
  error?: Error;
}

const ErrorScreen = ({ message, error }: ErrorScreenProps) => (
  <div style={{
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f8f9fa',
    color: '#d32f2f',
  }}>
    <div style={{
      background: '#fff',
      padding: '40px',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      maxWidth: '600px',
      textAlign: 'center'
    }}>
      <h1 style={{ margin: '0 0 20px 0', color: '#d32f2f' }}>Authentication Error</h1>
      <p style={{ margin: '0 0 20px 0', fontSize: '16px', lineHeight: '1.5' }}>
        {message}
      </p>
      {error && (
        <pre style={{
          background: '#f5f5f5',
          padding: '15px',
          borderRadius: '4px',
          textAlign: 'left',
          fontSize: '12px',
          overflow: 'auto',
          maxHeight: '200px'
        }}>
          {error.message}
        </pre>
      )}
    </div>
  </div>
);

/**
 * SNAuth Provider Wrapper
 * Wraps SNAuthRepositoryProvider and SNAuthProvider with localStorage support
 */
const SNAuthProviderWrapper = ({ children, authServerUrl }: { children: React.ReactNode; authServerUrl: string }) => {
  // Store auth config in localStorage for persistence across page reloads
  const authConfig = {
    callbackUri: `${window.location.origin}/authentication/callback`,
    authServerUrl,
    repoUrl: repositoryUrl
  };
  
  React.useEffect(() => {
    // Save auth configuration to localStorage for callback processing
    window.localStorage.setItem('sn-auth-config', JSON.stringify(authConfig));
    console.log('[SNAuthProviderWrapper] Saved auth config to localStorage:', authConfig);
    
    // Log callback URL processing
    console.log('[SNAuthProviderWrapper] Current URL on mount:', window.location.href);
    console.log('[SNAuthProviderWrapper] Search params:', window.location.search);
    
    // Log all localStorage keys related to SNAuth
    console.log('[SNAuthProviderWrapper] Checking localStorage for SNAuth data...');
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.includes('auth') || key.includes('sn-auth') || key.includes('sensenet'))) {
        const value = window.localStorage.getItem(key);
        console.log(`[SNAuthProviderWrapper] localStorage['${key}']:`, value?.substring(0, 100) + (value && value.length > 100 ? '...' : ''));
      }
    }
    
    if (window.location.pathname.includes('callback')) {
      console.log('[SNAuthProviderWrapper] Callback path detected!');
    }
  }, []);

  return (
    <SNAuthenticationProvider
      snAuthConfiguration={{
        callbackUri: `${window.location.origin}/authentication/callback`
      }}
      repoUrl={repositoryUrl}
      authServerUrl={authServerUrl}
    >
      <SNAuthProvider>
        {children}
      </SNAuthProvider>
    </SNAuthenticationProvider>
  );
};

/**
 * IdentityServer Provider Wrapper
 * Wraps OIDC AuthenticationProvider and ISAuthProvider
 */
const ISAuthProviderWrapper = ({ children, authServerUrl }: { children: React.ReactNode; authServerUrl: string }) => {
  console.log('[ISAuthProviderWrapper] Initializing with authServerUrl:', authServerUrl);
  
  return (
    <OidcAuthenticationProvider
      configuration={{
        client_id: import.meta.env.VITE_OIDC_CLIENT_ID || 'your-client-id',
        authority: authServerUrl,
        redirect_uri: `${window.location.origin}/authentication/callback`,
        post_logout_redirect_uri: `${window.location.origin}/`,
        response_type: 'code',
        scope: 'openid profile sensenet',
        silent_redirect_uri: `${window.location.origin}/authentication/silent_callback`,
        automaticSilentRenew: true,
        extraQueryParams: { snrepo: repositoryUrl },
      }}
      history={browserHistory}
    >
      <ISAuthProvider>
        {children}
      </ISAuthProvider>
    </OidcAuthenticationProvider>
  );
};

/**
 * Main AppProviders component
 * Detects authentication type from SenseNet API and renders appropriate provider
 */
export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  // Check for maintenance mode
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

  if (isMaintenanceMode) {
    return <MaintenanceMode />;
  }

  // Use a separate component to handle auth type detection
  return (
    <AuthTypeDetector>
      {children}
    </AuthTypeDetector>
  );
};

/**
 * Component that detects auth type and renders appropriate provider
 */
function AuthTypeDetector({ children }: { children: React.ReactNode }) {
  const [authType, setAuthType] = useState<AuthServerType | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const detectAuth = async () => {
      try {
        setIsLoading(true);
        console.log('[AuthTypeDetector] Detecting auth type from:', repositoryUrl);
        
        const config = await getAuthConfig(repositoryUrl);
        const detectedType = config.authServerSettings.type as AuthServerType;
        
        console.log('[AuthTypeDetector] Detected auth type:', detectedType);
        setAuthConfig(config);
        setAuthType(detectedType);
        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        console.error('[AuthTypeDetector] Failed to detect auth type:', error);
        setError(error);
        // Default to SNAuth if detection fails
        setAuthType('SNAuth');
      } finally {
        setIsLoading(false);
      }
    };

    detectAuth();
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (error && authType === null) {
    return (
      <ErrorScreen
        message={`Failed to detect authentication configuration from ${repositoryUrl}`}
        error={error}
      />
    );
  }

  if (!authType) {
    return <ErrorScreen message="No authentication type detected" />;
  }

  console.log('[AuthTypeDetector] Rendering provider for auth type:', authType);

  // Render appropriate provider based on detected auth type, wrapping in AuthTypeContext
  const contextValue = { authType };

  if (authType === 'IdentityServer') {
    const authServerUrl = authConfig?.authServerSettings.authority || authConfig?.authServerSettings.issuer || repositoryUrl;
    return (
      <AuthTypeContext.Provider value={contextValue}>
        <Suspense fallback={<LoadingScreen />}>
          <ISAuthProviderWrapper authServerUrl={authServerUrl}>
            {children}
          </ISAuthProviderWrapper>
        </Suspense>
      </AuthTypeContext.Provider>
    );
  } else {
    // SNAuth
    const authServerUrl = authConfig?.authServerSettings.authority || authConfig?.authServerSettings.issuer || repositoryUrl;
    return (
      <AuthTypeContext.Provider value={contextValue}>
        <Suspense fallback={<LoadingScreen />}>
          <SNAuthProviderWrapper authServerUrl={authServerUrl}>
            {children}
          </SNAuthProviderWrapper>
        </Suspense>
      </AuthTypeContext.Provider>
    );
  }
}
