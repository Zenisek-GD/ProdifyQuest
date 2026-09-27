import { normalizeCharacter } from './domain.js';
import { COMPANION_CONFIG } from './companion-domain.js';
import { BOSS_CHEST_COMPANIONS } from './catalog.js';
import { GEAR_POOL, WARDROBE_POOL } from './customization-domain.js';

// Change the balance here for new raids. Each raid stores a frozen rules snapshot.
export const RAID_CONFIG = Object.freeze({
  durationDays: 7, hpPerParticipant: 200, damage: { small: 10, medium: 20, large: 30 },
  dailyLimit: 60, minimumContribution: 20, rewardCoins: 100, rewardXp: 50,
  rewardCosmetic: 'dragon-scholar', resetTime: '00:00 UTC', spellBonus: 10,
  rewardCompanions: BOSS_CHEST_COMPANIONS,
});
export const DREADROOT_CONFIG = Object.freeze({
  ...RAID_CONFIG, hpPerParticipant: 250, minimumContribution: 1,
  attackMode: 'charges', dailyChargeLimit: 5, defense: 20, enrageAt: .4,
  rewardGear: GEAR_POOL, rewardWardrobe: WARDROBE_POOL,
});
export const isDreadroot = raid => raid.bossId === 'dreadroot';
export const nextRevision = raid => (Number.isSafeInteger(raid.revision) && raid.revision >= 0 ? raid.revision : 0) + 1;

export const instant = value => {
  const date = value?.toDate ? value.toDate() : new Date(value ?? 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
};
export const utcDay = now => new Date(now).toISOString().slice(0, 10);
export const raidStatus = (raid, now) => raid.status === 'active' && instant(raid.expiresAt) <= instant(now) ? 'expired' : raid.status;
export const raidParticipants = raid => Object.entries(raid.participants || {}).map(([uid, member]) => ({ ...member, uid }));

export function raidView(id, raid, uid, guild, now) {
  const config = { ...RAID_CONFIG, ...raid.config };
  const status = raidStatus(raid, now);
  const participants = raidParticipants(raid).map(member => ({
    uid: member.uid, username: member.username, damage: member.damage || 0, claimed: member.claimed === true,
  }));
  const mine = Object.hasOwn(raid.participants || {}, uid) ? raid.participants[uid] : null;
  return {
    id, guildId: raid.guildId, bossName: raid.bossName, bossId: raid.bossId || 'deadline-dragon', revision: raid.revision || 0, status, config,
    ...(isDreadroot(raid) ? { defense: config.defense, enrageAt: config.enrageAt } : {}),
    participants, participantCount: participants.length, maxHp: raid.maxHp || 0, hp: raid.hp || 0,
    createdAt: raid.createdAt, startedAt: raid.startedAt || null, expiresAt: raid.expiresAt || null,
    defeatedAt: raid.defeatedAt || null, recentAttacks: raid.recentAttacks || [],
    canJoin: status === 'recruiting' && !mine && participants.length < 100,
    canStart: status === 'recruiting' && guild.createdBy === uid && participants.length > 0,
    canClaim: status === 'defeated' && !!mine && mine.damage >= config.minimumContribution && !mine.claimed,
    me: mine ? { uid, username: mine.username, damage: mine.damage || 0, claimed: mine.claimed === true,
      companionReward: mine.companionReward || null,
      ...(isDreadroot(raid) ? { charges: mine.charges || 0, dailyCharges: mine.chargeDay === utcDay(now) ? mine.dailyCharges || 0 : 0,
        gearReward: mine.gearReward || null, wardrobeReward: mine.wardrobeReward || null } : {}),
      dailyDamage: mine.dailyDay === utcDay(now) ? mine.dailyDamage || 0 : 0 } : null,
  };
}

/** Pure damage calculation. The caller records even zero-damage attempts for deduplication. */
export function calculateAttack(raid, uid, user, size, now) {
  const config = raid.config || RAID_CONFIG;
  const participant = raid.participants[uid];
  const dailyDamage = participant.dailyDay === utcDay(now) ? participant.dailyDamage || 0 : 0;
  const remaining = Math.max(0, config.dailyLimit - dailyDamage);
  const base = Math.min(config.damage[size] ?? config.damage.medium, remaining, Math.max(0, raid.hp));
  const isMage = normalizeCharacter(user.character?.image) === 'apprenticemage';
  const charged = isMage && user.companion?.spellCharge >= COMPANION_CONFIG.spellChargeTasks;
  const bonusDamage = base > 0 && charged
    ? Math.min(config.spellBonus, remaining - base, raid.hp - base) : 0;
  const damage = base + bonusDamage;
  return {
    damage, bonusDamage,
    companion: bonusDamage > 0 ? { ...user.companion, spellCharge: 0 } : user.companion,
    participant: { ...participant, damage: (participant.damage || 0) + damage,
      dailyDay: utcDay(now), dailyDamage: dailyDamage + damage },
    hp: Math.max(0, raid.hp - damage),
  };
}
