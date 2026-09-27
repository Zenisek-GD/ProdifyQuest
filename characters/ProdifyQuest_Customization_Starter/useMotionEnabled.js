import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
export default function useMotionEnabled(active = true) {
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true, preferenceChanged = false;
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { preferenceChanged = true; if (mounted) setReduced(value); });
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && !preferenceChanged) setReduced(value); }).catch(() => { if (mounted && !preferenceChanged) setReduced(false); });
    return () => { mounted = false; app.remove(); motion.remove(); };
  }, []);
  return active && foreground && !reduced;
}
