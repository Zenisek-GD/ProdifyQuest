import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

export const BOSS_ANIMATIONS = {
  idle: { row: 0, times: [650, 550, 650], loop: true },
  enraged: { row: 1, times: [320, 340, 380], loop: true },
  hit: { row: 2, times: [160, 220, 300], loop: false },
  defeat: { row: 3, times: [300, 400, 900], loop: false },
};
export type BossAction = keyof typeof BOSS_ANIMATIONS;
type Props = { action?: BossAction; size?: number; active?: boolean; eventKey?: number };
export default function BossSprite(props: Props) {
  return <BossFrames key={`${props.action}:${props.active}:${props.eventKey}`} {...props} />;
}
function BossFrames({ action = 'idle', size = 170, active = true, eventKey = 0 }: Props) {
  const [frame, setFrame] = useState(!active && action === 'defeat' ? 2 : 0), [ready, setReady] = useState(false);
  useEffect(() => {
    const animation = BOSS_ANIMATIONS[action];
    let current = 0, elapsed = 0, previous: number | undefined, handle = 0, running = true;
    if (!active || !ready) return;
    function tick(now: number) {
      if (!running) return;
      if (previous != null) elapsed += Math.min(100, now - previous);
      previous = now;
      while (elapsed >= animation.times[current]) {
        elapsed -= animation.times[current];
        if (current === 2) { if (!animation.loop) { running = false; break; } current = 0; } else current++;
        setFrame(current);
      }
      if (running) handle = requestAnimationFrame(tick);
    }
    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [action, active, ready, eventKey]);
  return <View accessible accessibilityRole="image" accessibilityLabel={`Dreadroot Sentinel, ${action}`} style={{ width: size, height: size, overflow: 'hidden' }}><Image accessible={false} source={require('./assets/dreadroot-atlas.png')} resizeMode="stretch" fadeDuration={0} onLoad={() => setReady(true)} style={{ position: 'absolute', width: size * 3, height: size * 4, left: -frame * size, top: -BOSS_ANIMATIONS[action].row * size, opacity: ready ? 1 : 0 }} /></View>;
}
