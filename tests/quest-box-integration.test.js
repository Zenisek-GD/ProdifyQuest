import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { FakeFirestore } from './fake-firestore.js';

async function fixture(t, roll = 0.1) {
  let at = new Date('2026-09-26T12:00:00Z');
  const db = new FakeFirestore({ 'users/alice': { username: 'Alice', coins: 0, character: { image: 'apprenticemage', level: 1, exp: 0 } }, 'users/bob': { coins: 0 } });
  const app = createApp({ db, auth: { verifyIdToken: async uid => ({ uid }) }, now: () => at, questBoxRandom: () => roll });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = async (path, method = 'GET', body, uid = 'alice') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const create = async (title = 'Study') => (await request('/tasks', 'POST', { title })).body.task;
  return { db, request, create, nextDay() { at = new Date(at.getTime() + 86400000); } };
}

test('real task completion grants one durable box and manual opening pays only once', async t => {
  const { db, request, create } = await fixture(t);
  const task = await create();
  const results = await Promise.all([request(`/tasks/${task.id}/complete`, 'POST'), request(`/tasks/${task.id}/complete`, 'POST')]);
  assert.equal(results.filter(result => result.body.awarded).length, 1);
  const box = results.find(result => result.body.awarded).body.questBox;
  assert.ok(box.id);
  assert.equal(db.data.get('users/alice').coins, 10);
  assert.equal(db.data.get('users/alice').questBoxProgress.dropsToday, 1);
  assert.equal((await request('/quest-boxes')).body.unopenedCount, 1);
  assert.equal((await request(`/quest-boxes/${box.id}/open`, 'POST', undefined, 'bob')).status, 404);
  await request(`/tasks/${task.id}`, 'DELETE');
  const opened = await request(`/quest-boxes/${box.id}/open`, 'POST');
  assert.equal(opened.body.awarded, true);
  assert.equal(opened.body.box.reward.coins, 11);
  assert.equal(db.data.get('users/alice').coins, 21);
  const retry = await request(`/quest-boxes/${box.id}/open`, 'POST');
  assert.equal(retry.body.awarded, false);
  assert.deepEqual(retry.body.box.reward, opened.body.box.reward);
  const report = (await request('/reports')).body;
  assert.equal(report.transactions.filter(entry => entry.type === 'box_reward').length, 1);
  assert.equal(report.summary.coinsEarned, 21);
});

test('first-task boxes respect the daily cap without reducing task awards and reset by UTC', async t => {
  const { db, request, create, nextDay } = await fixture(t);
  const tasks = await Promise.all(Array.from({ length: 7 }, (_, i) => create(`Work ${i}`)));
  const responses = await Promise.all(tasks.map(task => request(`/tasks/${task.id}/complete`, 'POST')));
  assert.equal(responses.filter(response => response.body.questBox).length, 3);
  assert.equal(db.data.get('users/alice').coins, 70);
  assert.equal((await request('/quest-boxes')).body.unopenedCount, 3);
  nextDay();
  const retry = await request(`/tasks/${tasks[0].id}/complete`, 'POST');
  assert.equal(retry.body.questBox, null);
  const next = await create('New day');
  assert.ok((await request(`/tasks/${next.id}/complete`, 'POST')).body.questBox);
  assert.equal((await request('/quest-boxes')).body.progress.dropsToday, 1);
});

test('the fifth eligible dry completion guarantees a box and subtask edits do not advance it', async t => {
  const { db, request, create, nextDay } = await fixture(t, 0.99);
  for (let i = 0; i < 4; i += 1) {
    const task = await create();
    assert.equal((await request(`/tasks/${task.id}/complete`, 'POST')).body.questBox, null);
  }
  nextDay();
  const task = await create();
  await request(`/tasks/${task.id}`, 'PATCH', { subtasks: [{ id: 'step', title: 'Read notes', done: true }] });
  assert.equal(db.data.get('users/alice').questBoxProgress.misses, 4);
  const result = await request(`/tasks/${task.id}/complete`, 'POST', { roll: 0.99, coins: 99999 });
  assert.ok(result.body.questBox);
  assert.equal(result.body.questBoxProgress.misses, 0);
  assert.equal(db.data.get('users/alice').coins, 50);
});
