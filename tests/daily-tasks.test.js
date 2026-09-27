import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { taskInput } from '../api/domain.js';
import { taskOccurrence, taskOccurrenceKey, zonedDayTime } from '../api/task-recurrence.js';
import { RAID_CONFIG } from '../api/raid-domain.js';
import { FakeFirestore } from './fake-firestore.js';

async function fixture(t, { at: initial = '2026-09-26T15:59:00Z', zone = 'Asia/Taipei', seed = {} } = {}) {
  let at = new Date(initial);
  const db = new FakeFirestore({
    'users/alice': { username: 'Alice', coins: 0, timeZone: zone, character: { image: 'apprenticemage', level: 1, exp: 0 } },
    'users/bob': { username: 'Bob', coins: 0, timeZone: 'UTC' }, ...seed,
  });
  const app = createApp({ db, auth: { verifyIdToken: async uid => ({ uid }) }, now: () => at, questBoxRandom: () => 0.1 });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = async (path, method = 'GET', body, uid = 'alice') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const create = async (extra = {}) => {
    const response = await request('/tasks', 'POST', { title: 'Daily reading', recurrence: 'daily', ...extra });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.task;
  };
  const complete = task => request(`/tasks/${task.id}/complete`, 'POST', { occurrenceDay: task.occurrenceDay });
  const current = async id => (await request('/tasks')).body.tasks.find(task => task.id === id);
  return { db, request, create, complete, current, setTime(value) { at = new Date(value); } };
}

test('daily completion pays once per account calendar day and rolls over checklist without writes', async t => {
  const { db, request, create, complete, current, setTime } = await fixture(t);
  const task = await create({ dueDate: '2026-09-26T20:30:00+08:00', subtasks: [{ id: 'chapter', title: 'Read a chapter', done: false }] });
  assert.equal(task.occurrenceDay, '2026-09-26');
  assert.equal(task.nextResetAt, '2026-09-26T16:00:00.000Z');
  await request(`/tasks/${task.id}`, 'PATCH', { occurrenceDay: task.occurrenceDay, subtasks: [{ id: 'chapter', title: 'Read a chapter', done: true }] });
  const sameDay = await Promise.all([complete(task), complete(task)]);
  assert.ok(sameDay.every(result => result.status === 200));
  assert.equal(sameDay.filter(result => result.body.awarded).length, 1);
  const firstBox = sameDay.find(result => result.body.awarded).body.questBox;
  assert.equal(db.data.get('users/alice').coins, 10);
  assert.equal((await current(task.id)).subtasks[0].done, true);
  setTime('2026-09-26T16:00:00Z');
  const beforeRead = structuredClone(db.data);
  const today = await current(task.id);
  assert.deepEqual(db.data, beforeRead);
  assert.equal(today.occurrenceDay, '2026-09-27');
  assert.equal(today.isCompleted, false);
  assert.equal(today.completedAt, null);
  assert.equal(today.subtasks[0].done, false);
  assert.equal(today.dueDate, '2026-09-27T12:30:00.000Z');
  assert.equal(today.recurrenceLocked, true);
  const result = await complete(today);
  assert.equal(result.body.awarded, true);
  assert.notEqual(result.body.questBox.id, firstBox.id);
  assert.equal(db.data.get('users/alice').coins, 20);
  assert.equal(db.data.get('users/alice').companion.xp, 20);
  const report = (await request('/reports')).body;
  assert.equal(report.summary.totalTasks, 1);
  assert.equal(report.summary.completedTasks, 1);
  assert.equal(report.summary.totalCompletions, 2);
  assert.deepEqual(report.transactions.filter(entry => entry.type === 'task_completion').map(entry => entry.occurrenceDay), ['2026-09-27', '2026-09-26']);
  assert.equal(report.daily.find(day => day.date === '2026-09-26').completed, 1);
  assert.equal(report.daily.find(day => day.date === '2026-09-27').completed, 1);
  await request(`/tasks/${task.id}`, 'DELETE');
  const deleted = (await request('/reports')).body;
  assert.equal(deleted.summary.totalTasks, 0);
  assert.equal(deleted.summary.totalCompletions, 2);
  assert.equal((await request('/quest-boxes')).body.unopenedCount, 2);
});

test('stale/missing occurrence tokens cannot complete or edit the next day and client timezone is ignored', async t => {
  const { db, request, create, complete, current, setTime } = await fixture(t);
  const task = await create();
  assert.equal((await request(`/tasks/${task.id}/complete`, 'POST')).status, 409);
  setTime('2026-09-26T16:00:00Z');
  assert.equal((await complete(task)).status, 409);
  assert.equal((await request(`/tasks/${task.id}/complete`, 'POST', { occurrenceDay: '2026-09-26', timeZone: 'UTC' })).status, 409);
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { occurrenceDay: task.occurrenceDay, subtasks: [] })).status, 409);
  assert.equal(db.data.get('users/alice').coins, 0);
  const today = await current(task.id);
  assert.equal((await complete(today)).body.awarded, true);
  assert.equal((await complete(today)).body.awarded, false);
});

test('missed days have no backlog; current pending reports reset and a new day remains rewardable', async t => {
  const { db, request, create, complete, current, setTime } = await fixture(t);
  const task = await create();
  await complete(task);
  setTime('2026-10-01T05:00:00Z');
  const today = await current(task.id);
  assert.equal(today.occurrenceDay, '2026-10-01');
  const report = (await request('/reports')).body;
  assert.equal(report.summary.pendingTasks, 1);
  assert.equal(report.summary.completedTasks, 0);
  assert.equal(report.summary.totalCompletions, 1);
  assert.equal((await request('/tasks')).body.tasks.length, 1);
  await complete(today);
  assert.equal(db.data.get('users/alice').coins, 20);
  assert.equal(db.data.get('users/alice').streak, 1);
});

test('daily future starts are unavailable until local start date while templates remain editable', async t => {
  const { request, create, complete, current, setTime } = await fixture(t);
  const task = await create({ dueDate: '2026-09-29T09:00:00+08:00' });
  assert.equal(task.occurrenceDay, '2026-09-29');
  assert.equal(task.occurrenceAvailable, false);
  assert.equal((await complete(task)).status, 409);
  const changed = await request(`/tasks/${task.id}`, 'PATCH', { occurrenceDay: task.occurrenceDay, subtasks: [{ id: 's', title: 'Read', done: false }] });
  assert.equal(changed.status, 200);
  setTime('2026-09-28T16:00:00Z');
  const started = await current(task.id);
  assert.equal(started.occurrenceAvailable, true);
  assert.equal((await complete(started)).body.awarded, true);
});

test('DST spring and fall days reset at local midnight, repeating or skipping wall-clock due times deterministically', () => {
  const user = { timeZone: 'America/New_York' };
  const task = { recurrence: 'daily', recurrenceStartDay: '2026-03-01', dueDate: new Date('2026-03-07T07:30:00Z') };
  const spring = taskOccurrence(task, user, new Date('2026-03-08T05:00:00Z'));
  assert.equal(spring.occurrenceDay, '2026-03-08');
  assert.equal(spring.nextResetAt.toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(spring.dueDate.toISOString(), '2026-03-08T07:30:00.000Z'); // 02:30 skipped -> 03:30.
  const next = taskOccurrence(task, user, new Date('2026-03-09T04:00:00Z'));
  assert.equal(next.dueDate.toISOString(), '2026-03-09T06:30:00.000Z');
  const fall = taskOccurrence({ ...task, dueDate: new Date('2026-10-31T05:30:00Z') }, user, new Date('2026-11-01T04:00:00Z'));
  assert.equal(fall.nextResetAt.toISOString(), '2026-11-02T05:00:00.000Z'); // 25-hour day.
  assert.equal(fall.dueDate.toISOString(), '2026-11-01T05:30:00.000Z'); // First 01:30.
  assert.equal(taskOccurrence(task, user, new Date('2026-11-02T04:59:59Z')).occurrenceDay, '2026-11-01');
  assert.equal(zonedDayTime('2026-09-27', '00:00:00', 'Asia/Kathmandu').toISOString(), '2026-09-26T18:15:00.000Z');
});

test('HTTP completion remains single-award through the repeated DST hour', async t => {
  const { db, create, complete, current, setTime } = await fixture(t, { at: '2026-11-01T05:30:00Z', zone: 'America/New_York' });
  const task = await create();
  await complete(task);
  setTime('2026-11-01T06:30:00Z');
  assert.equal((await complete(await current(task.id))).body.awarded, false);
  setTime('2026-11-02T05:00:00Z');
  assert.equal((await complete(await current(task.id))).body.awarded, true);
  assert.equal(db.data.get('users/alice').coins, 20);
});

test('repeat settings lock after any reward, including legacy payment, while next-day effort is editable', async t => {
  const { db, request, create, complete, current, setTime } = await fixture(t);
  const task = await create();
  await complete(task);
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { recurrence: 'none' })).status, 409);
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { difficulty: 'hard' })).status, 409);
  setTime('2026-09-26T16:00:00Z');
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { recurrence: 'none' })).status, 409);
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { difficulty: 'hard', size: 'large' })).status, 200);
  assert.equal((await complete(await current(task.id))).body.awarded, true);
  assert.equal(db.data.get('users/alice').coins, 30);
  db.seed('todos/legacy', { userId: 'alice', title: 'Legacy', isCompleted: false });
  db.seed('users/alice/transactions/task_legacy', { type: 'task_completion', sourceId: 'legacy' });
  assert.equal((await request('/tasks/legacy', 'PATCH', { recurrence: 'daily' })).status, 409);
});

test('unpaid tasks can switch repeat settings without allowing a stale completion to cross modes', async t => {
  const { request, create, complete } = await fixture(t);
  const daily = await create();
  assert.equal((await request(`/tasks/${daily.id}`, 'PATCH', { recurrence: 'none', occurrenceDay: daily.occurrenceDay, subtasks: [] })).status, 200);
  assert.equal((await complete(daily)).status, 409);
  assert.equal((await request(`/tasks/${daily.id}/complete`, 'POST')).body.awarded, true);
  assert.equal((await request(`/tasks/${daily.id}`, 'PATCH', { recurrence: 'daily' })).status, 409);
  const oneOff = await create({ recurrence: 'none' });
  const changed = await request(`/tasks/${oneOff.id}`, 'PATCH', { recurrence: 'daily', subtasks: [] });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.task.occurrenceDay, '2026-09-26');
  assert.equal((await request(`/tasks/${oneOff.id}/complete`, 'POST')).status, 409);
  assert.equal((await complete(changed.body.task)).body.awarded, true);
  assert.throws(() => taskInput({ title: 'Invalid', recurrence: 'weekly' }), { status: 400 });
});

test('daily task permissions and per-occurrence IDs prevent cross-user awards and key collisions', async t => {
  const { db, request, create } = await fixture(t);
  const task = await create();
  for (const [method, path, body] of [
    ['POST', `/tasks/${task.id}/complete`, { occurrenceDay: task.occurrenceDay }],
    ['PATCH', `/tasks/${task.id}`, { occurrenceDay: task.occurrenceDay, subtasks: [] }],
    ['DELETE', `/tasks/${task.id}`, undefined],
  ]) assert.equal((await request(path, method, body, 'bob')).status, 404);
  assert.equal((await request('/tasks', 'GET', undefined, 'bob')).body.tasks.length, 0);
  assert.equal(db.data.get('users/alice').coins, 0);
  assert.notEqual(taskOccurrenceKey('a_2026-09-26', '2026-09-27'), taskOccurrenceKey('a', '2026-09-26'));
  assert.equal(taskOccurrenceKey('x'.repeat(200), '2026-09-26').length, 70);
});

test('daily raid contributions and boxes obey existing UTC caps across account-local reset', async t => {
  const seed = {
    'users/alice': { username: 'Alice', coins: 0, timeZone: 'Asia/Taipei', activeRaidId: 'raid', character: { image: 'basicarcher' } },
    'guilds/study': { createdBy: 'alice', members: ['alice'], activeRaidId: 'raid' },
    'guildRaids/raid': { guildId: 'study', status: 'active', config: structuredClone(RAID_CONFIG), maxHp: 1000, hp: 1000,
      startedAt: new Date('2026-09-25T00:00:00Z'), expiresAt: new Date('2026-10-02T00:00:00Z'),
      participants: { alice: { damage: 0, dailyDamage: 0 } } },
  };
  const { db, request, create, complete, current, setTime } = await fixture(t, { seed });
  const tasks = await Promise.all(Array.from({ length: 4 }, (_, index) => create({ title: `Read ${index}`, size: 'large' })));
  const dayOne = await Promise.all(tasks.map(complete));
  assert.equal(dayOne.filter(result => result.body.questBox).length, 3);
  assert.equal(dayOne.reduce((sum, result) => sum + result.body.raidAttack.damage, 0), 60);
  setTime('2026-09-26T16:00:00Z'); // New local day, same UTC caps.
  const nextLocal = await Promise.all(tasks.map(task => current(task.id)));
  const dayTwo = await Promise.all(nextLocal.map(complete));
  assert.equal(dayTwo.filter(result => result.body.questBox).length, 0);
  assert.equal(dayTwo.reduce((sum, result) => sum + result.body.raidAttack.damage, 0), 0);
  assert.equal(db.data.get('users/alice').coins, 80);
  setTime('2026-09-27T00:00:00Z');
  assert.equal((await complete(await current(tasks[0].id))).body.awarded, false);
  const fresh = await create();
  const eligible = await complete(fresh);
  assert.ok(eligible.body.questBox);
  assert.equal(eligible.body.raidAttack.damage, 20);
  setTime('2026-09-27T16:00:00Z');
  const next = await complete(await current(tasks[0].id));
  assert.equal(next.body.raidAttack.damage, 30);
  assert.ok(next.body.questBox);
  assert.equal(db.data.get('guildRaids/raid').hp, 890);
  const contributions = [...db.data.keys()].filter(key => key.startsWith('guildRaids/raid/contributions/'));
  assert.equal(contributions.length, 10);
  assert.equal((await request('/reports')).body.summary.totalCompletions, 10);
});

test('daily tasks cannot be used as mutable project milestone evidence', async t => {
  const { db, request, create } = await fixture(t, { seed: { 'guilds/study': { createdBy: 'alice', members: ['alice'] } } });
  const task = await create();
  await request('/guilds/study/project', 'PUT', { title: 'Project' });
  const result = await request('/guilds/study/project/milestones', 'POST', { title: 'Draft', assigneeId: 'alice', taskId: task.id });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /one-time task/i);
  db.seed('guildProjects/study', { title: 'Legacy project', milestones: [{ id: 'daily-link', taskId: task.id, assigneeId: 'alice', status: 'pending' }] });
  assert.equal((await request('/guilds/study/project/milestones/daily-link/submit', 'POST')).status, 409);
});

test('daily award overflow rolls back completion, ledger, boxes and streak atomically', async t => {
  const { db, create, complete } = await fixture(t, { seed: { 'users/alice': { coins: Number.MAX_SAFE_INTEGER, timeZone: 'UTC' } } });
  const task = await create();
  const before = structuredClone(db.data);
  const result = await complete(task);
  assert.equal(result.status, 409);
  assert.deepEqual(db.data, before);
});
