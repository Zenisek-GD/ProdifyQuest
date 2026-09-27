import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRaidRouter, prepareRaidAttack } from '../api/raids.js';
import { createCoreRouter } from '../api/core.js';
import { RAID_CONFIG } from '../api/raid-domain.js';
import { awardCompanion } from '../api/companion-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const start = new Date('2026-10-01T12:00:00Z');
const guild = { name: 'Study Team', createdBy: 'alice', members: ['alice', 'bob', 'carol'] };
const user = name => ({ username: name, coins: 10, character: { image: 'apprenticemage.png' }, companion: { spellCharge: 0 } });
const participant = (overrides = {}) => ({ username: 'Student', damage: 0, dailyDay: '', dailyDamage: 0, claimed: false, ...overrides });
const activeRaid = (overrides = {}) => ({
  guildId: 'study', bossName: 'Deadline Dragon', status: 'active', config: structuredClone(RAID_CONFIG),
  createdAt: start, startedAt: start, expiresAt: new Date(start.getTime() + 7 * 86400000),
  participants: { alice: participant(), bob: participant() }, maxHp: 400, hp: 400, recentAttacks: [], ...overrides,
});
const active = overrides => ({
  'guilds/study': { ...guild, activeRaidId: 'raid' },
  'guildRaids/raid': activeRaid(overrides),
  'users/alice': { ...user('Alice'), activeRaidId: 'raid' },
  'users/bob': { ...user('Bob'), activeRaidId: 'raid' },
});

async function fixture(t, seed = {}, initialTime = start) {
  let time = initialTime;
  const db = new FakeFirestore({ 'guilds/study': guild, 'users/alice': user('Alice'),
    'users/bob': user('Bob'), 'users/carol': user('Carol'), 'users/outsider': user('Outsider'), ...seed });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.get('x-test-user')) req.auth = { uid: req.get('x-test-user') }; next(); });
  app.use('/api', createRaidRouter({ db, now: () => time }));
  app.use('/api', createCoreRouter({ db, now: () => time }));
  app.use(errorHandler);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { user: uid = 'alice', method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-user': uid } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  // Exercise the same composable transaction contract as the core task endpoint.
  const complete = async (taskId, uid = 'alice', size = 'medium') => db.runTransaction(async transaction => {
    const userRef = db.doc(`users/${uid}`), taskRef = db.doc(`todos/${taskId}`);
    const [profile, snapshot] = await Promise.all([transaction.get(userRef), transaction.get(taskRef)]);
    const task = snapshot.exists ? snapshot.data() : { userId: uid, title: 'PRIVATE homework title', size };
    if (task.isCompleted) return { awarded: false };
    const previous = profile.data();
    const next = { ...previous, coins: previous.coins + 10, companion: awardCompanion(previous, { xp: 10, bond: 5, chargeTask: true }) };
    const attack = await prepareRaidAttack({ db, transaction, uid, user: next, taskId, task, now: time });
    next.companion = attack.companion || next.companion;
    transaction.set(taskRef, { ...task, isCompleted: true, completedAt: time,
      ...(attack.raidAttack.raidId ? { raidCreditId: attack.raidAttack.raidId } : {}) });
    transaction.set(userRef, next);
    attack.apply();
    return { awarded: true, raidAttack: attack.raidAttack };
  });
  return { db, request, complete, setTime: value => { time = new Date(value); } };
}

test('raid membership preview, owner controls, explicit consent, and locked health', async t => {
  const { request, db } = await fixture(t);
  assert.equal((await request('/guilds/study/raid', { user: null })).status, 401);
  assert.equal((await request('/guilds/study/raid', { user: 'outsider' })).status, 403);
  assert.equal((await request('/guilds/study/raids', { user: 'bob', method: 'POST' })).status, 403);
  const created = await request('/guilds/study/raids', { method: 'POST', body: { hp: 1, rewardCoins: 900000 } });
  assert.equal(created.status, 201);
  const raidId = created.body.raid.id;
  assert.equal(created.body.raid.config.rewardCoins, 100);
  const path = `/guilds/study/raids/${raidId}`;
  assert.equal((await request(`${path}/start`, { method: 'POST' })).status, 409);
  assert.equal((await request(`${path}/join`, { method: 'POST' })).status, 400);
  for (const uid of ['alice', 'bob']) assert.equal((await request(`${path}/join`, { user: uid, method: 'POST', body: { acceptRequirements: true } })).status, 200);
  assert.equal((await request(`${path}/start`, { user: 'bob', method: 'POST' })).status, 403);
  const started = await request(`${path}/start`, { method: 'POST' });
  assert.equal(started.body.raid.maxHp, 400);
  assert.equal(started.body.raid.hp, 400);
  assert.equal(started.body.raid.expiresAt, '2026-10-08T12:00:00.000Z');
  assert.equal((await request(`${path}/join`, { user: 'carol', method: 'POST', body: { acceptRequirements: true } })).status, 409);
  assert.equal((await request('/guilds/study/raids', { method: 'POST' })).status, 409);
  assert.equal(db.data.get(`guildRaids/${raidId}`).maxHp, 400);
});

test('inventory keeps unopened eligible chests across newer raids and reads never claim rewards', async t => {
  const won = { status: 'defeated', hp: 0, defeatedAt: start, participants: { alice: participant({ damage: 50 }), bob: participant({ damage: 5 }) } };
  const { db, request } = await fixture(t, {
    ...active(),
    'guildRaids/old': activeRaid(won),
    'guildRaids/opened': activeRaid({ ...won, participants: { alice: participant({ damage: 50, claimed: true }) } }),
    'guildRaids/other': activeRaid({ ...won, guildId: 'private' }),
    'guilds/private': { name: 'Private guild', members: ['bob'], createdBy: 'bob' },
  });
  assert.equal((await request('/inventory/chests', { user: null })).status, 401);
  const before = structuredClone(db.data);
  for (let i = 0; i < 2; i++) {
    const inventory = await request('/inventory/chests');
    assert.equal(inventory.status, 200);
    assert.deepEqual(inventory.body.bossChests.map(chest => chest.raidId), ['old']);
    assert.equal(inventory.body.bossChests[0].guildName, 'Study Team');
    assert.equal(inventory.body.bossChests[0].rewardCoins, 100);
  }
  assert.deepEqual(db.data, before, 'Listing cannot spend or award anything');
  assert.deepEqual((await request('/inventory/chests', { user: 'bob' })).body.bossChests, []);
  assert.deepEqual((await request('/inventory/chests', { user: 'outsider' })).body.bossChests, []);
  assert.equal((await request('/guilds/study/raids/old/claim', { method: 'POST' })).body.awarded, true);
  assert.deepEqual((await request('/inventory/chests')).body.bossChests, []);
  assert.equal((await request('/guilds/study/raids/old/claim', { method: 'POST' })).body.awarded, false);
});

test('concurrent task completions deduplicate rewards, damage and charge; attacks keep titles private', async t => {
  const { complete, db, request } = await fixture(t, active());
  const same = await Promise.all([complete('first'), complete('first')]);
  assert.equal(same.filter(result => result.awarded).length, 1);
  await Promise.all([complete('second', 'alice', 'small'), complete('third', 'alice', 'small'), complete('other', 'bob', 'large')]);
  assert.equal(db.data.get('guildRaids/raid').hp, 320); // Alice 20 + 10 + 10 + spell 10; Bob 30.
  assert.equal(db.data.get('users/alice').coins, 40);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 0);
  const { body } = await request('/guilds/study/raid');
  assert.equal(body.raid.me.damage, 50);
  assert.equal(body.raid.recentAttacks.at(-2).bonusDamage, 10);
  assert.ok(!JSON.stringify(body.raid).includes('PRIVATE'));
  assert.ok(!JSON.stringify(body.raid.recentAttacks).includes('first'));
  assert.equal(body.serverTime, start.toISOString());
});

test('UTC daily cap includes spell bonus, preserves unused charge, and resets next day', async t => {
  const { complete, db, setTime, request } = await fixture(t, active());
  await complete('one', 'alice', 'large');
  await complete('two', 'alice', 'large');
  const capped = await complete('three', 'alice', 'large');
  assert.equal(capped.raidAttack.damage, 0);
  assert.equal(capped.raidAttack.reason, 'daily_limit');
  assert.equal(db.data.get('users/alice').companion.spellCharge, 3);
  assert.equal(db.data.get('todos/three').raidCreditId, 'raid');
  assert.equal(db.data.get('users/alice').coins, 40);
  setTime('2026-10-02T00:00:00Z');
  assert.equal((await request('/guilds/study/raid')).body.raid.me.dailyDamage, 0);
  const nextDay = await complete('four', 'alice', 'large');
  assert.equal(nextDay.raidAttack.damage, 40);
  assert.equal(nextDay.raidAttack.bonusDamage, 10);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 0);
});

test('near-cap bonus only consumes when positive and damage never exceeds remaining health', async t => {
  const { complete, db } = await fixture(t, {
    ...active({ hp: 200, participants: { alice: participant({ damage: 45, dailyDay: '2026-10-01', dailyDamage: 45 }) } }),
    'users/alice': { ...user('Alice'), activeRaidId: 'raid', companion: { spellCharge: 3 } },
  });
  const partial = await complete('small', 'alice', 'small');
  assert.equal(partial.raidAttack.damage, 15);
  assert.equal(partial.raidAttack.bonusDamage, 5);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 0);
  const stored = db.data.get('guildRaids/raid');
  db.seed('guildRaids/raid', { ...stored, hp: 3, participants: { alice: participant({ damage: 60 }) } });
  db.seed('users/alice', { ...db.data.get('users/alice'), companion: { spellCharge: 3 } });
  const final = await complete('last');
  assert.equal(final.raidAttack.damage, 3);
  assert.equal(final.raidAttack.bonusDamage, 0);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 3);
});

test('expiry, nonparticipants, and former members retain personal rewards without guild damage', async t => {
  const { complete, db, request, setTime } = await fixture(t, active());
  const notJoined = await complete('carol-task', 'carol');
  assert.equal(notJoined.raidAttack.damage, 0);
  db.seed('guilds/study', { ...guild, activeRaidId: 'raid', members: ['alice', 'carol'] });
  const departed = await complete('bob-task', 'bob');
  assert.equal(departed.raidAttack.reason, 'not_a_member');
  setTime('2026-10-08T12:00:00Z');
  const expired = await complete('expired');
  assert.equal(expired.raidAttack.damage, 0);
  assert.equal(db.data.get('users/alice').coins, 20);
  assert.equal(db.data.get('guildRaids/raid').hp, 400);
  assert.equal((await request('/guilds/study/raid')).body.raid.status, 'expired');
  assert.equal((await request('/guilds/study/raids/raid/claim', { method: 'POST' })).status, 409);
  assert.equal((await request('/guilds/study/raids', { method: 'POST' })).status, 201);
});

test('simultaneous final attacks create one trophy and qualifying members claim equal rewards once', async t => {
  const { complete, db, request } = await fixture(t, active({ hp: 20, participants: {
    alice: participant({ damage: 40 }), bob: participant({ damage: 40 }), carol: participant({ damage: 10 }),
  } }));
  await Promise.all([complete('finisher', 'alice'), complete('after-victory', 'bob')]);
  assert.equal(db.data.get('guildRaids/raid').hp, 0);
  assert.equal(db.data.get('guilds/study').trophies.length, 1);
  const claim = uid => request('/guilds/study/raids/raid/claim', { user: uid, method: 'POST' });
  assert.equal((await claim('carol')).status, 409);
  const replies = await Promise.all([claim('alice'), claim('alice'), claim('bob')]);
  assert.equal(replies.filter(response => response.body.awarded).length, 2);
  assert.equal(db.data.get('users/alice').coins, 120);
  assert.equal(db.data.get('users/bob').coins, 120);
  for (const uid of ['alice', 'bob']) {
    assert.ok(db.data.get(`users/${uid}`).companion.ownedCosmetics.includes('dragon-scholar'));
    assert.equal(db.data.get(`users/${uid}/transactions/raid_raid`).amount, 100);
  }
});

test('new raids preserve access to older unclaimed victory rewards', async t => {
  const seed = active({ status: 'defeated', hp: 0, participants: { alice: participant({ damage: 30 }), bob: participant({ damage: 20 }) } });
  seed['guilds/study'].trophies = [{ raidId: 'raid', bossName: 'Deadline Dragon', defeatedAt: start }];
  const { request } = await fixture(t, seed);
  assert.equal((await request('/guilds/study/raids', { method: 'POST' })).status, 201);
  assert.equal((await request('/guilds/study/raid', { user: 'bob' })).body.pendingRewards[0].raidId, 'raid');
  assert.equal((await request('/guilds/study/raids/raid/claim', { user: 'bob', method: 'POST' })).body.awarded, true);
  assert.deepEqual((await request('/guilds/study/raid', { user: 'bob' })).body.pendingRewards, []);
});

async function addMilestone(request, body = {}) {
  await request('/guilds/study/project', { method: 'PUT', body: { title: 'Science presentation' } });
  const response = await request('/guilds/study/project/milestones', { method: 'POST', body: {
    title: 'Research sources', category: 'research', assigneeId: 'bob', size: 'medium', ...body,
  } });
  assert.equal(response.status, 201);
  return `/guilds/study/project/milestones/${response.body.milestone.id}`;
}

test('project assignments require submission and owner acceptance, damage once, and survive boss defeat', async t => {
  const { request, db } = await fixture(t, active());
  const path = await addMilestone(request);
  const untouched = await addMilestone(request, { title: 'Write presentation', category: 'writing' });
  assert.equal((await request(`${path}/accept`, { method: 'POST' })).status, 409);
  assert.equal((await request(`${path}/submit`, { method: 'POST' })).status, 403);
  assert.equal((await request(`${path}/submit`, { user: 'bob', method: 'POST' })).status, 200);
  assert.equal((await request(`${path}/accept`, { user: 'bob', method: 'POST' })).status, 403);
  const accepted = await Promise.all([request(`${path}/accept`, { method: 'POST' }), request(`${path}/accept`, { method: 'POST' })]);
  assert.equal(accepted.filter(reply => reply.body.awarded).length, 1);
  assert.equal(db.data.get('guildRaids/raid').hp, 380);
  assert.equal(db.data.get('users/bob').companion.spellCharge, 1);
  const stored = db.data.get('guildRaids/raid');
  db.seed('guildRaids/raid', { ...stored, status: 'defeated', hp: 0 });
  assert.equal((await request('/guilds/study/project')).body.project.milestones.find(m => untouched.endsWith(m.id)).status, 'pending');
  assert.equal((await request(path, { method: 'PATCH', body: { title: 'Changed' } })).status, 409);
});

test('linked tasks cannot double count damage, charge or multiple accepted milestones', async t => {
  const { request, complete, db } = await fixture(t, active());
  await complete('linked', 'bob');
  const path = await addMilestone(request, { taskId: 'linked' });
  const duplicate = await addMilestone(request, { taskId: 'linked', title: 'Copy of work' });
  await request(`${path}/submit`, { user: 'bob', method: 'POST' });
  const result = await request(`${path}/accept`, { method: 'POST' });
  assert.equal(result.body.raidAttack.damage, 0);
  assert.equal(db.data.get('guildRaids/raid').hp, 380);
  assert.equal(db.data.get('users/bob').companion.spellCharge, 1);
  assert.equal((await request(`${duplicate}/submit`, { user: 'bob', method: 'POST' })).status, 409);
});

test('linked historical tasks and capped completions cannot become delayed raid attacks', async t => {
  const { request, complete, db, setTime } = await fixture(t, {
    ...active(), 'todos/historical': { userId: 'bob', isCompleted: true, size: 'large', completedAt: new Date('2026-09-30T12:00:00Z') },
  });
  const historical = await addMilestone(request, { taskId: 'historical' });
  await request(`${historical}/submit`, { user: 'bob', method: 'POST' });
  assert.equal((await request(`${historical}/accept`, { method: 'POST' })).body.raidAttack.damage, 0);
  await complete('first', 'bob', 'large');
  await complete('second', 'bob', 'large');
  await complete('capped', 'bob', 'large');
  const capped = await addMilestone(request, { taskId: 'capped' });
  setTime('2026-10-02T00:00:00Z');
  await request(`${capped}/submit`, { user: 'bob', method: 'POST' });
  assert.equal((await request(`${capped}/accept`, { method: 'POST' })).body.raidAttack.damage, 0);
  assert.equal(db.data.get('guildRaids/raid').hp, 340);
  assert.equal(db.data.get('users/bob').companion.spellCharge, 3);
});

test('linked task ownership and guild permissions are enforced', async t => {
  const { request } = await fixture(t, { ...active(), 'todos/alice-only': { userId: 'alice', isCompleted: false } });
  await request('/guilds/study/project', { method: 'PUT', body: { title: 'Group work' } });
  assert.equal((await request('/guilds/study/project', { user: 'outsider' })).status, 403);
  assert.equal((await request('/guilds/study/project', { user: 'bob', method: 'PUT', body: { title: 'Forged' } })).status, 403);
  const invalid = await request('/guilds/study/project/milestones', { method: 'POST', body: { title: 'Task', assigneeId: 'bob', taskId: 'alice-only' } });
  assert.equal(invalid.status, 400);
});

test('real task HTTP endpoints atomically grant rewards, companion progression, damage and victory claims', async t => {
  const { request, db, setTime } = await fixture(t, active({ hp: 90 }));
  const makeTask = async (uid, title, size = 'small') => {
    const created = await request('/tasks', { user: uid, method: 'POST', body: { title, size, difficulty: 'normal' } });
    assert.equal(created.status, 201);
    return created.body.task.id;
  };
  const [a, b, c, d] = await Promise.all([
    makeTask('alice', 'Private research A'), makeTask('alice', 'Private research B'),
    makeTask('alice', 'Private research C'), makeTask('bob', 'Private team work', 'large'),
  ]);
  const completeTask = (taskId, uid = 'alice') => request(`/tasks/${taskId}/complete`, { user: uid, method: 'POST' });
  const duplicate = await Promise.all([completeTask(a), completeTask(a)]);
  assert.deepEqual(duplicate.map(response => response.status), [200, 200]);
  assert.equal(duplicate.filter(response => response.body.awarded).length, 1);
  const simultaneous = await Promise.all([completeTask(b), completeTask(c), completeTask(d, 'bob')]);
  assert.ok(simultaneous.every(response => response.status === 200));
  assert.equal(db.data.get('users/alice').coins, 40);
  assert.equal(db.data.get('users/alice').companion.xp, 30);
  assert.equal(db.data.get('users/alice').companion.bond, 15);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 0);
  assert.equal(db.data.get('guildRaids/raid').hp, 20);
  assert.equal(db.data.get(`users/alice/transactions/task_${a}`).amount, 10);
  assert.equal((await request(`/tasks/${a}`, { method: 'PATCH', body: { size: 'large' } })).status, 409);
  // Legacy reopened tasks remain paid and cannot add damage or charge again.
  db.seed(`todos/${a}`, { ...db.data.get(`todos/${a}`), isCompleted: false });
  assert.equal((await completeTask(a)).body.awarded, false);
  assert.equal(db.data.get('guildRaids/raid').hp, 20);
  setTime('2026-10-02T00:00:00Z');
  const last = await makeTask('bob', 'Finish presentation', 'medium');
  assert.equal((await completeTask(last, 'bob')).body.raidAttack.defeated, true);
  assert.equal(db.data.get('guilds/study').trophies.length, 1);
  for (const uid of ['alice', 'bob']) {
    const response = await request('/guilds/study/raids/raid/claim', { user: uid, method: 'POST' });
    assert.equal(response.body.awarded, true);
    assert.equal(response.body.rewards.coins, 100);
  }
  assert.equal(db.data.get('users/alice').coins, 140);
  assert.equal(db.data.get('users/alice').companion.xp, 80);
  assert.equal(db.data.get('users/bob').coins, 130);
  assert.equal(db.data.get('users/bob').companion.xp, 70);
});

test('returning guild members cannot enroll in two raids or inflate locked health after switching', async t => {
  const { request, db } = await fixture(t, {
    'guilds/study': { ...guild, activeRaidId: 'first' },
    'guilds/other': { ...guild, activeRaidId: 'second' },
    'guildRaids/first': activeRaid({ status: 'recruiting', participants: { alice: participant(), bob: participant() } }),
    'guildRaids/second': activeRaid({ guildId: 'other', status: 'recruiting', participants: { bob: participant() } }),
    'users/alice': { ...user('Alice'), activeRaidId: 'first' },
    'users/bob': { ...user('Bob'), activeRaidId: 'second' },
  });
  const join = () => request('/guilds/study/raids/first/join', { user: 'bob', method: 'POST', body: { acceptRequirements: true } });
  assert.equal((await join()).status, 409);
  assert.equal(db.data.get('users/bob').activeRaidId, 'second');
  const started = await request('/guilds/study/raids/first/start', { method: 'POST' });
  assert.equal(started.status, 200);
  assert.equal(started.body.raid.maxHp, 200);
  assert.deepEqual(started.body.raid.participants.map(member => member.uid), ['alice']);
});

test('simultaneous acceptance of two linked milestones credits a task at most once', async t => {
  const { request, complete, db } = await fixture(t, active());
  await complete('linked', 'bob');
  const first = await addMilestone(request, { taskId: 'linked' });
  const second = await addMilestone(request, { taskId: 'linked', title: 'Another checklist entry' });
  await Promise.all([first, second].map(path => request(`${path}/submit`, { user: 'bob', method: 'POST' })));
  const accepted = await Promise.all([first, second].map(path => request(`${path}/accept`, { method: 'POST' })));
  assert.deepEqual(accepted.map(reply => reply.status).sort(), [200, 409]);
  assert.equal(db.data.get('guildProjects/study').milestones.filter(milestone => milestone.status === 'accepted').length, 1);
  assert.equal(db.data.get('guildRaids/raid').hp, 380);
  assert.equal(db.data.get('users/bob').companion.spellCharge, 1);
});
