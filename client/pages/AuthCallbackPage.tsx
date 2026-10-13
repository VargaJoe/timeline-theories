import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedAuth } from '../context/useSharedAuth';
export default function AuthCallbackPage() {
  const { isAuthenticated, isLoading, error } = useSharedAuth();
  const navigate = useNavigate();
  useEffect(() => { if (isAuthenticated && !isLoading) navigate('/timelines', { replace: true }); }, [isAuthenticated, isLoading, navigate]);
  return <div style={{ padding: 32 }}><h1>Processing Login</h1><p>{error || 'Authenticating...'}</p></div>;
}
