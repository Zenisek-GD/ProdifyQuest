import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import Companion from './companions/Companion';
import PetSprite from './PetSprite';
import useMotionEnabled from './useMotionEnabled';
import { BACKGROUNDS, AURAS } from './assetCatalog';

function Aura({ auraId, size, enabled }) {
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    phase.setValue(0);
    if (!enabled) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(phase, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(phase, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    loop.start(); return () => loop.stop();
  }, [phase, enabled, auraId]);
  if (!AURAS[auraId]) return null;
  return <Animated.Image accessible={false} source={AURAS[auraId]} resizeMode="contain" style={{ width: size, height: size, opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.64, 0.85] }), transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }] }} />;
}

const CompanionScene = forwardRef(function CompanionScene({ outfit, width = 360, restingState = 'idle', active = true, onError }, ref) {
  const companion = useRef(null), pet = useRef(null);
  const enabled = useMotionEnabled(active);
  const w = Math.max(160, Number.isFinite(width) ? width : 360), h = w * 0.75;
  const companionWidth = w * 0.92, scale = companionWidth / 368;
  const footX = w * 0.47, footY = h * (outfit.backgroundId === 'sky-island' ? 0.78 : 0.87);
  const auraSize = w * 0.62, petSize = w * 0.26;
  useImperativeHandle(ref, () => ({
    play(action) { companion.current?.play(action); if (action === 'celebrate') pet.current?.celebrate(); },
    stop() { companion.current?.stop(); },
  }), []);
  return <View style={{ width: w, height: h, overflow: 'hidden', backgroundColor: '#e6e1f2', borderRadius: 22 }}>
    <Image accessible={false} source={BACKGROUNDS[outfit.backgroundId] || BACKGROUNDS['study-room']} resizeMode="cover" style={{ position: 'absolute', width: w, height: h }} />
    {outfit.auraId && <View pointerEvents="none" style={{ position: 'absolute', left: footX - auraSize / 2, top: footY - auraSize * 0.83 }}><Aura auraId={outfit.auraId} size={auraSize} enabled={enabled} /></View>}
    <View style={{ position: 'absolute', left: footX - 136 * scale, top: footY - 228 * scale }}>
      <Companion ref={companion} companionId={outfit.companionId} width={companionWidth} restingState={restingState} active={active} onError={onError} />
    </View>
    {outfit.petId && <View style={{ position: 'absolute', left: w * 0.70, top: footY - petSize * 0.84 }}>
      <PetSprite key={outfit.petId} ref={pet} petId={outfit.petId} size={petSize} enabled={enabled} />
    </View>}
  </View>;
});
export default CompanionScene;
