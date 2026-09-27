import { create, isAxiosError } from 'axios';
import { Platform } from 'react-native';

declare module 'axios' {
  interface AxiosRequestConfig {
    _sessionGeneration?: number;
    _retry?: boolean;
  }
}

const defaultOrigin = Platform.OS === 'web' && typeof window !== 'undefined' && !__DEV__
  ? window.location.origin
  : Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || defaultOrigin).replace(/\/+$/, '');
export const api = create({ baseURL: `${API_URL}/api`, timeout: 20000, headers: { 'Content-Type': 'application/json' } });
const authTransport = create({ baseURL: `${API_URL}/api`, timeout: 20000 });

type Tokens = { idToken: string; refreshToken: string; expiresIn: number };
let session: (Tokens & { expiresAt: number }) | null = null;
let generation = 0;
let refreshing: { generation: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const sessionChanged = () => new Error('The session changed. Please try again.');

export function getSessionGeneration() { return generation; }
export function isCurrentSession(version: number | undefined) { return session !== null && generation === version; }

// Credentials live only in memory, never AsyncStorage/localStorage or route URLs.
export function setSession(tokens: Tokens) {
  generation += 1;
  refreshing = null;
  session = { ...tokens, expiresAt: Date.now() + Number(tokens.expiresIn || 3600) * 1000 };
}
export function clearSession() {
  generation += 1;
  refreshing = null;
  session = null;
  listeners.forEach(listener => listener());
}
export function onSessionCleared(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
async function refreshSession(version: number) {
  if (generation !== version) throw sessionChanged();
  if (refreshing?.generation === version) return refreshing.promise;
  const current = session;
  if (!current) throw new Error('Please sign in to continue.');
  const pending = { generation: version, promise: Promise.resolve() };
  refreshing = pending;
  pending.promise = (async () => {
    try {
      const { data } = await authTransport.post<Tokens>('/auth/refresh', { refreshToken: current.refreshToken });
      if (generation !== version) throw sessionChanged();
      session = { ...data, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000 };
    } catch (error) {
      if (generation === version && isAxiosError(error) && error.response?.status === 401) clearSession();
      throw error;
    } finally { if (refreshing === pending) refreshing = null; }
  })();
  return pending.promise;
}
const isPublic = (url?: string) => /^\/auth\/(login|register|reset-password|refresh)$/.test(url || '');
api.interceptors.request.use(async config => {
  if (!isPublic(config.url)) {
    // Retries retain the original generation and can never switch accounts.
    const version = config._sessionGeneration ?? generation;
    config._sessionGeneration = version;
    if (generation !== version) throw sessionChanged();
    if (!session) throw new Error('Please sign in to continue.');
    if (session.expiresAt <= Date.now() + 60000) await refreshSession(version);
    const current = session;
    if (!current || generation !== version) throw sessionChanged();
    config.headers.set('Authorization', `Bearer ${current.idToken}`);
  }
  return config;
});
api.interceptors.response.use(response => {
  if (!isPublic(response.config.url) && !isCurrentSession(response.config._sessionGeneration)) {
    throw sessionChanged();
  }
  return response;
}, async error => {
  const config = error.config;
  if (config && !isPublic(config.url)) {
    const version = config._sessionGeneration;
    if (!isCurrentSession(version)) throw sessionChanged();
    if (error.response?.status !== 401) return Promise.reject(error);
    if (session && !config._retry) {
      config._retry = true;
      await refreshSession(version);
      if (!isCurrentSession(version)) throw sessionChanged();
      return api.request(config);
    }
    clearSession();
  }
  return Promise.reject(error);
});

export function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (typeof error.response?.data?.error === 'string') return error.response.data.error;
    if (!error.response) return 'Cannot reach ProdifyQuest. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
