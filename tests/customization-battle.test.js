import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCustomizationRouter } from '../api/customization.js';
import { createCompanionRouter } from '../api/companions.js';
import { createCoreRouter } from '../api/core.js';
import { createRaidRouter } from '../api/raids.js';
import { DREADROOT_CONFIG } from '../api/raid-domain.js';
import { characterBuild, equipmentState, GEAR_POOL, itemReward, wardrobeState, WARDROBE_POOL } from '../api/customization-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const start = new Date('2026-10-01T12:00:00Z');
const profile = overrides => ({ username: 'Alice', coins: 1000, character: { image: 'apprenticemage', level: 1 }, timeZone: 'UTC', ...overrides });
const member = overrides => ({ username: 'Alice', damage: 0, charges: 0, dailyCharges: 0, chargeDay: '', claimed: false, ...overrides });
const raid = overrides => ({ bossId: 'dreadroot', bossName: 'Dreadroot Sentinel', guildId: 'study', status: 'active', config: structuredClone(DREADROOT_CONFIG),
  startedAt: start, expiresAt: new Date('2026-10-08T12:00:00Z'), revision: 3, maxHp: 500, hp: 500,
  participants: { alice: member(), bob: member() }, recentAttacks: [], ...overrides });
const activeSeed = overrides => ({
  'guilds/study': { name: 'Study Team', members: ['alice', 'bob'], createdBy: 'alice', activeRaidId: 'raid' },
  'guildRaids/raid': raid(overrides), 'users/alice': profile({ activeRaidId: 'raid' }), 'users/bob': profile({ username: 'Bob', activeRaidId: 'raid' }),
});
async function fixture(t, seed = {}, rolls = {}) {
  let time = start;
  const db = new FakeFirestore({ 'users/alice': profile(), 'users/bob': profile({ username: 'Bob' }), 'users/outsider': profile(),
    'guilds/study': { name: 'Study Team', members: ['alice', 'bob'], createdBy: 'alice' }, ...seed });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.get('x-test-user')) req.auth = { uid: req.get('x-test-user') }; next(); });
  app.use('/api', createCustomizationRouter({ db, now: () => time }), createRaidRouter({ db, now: () => time,
    battleRandom: () => rolls.battle ?? .99, gearRandom: () => rolls.gear ?? 0, wardrobeRandom: () => rolls.wardrobe ?? 0, bossChestRandom: () => rolls.companion ?? 0 }),
  createCoreRouter({ db, now: () => time, questBoxRandom: () => .99 }), createCompanionRouter({ db, now: () => time }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { user = 'alice', method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const makeTask = async (body = {}, user = 'alice') => {
    const response = await request('/tasks', { user, method: 'POST', body: { title: 'Private actual work', ...body } });
    assert.equal(response.status, 201);
    return response.body.task;
  };
  const complete = (task, user = 'alice') => request(`/tasks/${task.id}/complete`, { user, method: 'POST', body: task.occurrenceDay ? { occurrenceDay: task.occurrenceDay } : {} });
  const attack = (attackId, user = 'alice', extra = {}) => request('/guilds/study/raids/raid/attack', { user, method: 'POST', body: { attackId, ...extra } });
  return { db, request, makeTask, complete, attack, setTime: value => { time = new Date(value); } };
}

test('legacy profiles receive only starter inventory, real player level grants and no demo coins', async t => {
  const { db, request } = await fixture(t, { 'users/alice': profile({ coins: 17, companion: { xp: 9900 } }) });
  const response = await request('/wardrobe');
  assert.equal(response.body.coins, 17);
  assert.equal(response.body.level, 1);
  assert.deepEqual(response.body.wardrobe.ownedItemIds, ['study-room', 'mint-slime']);
  assert.equal(response.body.items.length, 9);
  assert.deepEqual(response.body.wardrobe.presets, [null, null, null]);
  const equipment = await request('/equipment');
  assert.equal(equipment.body.items.length, 13);
  assert.equal(equipment.body.ownedItemIds.length, 4);
  assert.equal(equipment.body.build.companionId, 'apprentice-mage');
  assert.equal(equipment.body.build.level, 1);
  assert.equal((await request('/wardrobe', { user: null })).status, 401);
  db.seed('users/alice', { ...db.data.get('users/alice'), character: { image: 'apprenticemage', level: 20 } });
  const companion = await request('/companion');
  assert.ok(companion.body.wardrobe.ownedItemIds.includes('moon-owl'));
  assert.ok(db.data.get('users/alice').wardrobe.ownedItemIds.includes('sky-island'));
  assert.equal(db.data.get('users/alice').coins, 17);
});

test('inventory character previews use the same saved gear and level as the combat build', async t => {
  const { request, db } = await fixture(t, { 'users/alice': profile({ character: { image: 'apprenticemage', level: 10 } }) });
  const equipment = (await request('/equipment')).body;
  const before = structuredClone(db.data);
  const cards = (await request('/cards')).body.cards;
  const active = cards.find(card => card.equipped);
  assert.deepEqual(active.stats, { level: equipment.build.level, attack: equipment.build.attack,
    critChance: equipment.build.critChance, normalDamage: equipment.build.normalDamage });
  assert.ok(cards.every(card => card.stats.attack > 0 && card.stats.critChance > 0));
  assert.deepEqual(db.data, before, 'Previewing another character cannot equip it or change ownership');
});

test('wardrobe purchases atomically debit once and validate ownership and category for looks/favorites', async t => {
  const { db, request } = await fixture(t);
  const look = { backgroundId: 'moon-garden', petId: 'mint-slime', auraId: null };
  assert.equal((await request('/wardrobe/equip', { method: 'PATCH', body: look })).status, 403);
  assert.equal((await request('/wardrobe/presets/0', { method: 'PUT', body: look })).status, 403);
  const buy = () => request('/wardrobe/items/moon-garden/purchase', { method: 'POST', body: { price: 0 } });
  const results = await Promise.all([buy(), buy()]);
  assert.equal(results.filter(result => result.body.purchased).length, 1);
  assert.equal(db.data.get('users/alice').coins, 350);
  assert.equal(db.data.get('users/alice').wardrobe.equipped.backgroundId, 'study-room');
  assert.equal((await request('/wardrobe/items/arcane-halo/purchase', { method: 'POST' })).status, 403);
  assert.equal((await request('/wardrobe/equip', { method: 'PATCH', body: { ...look, backgroundId: 'mint-slime' } })).status, 400);
  assert.equal((await request('/wardrobe/presets/3', { method: 'PUT', body: look })).status, 400);
  assert.equal((await request('/wardrobe/presets/1/equip', { method: 'POST' })).status, 404);
  assert.equal((await request('/wardrobe/presets/0', { method: 'PUT', body: look })).status, 200);
  assert.equal((await request('/wardrobe/presets/0/equip', { method: 'POST' })).body.wardrobe.equipped.backgroundId, 'moon-garden');
  assert.equal((await request('/companion')).body.wardrobe.equipped.backgroundId, 'moon-garden');
  assert.equal((await request('/wardrobe', { user: 'bob' })).body.wardrobe.equipped.backgroundId, 'study-room');
  const reports = await request('/reports');
  assert.equal(reports.body.transactions[0].type, 'wardrobe_purchase');
  assert.equal(reports.body.transactions[0].amount, -650);
});

test('simultaneous different purchases cannot overspend and equipment stats come from owned slots', async t => {
  const { db, request } = await fixture(t, { 'users/alice': profile({ coins: 200 }) });
  const results = await Promise.all(['focus-staff', 'scholar-vest'].map(id => request(`/equipment/items/${id}/purchase`, { method: 'POST', body: { price: 0 } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const bought = results[0].status === 200 ? 'focus-staff' : 'scholar-vest';
  assert.equal((await request(`/equipment/items/${bought}/equip`, { method: 'POST' })).status, 200);
  assert.equal((await request('/equipment/items/sentinel-core/equip', { method: 'POST' })).status, 403);
  assert.equal((await request('/equipment/items/sentinel-core/purchase', { method: 'POST' })).status, 403);
  assert.ok(db.data.get('users/alice').coins >= 0);
  const build = characterBuild(profile({ character: { image: 'frost-scholar', level: 1, tier: 'legendary' } }));
  assert.equal(build.attack, 34);
  assert.equal(build.normalDamage, 28);
  assert.equal(build.criticalDamage, 42);
  assert.equal(build.critChance, .13);
  assert.equal(characterBuild(profile({ character: { image: 'dragonslayer', level: 1, tier: 'common' } })).rarity, 'Legendary');
});

test('Dreadroot selection freezes rules and participant HP, default raid stays Deadline Dragon', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/guilds/study/raids', { method: 'POST', body: { bossId: 'unknown' } })).status, 400);
  const made = await request('/guilds/study/raids', { method: 'POST', body: { bossId: 'dreadroot', hp: 1, defense: 0 } });
  const path = `/guilds/study/raids/${made.body.raid.id}`;
  for (const user of ['alice', 'bob']) assert.equal((await request(`${path}/join`, { user, method: 'POST', body: { acceptRequirements: true } })).status, 200);
  const started = await request(`${path}/start`, { method: 'POST' });
  assert.equal(started.body.raid.hp, 500);
  assert.equal(started.body.raid.defense, 20);
  assert.equal(started.body.raid.config.dailyChargeLimit, 5);
  assert.equal(started.body.raid.expiresAt, '2026-10-08T12:00:00.000Z');
  assert.equal((await request('/tasks')).body.raidRules.bossId, 'dreadroot');
  const preview = await request('/guilds/study/raid');
  assert.deepEqual(preview.body.bossGearOdds.map(item => item.chance), [.4, .3, .2, .1]);
  assert.deepEqual(preview.body.bossWardrobeOdds.map(item => item.chance), [.35, .5, .15]);
});

test('real parent task occurrences earn charges once, capped at five per UTC day without automatic damage', async t => {
  const { db, request, makeTask, complete, setTime } = await fixture(t, activeSeed());
  const first = await makeTask({ subtasks: [{ id: 'step', title: 'One step', done: false }] });
  await request(`/tasks/${first.id}`, { method: 'PATCH', body: { subtasks: [{ id: 'step', title: 'One step', done: true }] } });
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 0);
  const duplicate = await Promise.all([complete(first), complete(first)]);
  assert.equal(duplicate.filter(result => result.body.awarded).length, 1);
  for (let index = 0; index < 4; index++) assert.equal((await complete(await makeTask())).body.raidAttack.chargesEarned, 1);
  const cappedTask = await makeTask();
  const capped = await complete(cappedTask);
  assert.equal(capped.body.raidAttack.reason, 'daily_charge_limit');
  assert.equal(capped.body.raidAttack.chargesEarned, 0);
  assert.equal(db.data.get('guildRaids/raid').hp, 500);
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 5);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 3);
  db.seed(`todos/${first.id}`, { ...db.data.get(`todos/${first.id}`), isCompleted: false });
  assert.equal((await complete(first)).body.awarded, false);
  setTime('2026-10-02T00:00:00Z');
  assert.equal((await request('/guilds/study/raid')).body.raid.me.dailyCharges, 0);
  assert.equal((await complete(cappedTask)).body.awarded, false);
  assert.equal((await complete(await makeTask())).body.raidAttack.chargesEarned, 1);
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 6);
  assert.ok(!JSON.stringify((await request('/guilds/study/raid')).body).includes('Private actual work'));
});

test('daily recurrence gets one new charge each day, linked milestone cannot duplicate its completed task', async t => {
  const { db, request, makeTask, complete, setTime } = await fixture(t, activeSeed());
  const daily = await makeTask({ recurrence: 'daily' });
  await complete(daily);
  setTime('2026-10-02T12:00:00Z');
  const today = (await request('/tasks')).body.tasks.find(task => task.id === daily.id);
  await complete(today);
  const linked = await makeTask({}, 'bob');
  await complete(linked, 'bob');
  await request('/guilds/study/project', { method: 'PUT', body: { title: 'Real project' } });
  const add = body => request('/guilds/study/project/milestones', { method: 'POST', body: { title: 'Real milestone', assigneeId: 'bob', ...body } });
  const milestone = await add({ taskId: linked.id });
  const path = `/guilds/study/project/milestones/${milestone.body.milestone.id}`;
  await request(`${path}/submit`, { user: 'bob', method: 'POST' });
  const accepted = await request(`${path}/accept`, { method: 'POST' });
  assert.equal(accepted.body.raidAttack.reason, 'already_counted');
  assert.equal(db.data.get('guildRaids/raid').participants.bob.charges, 1);
  const unique = await add({});
  const uniquePath = `/guilds/study/project/milestones/${unique.body.milestone.id}`;
  await request(`${uniquePath}/submit`, { user: 'bob', method: 'POST' });
  const accepts = await Promise.all([1, 2].map(() => request(`${uniquePath}/accept`, { method: 'POST' })));
  assert.equal(accepts.filter(result => result.body.awarded).length, 1);
  assert.equal(db.data.get('guildRaids/raid').participants.bob.charges, 2);
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 2);
});

test('attack snapshots gear, server crit and level; original result replays without spending twice', async t => {
  const { db, request, attack } = await fixture(t, activeSeed({ participants: { alice: member({ charges: 2 }), bob: member() } }), { battle: 0 });
  await request('/equipment/items/focus-staff/purchase', { method: 'POST' });
  await request('/equipment/items/focus-staff/equip', { method: 'POST' });
  const results = await Promise.all([attack('unique_attack'), attack('unique_attack')]);
  assert.equal(results.filter(result => !result.body.replayed).length, 1);
  assert.deepEqual(results[0].body.attack, results[1].body.attack);
  assert.equal(results[0].body.attack.critical, true);
  assert.equal(results[0].body.attack.equipped.weapon, 'focus-staff');
  assert.equal(results[0].body.attack.build.attack, 36);
  assert.equal(results[0].body.attack.damage, 45);
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 1);
  assert.equal(db.data.get('guildRaids/raid').revision, 4);
  await request('/equipment/items/practice-focus/equip', { method: 'POST' });
  assert.deepEqual((await attack('unique_attack')).body.attack, results[0].body.attack);
  assert.equal((await attack('forged_attack', 'alice', { damage: 999999 })).status, 400);
});

test('simultaneous final hits clamp HP, reject new attacks after victory and retain losing charge', async t => {
  const { db, attack } = await fixture(t, activeSeed({ hp: 4, participants: { alice: member({ charges: 1 }), bob: member({ charges: 1 }) } }));
  const results = await Promise.all([attack('alice_final'), attack('bob_final', 'bob')]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? 'alice' : 'bob';
  assert.equal(results.find(result => result.status === 200).body.attack.damage, 4);
  assert.equal(db.data.get('guildRaids/raid').hp, 0);
  assert.equal(db.data.get('guildRaids/raid').participants[winner === 'alice' ? 'bob' : 'alice'].charges, 1);
  assert.equal(db.data.get('guilds/study').trophies.length, 1);
  assert.equal((await attack(`${winner}_final`, winner)).body.replayed, true);
});

test('unauthorized, expired, stale raid and zero-charge attacks do not consume or change health', async t => {
  const { db, attack, setTime } = await fixture(t, activeSeed({ participants: { alice: member({ charges: 1 }), bob: member() } }));
  assert.equal((await attack('outsider_attack', 'outsider')).status, 403);
  assert.equal((await attack('bob_nocharge', 'bob')).status, 409);
  assert.equal((await attack('anonymous_attack', null)).status, 401);
  db.seed('guilds/study', { ...db.data.get('guilds/study'), activeRaidId: 'newer_raid' });
  assert.equal((await attack('stale_attack')).status, 409);
  db.seed('guilds/study', { ...db.data.get('guilds/study'), activeRaidId: 'raid' });
  setTime('2026-10-08T12:00:00Z');
  assert.equal((await attack('expired_attack')).status, 409);
  assert.equal(db.data.get('guildRaids/raid').participants.alice.charges, 1);
  assert.equal(db.data.get('guildRaids/raid').hp, 500);
});

test('Dreadroot chest grants three independent pools atomically once and duplicate compensation stays exact', async t => {
  const { db, request } = await fixture(t, activeSeed({ status: 'defeated', hp: 0, participants: { alice: member({ damage: 1 }), bob: member() } }));
  const claim = () => request('/guilds/study/raids/raid/claim', { method: 'POST' });
  const results = await Promise.all([claim(), claim()]);
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  const won = results.find(result => result.body.awarded).body;
  assert.equal(won.gearReward.id, 'sunbrand');
  assert.equal(won.wardrobeReward.id, 'ember-drake');
  assert.equal(won.companionReward.duplicate, false);
  assert.equal(db.data.get('users/alice').coins, 1100);
  assert.ok(db.data.get('users/alice').equipment.ownedItemIds.includes('sunbrand'));
  assert.ok(db.data.get('users/alice').wardrobe.ownedItemIds.includes('ember-drake'));
  assert.ok(!db.data.get('users/alice').companion.ownedCosmetics.includes('dragon-scholar'));
  assert.equal((await request('/guilds/study/raids/raid/claim', { user: 'bob', method: 'POST' })).status, 409);
  const next = raid({ status: 'defeated', hp: 0, participants: { alice: member({ damage: 1 }) } });
  db.seed('guildRaids/second', next);
  const duplicate = await request('/guilds/study/raids/second/claim', { method: 'POST' });
  assert.equal(duplicate.body.gearReward.coins, 100);
  assert.equal(duplicate.body.wardrobeReward.coins, 200);
  assert.equal(duplicate.body.companionReward.duplicate, true);
  assert.equal(duplicate.body.rewards.coins, 400 + duplicate.body.companionReward.coins);
  const row = db.data.get('users/alice/transactions/raid_second');
  assert.equal(row.gearReward.id, 'sunbrand');
  assert.match(row.description, /Dreadroot Sentinel/);
  assert.equal(row.amount, duplicate.body.rewards.coins);
});

test('loot boundary probabilities and cosmetic isolation remain exact', () => {
  assert.deepEqual([0, .4, .7, .9, .999999].map(roll => itemReward(roll, GEAR_POOL, []).id), ['sunbrand', 'warden-plate', 'vanguard-cape', 'sentinel-core', 'sentinel-core']);
  assert.deepEqual([0, .35, .85, .999999].map(roll => itemReward(roll, WARDROBE_POOL, []).id), ['ember-drake', 'starfall', 'arcane-halo', 'arcane-halo']);
  assert.throws(() => itemReward(1, GEAR_POOL, []));
  const user = profile();
  const base = characterBuild(user);
  user.wardrobe = { ...wardrobeState(user), ownedItemIds: ['arcane-halo'], equipped: { backgroundId: 'study-room', petId: null, auraId: 'arcane-halo' } };
  assert.deepEqual(characterBuild(user), base);
  assert.equal(equipmentState({ equipment: { equipped: { weapon: 'sunbrand' } } }).equipped.weapon, 'practice-focus');
});

test('saved raid pool weights and duplicate values survive newer economy definitions', async t => {
  const config = structuredClone(DREADROOT_CONFIG);
  config.rewardGear = [{ ...GEAR_POOL.find(item => item.id === 'sentinel-core'), weight: 1, duplicateCoins: 17 }];
  config.rewardWardrobe = [{ ...WARDROBE_POOL.find(item => item.id === 'arcane-halo'), weight: 1, duplicateCoins: 19 }];
  config.rewardCompanions = [{ ...config.rewardCompanions.at(-1), weight: 1, duplicateCoins: 23 }];
  const user = profile({ activeRaidId: 'raid',
    character: { image: config.rewardCompanions[0].id, level: 1 },
    equipment: { ...equipmentState(), ownedItemIds: [...equipmentState().ownedItemIds, 'sentinel-core'] },
    wardrobe: { ...wardrobeState(), ownedItemIds: [...wardrobeState().ownedItemIds, 'arcane-halo'] },
  });
  const { request, db } = await fixture(t, { ...activeSeed({ config, status: 'defeated', hp: 0,
    participants: { alice: member({ damage: 1 }) } }), 'users/alice': user });
  const preview = await request('/guilds/study/raid');
  assert.deepEqual(preview.body.bossGearOdds.map(item => [item.id, item.chance, item.duplicateCoins]), [['sentinel-core', 1, 17]]);
  assert.deepEqual(preview.body.bossWardrobeOdds.map(item => [item.id, item.chance, item.duplicateCoins]), [['arcane-halo', 1, 19]]);
  assert.equal(preview.body.bossCompanionOdds[0].duplicateCoins, 23);
  const claim = await request('/guilds/study/raids/raid/claim', { method: 'POST' });
  assert.equal(claim.body.gearReward.coins, 17);
  assert.equal(claim.body.wardrobeReward.coins, 19);
  assert.equal(claim.body.companionReward.coins, 23);
  assert.equal(claim.body.rewards.coins, 159);
  assert.equal(db.data.get('users/alice').coins, 1159);
});

test('attack IDs are user-scoped and historical replay survives a new raid but still requires guild membership', async t => {
  const { request, db, attack } = await fixture(t, activeSeed({ participants: { alice: member({ charges: 1 }), bob: member({ charges: 1 }) } }));
  const first = await attack('shared_attack_id');
  const other = await attack('shared_attack_id', 'bob');
  assert.equal(first.body.replayed, false);
  assert.equal(other.body.replayed, false);
  assert.equal(other.body.attack.hpBefore, first.body.attack.hpAfter);
  const saved = db.data.get('guildRaids/raid');
  db.seed('guildRaids/raid', { ...saved, status: 'defeated', hp: 0 });
  db.seed('guilds/study', { ...db.data.get('guilds/study'), activeRaidId: 'new_raid' });
  db.seed('users/alice', { ...db.data.get('users/alice'), activeRaidId: 'new_raid' });
  const replay = await attack('shared_attack_id');
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.attack, first.body.attack);
  assert.equal((await attack('different_attack_id')).status, 403);
  db.seed('guilds/study', { ...db.data.get('guilds/study'), members: ['bob'] });
  assert.equal((await attack('shared_attack_id')).status, 403);
  assert.equal((await request('/guilds/study/raids/raid/claim', { method: 'POST' })).status, 403);
  assert.equal(db.data.get('users/alice').coins, 1000);
  assert.equal(db.data.get('guildRaids/raid').revision, saved.revision);
});
