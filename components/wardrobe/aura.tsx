import { useEffect, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { AURAS } from './assets';

export function Aura({ auraId, size, enabled }: { auraId: string; size: number; enabled: boolean }) {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    phase.setValue(0);
    if (!enabled) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(phase, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(phase, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase, enabled, auraId]);
  if (!AURAS[auraId]) return null;
  return <Animated.Image testID={`wardrobe-aura-${auraId}`} accessible={false} source={AURAS[auraId]} resizeMode="contain" style={{ width: size, height: size, opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.64, 0.85] }), transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }] }} />;
}
