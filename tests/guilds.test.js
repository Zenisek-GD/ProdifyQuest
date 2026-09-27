import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGuildRouter } from '../api/guilds.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

async function fixture(t, extra = {}) {
  const db = new FakeFirestore({
    'users/alice': { username: 'Alice' },
    'users/bob': { username: 'Bob' },
    'users/charlie': { username: 'Charlie' },
    ...extra,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get('x-test-user');
    if (uid) req.auth = { uid };
    next();
  });
  app.use('/api', createGuildRouter({ db }));
  app.use(errorHandler);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const request = async (path, { user = 'alice', method = 'GET', body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['x-test-user'] = user;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, request };
}

const guild = (overrides = {}) => ({
  name: 'Study Group', description: '', members: ['alice'], createdBy: 'alice',
  inviteCode: 'STUDY12', createdAt: new Date('2026-09-25T08:00:00Z'), ...overrides,
});

test('guild creation validates input, fixes ownership to the verified user, and lists only memberships', async t => {
  const { db, request } = await fixture(t, { 'guilds/private': guild({ members: ['bob'], createdBy: 'bob' }) });
  assert.equal((await request('/guilds', { user: null })).status, 401);
  for (const body of [{ name: '' }, { name: 'x'.repeat(81) }, { name: 'Study', description: 'x'.repeat(501) }, { name: 4 }]) {
    assert.equal((await request('/guilds', { method: 'POST', body })).status, 400);
  }
  const created = await request('/guilds', { method: 'POST', body: { name: '  Math  ', description: '  Exam prep  ', createdBy: 'bob', members: ['bob'] } });
  assert.equal(created.status, 201);
  assert.equal(created.body.guild.name, 'Math');
  assert.equal(created.body.guild.description, 'Exam prep');
  assert.equal(created.body.guild.createdBy, 'alice');
  assert.match(created.body.guild.inviteCode, /^[A-F0-9]{24}$/);
  assert.deepEqual(db.data.get(`guilds/${created.body.guild.id}`).members, ['alice']);
  assert.deepEqual((await request('/guilds')).body.guilds.map(entry => entry.id), [created.body.guild.id]);
});

test('invite joining accepts lower case, is idempotent, and enforces the member limit', async t => {
  const fullMembers = Array.from({ length: 100 }, (_, index) => `member-${index}`);
  const { db, request } = await fixture(t, {
    'guilds/study': guild(), 'guilds/full': guild({ members: fullMembers, inviteCode: 'FULL123' }),
  });
  const join = () => request('/guilds/join', { user: 'bob', method: 'POST', body: { code: '  study12 ' } });
  const replies = await Promise.all([join(), join()]);
  assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
  assert.deepEqual(db.data.get('guilds/study').members, ['alice', 'bob']);
  assert.equal((await request('/guilds/join', { method: 'POST', body: { code: 'FULL123' } })).status, 409);
  assert.equal(db.data.get('guilds/full').members.length, 100);
  assert.equal((await request('/guilds/join', { method: 'POST', body: { code: 'MISSING' } })).status, 404);
  assert.equal((await request('/guilds/join', { method: 'POST', body: { code: '../x' } })).status, 400);
});

test('chat rejects outsiders and blank or oversized messages, and ignores forged author details', async t => {
  const { db, request } = await fixture(t, { 'guilds/study': guild() });
  assert.equal((await request('/guilds/study/messages', { user: 'bob' })).status, 403);
  assert.equal((await request('/guilds/study/messages', { user: 'bob', method: 'POST', body: { text: 'Hello' } })).status, 403);
  for (const text of [' ', 'x'.repeat(2001), null]) {
    assert.equal((await request('/guilds/study/messages', { method: 'POST', body: { text } })).status, 400);
  }
  const sent = await request('/guilds/study/messages', {
    method: 'POST', body: { text: '  Hello  ', senderId: 'bob', senderName: 'Bob', createdAt: '1999-01-01' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.senderId, 'alice');
  assert.equal(sent.body.message.senderName, 'Alice');
  assert.equal(sent.body.message.text, 'Hello');
  assert.ok(new Date(sent.body.message.createdAt).getFullYear() >= 2026);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('guildChats/study/messages/')).length, 1);
  const chat = await request('/guilds/study/messages');
  assert.deepEqual(chat.body.members, [{ id: 'alice', username: 'Alice' }]);
  assert.deepEqual(chat.body.messages, [sent.body.message]);
});

test('chat returns the latest 100 messages in ascending order and reads legacy author IDs', async t => {
  const initial = { 'guilds/study': guild() };
  for (let index = 0; index < 105; index += 1) {
    initial[`guildChats/study/messages/message-${index}`] = {
      authorId: 'alice', text: `Message ${index}`, createdAt: new Date(Date.UTC(2026, 8, 25, 8, 0, index)),
    };
  }
  const { request } = await fixture(t, initial);
  const { body, status } = await request('/guilds/study/messages');
  assert.equal(status, 200);
  assert.equal(body.messages.length, 100);
  assert.equal(body.messages[0].text, 'Message 5');
  assert.equal(body.messages.at(-1).text, 'Message 104');
  assert.equal(body.messages[0].senderId, 'alice');
  assert.equal(body.messages[0].senderName, 'Alice');
});

test('leaving transfers ownership deterministically and deletes the last-member guild', async t => {
  const { db, request } = await fixture(t, { 'guilds/study': guild({ members: ['alice', 'charlie', 'bob'] }) });
  assert.equal((await request('/guilds/study/leave', { method: 'POST' })).status, 200);
  assert.equal(db.data.get('guilds/study').createdBy, 'bob');
  assert.equal((await request('/guilds/study/messages')).status, 403);
  assert.equal((await request('/guilds/study/messages', { method: 'POST', body: { text: 'No longer a member' } })).status, 403);
  assert.equal((await request('/guilds/study/leave', { user: 'bob', method: 'POST' })).status, 200);
  assert.equal(db.data.get('guilds/study').createdBy, 'charlie');
  assert.equal((await request('/guilds/study/leave', { user: 'charlie', method: 'POST' })).status, 200);
  assert.equal(db.data.has('guilds/study'), false);
  assert.equal((await request('/guilds/study/messages', { user: 'charlie' })).status, 404);
});

test('concurrent joins cannot overfill the final guild membership slot', async t => {
  const members = ['alice', ...Array.from({ length: 98 }, (_, index) => `member-${index}`)];
  const { db, request } = await fixture(t, { 'guilds/study': guild({ members }) });
  const replies = await Promise.all(['bob', 'charlie'].map(user =>
    request('/guilds/join', { user, method: 'POST', body: { code: 'STUDY12' } })));
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  assert.equal(db.data.get('guilds/study').members.length, 100);
});

test('fake Firestore rolls back failed writes and rejects reads after writes', async () => {
  const db = new FakeFirestore({ 'users/alice': { coins: 4, character: { level: 1 } } });
  const ref = db.doc('users/alice');
  await assert.rejects(db.runTransaction(async transaction => {
    transaction.update(ref, { coins: 0 });
    await transaction.get(ref);
  }), /reads before writes/);
  assert.equal((await ref.get()).data().coins, 4);
  await ref.update({ 'character.level': 2 });
  assert.equal((await ref.get()).data().character.level, 2);
});
