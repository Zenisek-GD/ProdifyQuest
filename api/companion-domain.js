import { normalizeCharacter } from './domain.js';
import { CARD_CATALOG } from './catalog.js';

export const COMPANION_CONFIG = Object.freeze({
  xpTask: 10, bondTask: 5, xpFocus: 20, bondFocus: 10, xpPerLevel: 100, maxHealth: 100,
  spellChargeTasks: 3, focusMinutes: Object.freeze([5, 15, 25, 50]), focusDefaultMinutes: 25,
});

export const COMPANION_MILESTONES = Object.freeze([
  { bond: 20, name: 'Study partners', stage: 'scholar', cosmeticId: 'scholar-pin', description: 'Scholar pin, a brighter aura, and a new greeting.' },
  { bond: 50, name: 'Trusted team', stage: 'sage', cosmeticId: 'celestial-robe', description: 'Celestial robe, a new appearance, and spell practice.' },
  { bond: 100, name: 'Learning legends', stage: 'archmage', cosmeticId: 'astral-library', description: 'Astral library, an evolved aura, and a special greeting.' },
]);

export const COMPANION_COSMETICS = Object.freeze([
  { id: 'apprentice-robe', name: 'Apprentice robe', category: 'outfit', color: '#7655B9', price: 0, requiredBond: 0, source: 'starter' },
  { id: 'plain-charm', name: 'Simple charm', category: 'accessory', color: '#C9B5EC', emblem: '✦', price: 0, requiredBond: 0, source: 'starter' },
  { id: 'study-nook', name: 'Study nook', category: 'background', color: '#F4EEFF', price: 0, requiredBond: 0, source: 'starter' },
  { id: 'sunrise-robe', name: 'Sunrise robe', category: 'outfit', color: '#E5A34D', price: 35, requiredBond: 0, source: 'shop' },
  { id: 'forest-charm', name: 'Forest charm', category: 'accessory', color: '#3E9476', emblem: '❧', price: 25, requiredBond: 0, source: 'shop' },
  { id: 'moonlit-room', name: 'Moonlit room', category: 'background', color: '#D8E1F8', price: 50, requiredBond: 20, source: 'shop' },
  { id: 'scholar-pin', name: 'Scholar pin', category: 'accessory', color: '#C79334', emblem: '★', price: 0, requiredBond: 20, source: 'bond' },
  { id: 'celestial-robe', name: 'Celestial robe', category: 'outfit', color: '#537ACC', price: 0, requiredBond: 50, source: 'bond' },
  { id: 'astral-library', name: 'Astral library', category: 'background', color: '#E5D6F7', price: 0, requiredBond: 100, source: 'bond' },
  { id: 'dragon-scholar', name: 'Dragon scholar robe', category: 'outfit', color: '#B55266', emblem: '◆', price: 0, requiredBond: 0, source: 'raid' },
  { id: 'quest-starlight-room', name: 'Starlight study room', category: 'background', color: '#DDE5FF', price: 0, requiredBond: 0, source: 'box' },
  { id: 'quest-comet-charm', name: 'Comet charm', category: 'accessory', color: '#E2A44D', emblem: '✦', price: 0, requiredBond: 0, source: 'box' },
]);

const baselineEquipment = Object.freeze({ outfit: 'apprentice-robe', accessory: 'plain-charm', background: 'study-nook' });
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const timestamp = value => {
  if (value == null) return null;
  try {
    const result = value?.toDate ? value.toDate() : new Date(value);
    return Number.isFinite(result.getTime()) ? result : null;
  } catch { return null; }
};

export function companionState(user = {}) {
  const saved = user.companion && typeof user.companion === 'object' ? user.companion : {};
  const bond = integer(saved.bond);
  const xp = integer(saved.xp);
  const level = Math.floor(xp / COMPANION_CONFIG.xpPerLevel) + 1;
  const levelCharacters = CARD_CATALOG.filter(card => card.unlock.type === 'level');
  const unlockedCharacters = [...new Set([
    ...(Array.isArray(saved.unlockedCharacters) ? saved.unlockedCharacters.filter(id => levelCharacters.some(card => card.id === id)) : []),
    ...levelCharacters.filter(card => level >= card.unlock.level).map(card => card.id),
  ])];
  const knownIds = new Set(COMPANION_COSMETICS.map(item => item.id));
  const ownedCosmetics = [...new Set([
    ...Object.values(baselineEquipment),
    ...(Array.isArray(saved.ownedCosmetics) ? saved.ownedCosmetics.filter(id => knownIds.has(id)) : []),
    ...COMPANION_MILESTONES.filter(item => bond >= item.bond).map(item => item.cosmeticId),
  ])];
  const equipped = Object.fromEntries(Object.entries(baselineEquipment).map(([category, fallback]) => {
    const selected = COMPANION_COSMETICS.find(item => item.id === saved.equipped?.[category]);
    return [category, selected?.category === category && ownedCosmetics.includes(selected.id) && bond >= selected.requiredBond ? selected.id : fallback];
  }));
  return {
    nickname: typeof saved.nickname === 'string' && saved.nickname.trim() ? saved.nickname.trim().slice(0, 32) : 'Apprentice Mage',
    xp, bond, unlockedCharacters, spellCharge: Math.min(COMPANION_CONFIG.spellChargeTasks, integer(saved.spellCharge)),
    // Health is shared with companion progression. Tasks and absence cause no damage.
    health: Number.isSafeInteger(saved.health) && saved.health >= 0 ? Math.min(COMPANION_CONFIG.maxHealth, saved.health) : COMPANION_CONFIG.maxHealth,
    ownedCosmetics, equipped, lastVisitAt: timestamp(saved.lastVisitAt),
    activeFocusId: typeof saved.activeFocusId === 'string' && saved.activeFocusId && !saved.activeFocusId.includes('/') ? saved.activeFocusId : null,
    lastActivity: ['task', 'focus', 'raid'].includes(saved.lastActivity) ? saved.lastActivity : null,
  };
}

/** Pure progression update. Business operations must persist it in their own transaction. */
export function awardCompanion(user, { xp = 0, bond = 0, chargeTask = false } = {}) {
  const previous = companionState(user);
  const isMage = normalizeCharacter(user.character?.image) === 'apprenticemage';
  const next = {
    ...previous,
    xp: Math.min(Number.MAX_SAFE_INTEGER, previous.xp + integer(xp)),
    bond: Math.min(Number.MAX_SAFE_INTEGER, previous.bond + integer(bond)),
    spellCharge: Math.min(COMPANION_CONFIG.spellChargeTasks, previous.spellCharge + (chargeTask && isMage ? 1 : 0)),
    lastActivity: chargeTask ? 'task' : previous.lastActivity,
  };
  return companionState({ ...user, companion: next });
}

export function companionView(user, now = new Date(), config = COMPANION_CONFIG) {
  const companion = companionState(user);
  const milestone = COMPANION_MILESTONES.filter(item => companion.bond >= item.bond).at(-1);
  const nextUnlock = COMPANION_MILESTONES.find(item => companion.bond < item.bond) || null;
  const dialogues = {
    apprentice: 'One small step is a great place to start. What shall we learn today?',
    scholar: 'Look how far our small steps have taken us. Ready for another?',
    sage: 'We make a good team. Let’s turn a big assignment into a small next step.',
    archmage: 'Every lesson adds a little magic. I’m glad we’re learning together.',
  };
  const stage = milestone?.stage || 'apprentice';
  // Derive presentation unlocks from the configured milestone stage, not copied bond thresholds.
  const capabilities = {
    highFive: ['scholar', 'sage', 'archmage'].includes(stage),
    cast: ['sage', 'archmage'].includes(stage),
    share: ['sage', 'archmage'].includes(stage),
    evolved: ['sage', 'archmage'].includes(stage),
    archmage: stage === 'archmage',
  };
  const recent = {
    task: 'That task is done! Take a breath and enjoy your progress.',
    focus: 'We made time to focus together. That effort counts.',
    raid: 'Our guild made progress together. Your contribution mattered.',
  };
  const stageEncouragement = {
    apprentice: '', scholar: 'Our study partnership is growing.',
    sage: 'Our growing magic comes from practice.', archmage: 'Learning together is our strongest spell.',
  };
  const xpPerLevel = Number.isSafeInteger(config.xpPerLevel) && config.xpPerLevel > 0 ? config.xpPerLevel : COMPANION_CONFIG.xpPerLevel;
  return {
    ...companion, maxHealth: COMPANION_CONFIG.maxHealth, level: Math.floor(companion.xp / xpPerLevel) + 1,
    xpIntoLevel: companion.xp % xpPerLevel, xpToNextLevel: xpPerLevel - companion.xp % xpPerLevel,
    stage, capabilities, nextUnlock: nextUnlock ? { ...nextUnlock, remainingBond: nextUnlock.bond - companion.bond } : null,
    dialogue: recent[companion.lastActivity] ? `${recent[companion.lastActivity]} ${stageEncouragement[stage]}`.trim() : dialogues[stage],
    greeting: !companion.lastVisitAt ? 'Welcome! Let’s make a little progress together.'
      : now.getTime() - companion.lastVisitAt.getTime() >= 24 * 60 * 60 * 1000 ? 'Welcome back! I’m happy to see you. We can pick up at your pace.'
        : 'Good to see you! What would you like to work on?',
    isMage: normalizeCharacter(user.character?.image) === 'apprenticemage',
    unlockedActions: ['wave', 'celebrate', ...(capabilities.cast ? ['cast'] : [])],
    cosmetics: COMPANION_COSMETICS.map(item => ({
      ...item, unlocked: companion.bond >= item.requiredBond && (!['raid', 'box'].includes(item.source) || companion.ownedCosmetics.includes(item.id)),
      owned: companion.ownedCosmetics.includes(item.id), equipped: companion.equipped[item.category] === item.id,
    })),
  };
}
