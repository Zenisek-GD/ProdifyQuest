import type { Raid } from '@/scripts/battle-types';

// A delayed poll or replay must never restore HP from an older raid revision.
export function isOlderRaid(current: Raid | null, incoming: Raid | null) {
  return !!current && !!incoming && current.id === incoming.id
    && (incoming.revision ?? 0) < (current.revision ?? 0);
}

export type RaidUpdateOptions = { authoritative?: boolean; transitionFrom?: string | null };

// Only the current-raid GET or an explicitly requested creation can change
// events. An old attack/claim response must not replace a newer event.
export function canAcceptRaidUpdate(current: Raid | null, incoming: Raid | null, options: RaidUpdateOptions = {}) {
  if (isOlderRaid(current, incoming)) return false;
  if (options.authoritative || current?.id === incoming?.id) return true;
  return Object.prototype.hasOwnProperty.call(options, 'transitionFrom')
    && options.transitionFrom === (current?.id ?? null);
}

export function bossRestAction(hp: number, maxHp: number, enrageAt = 0.4) {
  return hp <= 0 ? 'defeat' : maxHp > 0 && hp / maxHp <= enrageAt ? 'enraged' : 'idle';
}

export function canPresentAttack(raid: Raid, attack: { raidId: string; revision: number }) {
  return raid.id === attack.raidId && attack.revision >= (raid.revision ?? 0);
}

export function gearSummary(item: { attack?: number; critChance?: number; critMultiplier?: number }) {
  return [item.attack ? `+${item.attack} ATK` : '', item.critChance ? `+${Math.round(item.critChance * 100)} percentage points crit` : '', item.critMultiplier ? `+${item.critMultiplier.toFixed(2)} critical multiplier` : ''].filter(Boolean).join(' · ');
}
