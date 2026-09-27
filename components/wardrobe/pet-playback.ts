export type PetAction = 'idle' | 'happy';
export type PetPlayback = { action: PetAction; frame: number; elapsed: number };
const TIMES: Record<PetAction, number[]> = { idle: [1000, 220, 680], happy: [160, 200, 320] };
export const createPetPlayback = (action: PetAction = 'idle'): PetPlayback => ({ action, frame: 0, elapsed: 0 });
export function advancePetPlayback(current: PetPlayback, elapsed: number): PetPlayback {
  const next = { ...current, elapsed: current.elapsed + Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) };
  if (next.action === 'idle') next.elapsed %= 1900;
  while (next.elapsed >= TIMES[next.action][next.frame]) {
    next.elapsed -= TIMES[next.action][next.frame];
    next.frame += 1;
    if (next.frame === 3) { next.frame = 0; next.action = 'idle'; next.elapsed %= 1900; }
  }
  return next;
}
