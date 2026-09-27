import { createContext, PropsWithChildren, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@/context/auth';
import { api, errorMessage, getSessionGeneration, isCurrentSession } from '@/scripts/api';
import { CompanionUpdate, createCompanionStore, focusRemaining } from '@/scripts/companion-store';
import type { CompanionResponse } from '@/scripts/companion-types';

type State = {
  data: CompanionResponse | null; error: string; loading: boolean;
  remainingSeconds: number; studying: boolean;
  reload: () => Promise<void>;
  mutate: (path: string, body?: object, method?: 'POST' | 'PATCH' | 'PUT') => Promise<{ data: CompanionUpdate }>;
};
const CompanionContext = createContext<State | null>(null);
const isForeground = () => (AppState.currentState == null || AppState.currentState === 'active')
  && (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden);

export function CompanionProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [foreground, setForeground] = useState(isForeground);
  const [tick, setTick] = useState(() => Date.now());
  const [store] = useState(() => {
    const generation = getSessionGeneration();
    return createCompanionStore({
      read: () => api.get<CompanionUpdate>('/companion'),
      write: (url, data, method) => api.request<CompanionUpdate>({ url, data, method }),
      isCurrent: () => isCurrentSession(generation), message: errorMessage,
    });
  });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.start();
    const onVisibility = () => {
      const visible = isForeground();
      setForeground(visible);
      setTick(Date.now());
      if (visible) void store.refresh();
    };
    const subscription = AppState.addEventListener('change', onVisibility);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(() => { if (isForeground()) void store.reload(); }, 5000);
    return () => {
      subscription.remove(); clearInterval(timer); store.stop();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store]);
  // Profile changes follow confirmed task rewards, purchases and equipment changes.
  useEffect(() => { if (isForeground()) void store.refresh(); }, [store, pathname, user?.companion]);
  const running = snapshot.data?.focus?.status === 'running';
  useEffect(() => {
    if (!running || !foreground) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, foreground]);
  const remainingSeconds = focusRemaining(snapshot, Math.max(tick, snapshot.focusReceivedAt));
  const studying = running && remainingSeconds > 0;
  return <CompanionContext.Provider value={{ data: snapshot.data, error: snapshot.error, loading: snapshot.loading,
    remainingSeconds, studying, reload: store.refresh, mutate: store.mutate }}>{children}</CompanionContext.Provider>;
}

export function useCompanion() {
  const context = useContext(CompanionContext);
  if (!context) throw new Error('useCompanion must be used inside CompanionProvider');
  return context;
}
