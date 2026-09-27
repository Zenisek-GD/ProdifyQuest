import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { CARD_CATALOG, BOSS_CHEST_COMPANIONS } from '../api/catalog.js';
import { bossChestOdds, bossCompanionReward } from '../api/character-rewards.js';
import { awardCompanion, companionState, companionView } from '../api/companion-domain.js';
import { createCoreRouter } from '../api/core.js';
import { createCompanionRouter } from '../api/companions.js';
import { createQuestBoxRouter } from '../api/quest-boxes.js';
import { createRaidRouter } from '../api/raids.js';
import { RAID_CONFIG } from '../api/raid-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const start = new Date('2026-10-01T12:00:00Z');
const levelIds = ['frost-scholar', 'storm-runner', 'moon-bard', 'clockwork-scribe'];
const profile = (extra = {}) => ({ username: 'Alice', coins: 100, character: { image: 'apprenticemage', level: 1, exp: 0 }, companion: { xp: 0 }, ...extra });
const defeatedRaid = (extra = {}) => ({
  guildId: 'study', bossName: 'Deadline Dragon', status: 'defeated', config: structuredClone(RAID_CONFIG),
  createdAt: start, startedAt: start, defeatedAt: start, expiresAt: new Date(start.getTime() + 7 * 86400000),
  participants: { alice: { username: 'Alice', damage: 200, dailyDamage: 60, dailyDay: '2026-10-01', claimed: false } },
  maxHp: 200, hp: 0, recentAttacks: [], ...extra,
});

async function fixture(t, { initial = {}, bossDraws = [0.1], boxDraws = [0.6, 0, 0, 0] } = {}) {
  let clock = new Date(start);
  let bossCalls = 0, boxCalls = 0;
  const db = new FakeFirestore({
    'users/alice': profile(), 'users/bob': profile({ username: 'Bob' }),
    'guilds/study': { name: 'Study Team', createdBy: 'alice', members: ['alice', 'bob'], activeRaidId: 'first' },
    'guildRaids/first': defeatedRaid(), ...initial,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { uid: req.get('x-test-user') || 'alice' }; next(); });
  app.use('/api', createCoreRouter({ db, now: () => clock, questBoxRandom: () => 0.9 }));
  app.use('/api', createCompanionRouter({ db, now: () => clock }));
  app.use('/api', createQuestBoxRouter({ db, now: () => clock, random: () => boxDraws[boxCalls++ % boxDraws.length] }));
  app.use('/api', createRaidRouter({ db, now: () => clock, bossChestRandom: () => bossDraws[bossCalls++ % bossDraws.length] }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = 'GET', body, uid = 'alice' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': uid }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    db, request, claim: (raidId = 'first', options = {}) => request(`/guilds/study/raids/${raidId}/claim`, { method: 'POST', ...options }),
    advance: milliseconds => { clock = new Date(clock.getTime() + milliseconds); }, bossCalls: () => bossCalls,
  };
}

const records = (db, prefix) => [...db.data.entries()].filter(([path]) => path.startsWith(prefix));

test('catalog retains the original 23 quest-box companions and adds ten valid animated companions', async () => {
  assert.equal(CARD_CATALOG.length, 33);
  assert.equal(new Set(CARD_CATALOG.map(card => card.id)).size, 33);
  assert.equal(CARD_CATALOG.filter(card => card.questBoxEligible).length, 23);
  const added = CARD_CATALOG.filter(card => card.animated);
  assert.equal(added.length, 10);
  assert.equal(added.filter(card => card.unlock.type === 'shop').length, 3);
  assert.equal(added.filter(card => card.unlock.type === 'level').length, 4);
  assert.equal(added.filter(card => card.unlock.type === 'boss_chest').length, 3);
  for (const card of added) {
    assert.equal(card.questBoxEligible, false);
    const portrait = await readFile(new URL(`..${card.imagePath}`, import.meta.url));
    assert.equal(portrait.subarray(1, 4).toString(), 'PNG');
    assert.ok(portrait.readUInt32BE(16) > 0 && portrait.readUInt32BE(20) > 0);
    const atlas = await readFile(new URL(`..${card.imagePath.replace('/portrait.png', '/atlas.png')}`, import.meta.url));
    assert.equal(atlas.readUInt32BE(16), 2208);
    assert.equal(atlas.readUInt32BE(20), 1280);
  }
});

test('companion XP unlocks level companions at the exact four thresholds and keeps past unlocks', () => {
  for (let index = 0; index < levelIds.length; index += 1) {
    const xp = 900 + index * 1000;
    const before = companionState(profile({ companion: { xp: xp - 1 } }));
    assert.equal(before.unlockedCharacters.includes(levelIds[index]), false);
    const earned = awardCompanion(profile({ companion: before }), { xp: 1 });
    assert.deepEqual(earned.unlockedCharacters, levelIds.slice(0, index + 1));
    assert.equal(companionView(profile({ companion: earned })).level, 10 + index * 10);
    const later = companionState(profile({ companion: { ...earned, xp: 0 } }));
    assert.deepEqual(later.unlockedCharacters, earned.unlockedCharacters);
  }
  const skipped = awardCompanion(profile(), { xp: 4000 });
  assert.deepEqual(skipped.unlockedCharacters, levelIds);
  const filtered = companionState(profile({ companion: { unlockedCharacters: [...levelIds, 'astral-guardian', 'sprout-ranger', 'unknown'] } }));
  assert.deepEqual(filtered.unlockedCharacters, levelIds);
});

test('completing a task persists a level unlock and advertises ownership through the existing card API', async t => {
  const { db, request } = await fixture(t, { initial: { 'users/alice': profile({ companion: { xp: 890 } }) } });
  const created = await request('/tasks', { method: 'POST', body: { title: 'Read the chapter', difficulty: 'easy' } });
  assert.equal(created.status, 201);
  const completed = await request(`/tasks/${created.body.task.id}/complete`, { method: 'POST' });
  assert.equal(completed.status, 200);
  assert.equal(db.data.get('users/alice').companion.xp, 900);
  assert.ok(db.data.get('users/alice').companion.unlockedCharacters.includes('frost-scholar'));
  const cards = (await request('/cards')).body.cards;
  assert.equal(cards.find(card => card.id === 'frost-scholar').owned, true);
  assert.equal(cards.find(card => card.id === 'storm-runner').owned, false);
  assert.equal((await request(`/tasks/${created.body.task.id}/complete`, { method: 'POST' })).body.awarded, false);
  assert.equal(db.data.get('users/alice').companion.xp, 900);
});

test('focus XP and quest-box XP persist level unlocks without granting unrelated companions', async t => {
  const { db, request, advance } = await fixture(t, { initial: {
    'users/alice': profile({ companion: { xp: 1880 } }),
    'users/bob': profile({ companion: { xp: 2875 } }),
    'users/bob/questBoxes/task_study': { status: 'unopened', createdAt: start },
  } });
  const focus = (await request('/focus', { method: 'POST', body: { minutes: 5 } })).body.focus;
  advance(300000);
  const complete = await request(`/focus/${focus.id}/complete`, { method: 'POST' });
  assert.equal(complete.status, 200);
  assert.equal(db.data.get('users/alice').companion.xp, 1900);
  assert.deepEqual(db.data.get('users/alice').companion.unlockedCharacters, levelIds.slice(0, 2));
  const box = await request('/quest-boxes/task_study/open', { method: 'POST', uid: 'bob' });
  assert.equal(box.status, 200);
  assert.equal(box.body.box.reward.kind, 'companion_xp');
  assert.equal(db.data.get('users/bob').companion.xp, 2900);
  assert.deepEqual(db.data.get('users/bob').companion.unlockedCharacters, levelIds.slice(0, 3));
  const cards = (await request('/cards', { uid: 'bob' })).body.cards;
  assert.equal(cards.find(card => card.id === 'moon-bard').owned, true);
  assert.equal(cards.find(card => card.id === 'astral-guardian').owned, false);
});

test('level and boss companions cannot be purchased or equipped by forging client progression', async t => {
  const { db, request } = await fixture(t, { initial: { 'users/alice': profile({ coins: 0, character: { image: 'apprenticemage', level: 50, exp: 999999 } }) } });
  for (const id of [...levelIds, ...BOSS_CHEST_COMPANIONS.map(card => card.id)]) {
    const body = { coins: 0, level: 99, xp: 999999, unlockedCharacters: [id], owned: true };
    assert.equal((await request(`/cards/${id}/purchase`, { method: 'POST', body })).status, 403);
    assert.equal((await request(`/cards/${id}/equip`, { method: 'POST', body })).status, 403);
  }
  assert.equal(db.data.get('users/alice').character.image, 'apprenticemage');
  assert.equal(db.data.get('users/alice').coins, 0);
  assert.equal(records(db, 'users/alice/transactions/').length, 0);
  assert.equal((await request('/companion', { method: 'PATCH', body: { nickname: 'Nova', xp: 3900 } })).status, 400);
});

test('equipping an earned level companion preserves the original unrecorded starter and account ownership', async t => {
  const { db, request } = await fixture(t, { initial: { 'users/alice': profile({ companion: { xp: 900 }, character: { image: '/characters/common/ApprenticeMage.png', level: 4, exp: 20 } }) } });
  const equipped = await request('/cards/frost-scholar/equip', { method: 'POST' });
  assert.equal(equipped.status, 200);
  assert.equal(equipped.body.card.equipped, true);
  const user = db.data.get('users/alice');
  assert.equal(user.character.image, 'frost-scholar');
  assert.equal(user.character.level, 4);
  assert.equal(user.character.exp, 20);
  assert.equal(user.companion.xp, 900);
  const starter = records(db, 'userCharacterCollection/').map(([, card]) => card).find(card => card.characterName === 'apprenticemage');
  assert.equal(starter.source, 'starter');
  assert.equal(starter.userId, 'alice');
  assert.equal((await request('/cards/frost-scholar/equip', { method: 'POST', uid: 'bob' })).status, 403);
  assert.equal((await request('/cards/apprenticemage/equip', { method: 'POST' })).status, 200);
});

test('new shop companions debit their exact prices once and ignore submitted discount values', async t => {
  const { db, request } = await fixture(t, { initial: { 'users/alice': profile({ coins: 1900 }) } });
  for (const [id, cost, balance] of [['sprout-ranger', 400, 1500], ['copper-knight', 600, 900], ['sun-cleric', 900, 0]]) {
    const results = await Promise.all(Array.from({ length: 3 }, () => request(`/cards/${id}/purchase`, { method: 'POST', body: { price: 0, cost: 0, coins: 999999 } })));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409]);
    assert.equal(db.data.get('users/alice').coins, balance);
    assert.equal(db.data.get(`users/alice/transactions/card_${id}`).amount, -cost);
    assert.equal(records(db, 'userCharacterCollection/').filter(([, card]) => card.characterName === id).length, 1);
    assert.equal((await request(`/cards/${id}/equip`, { method: 'POST' })).status, 200);
  }
  assert.equal(records(db, 'users/alice/transactions/').length, 3);
  db.seed('users/bob', profile({ coins: 399 }));
  assert.equal((await request('/cards/sprout-ranger/purchase', { method: 'POST', uid: 'bob' })).status, 409);
  assert.equal(db.data.get('users/bob').coins, 399);
});

test('boss chest selection matches displayed 60/30/10 odds at exact boundaries', () => {
  const odds = bossChestOdds();
  assert.deepEqual(odds.map(item => [item.id, item.chance, item.duplicateCoins]), [
    ['prism-fox', 0.6, 100], ['ember-dragonling', 0.3, 250], ['astral-guardian', 0.1, 500],
  ]);
  for (const [roll, id] of [[0, 'prism-fox'], [0.599999, 'prism-fox'], [0.6, 'ember-dragonling'], [0.899999, 'ember-dragonling'], [0.9, 'astral-guardian'], [0.999999, 'astral-guardian']]) {
    assert.equal(bossCompanionReward({ roll, user: profile(), collection: { docs: [] } }).reward.id, id);
  }
  for (const roll of [-1, 1, NaN, Infinity, '0.1']) assert.throws(() => bossCompanionReward({ roll, user: profile(), collection: { docs: [] } }));
});

test('each boss companion is collectible with the unchanged base victory rewards', async t => {
  for (const [roll, id] of [[0.1, 'prism-fox'], [0.7, 'ember-dragonling'], [0.99, 'astral-guardian']]) await t.test(id, async subtest => {
    const { db, request, claim } = await fixture(subtest, { bossDraws: [roll] });
    const before = (await request('/guilds/study/raid')).body;
    assert.deepEqual(before.bossCompanionOdds.map(item => item.chance), [0.6, 0.3, 0.1]);
    const result = await claim('first', { body: { companionId: 'astral-guardian', roll: 0.99, rewardCoins: 999999 } });
    assert.equal(result.status, 200);
    assert.equal(result.body.awarded, true);
    assert.equal(result.body.companionReward.id, id);
    assert.equal(result.body.companionReward.duplicate, false);
    assert.deepEqual(result.body.rewards, { coins: 100, xp: 50, cosmetic: 'dragon-scholar' });
    const user = db.data.get('users/alice');
    assert.equal(user.coins, 200);
    assert.equal(user.companion.xp, 50);
    assert.equal(user.companion.bond, 0);
    assert.ok(user.companion.ownedCosmetics.includes('dragon-scholar'));
    assert.equal(user.character.image, 'apprenticemage');
    const collection = records(db, 'userCharacterCollection/');
    assert.equal(collection.length, 1);
    assert.equal(collection[0][1].catalogId, id);
    assert.equal(collection[0][1].source, 'boss_chest');
    assert.equal(collection[0][1].sourceId, 'first');
    const cards = (await request('/cards')).body.cards;
    assert.equal(cards.find(card => card.id === id).owned, true);
    assert.equal((await request(`/cards/${id}/equip`, { method: 'POST' })).status, 200);
  });
});

test('owned boss companions convert to their configured coins in addition to the base reward', async t => {
  for (const [roll, id, extra] of [[0.1, 'prism-fox', 100], [0.7, 'ember-dragonling', 250], [0.99, 'astral-guardian', 500]]) await t.test(id, async subtest => {
    const { db, claim } = await fixture(subtest, { bossDraws: [roll], initial: {
      'userCharacterCollection/owned': { userId: 'alice', characterName: id },
    } });
    const result = await claim();
    assert.equal(result.status, 200);
    assert.equal(result.body.companionReward.duplicate, true);
    assert.equal(result.body.companionReward.coins, extra);
    assert.equal(result.body.rewards.coins, 100 + extra);
    assert.equal(db.data.get('users/alice').coins, 200 + extra);
    assert.equal(db.data.get('users/alice').companion.xp, 50);
    const ledger = db.data.get('users/alice/transactions/raid_first');
    assert.equal(ledger.amount, 100 + extra);
    assert.equal(ledger.companionReward.id, id);
    assert.equal(records(db, 'userCharacterCollection/').length, 1);
  });
});

test('concurrent claims and subsequent retries keep the saved choice and pay once', async t => {
  const { db, request, claim } = await fixture(t, { bossDraws: [0.1, 0.7, 0.99] });
  const results = await Promise.all(Array.from({ length: 6 }, () => claim()));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  const earned = results.find(result => result.body.awarded).body.companionReward;
  assert.ok(results.every(result => result.body.companionReward.id === earned.id));
  const retry = await claim();
  assert.equal(retry.body.awarded, false);
  assert.deepEqual(retry.body.companionReward, earned);
  const view = (await request('/guilds/study/raid')).body.raid;
  assert.deepEqual(view.me.companionReward, earned);
  assert.equal(db.data.get('users/alice').coins, 200);
  assert.equal(db.data.get('users/alice').companion.xp, 50);
  assert.equal(records(db, 'userCharacterCollection/').length, 1);
  assert.equal(records(db, 'users/alice/transactions/').length, 1);
});

test('Firestore retries reuse the preselected boss draw and roll back prior writes', async t => {
  const { db, claim, bossCalls } = await fixture(t, { bossDraws: [0.99, 0.1] });
  const original = db.runTransaction.bind(db);
  const retry = new Error('retry transaction');
  db.runTransaction = callback => original(async transaction => {
    await callback(transaction);
    throw retry;
  }).catch(error => {
    if (error !== retry) throw error;
    return original(callback);
  });
  const result = await claim();
  assert.equal(result.status, 200);
  assert.equal(result.body.companionReward.id, 'astral-guardian');
  assert.equal(bossCalls(), 1);
  assert.equal(records(db, 'userCharacterCollection/').length, 1);
  assert.equal(records(db, 'users/alice/transactions/').length, 1);
  assert.equal(db.data.get('users/alice').coins, 200);
});

test('two different victory chests for the same user grant one companion and one duplicate payout', async t => {
  const { db, claim } = await fixture(t, { bossDraws: [0.7], initial: { 'guildRaids/second': defeatedRaid() } });
  const results = await Promise.all([claim('first'), claim('second')]);
  assert.ok(results.every(result => result.status === 200 && result.body.awarded));
  assert.deepEqual(results.map(result => result.body.companionReward.duplicate).sort(), [false, true]);
  assert.equal(db.data.get('users/alice').coins, 550);
  assert.equal(db.data.get('users/alice').companion.xp, 100);
  assert.equal(records(db, 'userCharacterCollection/').length, 1);
  assert.equal(records(db, 'users/alice/transactions/').length, 2);
  assert.equal(db.data.get('guildRaids/first').participants.alice.claimed, true);
  assert.equal(db.data.get('guildRaids/second').participants.alice.claimed, true);
});

test('a raid rules snapshot controls its companion pool and duplicate payout', async t => {
  const config = { ...structuredClone(RAID_CONFIG), rewardCompanions: [{ ...BOSS_CHEST_COMPANIONS[2], weight: 1, duplicateCoins: 321 }] };
  const { db, request, claim } = await fixture(t, { bossDraws: [0.1], initial: {
    'guildRaids/first': defeatedRaid({ config }),
    'users/alice': profile({ character: { image: '/characters/ASTRAL-GUARDIAN.png' } }),
  } });
  const odds = (await request('/guilds/study/raid')).body.bossCompanionOdds;
  assert.equal(odds.length, 1);
  assert.equal(odds[0].chance, 1);
  const result = await claim();
  assert.equal(result.body.companionReward.id, 'astral-guardian');
  assert.equal(result.body.companionReward.duplicate, true);
  assert.equal(result.body.companionReward.coins, 321);
  assert.equal(db.data.get('users/alice').coins, 521);
  assert.equal(records(db, 'userCharacterCollection/').length, 0);
});

test('coin overflow leaves the victory chest claimable and does not grant a companion or XP', async t => {
  const { db, claim } = await fixture(t, { initial: { 'users/alice': profile({ coins: Number.MAX_SAFE_INTEGER }) } });
  assert.equal((await claim()).status, 409);
  assert.equal(db.data.get('guildRaids/first').participants.alice.claimed, false);
  assert.equal(db.data.get('users/alice').companion.xp, 0);
  assert.equal(records(db, 'userCharacterCollection/').length, 0);
  assert.equal(records(db, 'users/alice/transactions/').length, 0);
});
