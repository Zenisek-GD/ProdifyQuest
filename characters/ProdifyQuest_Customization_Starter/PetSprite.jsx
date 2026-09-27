import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { PETS } from './assetCatalog';
const TIMES = { idle: [1000, 220, 680], happy: [160, 200, 320] };
const PetSprite = forwardRef(function PetSprite({ petId, size = 96, enabled = true }, ref) {
  const pet = PETS[petId];
  const playback = useRef({ action: 'idle', frame: 0, elapsed: 0 });
  const [pose, setPose] = useState({ action: 'idle', frame: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useImperativeHandle(ref, () => ({ celebrate() {
    if (!enabled) return;
    playback.current = { action: 'happy', frame: 0, elapsed: 0 };
    setPose({ action: 'happy', frame: 0 });
  } }), [enabled]);
  useEffect(() => {
    if (!pet || !ready || !enabled) return;
    let raf, last, running = true;
    function tick(now) {
      if (!running) return;
      const p = playback.current;
      if (last != null) p.elapsed += Math.min(100, now - last);
      last = now; let changed = false;
      while (p.elapsed >= TIMES[p.action][p.frame]) {
        p.elapsed -= TIMES[p.action][p.frame]; p.frame++; changed = true;
        if (p.frame === 3) { p.frame = 0; p.action = 'idle'; }
      }
      if (changed) setPose({ action: p.action, frame: p.frame });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [pet, ready, enabled]);
  if (!pet) return null;
  return <View accessible accessibilityRole="image" accessibilityLabel={failed ? 'Pet image unavailable' : petId.replace(/-/g, ' ') + ' pet'} style={{ width: size, height: size, overflow: 'hidden' }}>
    <Image source={pet.atlas} resizeMode="stretch" fadeDuration={0} onLoad={() => { setReady(true); setFailed(false); }} onError={() => { setReady(false); setFailed(true); }} style={{ position: 'absolute', width: size * 3, height: size * 2, left: -pose.frame * size, top: pose.action === 'happy' ? -size : 0, opacity: ready ? 1 : 0 }} />
  </View>;
});
export default PetSprite;
