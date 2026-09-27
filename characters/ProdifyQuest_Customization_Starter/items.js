// Sample economy: edit prices, levels and weights here.
export const ITEMS = [
  { id: 'study-room', name: 'Sunlit Study', category: 'background', rarity: 'Common', description: 'A quiet corner for your next focus session.', unlock: { type: 'starter' } },
  { id: 'moon-garden', name: 'Moon Garden', category: 'background', rarity: 'Rare', description: 'A peaceful terrace beneath the stars.', unlock: { type: 'shop', coins: 650 } },
  { id: 'sky-island', name: 'Sky Sanctuary', category: 'background', rarity: 'Epic', description: 'A place above the clouds, earned with progress.', unlock: { type: 'level', level: 20 } },
  { id: 'mint-slime', name: 'Mint Slime', category: 'pet', rarity: 'Common', description: 'A tiny sprout with a big happy bounce.', unlock: { type: 'starter' } },
  { id: 'moon-owl', name: 'Moon Owl', category: 'pet', rarity: 'Rare', description: 'Your little late-night study buddy.', unlock: { type: 'level', level: 10 } },
  { id: 'ember-drake', name: 'Ember Drake', category: 'pet', rarity: 'Epic', description: 'A small dragon who celebrates every win.', unlock: { type: 'boss', weight: 35, duplicateCoins: 200 } },
  { id: 'leaf-dance', name: 'Leaf Dance', category: 'aura', rarity: 'Uncommon', description: 'Fresh green leaves sway around your companion.', unlock: { type: 'shop', coins: 350 } },
  { id: 'starfall', name: 'Starfall', category: 'aura', rarity: 'Rare', description: 'A gentle shimmer of gold and lilac.', unlock: { type: 'boss', weight: 50, duplicateCoins: 100 } },
  { id: 'arcane-halo', name: 'Arcane Halo', category: 'aura', rarity: 'Legendary', description: 'A brilliant ring of celestial magic.', unlock: { type: 'boss', weight: 15, duplicateCoins: 300 } },
];
export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map(item => [item.id, item]));
export const SLOT_FOR_CATEGORY = { background: 'backgroundId', pet: 'petId', aura: 'auraId' };
export function unlockLabel(item) {
  const u = item.unlock;
  if (u.type === 'shop') return `${u.coins} coins`;
  if (u.type === 'level') return `Level ${u.level}`;
  if (u.type === 'boss') return 'Boss chest';
  return 'Starter gift';
}
