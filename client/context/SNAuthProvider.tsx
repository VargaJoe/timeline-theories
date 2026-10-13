import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSnAuth } from '@sensenet/sn-auth-react';
import { SNAuthContext } from './authTypes';
import { environment } from '../configuration';
import { setRepositoryAccessToken } from '../services/sensenet';
export function SNAuthProvider({ children }: { children: ReactNode }) {
  const { user, externalLogin, logout, accessToken, isLoading, error } = useSnAuth();
  const processing = useRef(false);
  const [callbackError, setCallbackError] = useState<string>();
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('auth_code');
    if (!code || processing.current) return;
    processing.current = true;
    const exchange = async () => {
      const response = await fetch(environment.authority + '/api/auth/convert-auth-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: code }) });
      if (!response.ok) throw new Error('Token exchange failed: ' + response.status);
      const tokens = await response.json();
      if (typeof tokens.accessToken !== 'string') throw new Error('Invalid token exchange');
      const details = await fetch(environment.repositoryUrl + "/odata.svc/('Root')/GetCurrentUser", { headers: { Authorization: 'Bearer ' + tokens.accessToken } });
      if (!details.ok) throw new Error('User verification failed: ' + details.status);
      const currentUser = await details.json();
      localStorage.setItem('sn-auth-access-token', tokens.accessToken);
      if (tokens.refreshToken) localStorage.setItem('sn-auth-refresh-token', tokens.refreshToken);
      localStorage.setItem('sn-auth-user-details', JSON.stringify(currentUser.d));
      window.history.replaceState(null, '', '/timelines');
      window.location.reload();
    };
    void exchange().catch(() => setCallbackError('Authentication failed. Please log in again.'));
  }, []);
  return <SNAuthContext.Provider value={{ user, isAuthenticated: !!user,
    login: async () => { await externalLogin(); }, logout: async () => { setRepositoryAccessToken(''); await logout(); },
    accessToken, isLoading, error: callbackError || error?.message }}>{children}</SNAuthContext.Provider>;
}
