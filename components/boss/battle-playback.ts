import type { ConfirmedAttack } from '@/scripts/battle-types';

type Callbacks = {
  motion: () => boolean;
  prepare: (result: ConfirmedAttack) => void;
  entrance: () => void;
  attack: () => void;
  projectile: () => void;
  impact: (result: ConfirmedAttack) => void;
  recover: (result: ConfirmedAttack) => void;
  fade: () => void;
  settle: (result: ConfirmedAttack) => void;
  busy: (busy: boolean) => void;
};

// Presentation consumes confirmed outcomes; it cannot spend a charge or grant loot.
export function createBattlePlayback(callbacks: Callbacks, schedule = setTimeout, cancel = clearTimeout) {
  let pending: ConfirmedAttack | null = null, started = false, impacted = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  function clear() { timers.forEach(cancel); timers = []; }
  function later(fn: () => void, ms: number) { timers.push(schedule(fn, ms)); }
  function impact(result: ConfirmedAttack) { if (!impacted) { impacted = true; callbacks.impact(result); } }
  function settle() {
    clear();
    const result = pending;
    pending = null; started = false;
    if (result) { impact(result); callbacks.settle(result); }
    callbacks.busy(false);
  }
  return {
    play(result: ConfirmedAttack) {
      if (pending) return false;
      pending = result; impacted = false;
      callbacks.busy(true); callbacks.prepare(result);
      if (!callbacks.motion()) settle();
      else later(settle, 8000); // A missing image must not leave the app locked.
      return true;
    },
    ready() {
      const result = pending;
      if (!result || started) return;
      if (!callbacks.motion()) { settle(); return; }
      started = true; clear(); callbacks.entrance();
      later(callbacks.attack, 260);
      later(callbacks.projectile, 700);
      later(() => impact(result), 920);
      later(() => callbacks.recover(result), 1700);
      later(callbacks.fade, 2450);
      later(settle, 2700);
    },
    settle,
    destroy() { clear(); pending = null; callbacks.busy(false); },
  };
}
