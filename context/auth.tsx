import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, clearSession, getSessionGeneration, isCurrentSession, onSessionCleared, setSession } from '@/scripts/api';
import type { Companion } from '@/scripts/companion-types';

export type User = {
  id: string; username: string; email: string; coins: number; streak: number;
  bestStreak: number; level: number; exp: number; timeZone: string; imagePath?: string;
  character?: { level: number; exp: number; image: string; tier: string };
  companion?: Companion;
};
type Auth = {
  user: User | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>; refreshUser: () => Promise<void>;
};
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authAttempt = useRef(0);
  useEffect(() => {
    let mounted = true;
    // Remove tokens left by the earlier unfinished client.
    AsyncStorage.multiRemove(['uid', 'idToken', 'refreshToken']).catch(() => {}).finally(() => { if (mounted) setLoading(false); });
    const unsubscribe = onSessionCleared(() => { authAttempt.current += 1; setUser(null); });
    return () => { mounted = false; authAttempt.current += 1; unsubscribe(); };
  }, []);
  const refreshUser = useCallback(async () => {
    const version = getSessionGeneration();
    const { data } = await api.get<{ user: User }>('/me', { _sessionGeneration: version });
    if (!isCurrentSession(version)) throw new Error('The session changed. Please try again.');
    setUser(data.user);
  }, []);
  const authenticate = useCallback(async (path: string, body: object) => {
    // Starting another sign-in cancels requests and attempts from the prior account.
    clearSession();
    const attempt = ++authAttempt.current;
    const previousVersion = getSessionGeneration();
    const { data } = await api.post(path, body);
    if (attempt !== authAttempt.current || previousVersion !== getSessionGeneration()) {
      throw new Error('The sign-in attempt changed. Please try again.');
    }
    setSession(data);
    const version = getSessionGeneration();
    try { await refreshUser(); }
    catch (error) {
      if (attempt === authAttempt.current && isCurrentSession(version)) clearSession();
      throw error;
    }
  }, [refreshUser]);
  const signIn = useCallback((email: string, password: string) => authenticate('/auth/login', { email, password }), [authenticate]);
  const register = useCallback((username: string, email: string, password: string) => authenticate('/auth/register', {
    username, email, password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }), [authenticate]);
  const signOut = useCallback(async () => {
    authAttempt.current += 1;
    const version = getSessionGeneration();
    // Show server failures in the caller so users know revocation did not succeed.
    // Local credentials are cleared regardless of connectivity.
    try { await api.post('/auth/logout', undefined, { _sessionGeneration: version }); }
    finally {
      if (version === getSessionGeneration()) { clearSession(); setUser(null); }
    }
  }, []);
  return <AuthContext.Provider value={{ user, loading, signIn, register, signOut, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
