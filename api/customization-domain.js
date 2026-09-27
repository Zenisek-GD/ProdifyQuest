import { ITEMS, SLOT_FOR_CATEGORY } from '../characters/ProdifyQuest_Customization_Starter/items.js';
import { GEAR, GEAR_SLOTS, CHARACTER_BASE, RARITY_MULTIPLIER } from '../characters/ProdifyQuest_Boss_Event_Starter/battleConfig.js';
import { CARD_CATALOG } from './catalog.js';
import { normalizeCharacter } from './domain.js';
import { HttpError } from './shared.js';

export { ITEMS as WARDROBE_ITEMS, GEAR, GEAR_SLOTS };
export const playerLevel = user => Number.isSafeInteger(user.character?.level) && user.character.level >= 1 && user.character.level <= 50 ? user.character.level : 1;
const looks = { backgroundId: 'study-room', petId: 'mint-slime', auraId: null };
const gearDefaults = { weapon: 'practice-focus', armor: 'apprentice-robe', cape: 'linen-cape', trinket: 'wooden-charm' };
const knownOwned = (value, items) => Array.isArray(value) ? value.filter(id => items.some(item => item.id === id)) : [];

export function validateLook(look, owned) {
  if (!look || typeof look !== 'object' || Array.isArray(look) || Object.keys(look).some(key => !Object.hasOwn(looks, key))) throw new HttpError(400, 'Use backgroundId, petId and auraId for a cosmetic look.');
  const result = {};
  for (const [category, slot] of Object.entries(SLOT_FOR_CATEGORY)) {
    const id = look[slot];
    if (category !== 'background' && id === null) { result[slot] = null; continue; }
    const item = ITEMS.find(entry => entry.id === id && entry.category === category);
    if (!item) throw new HttpError(400, `Choose a valid ${category}.`);
    if (!owned.includes(id)) throw new HttpError(403, `Own ${item.name} before equipping or saving it.`);
    result[slot] = id;
  }
  return result;
}

export function wardrobeState(user = {}) {
  const saved = user.wardrobe || {};
  const ownedItemIds = [...new Set([...knownOwned(saved.ownedItemIds, ITEMS),
    ...ITEMS.filter(item => item.unlock.type === 'starter' || item.unlock.type === 'level' && playerLevel(user) >= item.unlock.level).map(item => item.id)])];
  let equipped;
  try { equipped = validateLook(saved.equipped, ownedItemIds); } catch { equipped = { ...looks }; }
  const presets = [0, 1, 2].map(slot => {
    try { return validateLook(saved.presets?.[slot], ownedItemIds); } catch { return null; }
  });
  return { ownedItemIds, equipped, presets };
}

export function equipmentState(user = {}) {
  const saved = user.equipment || {};
  const ownedItemIds = [...new Set([...Object.values(gearDefaults), ...knownOwned(saved.ownedItemIds, GEAR)])];
  const equipped = Object.fromEntries(GEAR_SLOTS.map(slot => {
    const selected = GEAR.find(item => item.id === saved.equipped?.[slot] && item.slot === slot);
    return [slot, selected && ownedItemIds.includes(selected.id) ? selected.id : gearDefaults[slot]];
  }));
  return { ownedItemIds, equipped };
}

/** The active companion and tier come from the authenticated profile/catalog, never request stats. */
export function characterBuild(user, equipment = equipmentState(user), defense = 20) {
  const card = CARD_CATALOG.find(item => normalizeCharacter(item.characterName) === normalizeCharacter(user.character?.image)) || CARD_CATALOG.find(item => item.id === 'apprenticemage');
  const companionId = card.id === 'apprenticemage' ? 'apprentice-mage' : card.id;
  const base = CHARACTER_BASE[companionId] || { attack: 22, critChance: .06 };
  const rarity = Object.keys(RARITY_MULTIPLIER).find(key => key.toLowerCase() === card.tier) || 'Common';
  const level = playerLevel(user);
  const gear = Object.values(equipment.equipped).map(id => GEAR.find(item => item.id === id));
  const attack = Math.floor((base.attack + 2 * (level - 1)) * RARITY_MULTIPLIER[rarity]) + gear.reduce((sum, item) => sum + (item.attack || 0), 0);
  const critChance = Math.min(.5, base.critChance + gear.reduce((sum, item) => sum + (item.critChance || 0), 0));
  const critMultiplier = Math.min(2.5, 1.5 + gear.reduce((sum, item) => sum + (item.critMultiplier || 0), 0));
  const damage = attack * 100 / (100 + defense);
  return { companionId, name: card.name, imagePath: card.imagePath, rarity, level, attack, critChance, critMultiplier,
    normalDamage: Math.max(1, Math.floor(damage)), criticalDamage: Math.max(1, Math.floor(damage * critMultiplier)) };
}

export const GEAR_POOL = GEAR.filter(item => item.unlock === 'boss').map(item => ({ id: item.id, name: item.name, weight: item.weight, duplicateCoins: item.duplicateCoins }));
export const WARDROBE_POOL = ITEMS.filter(item => item.unlock.type === 'boss').map(item => ({ id: item.id, name: item.name, weight: item.unlock.weight, duplicateCoins: item.unlock.duplicateCoins }));
export function itemOdds(pool) {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  if (!total || pool.some(item => !Number.isFinite(item.weight) || item.weight <= 0 || !Number.isSafeInteger(item.duplicateCoins) || item.duplicateCoins < 0)) throw new Error('Invalid item reward pool.');
  return pool.map(item => ({ ...item, chance: item.weight / total }));
}
export function itemReward(roll, pool, owned) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Invalid item reward random draw.');
  const odds = itemOdds(pool);
  let cumulative = 0;
  const selected = odds.find(item => { cumulative += item.chance; return roll < cumulative - 1e-12; }) || odds.at(-1);
  const duplicate = owned.includes(selected.id);
  return { id: selected.id, name: selected.name, duplicate, coins: duplicate ? selected.duplicateCoins : 0,
    description: duplicate ? `${selected.name} duplicate: ${selected.duplicateCoins} coins.` : `${selected.name} added to your collection.` };
}
