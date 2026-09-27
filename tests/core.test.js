import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCoreRouter } from '../api/core.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const profile = (coins = 0) => ({ username: 'Alice', email: 'alice@example.test', coins, timeZone: 'UTC', character: { level: 1, exp: 90, image: 'apprenticemage', tier: 'common' } });
const task = (userId = 'alice') => ({ userId, title: 'Finish homework', difficulty: 'normal', isCompleted: false, createdAt: new Date() });
const reward = cost => ({ userId: 'alice', name: 'A relaxing break', cost, redeemed: false, createdAt: new Date() });

async function setup(t, initial = {}) {
  const db = new FakeFirestore({ 'users/alice': profile(), 'users/bob': profile(), ...initial });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { uid: req.get('x-test-user') || 'alice' }; next(); });
  app.use('/api', createCoreRouter({ db }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = 'GET', body, uid = 'alice' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': uid }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text, headers: response.headers };
  };
  return { db, request };
}

test('task CRUD validates input and isolates user records', async t => {
  const { db, request } = await setup(t, { 'todos/bobs-task': task('bob') });
  assert.equal((await request('/tasks/bobs-task', { method: 'PATCH', body: { title: 'Stolen task' } })).status, 404);
  assert.equal((await request('/tasks/bobs-task', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/tasks/bobs-task/complete', { method: 'POST', body: { uid: 'bob' } })).status, 404);
  assert.equal((await request('/tasks', { method: 'POST', body: { title: '' } })).status, 400);
  const created = await request('/tasks', { method: 'POST', body: { title: 'Study', category: 'School', priority: 'high', dueDate: '2026-12-01' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.task.dueDate, '2026-12-01T00:00:00.000Z');
  assert.equal((await request('/tasks')).body.tasks.length, 1);
  assert.equal((await request(`/tasks/${created.body.task.id}`, { method: 'PATCH', body: { isCompleted: true } })).status, 400);
  assert.equal((await request(`/tasks/${created.body.task.id}`, { method: 'PATCH', body: { title: 'Review notes' } })).body.task.title, 'Review notes');
  assert.equal((await request(`/tasks/${created.body.task.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(db.data.get('todos/bobs-task').title, 'Finish homework');
});

test('concurrent completion pays once, advances experience, and records one transaction', async t => {
  const { db, request } = await setup(t, { 'todos/math': task() });
  const results = await Promise.all(Array.from({ length: 4 }, () => request('/tasks/math/complete', { method: 'POST' })));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  assert.equal(db.data.get('users/alice').coins, 10);
  assert.equal(db.data.get('users/alice').streak, 1);
  assert.equal(db.data.get('users/alice').character.level, 2);
  assert.equal(db.data.get('users/alice').character.exp, 10);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 1);
});

test('reset legacy tasks cannot earn their reward again', async t => {
  const { db, request } = await setup(t, { 'todos/old': { ...task(), completedAt: new Date('2026-01-01') } });
  const result = await request('/tasks/old/complete', { method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.awarded, false);
  assert.equal(db.data.get('users/alice').coins, 0);
  assert.equal(db.data.get('todos/old').isCompleted, true);
});

test('simultaneous redemptions cannot overspend and failed transactions leave no partial changes', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile(40), 'rewards/first': reward(25), 'rewards/second': reward(25) });
  const results = await Promise.all(['first', 'second'].map(id => request(`/rewards/${id}/redeem`, { method: 'POST' })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.data.get('users/alice').coins, 15);
  assert.equal(['first', 'second'].filter(id => db.data.get(`rewards/${id}`).redeemed).length, 1);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 1);
  const redeemed = ['first', 'second'].find(id => db.data.get(`rewards/${id}`).redeemed);
  assert.equal((await request(`/rewards/${redeemed}/redeem`, { method: 'POST' })).status, 409);
  assert.equal((await request(`/rewards/${redeemed}`, { method: 'DELETE' })).status, 409);
});

test('reward endpoints reject another user and invalid prices', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile(40), 'rewards/foreign': { ...reward(10), userId: 'bob' } });
  for (const cost of [-50, 0, 1.5, '20']) assert.equal((await request('/rewards', { method: 'POST', body: { name: 'Free coins', cost } })).status, 400);
  assert.equal((await request('/rewards/foreign/redeem', { method: 'POST' })).status, 404);
  assert.equal((await request('/rewards/foreign', { method: 'PATCH', body: { cost: 1 } })).status, 404);
  assert.equal((await request('/rewards/foreign', { method: 'DELETE' })).status, 404);
  assert.equal(db.data.get('users/alice').coins, 40);
});

test('card purchases prevent duplicates and equipping keeps ownership of the starter', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile(100) });
  assert.equal((await request('/cards/basicarcher/equip', { method: 'POST' })).status, 403);
  assert.equal((await request('/cards/apprenticemage/purchase', { method: 'POST' })).status, 409);
  const bought = await Promise.all([1, 2].map(() => request('/cards/basicarcher/purchase', { method: 'POST' })));
  assert.deepEqual(bought.map(result => result.status).sort(), [201, 409]);
  assert.equal(db.data.get('users/alice').coins, 70);
  assert.equal((await request('/cards/basicarcher/equip', { method: 'POST' })).status, 200);
  let cards = (await request('/cards')).body.cards;
  assert.ok(cards.find(card => card.id === 'apprenticemage').owned);
  assert.ok(cards.find(card => card.id === 'basicarcher').equipped);
  assert.equal((await request('/cards/apprenticemage/equip', { method: 'POST' })).status, 200);
  cards = (await request('/cards')).body.cards;
  assert.ok(cards.find(card => card.id === 'basicarcher').owned);
});

test('card and reward spending share the same atomic coin balance', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile(40), 'rewards/break': reward(30) });
  const results = await Promise.all([
    request('/cards/basicarcher/purchase', { method: 'POST' }), request('/rewards/break/redeem', { method: 'POST' }),
  ]);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.equal(db.data.get('users/alice').coins, 10);
});

test('legacy collection aliases remain owned and changing character preserves an unrecorded custom card', async t => {
  const { db, request } = await setup(t, {
    'users/alice': { ...profile(100), character: { image: 'custom-sage', level: 3, exp: 30, tier: 'rare' } },
    'userCharacterCollection/legacy': { userId: 'alice', characterName: 'Basic Archer', price: 30 },
  });
  const cards = (await request('/cards')).body.cards;
  assert.ok(cards.find(card => card.id === 'basicarcher').owned);
  assert.equal((await request('/cards/basicarcher/purchase', { method: 'POST' })).status, 409);
  assert.equal((await request('/cards/basicarcher/equip', { method: 'POST' })).status, 200);
  assert.ok([...db.data.entries()].some(([path, value]) => path.startsWith('userCharacterCollection/') && value.characterName === 'custom-sage'));
  assert.equal(db.data.get('users/alice').character.level, 3);
  assert.equal(db.data.get('users/alice').character.exp, 30);
});

test('invalid legacy dates and nullable fields do not break lists or invent overdue tasks', async t => {
  const { request } = await setup(t, { 'todos/legacy': { ...task(), description: null, category: null, difficulty: 'unknown', dueDate: 'not a date' } });
  const list = await request('/tasks');
  assert.equal(list.status, 200);
  assert.equal(list.body.tasks[0].description, '');
  assert.equal(list.body.tasks[0].category, 'Personal');
  assert.equal(list.body.tasks[0].difficulty, 'easy');
  assert.equal(list.body.tasks[0].dueDate, null);
  const report = await request('/reports');
  assert.equal(report.status, 200);
  assert.equal(report.body.summary.overdueTasks, 0);
  const complete = await request('/tasks/legacy/complete', { method: 'POST' });
  assert.equal(complete.body.user.coins, 5);
});

test('reports and CSV retain history after deletion and escape formula injection', async t => {
  const { request } = await setup(t, { 'todos/formula': { ...task(), title: '=HYPERLINK("bad")' }, 'users/bob/transactions/private': { description: 'Private data', amount: 1000, type: 'task_completion' } });
  await request('/tasks/formula/complete', { method: 'POST' });
  await request('/tasks/formula', { method: 'DELETE' });
  const report = (await request('/reports')).body;
  assert.equal(report.summary.totalTasks, 0);
  assert.equal(report.summary.coinsEarned, 10);
  assert.equal(report.transactions.length, 1);
  assert.equal(report.daily.reduce((sum, day) => sum + day.completed, 0), 1);
  const csv = await request('/reports/export');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.body.includes("'=HYPERLINK"));
  assert.ok(!csv.body.includes('Private data'));
});
