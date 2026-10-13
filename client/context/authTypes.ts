import { createContext } from 'react';
export interface AuthUser { UserName?: string; DisplayName?: string; Email?: string; email?: string; sub?: string; Id?: number; [key: string]: unknown }
export interface AuthContextModel {
  user?: AuthUser;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  accessToken?: string;
  isLoading: boolean;
  error?: string;
}
export const SNAuthContext = createContext<AuthContextModel | undefined>(undefined);
export const ISAuthContext = createContext<AuthContextModel | undefined>(undefined);
