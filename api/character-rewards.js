import { randomInt } from 'node:crypto';
import { BOSS_CHEST_COMPANIONS, CARD_CATALOG } from './catalog.js';
import { normalizeCharacter } from './domain.js';

export const randomBossChestRoll = () => randomInt(0, 1000000) / 1000000;

export function bossChestOdds(pool = BOSS_CHEST_COMPANIONS) {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  if (!total || pool.some(item => !Number.isFinite(item.weight) || item.weight <= 0 || !Number.isSafeInteger(item.duplicateCoins) || item.duplicateCoins < 0)) throw new Error('Invalid boss companion rewards.');
  return pool.map(item => ({ ...item, chance: item.weight / total }));
}

export function bossCompanionReward({ roll, user, collection, pool = BOSS_CHEST_COMPANIONS }) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Invalid boss companion random draw.');
  const odds = bossChestOdds(pool);
  const draw = Math.floor(roll * 1000000);
  let cumulative = 0;
  const selected = odds.find(item => { cumulative += Math.round(item.chance * 1000000); return draw < cumulative; }) || odds.at(-1);
  const card = CARD_CATALOG.find(item => item.id === selected.id && item.unlock.type === 'boss_chest');
  if (!card) throw new Error('Boss companion reward is unavailable.');
  const names = new Set([normalizeCharacter(user.character?.image), ...collection.docs.map(doc => normalizeCharacter(doc.data().characterName))]);
  const duplicate = names.has(normalizeCharacter(card.characterName));
  return {
    card, reward: { id: card.id, name: card.name, tier: card.tier, imagePath: card.imagePath,
      duplicate, coins: duplicate ? selected.duplicateCoins : 0,
      description: duplicate ? `You already own ${card.name}. Added ${selected.duplicateCoins} coins instead.` : `${card.name} joined your collection. Equip your new companion in Companions.` },
  };
}
