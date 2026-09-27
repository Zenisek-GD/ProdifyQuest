import { ITEMS, ITEMS_BY_ID, SLOT_FOR_CATEGORY } from './items.js';
import { COMPANION_DEFINITIONS } from './companions/companionDefinitions.js';

export const COMPANION_IDS = COMPANION_DEFINITIONS.map(c => c.id);
export const DEFAULT_OUTFIT = { companionId: 'frost-scholar', backgroundId: 'study-room', petId: 'mint-slime', auraId: null };
const STARTER_IDS = ITEMS.filter(i => i.unlock.type === 'starter').map(i => i.id);
const SLOT_ENTRIES = Object.entries(SLOT_FOR_CATEGORY);
const unique = values => [...new Set(values)];

export function createDemoProfile() {
  // All companions are available here for compatibility previews. Your production
  // profile must provide the player's actual ownedCompanionIds.
  return { schemaVersion: 1, coins: 1600, level: 1, ownedItemIds: [...STARTER_IDS], ownedCompanionIds: [...COMPANION_IDS], equipped: { ...DEFAULT_OUTFIT }, presets: [], claimedRaidIds: [] };
}
export function validateOutfit(profile, outfit) {
  if (!outfit || !COMPANION_IDS.includes(outfit.companionId) || !profile.ownedCompanionIds.includes(outfit.companionId)) throw new Error('Unlock this companion before equipping it.');
  const clean = { companionId: outfit.companionId };
  for (const [category, slot] of SLOT_ENTRIES) {
    const id = outfit[slot];
    if (id == null && category !== 'background') { clean[slot] = null; continue; }
    const item = ITEMS_BY_ID[id];
    if (!item || item.category !== category) throw new Error(`Choose a valid ${category}.`);
    if (!profile.ownedItemIds.includes(id)) throw new Error(`Unlock ${item.name} before equipping this look.`);
    clean[slot] = id;
  }
  return clean;
}
export function equipOutfit(profile, outfit) { return { ...profile, equipped: validateOutfit(profile, outfit) }; }
export function buyItem(profile, id) {
  const item = ITEMS_BY_ID[id];
  if (!item || item.unlock.type !== 'shop') throw new Error('This item cannot be bought in the coin shop.');
  if (profile.ownedItemIds.includes(id)) throw new Error('You already own this item.');
  if (!Number.isSafeInteger(profile.coins) || profile.coins < item.unlock.coins) throw new Error('You need more coins for this item.');
  return { ...profile, coins: profile.coins - item.unlock.coins, ownedItemIds: [...profile.ownedItemIds, id] };
}
export function grantLevelItems(profile, level) {
  if (!Number.isSafeInteger(level) || level < profile.level || level < 1) throw new Error('The new level must not be below the current level.');
  const unlocked = ITEMS.filter(i => i.unlock.type === 'level' && level >= i.unlock.level && !profile.ownedItemIds.includes(i.id));
  return { profile: { ...profile, level, ownedItemIds: unique([...profile.ownedItemIds, ...unlocked.map(i => i.id)]) }, unlocked };
}
export function bossOdds() {
  const pool = ITEMS.filter(i => i.unlock.type === 'boss');
  const total = pool.reduce((sum, i) => sum + i.unlock.weight, 0);
  if (!(total > 0) || pool.some(i => !Number.isFinite(i.unlock.weight) || i.unlock.weight <= 0)) throw new Error('Invalid boss reward weights.');
  return pool.map(item => ({ item, probability: item.unlock.weight / total }));
}
export function claimCosmeticChest(profile, { raidId, eligible, defeated, randomValue }) {
  if (typeof raidId !== 'string' || !raidId.trim()) throw new Error('A raid ID is required.');
  if (!eligible || !defeated) throw new Error('Complete an eligible guild boss victory first.');
  if (profile.claimedRaidIds.includes(raidId)) return { profile, reward: { type: 'already-claimed' } };
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) throw new Error('The random value must be between zero (inclusive) and one (exclusive).');
  const odds = bossOdds(); let cursor = 0, chosen = odds[odds.length - 1].item;
  for (const entry of odds) { cursor += entry.probability; if (randomValue < cursor) { chosen = entry.item; break; } }
  const duplicate = profile.ownedItemIds.includes(chosen.id);
  return {
    profile: { ...profile, coins: profile.coins + (duplicate ? chosen.unlock.duplicateCoins : 0), ownedItemIds: duplicate ? profile.ownedItemIds : [...profile.ownedItemIds, chosen.id], claimedRaidIds: [...profile.claimedRaidIds, raidId] },
    reward: { type: duplicate ? 'coins' : 'item', item: chosen, coins: duplicate ? chosen.unlock.duplicateCoins : 0 },
  };
}
export function savePreset(profile, slot, name, outfit) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new Error('Choose favorite slot 1, 2 or 3.');
  const clean = validateOutfit(profile, outfit);
  const presets = profile.presets.filter(p => p.slot !== slot);
  presets.push({ slot, name: String(name || `Favorite ${slot + 1}`).trim().slice(0, 32) || `Favorite ${slot + 1}`, outfit: clean });
  return { ...profile, presets: presets.sort((a,b) => a.slot - b.slot) };
}
export function loadPreset(profile, slot) {
  const preset = profile.presets.find(p => p.slot === slot);
  if (!preset) throw new Error('Save an outfit in this favorite slot first.');
  return equipOutfit(profile, preset.outfit);
}
export function restoreProfile(value) {
  // Defensive local hydration, NOT a security boundary for real rewards.
  if (!value || value.schemaVersion !== 1) throw new Error('This saved wardrobe uses an unsupported format.');
  const base = createDemoProfile();
  const safeList = (v, allowed) => unique(Array.isArray(v) ? v.filter(x => allowed.includes(x)) : []);
  const ownedCompanionIds = safeList(value.ownedCompanionIds, COMPANION_IDS);
  const profile = { ...base,
    coins: Number.isSafeInteger(value.coins) && value.coins >= 0 ? value.coins : 0,
    level: Number.isSafeInteger(value.level) && value.level >= 1 ? value.level : 1,
    ownedItemIds: unique([...STARTER_IDS, ...safeList(value.ownedItemIds, ITEMS.map(i => i.id))]),
    ownedCompanionIds: ownedCompanionIds.length ? ownedCompanionIds : ['apprentice-mage'],
    claimedRaidIds: unique(Array.isArray(value.claimedRaidIds) ? value.claimedRaidIds.filter(x => typeof x === 'string' && x.length > 0) : []),
    presets: [],
  };
  profile.equipped = { ...DEFAULT_OUTFIT, companionId: profile.ownedCompanionIds[0] };
  try { profile.equipped = validateOutfit(profile, value.equipped); } catch { /* keep safe defaults */ }
  for (const p of Array.isArray(value.presets) ? value.presets : []) {
    try { profile.presets = savePreset(profile, p.slot, p.name, p.outfit).presets; } catch { /* ignore unusable preset */ }
  }
  return grantLevelItems(profile, profile.level).profile;
}
