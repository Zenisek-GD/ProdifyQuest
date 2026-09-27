import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

const visible = () => (AppState.currentState == null || AppState.currentState === 'active')
  && (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden);

export function useMotionEnabled(active = true) {
  const [foreground, setForeground] = useState(visible);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true, preferenceChanged = false;
    const onVisibility = () => setForeground(visible());
    const app = AppState.addEventListener('change', onVisibility);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceChanged = true;
      if (mounted) setReduced(value);
    });
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisibility);
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !preferenceChanged) setReduced(value);
    }).catch(() => { if (mounted && !preferenceChanged) setReduced(false); });
    return () => {
      mounted = false; app.remove(); motion.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return active && foreground && !reduced;
}
