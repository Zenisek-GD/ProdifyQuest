/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../scripts/companion-store.ts');
const moduleSource = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(moduleSource, {
  module: loaded, exports: loaded.exports, Date, Error, Promise, Set,
}, { filename });
const { createCompanionStore, focusRemaining } = loaded.exports;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const focus = (id = 'study-1', status = 'running', remainingSeconds = 300) => ({
  id, status, durationSeconds: 300, remainingSeconds,
});
const response = (session = null, companion = {}) => ({ data: {
  companion: {
    nickname: 'Lumen', xp: 10,
    activeFocusId: session && ['running', 'paused'].includes(session.status) ? session.id : null,
    ...companion,
  },
  focus: session, serverTime: '2026-09-26T01:00:00.000Z',
  config: { xpTask: 10, bondTask: 5, xpFocus: 20, bondFocus: 10 },
} });

function fixture(t) {
  let time = 10000;
  let current = true;
  const reads = [];
  const writes = [];
  const store = createCompanionStore({
    read() { const request = deferred(); reads.push(request); return request.promise; },
    write(route, body, method) {
      const request = { ...deferred(), route, body, method };
      writes.push(request);
      return request.promise;
    },
    isCurrent: () => current, message: error => error.message, now: () => time,
  });
  t.after(() => {
    store.stop();
    assert.equal(reads.length, 0, 'All local read requests should be inspected');
    assert.equal(writes.length, 0, 'All local write requests should be inspected');
  });
  return {
    store, reads, writes,
    remaining: () => focusRemaining(store.getSnapshot(), time),
    advance(milliseconds) { time += milliseconds; },
    changeAccount() { current = false; },
    async load(data = response()) {
      const pending = store.reload();
      reads.shift().resolve(data);
      await pending;
    },
  };
}

test('confirmed local focus actions publish immediately while unconfirmed actions keep their previous pose', async t => {
  const { store, writes, load, advance, remaining } = fixture(t);
  await load();
  const notifications = [];
  const unsubscribe = store.subscribe(() => notifications.push(store.getSnapshot().data.focus?.status));
  const start = store.mutate('/focus', { minutes: 5 });
  assert.equal(store.getSnapshot().data.focus, null, 'Starting does not invent a session before the server confirms it');
  const startRequest = writes.shift();
  assert.equal(startRequest.route, '/focus');
  assert.equal(startRequest.method, 'POST');
  assert.deepEqual(startRequest.body, { minutes: 5 });
  startRequest.resolve(response(focus()));
  await start;
  assert.equal(store.getSnapshot().data.focus.status, 'running');
  assert.equal(remaining(), 300);
  advance(1500);
  assert.equal(remaining(), 299, 'The shared countdown advances between server responses');

  const pause = store.mutate('/focus/study-1/pause');
  assert.equal(store.getSnapshot().data.focus.status, 'running');
  writes.shift().resolve(response(focus('study-1', 'paused', 298)));
  await pause;
  advance(30000);
  assert.equal(remaining(), 298, 'Paused time never counts against the remaining duration');
  const resume = store.mutate('/focus/study-1/resume');
  writes.shift().resolve(response(focus('study-1', 'running', 298)));
  await resume;
  advance(2000);
  assert.equal(remaining(), 296);

  const cancel = store.mutate('/focus/study-1/cancel');
  assert.equal(store.getSnapshot().data.focus.status, 'running');
  writes.shift().resolve(response(focus('study-1', 'cancelled', 296)));
  await cancel;
  assert.equal(remaining(), 0);
  assert.equal(store.getSnapshot().data.companion.activeFocusId, null);
  assert.deepEqual(notifications, ['running', 'paused', 'running', 'cancelled']);
  unsubscribe();
});

test('timer expiry is display-only and completion requires a separate confirmed response', async t => {
  const { store, writes, load, advance, remaining } = fixture(t);
  await load(response(focus('study-1', 'running', 2)));
  advance(9000);
  assert.equal(remaining(), 0);
  assert.equal(store.getSnapshot().data.focus.status, 'running');
  assert.equal(store.getSnapshot().data.companion.xp, 10);
  const complete = store.mutate('/focus/study-1/complete');
  assert.equal(store.getSnapshot().data.companion.xp, 10);
  writes.shift().resolve(response(focus('study-1', 'completed', 0), { xp: 30 }));
  await complete;
  assert.equal(remaining(), 0);
  assert.equal(store.getSnapshot().data.companion.xp, 30);
  assert.equal(store.getSnapshot().data.focus.status, 'completed');
});

test('nickname and cosmetic responses preserve the running focus clock when their focus field is omitted', async t => {
  const { store, writes, load, advance, remaining } = fixture(t);
  await load(response(focus()));
  const receivedAt = store.getSnapshot().focusReceivedAt;
  advance(10000);
  const rename = store.mutate('/companion', { nickname: 'Nova' }, 'PATCH');
  const renameRequest = writes.shift();
  assert.equal(renameRequest.method, 'PATCH');
  const updated = response(focus(), { nickname: 'Nova', equipped: { outfit: 'sunrise-robe' } });
  delete updated.data.focus;
  renameRequest.resolve(updated);
  await rename;
  assert.equal(store.getSnapshot().data.companion.nickname, 'Nova');
  assert.equal(store.getSnapshot().data.companion.equipped.outfit, 'sunrise-robe');
  assert.equal(store.getSnapshot().data.focus.id, 'study-1');
  assert.equal(store.getSnapshot().focusReceivedAt, receivedAt);
  assert.equal(remaining(), 290, 'Updating the companion appearance cannot restart the countdown');
  advance(3000);
  assert.equal(remaining(), 287);
});

test('a stale poll cannot undo a confirmed pause even when it resolves after that mutation', async t => {
  const { store, reads, writes, load } = fixture(t);
  await load(response(focus()));
  const poll = store.reload();
  const staleRead = reads.shift();
  const pause = store.mutate('/focus/study-1/pause');
  writes.shift().resolve(response(focus('study-1', 'paused', 270)));
  await pause;
  const confirmed = store.getSnapshot();
  staleRead.resolve(response(focus('study-1', 'running', 290)));
  await poll;
  assert.equal(store.getSnapshot(), confirmed);
  assert.equal(store.getSnapshot().data.focus.status, 'paused');
});

test('refresh invalidates older reads while repeated polling shares the in-flight request', async t => {
  const { store, reads, load } = fixture(t);
  await load(response(focus()));
  const oldPoll = store.reload();
  const oldRead = reads.shift();
  assert.equal(store.reload(), oldPoll, 'Independent screen polling does not duplicate a request');
  const refreshed = store.refresh();
  const newRead = reads.shift();
  assert.notEqual(oldPoll, refreshed);
  newRead.resolve(response(focus('study-1', 'paused', 250)));
  await refreshed;
  oldRead.resolve(response(focus('study-1', 'running', 280)));
  await oldPoll;
  assert.equal(store.getSnapshot().data.focus.status, 'paused');
  assert.equal(store.getSnapshot().data.focus.remainingSeconds, 250);
});

test('profile or route refreshes during a write do not discard its confirmed focus state', async t => {
  const { store, reads, writes, load } = fixture(t);
  await load(response(focus()));
  const pause = store.mutate('/focus/study-1/pause');
  await store.refresh();
  await store.refresh();
  await store.reload();
  assert.equal(reads.length, 0, 'The active mutation supplies the next authoritative state');
  const competing = store.mutate('/focus/study-1/cancel');
  await assert.rejects(competing, /wait for your companion/);
  assert.equal(writes.length, 1, 'Concurrent controls cannot issue competing mutations');
  writes.shift().resolve(response(focus('study-1', 'paused', 270)));
  await pause;
  assert.equal(store.getSnapshot().data.focus.status, 'paused');
});

test('a failed mutation retains the last confirmation until its reconciliation read succeeds', async t => {
  const { store, reads, writes, load, advance, remaining } = fixture(t);
  await load(response(focus()));
  advance(10000);
  const previous = store.getSnapshot();
  const pause = store.mutate('/focus/study-1/pause');
  const failed = assert.rejects(pause, /connection lost/);
  writes.shift().reject(new Error('connection lost'));
  await failed;
  assert.equal(store.getSnapshot(), previous, 'A rejected pause cannot invent a paused pose');
  assert.equal(remaining(), 290);
  assert.equal(reads.length, 1, 'An ambiguous timeout schedules a read of the saved server state');
  const reconciliation = store.reload();
  reads.shift().resolve(response(focus('study-1', 'paused', 289)));
  await reconciliation;
  assert.equal(store.getSnapshot().data.focus.status, 'paused', 'A server commit followed by a lost response is recovered');
  assert.equal(remaining(), 289);
});

test('a failed reconciliation preserves the confirmed timer and a later poll recovers', async t => {
  const { store, reads, writes, load, advance, remaining } = fixture(t);
  await load(response(focus()));
  const cancel = store.mutate('/focus/study-1/cancel');
  const failed = assert.rejects(cancel, /offline/);
  writes.shift().reject(new Error('offline'));
  await failed;
  const reconciliation = store.reload();
  reads.shift().reject(new Error('Still offline'));
  await reconciliation;
  assert.equal(store.getSnapshot().error, 'Still offline');
  advance(5000);
  assert.equal(remaining(), 295);
  const recovered = store.reload();
  reads.shift().resolve(response(null));
  await recovered;
  assert.equal(store.getSnapshot().error, '');
  assert.equal(store.getSnapshot().data.focus, null);
  assert.equal(remaining(), 0);
});

test('retrying an old terminal focus response cannot replace a newer active focus or restart its clock', async t => {
  const { store, reads, writes, load, advance, remaining } = fixture(t);
  await load(response(focus('new-session', 'running', 240)));
  const receivedAt = store.getSnapshot().focusReceivedAt;
  advance(10000);
  const completeOld = store.mutate('/focus/old-session/complete');
  writes.shift().resolve(response(focus('old-session', 'completed', 0), { activeFocusId: 'new-session', xp: 30 }));
  await completeOld;
  assert.equal(store.getSnapshot().data.focus.id, 'new-session');
  assert.equal(store.getSnapshot().data.focus.status, 'running');
  assert.equal(store.getSnapshot().focusReceivedAt, receivedAt);
  assert.equal(remaining(), 230);
  assert.equal(store.getSnapshot().data.companion.xp, 30);
  assert.equal(reads.length, 1, 'A mismatched historical response triggers an authoritative reread');
  const refreshed = store.reload();
  reads.shift().resolve(response(focus('new-session', 'running', 229), { xp: 30 }));
  await refreshed;
  assert.equal(remaining(), 229);
});

test('an unknown newer session is fetched rather than displaying an unrelated terminal result', async t => {
  const { store, reads, writes, load } = fixture(t);
  await load(response(focus('old-session', 'paused', 100)));
  const cancelled = store.mutate('/focus/old-session/cancel');
  writes.shift().resolve(response(focus('old-session', 'cancelled', 100), { activeFocusId: 'another-device-session' }));
  await cancelled;
  assert.equal(store.getSnapshot().data.focus, null);
  assert.equal(store.getSnapshot().data.companion.activeFocusId, 'another-device-session');
  const refreshed = store.reload();
  reads.shift().resolve(response(focus('another-device-session', 'running', 295)));
  await refreshed;
  assert.equal(store.getSnapshot().data.focus.id, 'another-device-session');
  assert.equal(store.getSnapshot().data.focus.status, 'running');
});

test('a disposed store ignores pending reads and rejects pending mutations without notifying subscribers', async t => {
  const { store, reads, writes, load } = fixture(t);
  await load(response(focus()));
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });
  const oldRead = store.reload();
  const request = reads.shift();
  const oldMutation = store.mutate('/focus/study-1/pause');
  const rejected = assert.rejects(oldMutation, /session changed/);
  const mutation = writes.shift();
  const confirmed = store.getSnapshot();
  store.stop();
  request.resolve(response(focus('study-1', 'paused', 290)));
  mutation.resolve(response(focus('study-1', 'paused', 289)));
  await Promise.all([oldRead, rejected]);
  assert.equal(store.getSnapshot(), confirmed);
  assert.equal(notifications, 0);
  await store.reload();
  await store.refresh();
  await assert.rejects(store.mutate('/focus'), /session changed/);
  unsubscribe();
});

test('responses from an old account generation cannot publish or trigger additional reads', async t => {
  const { store, reads, writes, load, changeAccount } = fixture(t);
  await load(response(focus()));
  const stalePoll = store.reload();
  const staleRead = reads.shift();
  const mutation = store.mutate('/focus/study-1/cancel');
  const rejected = assert.rejects(mutation, /session changed/);
  const pendingWrite = writes.shift();
  const previous = store.getSnapshot();
  changeAccount();
  staleRead.resolve(response(focus('study-1', 'paused', 290)));
  pendingWrite.resolve(response(focus('study-1', 'cancelled', 290)));
  await Promise.all([stalePoll, rejected]);
  assert.equal(store.getSnapshot(), previous);
  await store.reload();
  await store.refresh();
  await assert.rejects(store.mutate('/focus'), /session changed/);
  assert.equal(reads.length, 0);
  assert.equal(writes.length, 0);
});

test('restarting a store cannot admit a mutation from its disposed lifecycle', async t => {
  const { store, reads, writes, load } = fixture(t);
  await load(response(focus()));
  const mutation = store.mutate('/focus/study-1/pause');
  const rejected = assert.rejects(mutation, /session changed/);
  const oldWrite = writes.shift();
  const previous = store.getSnapshot();
  store.stop();
  store.start();
  oldWrite.resolve(response(focus('study-1', 'paused', 290)));
  await rejected;
  assert.equal(store.getSnapshot(), previous, 'A response started before disposal must not publish after a new start');
  // Reconciliation may still discover that the old request committed on the
  // server, but only a read from the current lifecycle may confirm that state.
  const reconciliation = store.reload();
  reads.shift().resolve(response(focus('study-1', 'paused', 289)));
  await reconciliation;
  assert.equal(store.getSnapshot().data.focus.status, 'paused');
  assert.equal(store.getSnapshot().data.focus.remainingSeconds, 289);
});
