import React from 'react';
import { AuthenticationProvider } from '@sensenet/authentication-oidc-react';
import { configuration } from './configuration';
import { browserHistory } from './browserHistory';

console.log('[AppProviders] Mounting AuthenticationProvider');
console.log('[AppProviders] configuration:', configuration);
console.log('[AppProviders] browserHistory:', browserHistory);

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

export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  // Check for maintenance mode
  const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

  if (isMaintenanceMode) {
    return <MaintenanceMode />;
  }

  return (
    <AuthenticationProvider configuration={configuration} history={browserHistory}>
      {children}
    </AuthenticationProvider>
  );
};
