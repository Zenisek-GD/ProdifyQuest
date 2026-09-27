import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';

export function useBattleMotion() {
  const focused = useIsFocused();
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true, changed = false;
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; setReduced(value); });
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && !changed) setReduced(value); }).catch(() => { if (mounted && !changed) setReduced(false); });
    function syncForeground() {
      setForeground((AppState.currentState == null || AppState.currentState === 'active') && (Platform.OS !== 'web' || !document.hidden));
    }
    const app = AppState.addEventListener('change', syncForeground);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', syncForeground);
    return () => { mounted = false; preference.remove(); app.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', syncForeground); };
  }, []);
  return focused && foreground && !reduced;
}
