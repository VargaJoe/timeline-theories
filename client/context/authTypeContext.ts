import { createContext, useContext } from 'react';
import type { AuthServerType } from '../services/authConfigService';
export const AuthTypeContext = createContext<{ authType: AuthServerType | null }>({ authType: null });
export function useAuthType() { return useContext(AuthTypeContext); }
