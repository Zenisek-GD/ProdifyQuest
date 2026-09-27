import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { PETS } from './assets';
import { advancePetPlayback, createPetPlayback } from './pet-playback';

export type PetHandle = { celebrate: () => void; stop: () => void };
export const PetSprite = forwardRef<PetHandle, { petId: string; size?: number; enabled?: boolean }>(function PetSprite({ petId, size = 96, enabled = true }, ref) {
  const pet = PETS[petId];
  const playback = useRef(createPetPlayback());
  const [pose, setPose] = useState(createPetPlayback);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useImperativeHandle(ref, () => ({
    celebrate() {
      if (!enabled) return;
      playback.current = createPetPlayback('happy'); setPose(playback.current);
    },
    stop() { playback.current = createPetPlayback(); setPose(playback.current); },
  }), [enabled]);
  useEffect(() => {
    if (!pet || !ready || !enabled) return;
    let raf = 0, last: number | undefined, running = true;
    function tick(now: number) {
      if (!running) return;
      const previous = playback.current;
      playback.current = advancePetPlayback(previous, last == null ? 0 : Math.min(100, now - last));
      last = now;
      if (previous.action !== playback.current.action || previous.frame !== playback.current.frame) setPose(playback.current);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [pet, ready, enabled]);
  if (!pet) return null;
  return <View testID={`wardrobe-pet-${petId}`} accessible accessibilityRole="image" accessibilityLabel={failed ? 'Pet image unavailable' : `${petId.replace(/-/g, ' ')} pet`} style={{ width: size, height: size, overflow: 'hidden' }}>
    <Image source={pet.atlas} resizeMode="stretch" fadeDuration={0} onLoad={() => { setReady(true); setFailed(false); }} onError={() => { setReady(false); setFailed(true); }} style={{ position: 'absolute', width: size * 3, height: size * 2, left: -pose.frame * size, top: pose.action === 'happy' ? -size : 0, opacity: ready ? 1 : 0 }} />
  </View>;
});
