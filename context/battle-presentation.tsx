import { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

const BattlePresentationContext = createContext({ busy: false, setBusy: (_busy: boolean) => {} });

export function BattlePresentationProvider({ children }: PropsWithChildren) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [busy]);
  return <BattlePresentationContext.Provider value={{ busy, setBusy }}>{children}</BattlePresentationContext.Provider>;
}

export const useBattlePresentation = () => useContext(BattlePresentationContext);
