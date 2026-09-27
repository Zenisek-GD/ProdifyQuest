import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { rateLimit } from '../api/auth.js';
import { FakeFirestore } from './fake-firestore.js';

async function fixture(t, overrides = {}) {
  const db = new FakeFirestore({ 'users/alice': { username: 'Alice', email: 'alice@example.com', coins: 0 } });
  const calls = [];
  const usersByEmail = new Map([['alice@example.com', 'alice']]);
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      calls.push({ action: 'verify', token, checkRevoked });
      if (token !== 'valid-test-token') throw new Error('sensitive verification detail');
      return { uid: 'alice' };
    },
    async createUser(value) {
      calls.push({ action: 'create', value });
      usersByEmail.set(value.email, 'new-user');
      return { uid: 'new-user' };
    },
    async deleteUser(uid) { calls.push({ action: 'delete', uid }); },
    async revokeRefreshTokens(uid) { calls.push({ action: 'revoke', uid }); },
  };
  const fetchImpl = async (url, options) => {
    calls.push({ action: 'fetch', url, options });
    const email = options.headers['Content-Type'] === 'application/json' ? JSON.parse(options.body).email : undefined;
    return { ok: true, async json() { return { localId: usersByEmail.get(email) || 'alice', idToken: 'valid-test-token', refreshToken: 'test-refresh-token', expiresIn: '3600' }; } };
  };
  const app = createApp({ auth, db, apiKey: 'test-key', fetchImpl, webDirectory: path.join(os.tmpdir(), 'prodifyquest-nonexistent-test-dist'), ...overrides });
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const content = await response.text();
    let result; try { result = JSON.parse(content); } catch { result = content; }
    return { status: response.status, headers: response.headers, body: result };
  };
  return { db, calls, request, auth };
}
const authorized = { Authorization: 'Bearer valid-test-token' };

test('every data route requires verified, revocation-checked bearer identity', async t => {
  const { request, calls } = await fixture(t);
  for (const route of ['/api/me?uid=alice', '/api/tasks', '/api/reports', '/api/cards', '/api/guilds']) {
    assert.equal((await request(route)).status, 401);
  }
  assert.equal((await request('/api/tasks', { method: 'POST', body: { uid: 'alice', title: 'Spoofed task' } })).status, 401);
  assert.equal((await request('/api/me', { headers: { Authorization: 'Bearer forged' } })).status, 401);
  const me = await request('/api/me?uid=someone-else', { headers: authorized });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, 'alice');
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.equal(calls.filter(call => call.action === 'verify').every(call => call.checkRevoked === true), true);
});

test('registration sets the role and starting balance on the server', async t => {
  const { request, db, calls } = await fixture(t);
  const response = await request('/api/auth/register', { method: 'POST', body: {
    username: ' New Adventurer ', email: 'NEW@example.com ', password: 'valid-password', timeZone: 'Asia/Taipei', role: 'admin', coins: 1000000,
  } });
  assert.equal(response.status, 201);
  assert.equal(response.body.uid, 'new-user');
  assert.equal(response.body.idToken, 'valid-test-token');
  const user = db.data.get('users/new-user');
  assert.equal(user.role, 'student');
  assert.equal(user.coins, 0);
  assert.equal(user.username, 'New Adventurer');
  assert.equal(user.timeZone, 'Asia/Taipei');
  assert.equal(user.character.image, 'apprenticemage');
  assert.equal('password' in user, false);
  assert.equal(calls.find(call => call.action === 'create').value.email, 'new@example.com');
});

test('registration service failures return 503 without creating profiles or exposing private details', async t => {
  for (const code of ['app/invalid-credential', 'auth/invalid-credential', 'auth/insufficient-permission']) {
    await t.test(code, async t => {
      const { request, auth, db, calls } = await fixture(t);
      const before = structuredClone(db.data);
      auth.createUser = async value => {
        calls.push({ action: 'create', value });
        throw Object.assign(new Error('private service-account key and OAuth token'), { code });
      };
      const collection = db.collection.bind(db);
      db.collection = name => { calls.push({ action: 'database' }); return collection(name); };

      const response = await request('/api/auth/register', { method: 'POST', body: {
        username: 'New Adventurer', email: 'new@example.com', password: 'valid-password',
      } });

      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { error: 'The account service is unavailable. Please try again shortly.' });
      assert.deepEqual(calls.map(call => call.action), ['create']);
      assert.deepEqual(db.data, before);
    });
  }
});

test('token verification service failures return 503 instead of expiring valid sessions', async t => {
  for (const code of ['app/invalid-credential', 'auth/invalid-credential', 'auth/insufficient-permission']) {
    await t.test(code, async t => {
      const { request, auth, db, calls } = await fixture(t);
      auth.verifyIdToken = async (token, checkRevoked) => {
        calls.push({ action: 'verify', token, checkRevoked });
        throw Object.assign(new Error('private signing credential and access token'), { code });
      };
      const collection = db.collection.bind(db);
      db.collection = name => { calls.push({ action: 'database' }); return collection(name); };

      const response = await request('/api/me', { headers: authorized });

      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { error: 'The account service is unavailable. Please try again shortly.' });
      assert.deepEqual(calls, [{ action: 'verify', token: 'valid-test-token', checkRevoked: true }]);
    });
  }
});

test('invalid registration does not create an account; failed profile creation rolls back Auth', async t => {
  const { request, calls } = await fixture(t);
  const valid = { username: 'Alice', email: 'alice@example.com', password: 'password123' };
  for (const body of [{ ...valid, username: '' }, { ...valid, password: '123' }, { ...valid, timeZone: 'Invalid/Zone' }, { ...valid, email: 'bad' }]) {
    assert.equal((await request('/api/auth/register', { method: 'POST', body })).status, 400);
  }
  assert.equal(calls.some(call => call.action === 'create'), false);
  const db = new FakeFirestore();
  const original = db.collection.bind(db);
  db.collection = name => {
    const collection = original(name);
    if (name === 'users') collection.doc = () => ({ set: async () => { throw new Error('private database detail'); } });
    return collection;
  };
  const rollback = await fixture(t, { db });
  const response = await rollback.request('/api/auth/register', { method: 'POST', body: valid });
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body).includes('private database detail'), false);
  assert.equal(rollback.calls.some(call => call.action === 'delete' && call.uid === 'new-user'), true);
});

test('refresh exchanges only with Firebase; logout requires authentication and revokes tokens', async t => {
  const { request, calls } = await fixture(t);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', body: {} })).status, 400);
  const result = await request('/api/auth/refresh', { method: 'POST', body: { refreshToken: 'old-token' } });
  assert.equal(result.status, 200);
  const exchange = calls.find(call => call.action === 'fetch');
  assert.match(exchange.url, /^https:\/\/securetoken.googleapis.com\/v1\/token\?key=test-key$/);
  assert.equal(new URLSearchParams(exchange.options.body).get('grant_type'), 'refresh_token');
  assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: authorized })).status, 200);
  assert.equal(calls.some(call => call.action === 'revoke' && call.uid === 'alice'), true);
});

test('password reset prevents account enumeration and missing setup is actionable', async t => {
  const failed = await fixture(t, { fetchImpl: async () => ({ ok: false, json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }) }) });
  const response = await failed.request('/api/auth/reset-password', { method: 'POST', body: { email: 'nobody@example.com' } });
  assert.equal(response.status, 200);
  assert.match(response.body.message, /If an account exists/);
  const missing = await fixture(t, { apiKey: '' });
  const setup = await missing.request('/api/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'password123' } });
  assert.equal(setup.status, 503);
  assert.match(setup.body.error, /FIREBASE_API_KEY/);
});

test('health, CORS, input shape, static cards and retired mutation paths are handled safely', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: [] })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST' })).status, 400);
  assert.equal((await request('/health', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await request('/health', { headers: { Origin: 'http://localhost:8081' } })).headers.get('access-control-allow-origin'), 'http://localhost:8081');
  for (const route of ['/tasks/complete', '/shop/purchase', '/profile/collection/add', '/admin/users/promote']) {
    assert.equal((await request(route, { method: 'POST', body: { uid: 'alice' } })).status, 410);
  }
  const card = await request('/characters/common/apprenticemage.png');
  assert.equal(card.status, 200);
  assert.match(card.headers.get('content-type'), /^image\/png/);
  assert.equal((await request('/api/missing', { headers: authorized })).status, 404);
});

test('exported web app supports direct navigation without exposing old mutations', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prodifyquest-web-'));
  // Only remove this specifically created and verified temp directory.
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>ProdifyQuest test</title>');
  const { request } = await fixture(t, { webDirectory: directory });
  for (const route of ['/home', '/guild', '/profile', '/auth/login', '/reports']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(response.body, /ProdifyQuest test/);
  }
  assert.equal((await request('/guild/create', { method: 'POST', body: { uid: 'alice' } })).status, 410);
});

test('rate limiter permits retries after its window and reports retry time', () => {
  let time = 0, allowed = 0, rejected = 0;
  const limiter = rateLimit({ limit: 2, windowMs: 1000, now: () => time });
  const response = { set(key, value) { assert.equal(key, 'Retry-After'); assert.equal(value, '1'); }, status(code) { assert.equal(code, 429); rejected++; return this; }, json() {} };
  for (let index = 0; index < 3; index++) limiter({ ip: 'local-test' }, response, () => allowed++);
  assert.equal(allowed, 2); assert.equal(rejected, 1);
  time = 1001;
  limiter({ ip: 'local-test' }, response, () => allowed++);
  assert.equal(allowed, 3);
});
