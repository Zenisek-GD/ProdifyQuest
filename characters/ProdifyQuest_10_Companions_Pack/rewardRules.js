import { COMPANION_DEFINITIONS } from './companionDefinitions.js';

const byId = Object.fromEntries(COMPANION_DEFINITIONS.map(item => [item.id, item]));

export function createDemoPlayer() {
  return { level: 1, coins: 1500, ownedIds: ['apprentice-mage'], claimedRaidIds: [] };
}

function validatePlayer(player) {
  if (!Number.isSafeInteger(player.level) || player.level < 1 || !Number.isSafeInteger(player.coins) || player.coins < 0 || !Array.isArray(player.ownedIds) || !Array.isArray(player.claimedRaidIds)) {
    throw new Error('Invalid player state.');
  }
}

export function getUnlockLabel(companion) {
  const rule = companion.unlock;
  if (rule.type === 'starter') return 'Starter companion';
  if (rule.type === 'shop') return `${rule.coins} coins`;
  if (rule.type === 'level') return `Unlock at level ${rule.level}`;
  return 'Boss chest reward';
}

export function grantLevelRewards(player) {
  validatePlayer(player);
  const unlockedIds = COMPANION_DEFINITIONS
    .filter(item => item.unlock.type === 'level' && player.level >= item.unlock.level && !player.ownedIds.includes(item.id))
    .map(item => item.id);
  return { player: { ...player, ownedIds: [...new Set([...player.ownedIds, ...unlockedIds])] }, unlockedIds };
}

export function buyShopCompanion(player, companionId) {
  validatePlayer(player);
  const item = byId[companionId];
  if (!item || item.unlock.type !== 'shop') throw new Error('This companion is not sold in the coin shop.');
  if (player.ownedIds.includes(companionId)) throw new Error('You already own this companion.');
  if (player.coins < item.unlock.coins) throw new Error('Not enough coins.');
  return { ...player, coins: player.coins - item.unlock.coins, ownedIds: [...player.ownedIds, companionId] };
}

export function getBossChestOdds() {
  const pool = COMPANION_DEFINITIONS.filter(item => item.unlock.type === 'boss_chest');
  const total = pool.reduce((sum, item) => sum + item.unlock.weight, 0);
  if (!total || pool.some(item => !Number.isFinite(item.unlock.weight) || item.unlock.weight <= 0)) throw new Error('Boss chest weights must be positive.');
  return pool.map(item => ({ id: item.id, name: item.name, rarity: item.rarity, probability: item.unlock.weight / total, duplicateCoins: item.unlock.duplicateCoins }));
}

/** Pure sample rules; the real backend must authorize and persist claims atomically. */
export function claimBossChest(player, { raidId, defeated, eligible, randomValue }) {
  validatePlayer(player);
  if (typeof raidId !== 'string' || !raidId.trim()) throw new Error('A raid ID is required.');
  if (defeated !== true || eligible !== true) throw new Error('Win the boss raid and meet its participation requirement first.');
  if (player.claimedRaidIds.includes(raidId)) return { player, reward: { type: 'already_claimed' } };
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) throw new Error('randomValue must be between 0 (inclusive) and 1 (exclusive).');
  const odds = getBossChestOdds();
  let cursor = 0;
  const selected = odds.find(item => { cursor += item.probability; return randomValue < cursor; }) || odds[odds.length - 1];
  const duplicate = player.ownedIds.includes(selected.id);
  const reward = duplicate
    ? { type: 'coins', amount: selected.duplicateCoins, duplicateCompanionId: selected.id, name: selected.name }
    : { type: 'companion', companionId: selected.id, name: selected.name, rarity: selected.rarity };
  return {
    player: {
      ...player,
      coins: player.coins + (duplicate ? selected.duplicateCoins : 0),
      ownedIds: duplicate ? [...player.ownedIds] : [...player.ownedIds, selected.id],
      claimedRaidIds: [...player.claimedRaidIds, raidId],
    },
    reward,
  };
}
