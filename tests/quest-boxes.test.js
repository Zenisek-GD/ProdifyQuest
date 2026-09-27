import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createQuestBoxRouter } from '../api/quest-boxes.js';
import {
  normalizeQuestBoxConfig, prepareQuestBoxDrop, questBoxProgressView, questBoxRules,
  randomQuestBoxRoll, QUEST_BOX_RARITIES, QUEST_BOX_REWARDS, weightedQuestBoxChoice,
} from '../api/quest-box-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const instant = new Date('2026-09-26T10:00:00Z');
const profile = (extra = {}) => ({ username: 'Alice', coins: 100, character: { image: 'apprenticemage', level: 1, exp: 0 }, ...extra });
const unopened = (createdAt = instant) => ({ status: 'unopened', createdAt });
const boxPath = id => `users/alice/questBoxes/${id}`;
const ledgerPath = id => `users/alice/transactions/box_${id}`;
const drop = (user = {}, roll = 0.5, now = instant, config) => prepareQuestBoxDrop({ uid: 'alice', user, taskId: 'task1', now, roll, config });

async function setup(t, { initial = {}, draws = [0.1, 0.1, 0.1, 0.1], config } = {}) {
  const db = new FakeFirestore({ 'users/alice': profile(), 'users/bob': profile(), [boxPath('task_first')]: unopened(), ...initial });
  let randomCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { uid: req.get('x-test-user') || 'alice' }; next(); });
  app.use('/api', createQuestBoxRouter({ db, now: () => new Date(instant), random: () => draws[randomCalls++ % draws.length], config }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = 'GET', body, uid = 'alice' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': uid }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, request, open: (id = 'task_first', options = {}) => request(`/quest-boxes/${id}/open`, { method: 'POST', ...options }), randomCalls: () => randomCalls };
}

test('task box drops use the exact probability boundary and do not mutate user state', () => {
  const user = profile({ questBoxProgress: { day: '2026-09-26', dropsToday: 1, misses: 2 } });
  const before = structuredClone(user);
  const win = drop(user, 0.249999);
  assert.deepEqual(win.box, { id: 'task_task1', status: 'unopened', createdAt: instant });
  assert.deepEqual(win.progress, { day: '2026-09-26', dropsToday: 2, misses: 0 });
  const miss = drop(user, 0.25);
  assert.equal(miss.box, null);
  assert.equal(miss.progress.misses, 3);
  assert.deepEqual(user, before);
});

test('four misses guarantee a box on the fifth eligible completion and restart the counter', () => {
  let user = profile();
  for (let index = 1; index <= 5; index += 1) {
    const result = drop(user, 0.999999);
    assert.equal(Boolean(result.box), index === 5);
    assert.equal(result.progress.misses, index === 5 ? 0 : index);
    user = { ...user, questBoxProgress: result.progress };
  }
  assert.equal(user.questBoxProgress.dropsToday, 1);
  assert.equal(questBoxProgressView(user, instant).guaranteedIn, 5);
});

test('daily cap stops all drops and miss changes until UTC midnight while keeping carried misses', () => {
  const user = profile({ questBoxProgress: { day: '2026-09-26', dropsToday: 3, misses: 4 } });
  const capped = drop(user, 0);
  assert.equal(capped.box, null);
  assert.deepEqual(capped.progress, user.questBoxProgress);
  const midnight = new Date('2026-09-27T00:00:00Z');
  const reopened = drop(user, 0.999999, midnight);
  assert.ok(reopened.box);
  assert.deepEqual(reopened.progress, { day: '2026-09-27', dropsToday: 1, misses: 0 });
  assert.equal(questBoxProgressView(user, new Date('2026-09-26T23:59:59Z')).resetTime.toISOString(), midnight.toISOString());
});

test('box configuration and legacy progress are validated and advertised consistently', () => {
  const config = normalizeQuestBoxConfig({ dropChance: 0, guaranteeEvery: 2, dailyLimit: 1, coinMin: 7, coinMax: 9, companionXP: 12 });
  assert.equal(drop({}, 0, instant, config).box, null);
  assert.ok(drop({ questBoxProgress: { misses: 1 } }, 0.9, instant, config).box);
  assert.deepEqual(drop({ questBoxProgress: { day: '2026-09-26', dropsToday: -4, misses: NaN } }, 0.8).progress, { day: '2026-09-26', dropsToday: 0, misses: 1 });
  const rules = questBoxRules(instant, config);
  assert.match(rules.rewards[0].description, /7-9/);
  assert.match(rules.rewards[1].description, /12/);
  assert.ok(Math.abs(rules.rewards.reduce((sum, reward) => sum + reward.chance, 0) - 1) < 1e-12);
  assert.ok(Math.abs(rules.companionRarities.reduce((sum, tier) => sum + tier.chance, 0) - 1) < 1e-12);
  for (const invalid of [{ dropChance: 1.1 }, { dropChance: '0.25' }, { dailyLimit: 0 }, { guaranteeEvery: 1.5 }, { coinMin: 30, coinMax: 20 }]) assert.throws(() => normalizeQuestBoxConfig(invalid));
  for (const invalid of [-1, 1, NaN, '0', Infinity]) assert.throws(() => drop({}, invalid));
  for (let index = 0; index < 20; index += 1) {
    const roll = randomQuestBoxRoll();
    assert.ok(roll >= 0 && roll < 1);
  }
});

test('reward and companion rarity boundaries match published odds', () => {
  for (const [roll, kind] of [[0, 'coins'], [0.499999, 'coins'], [0.5, 'companion_xp'], [0.749999, 'companion_xp'], [0.75, 'character'], [0.949999, 'character'], [0.95, 'cosmetic'], [0.999999, 'cosmetic']]) assert.equal(weightedQuestBoxChoice(QUEST_BOX_REWARDS, roll).kind, kind);
  for (const [roll, tier] of [[0, 'common'], [0.7, 'uncommon'], [0.9, 'rare'], [0.98, 'epic'], [0.995, 'legendary'], [0.999999, 'legendary']]) assert.equal(weightedQuestBoxChoice(QUEST_BOX_RARITIES, roll).tier, tier);
});

test('inventory is private, hides unopened outcomes, paginates pending display and retains last 20 reveals', async t => {
  const initial = {};
  for (let index = 0; index < 100; index += 1) initial[boxPath(`task_pending${index}`)] = { ...unopened(new Date(instant.getTime() + index * 1000)), reward: { label: 'Hidden' } };
  for (let index = 0; index < 21; index += 1) initial[boxPath(`task_opened${index}`)] = { status: 'opened', createdAt: instant, openedAt: new Date(instant.getTime() + index * 1000), reward: { label: `Reward ${index}` } };
  initial['users/bob/questBoxes/task_secret'] = unopened();
  const { request } = await setup(t, { initial });
  const response = await request('/quest-boxes');
  assert.equal(response.status, 200);
  assert.equal(response.body.unopenedCount, 101);
  assert.equal(response.body.boxes.length, 100);
  assert.equal(response.body.boxes[0].id, 'task_pending99');
  assert.ok(response.body.boxes.every(box => !('reward' in box) && !('openedAt' in box)));
  assert.equal(response.body.history.length, 20);
  assert.equal(response.body.history[0].reward.label, 'Reward 20');
  assert.equal(response.body.history.at(-1).reward.label, 'Reward 1');
  assert.equal(response.body.rules.dropChance, 0.25);
  assert.equal(response.body.progress.guaranteedIn, 5);
  assert.equal(response.body.progress.resetTime, '2026-09-27T00:00:00.000Z');
  assert.equal((await request('/quest-boxes', { uid: 'bob' })).body.boxes.length, 1);
  assert.equal((await request('/quest-boxes', { uid: 'missing' })).status, 404);
});

test('coin rewards include both endpoints and keep the saved result on retry', async t => {
  const { db, open, request } = await setup(t, { draws: [0, 0, 0, 0, 0.49, 0.999999, 0, 0], initial: { [boxPath('task_second')]: unopened() } });
  const first = await open();
  assert.equal(first.status, 200);
  assert.equal(first.body.awarded, true);
  assert.equal(first.body.box.reward.coins, 10);
  const second = await open('task_second');
  assert.equal(second.body.box.reward.coins, 25);
  assert.equal(db.data.get('users/alice').coins, 135);
  const replay = await open('task_second');
  assert.equal(replay.body.awarded, false);
  assert.deepEqual(replay.body.box, second.body.box);
  assert.equal(db.data.get('users/alice').coins, 135);
  const ledger = db.data.get(ledgerPath('task_second'));
  assert.equal(ledger.type, 'box_reward');
  assert.equal(ledger.amount, 25);
  assert.equal(ledger.balance, 135);
  assert.equal(ledger.exp, 0);
  assert.equal((await request('/quest-boxes')).body.unopenedCount, 0);
});

test('concurrent opening pays coins and writes a ledger entry exactly once', async t => {
  const { db, open } = await setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => open()));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  assert.ok(results.every(result => result.body.box.reward.coins === 11));
  assert.equal(db.data.get('users/alice').coins, 111);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 1);
});

test('Firestore callback retries reuse the four original random draws and roll back the failed attempt', async t => {
  const { db, open, randomCalls } = await setup(t, { draws: [0, 0.999999, 0, 0, 0.99, 0, 0, 0] });
  const original = db.runTransaction.bind(db);
  let retried = false;
  const retry = new Error('retry transaction');
  db.runTransaction = callback => original(async transaction => {
    await callback(transaction);
    retried = true;
    throw retry;
  }).catch(error => {
    if (error !== retry) throw error;
    return original(callback);
  });
  const result = await open();
  assert.equal(result.status, 200);
  assert.equal(retried, true);
  assert.equal(randomCalls(), 4);
  assert.equal(result.body.box.reward.coins, 25);
  assert.equal(db.data.get('users/alice').coins, 125);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 1);
});

test('companion XP preserves focus, nickname, equipment, bond and spell charge without awarding coins', async t => {
  const previous = {
    nickname: 'Nova', xp: 90, bond: 24, spellCharge: 2, activeFocusId: 'focus_live',
    lastVisitAt: instant, lastActivity: 'focus', ownedCosmetics: ['sunrise-robe'],
    equipped: { outfit: 'sunrise-robe', background: 'study-nook', accessory: 'plain-charm' },
  };
  const { db, open } = await setup(t, { draws: [0.5, 0, 0, 0], initial: { 'users/alice': profile({ companion: previous }) } });
  const reward = (await open()).body.box.reward;
  assert.equal(reward.kind, 'companion_xp');
  assert.equal(reward.xp, 25);
  assert.equal(reward.coins, 0);
  const user = db.data.get('users/alice');
  assert.equal(user.coins, 100);
  assert.equal(user.companion.xp, 115);
  for (const field of ['nickname', 'bond', 'spellCharge', 'activeFocusId', 'lastActivity']) assert.equal(user.companion[field], previous[field]);
  assert.deepEqual(user.companion.equipped, previous.equipped);
  assert.equal(db.data.get(ledgerPath('task_first')).exp, 25);
});

test('new companions enter the existing collection schema without changing the equipped companion', async t => {
  const { db, open } = await setup(t, { draws: [0.75, 0, 0, 0.125] });
  const reward = (await open()).body.box.reward;
  assert.equal(reward.kind, 'character');
  assert.equal(reward.character.id, 'basicarcher');
  assert.equal(reward.character.tier, 'common');
  assert.equal(reward.duplicate, false);
  const entries = [...db.data.entries()].filter(([path]) => path.startsWith('userCharacterCollection/'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].characterName, 'basicarcher');
  assert.equal(entries[0][1].characterTier, 'common');
  assert.equal(entries[0][1].userId, 'alice');
  assert.equal(entries[0][1].catalogId, 'basicarcher');
  assert.equal(entries[0][1].source, 'quest_box');
  assert.equal(db.data.get('users/alice').character.image, 'apprenticemage');
  assert.equal(db.data.get('users/alice').coins, 100);
});

test('the normalized active starter counts as owned and becomes half-price coins', async t => {
  const { db, open } = await setup(t, { draws: [0.75, 0, 0, 0], initial: { 'users/alice': profile({ character: { image: '/characters/common/ApprenticeMage.png' } }) } });
  const reward = (await open()).body.box.reward;
  assert.equal(reward.character.id, 'apprenticemage');
  assert.equal(reward.duplicate, true);
  assert.equal(reward.coins, 15);
  assert.match(reward.description, /already own.*15 coins.*half/);
  assert.equal(db.data.get('users/alice').coins, 115);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('userCharacterCollection/')).length, 0);
});

test('legacy owned companions normalize aliases and return their tier-specific duplicate coins', async t => {
  const { db, open } = await setup(t, { draws: [0.8, 0, 0.98, 0], initial: {
    'userCharacterCollection/legacy': { userId: 'alice', characterName: 'aracanasamurai.png' },
  } });
  const reward = (await open()).body.box.reward;
  assert.equal(reward.character.id, 'arcanesamurai');
  assert.equal(reward.character.tier, 'epic');
  assert.equal(reward.duplicate, true);
  assert.equal(reward.coins, 120);
  assert.equal(db.data.get('users/alice').coins, 220);
});

test('conditional legendary rarity can award a legendary without borrowing another user ownership', async t => {
  const { db, open } = await setup(t, { draws: [0.8, 0, 0.995, 0], initial: {
    'userCharacterCollection/bob': { userId: 'bob', characterName: 'Goldenlionknight' },
  } });
  const reward = (await open()).body.box.reward;
  assert.equal(reward.character.id, 'goldenlionknight');
  assert.equal(reward.character.tier, 'legendary');
  assert.equal(reward.duplicate, false);
  assert.equal(db.data.get('users/alice').coins, 100);
});

test('simultaneous character boxes grant one companion then compensate the duplicate', async t => {
  const { db, open } = await setup(t, { draws: [0.8, 0, 0, 0.125], initial: { [boxPath('task_second')]: unopened() } });
  const results = await Promise.all([open(), open('task_second')]);
  assert.ok(results.every(result => result.body.awarded));
  assert.deepEqual(results.map(result => result.body.box.reward.duplicate).sort(), [false, true]);
  assert.equal(db.data.get('users/alice').coins, 115);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('userCharacterCollection/')).length, 1);
});

test('exclusive cosmetics grant ownership without equipping and duplicates convert to 15 coins', async t => {
  const { db, open } = await setup(t, { draws: [0.95, 0, 0, 0], initial: { [boxPath('task_second')]: unopened() } });
  const first = (await open()).body.box.reward;
  assert.equal(first.kind, 'cosmetic');
  assert.equal(first.cosmetic.id, 'quest-starlight-room');
  assert.equal(first.duplicate, false);
  assert.ok(db.data.get('users/alice').companion.ownedCosmetics.includes('quest-starlight-room'));
  assert.equal(db.data.get('users/alice').companion.equipped.background, 'study-nook');
  const duplicate = (await open('task_second')).body.box.reward;
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.coins, 15);
  assert.match(duplicate.label, /Duplicate.*15 coins/);
  assert.equal(db.data.get('users/alice').coins, 115);
});

test('second exclusive cosmetic is available without granting bond or raid cosmetics', async t => {
  const { db, open } = await setup(t, { draws: [0.999999, 0, 0, 0.999999] });
  const result = await open();
  assert.equal(result.body.box.reward.cosmetic.id, 'quest-comet-charm');
  const companion = db.data.get('users/alice').companion;
  assert.ok(companion.ownedCosmetics.includes('quest-comet-charm'));
  assert.ok(!companion.ownedCosmetics.includes('dragon-scholar'));
  assert.ok(!companion.ownedCosmetics.includes('celestial-robe'));
  assert.equal(companion.bond, 0);
});

test('concurrent XP requests cannot claim the same experience twice', async t => {
  const { db, open } = await setup(t, { draws: [0.6, 0, 0, 0] });
  const results = await Promise.all(Array.from({ length: 5 }, () => open()));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  assert.equal(db.data.get('users/alice').companion.xp, 25);
  assert.equal(db.data.get('users/alice').companion.bond, 0);
  assert.equal(db.data.get('users/alice').coins, 100);
});

test('concurrent cosmetic boxes grant ownership once and compensate only the other box', async t => {
  const { db, open } = await setup(t, { draws: [0.99, 0, 0, 0.75], initial: { [boxPath('task_second')]: unopened() } });
  const results = await Promise.all([open(), open('task_second'), open('task_second')]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 2);
  const user = db.data.get('users/alice');
  assert.equal(user.coins, 115);
  assert.equal(user.companion.ownedCosmetics.filter(id => id === 'quest-comet-charm').length, 1);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 2);
});

test('quest box pools end at the original companions rather than level or boss exclusives', async t => {
  const draws = [
    0.8, 0, 0, 0.999999,
    0.8, 0, 0.7, 0.999999,
    0.8, 0, 0.9, 0.999999,
    0.8, 0, 0.98, 0.999999,
    0.8, 0, 0.995, 0.999999,
  ];
  const ids = ['task_first', 'task_uncommon', 'task_rare', 'task_epic', 'task_legendary'];
  const { open } = await setup(t, { draws, initial: Object.fromEntries(ids.map(id => [boxPath(id), unopened()])) });
  const expected = ['villagefarmer', 'tundrahunter', 'stormsorcerer', 'shadowassasin', 'sunpalladin'];
  for (let index = 0; index < ids.length; index += 1) {
    const result = await open(ids[index]);
    assert.equal(result.status, 200);
    assert.equal(result.body.box.reward.character.id, expected[index]);
  }
});

test('opening enforces account scope, validates IDs and rejects client reward manipulation', async t => {
  const { db, open, request, randomCalls } = await setup(t);
  assert.equal((await open('task_first', { uid: 'bob' })).status, 404);
  assert.equal((await open('task_missing')).status, 404);
  assert.equal((await open('bad-id')).status, 400);
  assert.equal((await request('/quest-boxes/task_bad%2Fpath/open', { method: 'POST' })).status, 400);
  const count = randomCalls();
  for (const body of [{ roll: 0 }, { kind: 'character', characterId: 'sunpalladin' }, { coins: 1000 }, ['character']]) assert.equal((await open('task_first', { body })).status, 400);
  assert.equal(randomCalls(), count);
  assert.equal(db.data.get('users/alice').coins, 100);
  assert.equal(db.data.get(boxPath('task_first')).status, 'unopened');
  assert.equal((await open('task_first', { body: {} })).body.box.reward.coins, 11);
});

test('balance overflow rolls back the reveal, inventory and ledger for a recoverable unopened box', async t => {
  const { db, open } = await setup(t, { initial: { 'users/alice': profile({ coins: Number.MAX_SAFE_INTEGER }) } });
  const result = await open();
  assert.equal(result.status, 409);
  assert.equal(db.data.get(boxPath('task_first')).status, 'unopened');
  assert.equal(db.data.has(ledgerPath('task_first')), false);
  assert.equal(db.data.get('users/alice').coins, Number.MAX_SAFE_INTEGER);
});

test('unexpected prior ledger or malformed stored state never pays a second reward', async t => {
  const { db, open } = await setup(t, { initial: { [ledgerPath('task_first')]: { type: 'box_reward', amount: 11 } } });
  assert.equal((await open()).status, 409);
  assert.equal(db.data.get('users/alice').coins, 100);
  db.seed(boxPath('task_second'), { status: 'invalid', createdAt: instant });
  assert.equal((await open('task_second')).status, 409);
});
