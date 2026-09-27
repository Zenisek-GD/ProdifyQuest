import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCompanionRouter } from '../api/companions.js';
import { awardCompanion, companionView, COMPANION_CONFIG, COMPANION_MILESTONES } from '../api/companion-domain.js';
import { errorHandler } from '../api/shared.js';
import { FakeFirestore } from './fake-firestore.js';

const profile = (companion = {}, coins = 100) => ({
  username: 'Alice', coins, character: { image: 'apprenticemage', level: 1, exp: 0 }, companion,
});

async function setup(t, initial = {}, config) {
  let instant = new Date('2026-09-26T10:00:00Z');
  const db = new FakeFirestore({ 'users/alice': profile(), 'users/bob': profile(), ...initial });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { uid: req.get('x-test-user') || 'alice' }; next(); });
  app.use('/api', createCompanionRouter({ db, now: () => new Date(instant), config }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = 'GET', body, uid = 'alice' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': uid }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, request, advance: milliseconds => { instant = new Date(instant.getTime() + milliseconds); } };
}

test('companion progression is immutable, preserves ownership and gains mage charge at most three', () => {
  const user = profile({ xp: 95, bond: 15, spellCharge: 2, ownedCosmetics: ['dragon-scholar'] });
  const before = structuredClone(user);
  const companion = awardCompanion(user, { xp: COMPANION_CONFIG.xpTask, bond: COMPANION_CONFIG.bondTask, chargeTask: true });
  assert.deepEqual(user, before);
  assert.equal(companion.spellCharge, 3);
  assert.ok(companion.ownedCosmetics.includes('dragon-scholar'));
  assert.ok(companion.ownedCosmetics.includes('scholar-pin'));
  const view = companionView({ ...user, companion });
  assert.equal(view.level, 2);
  assert.equal(view.xpIntoLevel, 5);
  assert.equal(view.xpToNextLevel, 95);
  assert.equal(view.stage, 'scholar');
  assert.equal(view.nextUnlock.remainingBond, 30);
  assert.match(view.dialogue, /task is done/);
  assert.equal(awardCompanion({ ...user, companion }, { chargeTask: true }).spellCharge, 3);
  assert.equal(awardCompanion({ ...user, character: { image: 'basicarcher' } }, { chargeTask: true }).spellCharge, 2);
});

test('companion health defaults to full, is bounded, and does not fall with absence or task progress', () => {
  for (const saved of [undefined, null, {}, { health: -1 }, { health: '50' }, { health: Number.NaN }]) {
    assert.equal(companionView(profile(saved)).health, 100);
  }
  assert.equal(companionView(profile({ health: 1000 })).health, 100);
  assert.equal(companionView(profile({ health: 0 })).health, 0);
  const user = profile({ health: 80, lastVisitAt: new Date('2025-01-01') });
  const afterAbsence = companionView(user, new Date('2027-01-01'));
  assert.equal(afterAbsence.health, 80);
  assert.equal(afterAbsence.maxHealth, 100);
  assert.equal(awardCompanion(user, { xp: 10, bond: 5, chargeTask: true }).health, 80);
});

test('companion health is not caller-editable and survives nickname changes', async t => {
  const { request } = await setup(t, { 'users/alice': profile({ health: 80 }) });
  assert.equal((await request('/companion', { method: 'PATCH', body: { nickname: 'Nova', health: 100 } })).status, 400);
  const renamed = await request('/companion', { method: 'PATCH', body: { nickname: 'Nova' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.companion.health, 80);
  assert.equal(renamed.body.companion.maxHealth, 100);
});

test('bond milestones unlock evolving appearances without reducing progress after absence', () => {
  const user = profile({ xp: 500, bond: 100, lastVisitAt: new Date('2025-01-01') });
  const view = companionView(user, new Date('2026-09-26'));
  assert.equal(view.stage, 'archmage');
  assert.equal(view.nextUnlock, null);
  assert.equal(view.bond, 100);
  assert.deepEqual(view.unlockedActions, ['wave', 'celebrate', 'cast']);
  for (const id of ['scholar-pin', 'celestial-robe', 'astral-library']) assert.ok(view.cosmetics.find(item => item.id === id).owned);
  assert.match(view.greeting, /Welcome back/);
  assert.equal(view.cosmetics.find(item => item.id === 'dragon-scholar').unlocked, false);
});

test('presentation capabilities follow the configured stage milestones', () => {
  const stages = ['apprentice', 'scholar', 'sage', 'archmage'];
  for (let index = 0; index < COMPANION_MILESTONES.length; index += 1) {
    const milestone = COMPANION_MILESTONES[index];
    const before = companionView(profile({ bond: milestone.bond - 1 }));
    const unlocked = companionView(profile({ bond: milestone.bond }));
    assert.equal(before.stage, stages[index]);
    assert.equal(unlocked.stage, milestone.stage);
    assert.equal(unlocked.capabilities.highFive, true);
    assert.equal(unlocked.capabilities.cast, index >= 1);
    assert.equal(unlocked.capabilities.share, index >= 1);
    assert.equal(unlocked.capabilities.evolved, index >= 1);
    assert.equal(unlocked.capabilities.archmage, index === 2);
    assert.equal(unlocked.unlockedActions.includes('cast'), unlocked.capabilities.cast);
  }
  assert.deepEqual(companionView(profile()).capabilities, { highFive: false, cast: false, share: false, evolved: false, archmage: false });
});

test('legacy companions have safe defaults and nickname editing cannot grant progression', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile(null) });
  const initial = await request('/companion');
  assert.equal(initial.body.companion.nickname, 'Apprentice Mage');
  assert.equal(initial.body.focus, null);
  assert.equal(initial.body.serverTime, '2026-09-26T10:00:00.000Z');
  assert.equal((await request('/companion', { method: 'PATCH', body: { nickname: '   ' } })).status, 400);
  assert.equal((await request('/companion', { method: 'PATCH', body: { nickname: 'Nova', xp: 100 } })).status, 400);
  const edited = await request('/companion', { method: 'PATCH', body: { nickname: ' Nova ' } });
  assert.equal(edited.body.companion.nickname, 'Nova');
  assert.equal(db.data.get('users/alice').companion.xp, 0);
  assert.equal(db.data.get('users/bob').companion.nickname, undefined);
});

test('visits retain bond and save a warm welcome before updating the visit timestamp', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile({ bond: 50, lastVisitAt: new Date('2026-01-01') }) });
  const visit = await request('/companion/visit', { method: 'POST' });
  assert.match(visit.body.greeting, /Welcome back/);
  assert.equal(visit.body.companion.bond, 50);
  assert.equal(db.data.get('users/alice').companion.lastVisitAt.toISOString(), '2026-09-26T10:00:00.000Z');
  const revisit = await request('/companion/visit', { method: 'POST' });
  assert.match(revisit.body.greeting, /Good to see you/);
});

test('simultaneous cosmetic purchases debit only once and must be owned before equipping', async t => {
  const { db, request } = await setup(t);
  assert.equal((await request('/companion/cosmetics/sunrise-robe/equip', { method: 'POST' })).status, 403);
  const results = await Promise.all(Array.from({ length: 4 }, () => request('/companion/cosmetics/sunrise-robe/purchase', { method: 'POST' })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409, 409]);
  assert.equal(db.data.get('users/alice').coins, 65);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/transactions/')).length, 1);
  assert.equal(db.data.get('users/alice/transactions/cosmetic_sunrise-robe').amount, -35);
  const equipped = await request('/companion/cosmetics/sunrise-robe/equip', { method: 'POST' });
  assert.equal(equipped.body.companion.equipped.outfit, 'sunrise-robe');
  assert.equal(db.data.get('users/alice').companion.equipped.outfit, 'sunrise-robe');
  assert.equal((await request('/companion/cosmetics/sunrise-robe/equip', { method: 'POST' })).body.coins, 65);
});

test('cosmetics enforce balance, bond, raid rewards and account isolation', async t => {
  const { db, request } = await setup(t, { 'users/alice': profile({}, 25) });
  assert.equal((await request('/companion/cosmetics/moonlit-room/purchase', { method: 'POST' })).status, 403);
  assert.equal((await request('/companion/cosmetics/dragon-scholar/purchase', { method: 'POST' })).status, 403);
  assert.equal((await request('/companion/cosmetics/dragon-scholar/equip', { method: 'POST' })).status, 403);
  assert.equal((await request('/companion/cosmetics/sunrise-robe/purchase', { method: 'POST' })).status, 409);
  assert.equal((await request('/companion/cosmetics/unknown/purchase', { method: 'POST' })).status, 404);
  assert.equal(db.data.get('users/alice').coins, 25);
  assert.equal((await request('/companion/cosmetics/forest-charm/purchase', { method: 'POST' })).status, 201);
  assert.equal(db.data.get('users/alice').coins, 0);
  assert.equal((await request('/companion/cosmetics/forest-charm/equip', { method: 'POST', uid: 'bob' })).status, 403);
  db.seed('users/alice', profile({ bond: 20 }, 50));
  assert.equal((await request('/companion/cosmetics/moonlit-room/purchase', { method: 'POST' })).status, 201);
  assert.equal((await request('/companion/cosmetics/scholar-pin/equip', { method: 'POST' })).status, 200);
  assert.equal(db.data.get('users/alice').coins, 0);
});

test('concurrent focus starts create a single active session and reject invalid durations', async t => {
  const { db, request } = await setup(t);
  for (const minutes of [0, 1, -5, '5', 5.5, 100000]) assert.equal((await request('/focus', { method: 'POST', body: { minutes } })).status, 400);
  const results = await Promise.all(Array.from({ length: 3 }, () => request('/focus', { method: 'POST', body: { minutes: 5 } })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409]);
  const started = results.find(result => result.status === 201).body.focus;
  assert.equal(started.durationSeconds, 300);
  assert.equal(started.remainingSeconds, 300);
  assert.equal(started.status, 'running');
  assert.equal(db.data.get('users/alice').companion.activeFocusId, started.id);
  assert.equal((await request('/companion')).body.focus.id, started.id);
  assert.equal([...db.data.keys()].filter(path => path.startsWith('users/alice/focusSessions/')).length, 1);
});

test('configured focus choices and default are advertised and accepted consistently', async t => {
  const { request } = await setup(t, {}, { focusMinutes: [10, 30], focusDefaultMinutes: 30 });
  const advertised = (await request('/companion')).body.config;
  assert.deepEqual(advertised.focusMinutes, [10, 30]);
  assert.equal(advertised.focusDefaultMinutes, 30);
  assert.equal((await request('/focus', { method: 'POST', body: { minutes: 25 } })).status, 400);
  const started = await request('/focus', { method: 'POST' });
  assert.equal(started.status, 201);
  assert.equal(started.body.focus.durationSeconds, 1800);
  assert.equal((await request(`/focus/${started.body.focus.id}/cancel`, { method: 'POST' })).status, 200);
  const selected = await request('/focus', { method: 'POST', body: { minutes: 10 } });
  assert.equal(selected.body.focus.durationSeconds, 600);
});

test('removing the usual focus default falls back to an allowed duration', async t => {
  const { request } = await setup(t, {}, { focusMinutes: [10, 30] });
  assert.equal((await request('/companion')).body.config.focusDefaultMinutes, 10);
  const started = await request('/focus', { method: 'POST' });
  assert.equal(started.status, 201);
  assert.equal(started.body.focus.durationSeconds, 600);
  assert.throws(() => createCompanionRouter({ db: new FakeFirestore(), config: { focusMinutes: [] } }), /Focus durations/);
  assert.throws(() => createCompanionRouter({ db: new FakeFirestore(), config: { focusMinutes: [0.5] } }), /Focus durations/);
});

test('focus counts only server elapsed running time across pause, resume and app reload', async t => {
  const { db, request, advance } = await setup(t);
  const id = (await request('/focus', { method: 'POST', body: { minutes: 5 } })).body.focus.id;
  advance(90500);
  const paused = await request(`/focus/${id}/pause`, { method: 'POST' });
  assert.equal(paused.body.focus.remainingSeconds, 210);
  assert.equal(paused.body.focus.status, 'paused');
  advance(60 * 60 * 1000);
  assert.equal((await request(`/focus/${id}/pause`, { method: 'POST' })).body.focus.remainingSeconds, 210);
  assert.equal((await request('/companion')).body.focus.remainingSeconds, 210);
  assert.equal((await request(`/focus/${id}/complete`, { method: 'POST', body: { elapsedSeconds: 9999 } })).status, 409);
  assert.equal((await request(`/focus/${id}/resume`, { method: 'POST' })).body.focus.status, 'running');
  advance(99500);
  assert.equal((await request(`/focus/${id}/resume`, { method: 'POST' })).body.focus.remainingSeconds, 110);
  advance(109999);
  assert.equal((await request(`/focus/${id}/complete`, { method: 'POST' })).status, 409);
  advance(1);
  const completed = await request(`/focus/${id}/complete`, { method: 'POST' });
  assert.equal(completed.body.awarded, true);
  assert.equal(completed.body.focus.remainingSeconds, 0);
  assert.equal(completed.body.focus.status, 'completed');
  assert.equal(db.data.get('users/alice').companion.xp, COMPANION_CONFIG.xpFocus);
  assert.equal(db.data.get('users/alice').companion.bond, COMPANION_CONFIG.bondFocus);
  assert.equal(db.data.get('users/alice').companion.spellCharge, 0);
  assert.equal(db.data.get('users/alice').coins, 100);
});

test('focus completion is idempotent under concurrent retries and does not disturb a newer session', async t => {
  const { db, request, advance } = await setup(t, {}, { xpFocus: 30, bondFocus: 20 });
  const firstId = (await request('/focus', { method: 'POST', body: { minutes: 5 } })).body.focus.id;
  advance(300000);
  const completed = await Promise.all(Array.from({ length: 4 }, () => request(`/focus/${firstId}/complete`, { method: 'POST' })));
  assert.ok(completed.every(result => result.status === 200));
  assert.equal(completed.filter(result => result.body.awarded).length, 1);
  assert.equal(db.data.get('users/alice').companion.xp, 30);
  assert.equal(db.data.get('users/alice').companion.bond, 20);
  assert.equal(db.data.get('users/alice').companion.activeFocusId, null);
  assert.equal((await request('/companion')).body.focus, null);
  const secondId = (await request('/focus', { method: 'POST' })).body.focus.id;
  const retry = await request(`/focus/${firstId}/complete`, { method: 'POST' });
  assert.equal(retry.body.awarded, false);
  assert.equal(retry.body.companion.activeFocusId, secondId);
  assert.equal(db.data.get('users/alice').companion.xp, 30);
});

test('focus cancellation is idempotent, clears its pointer and cannot pay rewards', async t => {
  const { db, request, advance } = await setup(t);
  const id = (await request('/focus', { method: 'POST', body: { minutes: 5 } })).body.focus.id;
  advance(600000);
  assert.equal((await request(`/focus/${id}/cancel`, { method: 'POST' })).body.focus.status, 'cancelled');
  assert.equal((await request(`/focus/${id}/cancel`, { method: 'POST' })).status, 200);
  assert.equal((await request(`/focus/${id}/complete`, { method: 'POST' })).status, 409);
  assert.equal((await request(`/focus/${id}/resume`, { method: 'POST' })).status, 409);
  assert.equal(db.data.get('users/alice').companion.xp, 0);
  assert.equal(db.data.get('users/alice').companion.activeFocusId, null);
  assert.equal((await request('/focus', { method: 'POST' })).status, 201);
});

test('focus actions are scoped to their owner and cannot forge time or rewards', async t => {
  const { db, request } = await setup(t);
  const id = (await request('/focus', { method: 'POST', body: { minutes: 5, startedAt: '2000-01-01', xp: 1000 } })).body.focus.id;
  for (const action of ['pause', 'resume', 'complete', 'cancel']) {
    assert.equal((await request(`/focus/${id}/${action}`, { method: 'POST', uid: 'bob' })).status, 404);
  }
  assert.equal((await request(`/focus/${id}/complete`, { method: 'POST', body: { remainingSeconds: 0 } })).status, 409);
  assert.equal(db.data.get('users/alice').companion.xp, 0);
  assert.equal(db.data.get('users/alice').companion.activeFocusId, id);
  assert.equal((await request('/companion', { uid: 'missing' })).status, 404);
});
