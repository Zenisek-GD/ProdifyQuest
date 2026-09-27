import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCoreRouter } from '../api/core.js';
import { COMPANION_CONFIG } from '../api/companion-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const profile = () => ({ username: 'Alice', coins: 0, timeZone: 'UTC', character: { image: 'apprenticemage', level: 1, exp: 0 } });
const steps = () => [
  { id: 'objectives', title: 'Draft objectives', done: false },
  { id: 'introduction', title: 'Write the introduction', done: false },
];

async function setup(t) {
  const db = new FakeFirestore({ 'users/alice': profile(), 'users/bob': { ...profile(), username: 'Bob' } });
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
    return { status: response.status, body: await response.json() };
  };
  const createTask = async body => {
    const response = await request('/tasks', { method: 'POST', body: { title: 'Finish capstone', subtasks: steps(), size: 'large', ...body } });
    assert.equal(response.status, 201);
    return response.body.task;
  };
  return { db, request, createTask };
}

test('subtask validation rejects malformed lists, duplicate IDs and empty step titles', async t => {
  const { request } = await setup(t);
  const invalid = [
    'not a checklist', {}, [null], [{ title: 'Read', done: false }],
    [{ id: 'a', title: 'Read', done: 'false' }], [{ id: 'a/b', title: 'Read', done: false }],
    [{ id: 'a', title: ' ', done: false }], [{ id: 'a', title: 'x'.repeat(161), done: false }],
    [{ id: 'a', title: 'Read', done: false }, { id: 'a', title: 'Write', done: true }],
    Array.from({ length: 21 }, (_, index) => ({ id: `step-${index}`, title: 'Read', done: false })),
  ];
  for (const subtasks of invalid) {
    assert.equal((await request('/tasks', { method: 'POST', body: { title: 'Capstone', subtasks } })).status, 400);
  }
  assert.equal((await request('/tasks')).body.tasks.length, 0);
});

test('checklist editing is owned, persistent and never independently grants rewards', async t => {
  const { db, request, createTask } = await setup(t);
  const task = await createTask();
  const done = steps().map(step => ({ ...step, done: true }));
  assert.equal((await request(`/tasks/${task.id}`, { method: 'PATCH', uid: 'bob', body: { subtasks: done } })).status, 404);
  assert.deepEqual(db.data.get(`todos/${task.id}`).subtasks, steps());
  const edited = await request(`/tasks/${task.id}`, { method: 'PATCH', body: { subtasks: done } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.task.subtasks, done);
  assert.equal(edited.body.task.isCompleted, false);
  assert.deepEqual((await request('/tasks')).body.tasks[0].subtasks, done);
  assert.equal(db.data.get('users/alice').coins, 0);
  assert.equal(db.data.get('users/alice').companion, undefined);
  assert.equal([...db.data.keys()].filter(key => key.includes('/transactions/')).length, 0);
  const revised = [{ id: 'objectives', title: 'Revise objectives', done: false }];
  assert.deepEqual((await request(`/tasks/${task.id}`, { method: 'PATCH', body: { subtasks: revised } })).body.task.subtasks, revised);
  assert.equal(db.data.get('users/alice').coins, 0);
});

test('task completion preserves unfinished checklist steps and effort is independent of priority', async t => {
  const { db, request, createTask } = await setup(t);
  const task = await createTask({ size: 'small', priority: 'high', difficulty: 'normal' });
  assert.equal(task.size, 'small');
  assert.equal(task.priority, 'high');
  const result = await request(`/tasks/${task.id}/complete`, { method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.awarded, true);
  assert.equal(result.body.task.isCompleted, true);
  assert.deepEqual(result.body.task.subtasks, steps());
  assert.deepEqual(db.data.get(`todos/${task.id}`).subtasks, steps());
  assert.equal(db.data.get('users/alice').coins, 10);
});

test('completed task effort and difficulty are locked while checklist corrections remain editable', async t => {
  const { db, request, createTask } = await setup(t);
  const task = await createTask({ size: 'small', difficulty: 'easy' });
  assert.equal((await request(`/tasks/${task.id}/complete`, { method: 'POST' })).status, 200);
  for (const body of [{ size: 'large' }, { difficulty: 'hard' }]) {
    assert.equal((await request(`/tasks/${task.id}`, { method: 'PATCH', body })).status, 409);
  }
  assert.equal((await request(`/tasks/${task.id}`, { method: 'PATCH', body: { isCompleted: false } })).status, 400);
  const done = steps().map(step => ({ ...step, done: true }));
  const corrected = await request(`/tasks/${task.id}`, { method: 'PATCH', body: { size: 'small', difficulty: 'easy', subtasks: done } });
  assert.equal(corrected.status, 200);
  assert.deepEqual(corrected.body.task.subtasks, done);
  assert.equal(db.data.get(`todos/${task.id}`).size, 'small');
  assert.equal(db.data.get('users/alice').coins, 5);
});

test('simultaneous and repeated task completion grants companion progression and spell charge once', async t => {
  const { db, request, createTask } = await setup(t);
  const task = await createTask();
  const results = await Promise.all(Array.from({ length: 4 }, () => request(`/tasks/${task.id}/complete`, { method: 'POST' })));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  const user = db.data.get('users/alice');
  assert.equal(user.coins, 10);
  assert.equal(user.companion.xp, COMPANION_CONFIG.xpTask);
  assert.equal(user.companion.bond, COMPANION_CONFIG.bondTask);
  assert.equal(user.companion.spellCharge, 1);
  assert.equal([...db.data.keys()].filter(key => key.startsWith('users/alice/transactions/')).length, 1);
  await request(`/tasks/${task.id}`, { method: 'PATCH', body: { subtasks: steps().map(step => ({ ...step, done: true })) } });
  const retry = await request(`/tasks/${task.id}/complete`, { method: 'POST' });
  assert.equal(retry.body.awarded, false);
  assert.equal(db.data.get('users/alice').companion.xp, COMPANION_CONFIG.xpTask);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 1);
});
