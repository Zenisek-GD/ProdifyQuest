import { randomInt } from 'node:crypto';

export const QUEST_BOX_CONFIG = Object.freeze({
  dropChance: 0.25, guaranteeEvery: 5, dailyLimit: 3,
  coinMin: 10, coinMax: 25, companionXP: 25, duplicateCosmeticCoins: 15,
});

export const QUEST_BOX_REWARDS = Object.freeze([
  { kind: 'coins', label: 'Coins', chance: 0.5 },
  { kind: 'companion_xp', label: 'Companion XP', chance: 0.25 },
  { kind: 'character', label: 'Companion', chance: 0.2 },
  { kind: 'cosmetic', label: 'Exclusive cosmetic', chance: 0.05 },
]);

export const QUEST_BOX_RARITIES = Object.freeze([
  { tier: 'common', chance: 0.7 }, { tier: 'uncommon', chance: 0.2 },
  { tier: 'rare', chance: 0.08 }, { tier: 'epic', chance: 0.015 }, { tier: 'legendary', chance: 0.005 },
]);

export const QUEST_BOX_COSMETICS = Object.freeze(['quest-starlight-room', 'quest-comet-charm']);

export function normalizeQuestBoxConfig(overrides = {}) {
  const config = { ...QUEST_BOX_CONFIG, ...overrides };
  if (typeof config.dropChance !== 'number' || !Number.isFinite(config.dropChance) || config.dropChance < 0 || config.dropChance > 1) throw new Error('Quest box drop chance must be between zero and one.');
  for (const field of ['guaranteeEvery', 'dailyLimit', 'coinMin', 'coinMax', 'companionXP', 'duplicateCosmeticCoins']) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) throw new Error(`Invalid quest box configuration: ${field}`);
  }
  if (config.coinMin > config.coinMax || config.coinMax - config.coinMin >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid quest box coin range.');
  return config;
}

export const randomQuestBoxRoll = () => randomInt(0, 1000000) / 1000000;

export function validateQuestBoxRoll(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Quest box random draws must be fractions from zero up to one.');
  return value;
}

const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const utcDay = now => now.toISOString().slice(0, 10);
const nextReset = now => new Date(`${utcDay(new Date(now.getTime() + 86400000))}T00:00:00.000Z`);

function progressState(user, now, config) {
  const saved = user.questBoxProgress || {};
  const day = utcDay(now);
  return {
    day,
    dropsToday: saved.day === day ? Math.min(config.dailyLimit, integer(saved.dropsToday)) : 0,
    misses: Math.min(config.guaranteeEvery - 1, integer(saved.misses)),
  };
}

/** Called only for a first rewarded task completion, within that operation's transaction. */
export function prepareQuestBoxDrop({ uid, user, taskId, now = new Date(), roll, config = QUEST_BOX_CONFIG }) {
  if (typeof uid !== 'string' || !uid || typeof taskId !== 'string' || !taskId || taskId.includes('/') || taskId.length > 200) throw new Error('Invalid quest box owner or task.');
  const validated = normalizeQuestBoxConfig(config);
  validateQuestBoxRoll(roll);
  const progress = progressState(user, now, validated);
  if (progress.dropsToday >= validated.dailyLimit) return { progress, box: null };
  const dropped = roll < validated.dropChance || progress.misses + 1 >= validated.guaranteeEvery;
  if (!dropped) return { progress: { ...progress, misses: progress.misses + 1 }, box: null };
  return {
    progress: { ...progress, dropsToday: progress.dropsToday + 1, misses: 0 },
    box: { id: `task_${taskId}`, status: 'unopened', createdAt: now },
  };
}

export function questBoxProgressView(user, now = new Date(), config = QUEST_BOX_CONFIG) {
  const progress = progressState(user, now, config);
  return {
    dropsToday: progress.dropsToday, dailyLimit: config.dailyLimit, misses: progress.misses,
    guaranteedIn: config.guaranteeEvery - progress.misses, resetTime: nextReset(now),
  };
}

export function questBoxRules(now = new Date(), config = QUEST_BOX_CONFIG) {
  const descriptions = {
    coins: `${config.coinMin}-${config.coinMax} coins, with each amount equally likely.`,
    companion_xp: `${config.companionXP} companion XP. This does not add bond or spell charge.`,
    character: 'A companion from the collection. An owned companion becomes half its shop price in coins.',
    cosmetic: `An exclusive background or charm. An owned cosmetic becomes ${config.duplicateCosmeticCoins} coins.`,
  };
  return {
    dropChance: config.dropChance, guaranteeEvery: config.guaranteeEvery, dailyLimit: config.dailyLimit, resetTime: nextReset(now),
    rewards: QUEST_BOX_REWARDS.map(item => ({ ...item, description: descriptions[item.kind] })),
    companionRarities: QUEST_BOX_RARITIES.map(item => ({ ...item })),
    duplicateCoins: { cosmetic: config.duplicateCosmeticCoins, characterPriceFraction: 0.5 },
  };
}

/** Never disclose a result for an unopened box. */
export function questBoxView(id, box) {
  return {
    id, status: box.status === 'opened' ? 'opened' : 'unopened', createdAt: box.createdAt,
    ...(box.status === 'opened' ? { openedAt: box.openedAt, reward: box.reward } : {}),
  };
}

export function weightedQuestBoxChoice(items, roll) {
  validateQuestBoxRoll(roll);
  // Integer millionths make exact advertised probability boundaries predictable.
  const draw = Math.floor(roll * 1000000);
  let cumulative = 0;
  for (const item of items) {
    cumulative += Math.round(item.chance * 1000000);
    if (draw < cumulative) return item;
  }
  return items.at(-1);
}
