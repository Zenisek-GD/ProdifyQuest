// Pure timing logic. No React Native or third-party dependencies.
export const SHEET = { frameWidth: 368, frameHeight: 256, columns: 6, rows: 5 };

export const ANIMATIONS = {
  idle: { row: 0, durations: [600, 220, 140, 260, 220, 640] },
  wave: { row: 1, durations: [200, 180, 200, 200, 180, 340] },
  study: { row: 2, durations: [650, 350, 140, 300, 350, 500] },
  celebrate: { row: 3, durations: [220, 120, 140, 220, 140, 500] },
  attack: { row: 4, durations: [240, 200, 200, 130, 230, 360] },
};

const ACTIONS = ['wave', 'celebrate', 'attack'];

export function createPlayback(restingState = 'idle') {
  return { restingState: restingState === 'study' ? 'study' : 'idle', queue: [], frame: 0, elapsed: 0 };
}

export function getPose(playback) {
  return { animation: playback.queue[0] || playback.restingState, frame: playback.frame };
}

export function startActions(playback, actionOrSequence) {
  const queue = (Array.isArray(actionOrSequence) ? [...actionOrSequence] : [actionOrSequence]).map(action => action === 'cast' ? 'attack' : action);
  if (!queue.length || queue.some(action => !ACTIONS.includes(action))) {
    throw new Error('Companion.play expects wave, celebrate, attack, or an array of these actions.');
  }
  // A new call deliberately replaces the current action sequence.
  return { ...playback, queue, frame: 0, elapsed: 0 };
}

export function setRestingState(playback, restingState) {
  const next = restingState === 'study' ? 'study' : 'idle';
  if (next === playback.restingState) return playback;
  if (!playback.queue.length) return createPlayback(next);
  return { ...playback, restingState: next };
}

export function advancePlayback(playback, deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error('deltaMs must be a finite, non-negative number.');
  }
  const next = { ...playback, queue: [...playback.queue], elapsed: playback.elapsed + deltaMs };
  const completed = [];
  for (;;) {
    const animation = next.queue[0] || next.restingState;
    const durations = ANIMATIONS[animation].durations;
    if (next.elapsed < durations[next.frame]) break;
    next.elapsed -= durations[next.frame];
    next.frame += 1;
    if (next.frame === durations.length) {
      next.frame = 0;
      if (next.queue.length) completed.push(next.queue.shift());
      // Fast-forward complete idle/study loops without creating callbacks.
      if (!next.queue.length) {
        const loopDuration = ANIMATIONS[next.restingState].durations.reduce((a, b) => a + b, 0);
        next.elapsed %= loopDuration;
      }
    }
  }
  return { playback: next, completed };
}
