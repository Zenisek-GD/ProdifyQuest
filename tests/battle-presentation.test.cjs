/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(__dirname, '../components/boss', file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, setTimeout, clearTimeout }, { filename });
  return loaded.exports;
}
const { createBattlePlayback } = load('battle-playback.ts');
const { isOlderRaid, canAcceptRaidUpdate, canPresentAttack, bossRestAction } = load('raid-state.ts');
const attack = { attackId: 'attack-1', raidId: 'raid-1', hpBefore: 250, hpAfter: 220, damage: 30, revision: 4 };
function fixture() {
  let time = 0, id = 0, motion = true;
  const timers = new Map(), events = [];
  const callbacks = Object.fromEntries(['prepare', 'entrance', 'attack', 'projectile', 'impact', 'recover', 'fade', 'settle', 'busy'].map(name => [name, value => events.push({ name, value, time })]));
  callbacks.motion = () => motion;
  const playback = createBattlePlayback(callbacks, (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; }, key => timers.delete(key));
  function advance(ms) {
    const until = time + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = until;
  }
  return { playback, events, advance, setMotion: value => { motion = value; } };
}
test('confirmed attack waits for hero image, then synchronizes projectile and impact', () => {
  const f = fixture();
  assert.equal(f.playback.play(attack), true);
  f.advance(1000);
  assert.equal(f.events.some(event => event.name === 'impact'), false);
  f.playback.ready(); f.playback.ready();
  f.advance(919);
  assert.equal(f.events.filter(event => event.name === 'attack').length, 1);
  assert.equal(f.events.find(event => event.name === 'projectile').time, 1700);
  assert.equal(f.events.some(event => event.name === 'impact'), false);
  f.advance(1);
  assert.equal(f.events.find(event => event.name === 'impact').value, attack);
  assert.equal(f.events.find(event => event.name === 'impact').time, 1920);
  f.advance(1780);
  assert.equal(f.events.filter(event => event.name === 'impact').length, 1);
  assert.equal(f.events.at(-1).name, 'busy');
  assert.equal(f.events.at(-1).value, false);
});
test('reduced motion settles to saved outcome without launching animations', () => {
  const f = fixture(); f.setMotion(false); f.playback.play(attack); f.advance(9000);
  assert.equal(f.events.filter(event => event.name === 'impact').length, 1);
  assert.equal(f.events.some(event => event.name === 'projectile'), false);
  assert.equal(f.events.find(event => event.name === 'settle').value.hpAfter, 220);
  assert.equal(f.events.at(-1).value, false);
});
test('background or asset failure settles once and cancels delayed callbacks', () => {
  const f = fixture(); f.playback.play(attack); f.playback.ready(); f.advance(400); f.playback.settle(); f.advance(10000);
  assert.equal(f.events.filter(event => event.name === 'impact').length, 1);
  assert.equal(f.events.filter(event => event.name === 'settle').length, 1);
  assert.equal(f.events.some(event => event.name === 'projectile'), false);
});
test('unloaded images release presentation after timeout and preserve confirmed damage', () => {
  const f = fixture(); f.playback.play(attack); f.advance(8000);
  assert.equal(f.events.find(event => event.name === 'settle').value, attack);
  assert.equal(f.events.at(-1).value, false);
});
test('parallel plays cannot replace an in-flight result; unmount cancels timers', () => {
  const f = fixture(); f.playback.play(attack);
  assert.equal(f.playback.play({ ...attack, attackId: 'second' }), false);
  f.playback.ready(); f.advance(300); f.playback.destroy(); f.advance(9000);
  assert.equal(f.events.some(event => event.name === 'impact'), false);
  assert.equal(f.events.at(-1).value, false);
});
test('stale polls and retry results cannot rewind a raid or play another raid result', () => {
  const raid = { id: 'raid-1', revision: 5 };
  assert.equal(isOlderRaid(raid, { id: 'raid-1', revision: 4 }), true);
  assert.equal(isOlderRaid(raid, { id: 'raid-2', revision: 1 }), false);
  assert.equal(canPresentAttack(raid, attack), false);
  assert.equal(canPresentAttack(raid, { ...attack, revision: 5 }), true);
  assert.equal(canPresentAttack(raid, { ...attack, raidId: 'another', revision: 6 }), false);
});
test('boss enrages only at threshold and settles to defeat at zero', () => {
  assert.equal(bossRestAction(101, 250), 'idle');
  assert.equal(bossRestAction(100, 250), 'enraged');
  assert.equal(bossRestAction(0, 250), 'defeat');
});

test('late attack and claim confirmations cannot replace a newer raid', () => {
  const current = { id: 'new-event', revision: 2 };
  const previous = { id: 'old-event', revision: 100 };
  assert.equal(canAcceptRaidUpdate(current, previous), false);
  assert.equal(canAcceptRaidUpdate(current, { ...current, revision: 1 }), false);
  assert.equal(canAcceptRaidUpdate(current, { ...current, revision: 3 }), true);
  assert.equal(canAcceptRaidUpdate(current, null), false);
});

test('authoritative reads and intentional creation may advance events without reviving stale creations', () => {
  const previous = { id: 'old-event', revision: 100 };
  const next = { id: 'new-event', revision: 1 };
  assert.equal(canAcceptRaidUpdate(previous, next, { authoritative: true }), true);
  assert.equal(canAcceptRaidUpdate(previous, next, { transitionFrom: previous.id }), true);
  assert.equal(canAcceptRaidUpdate(null, next, { transitionFrom: null }), true);
  assert.equal(canAcceptRaidUpdate(next, next, { transitionFrom: previous.id }), true);
  assert.equal(canAcceptRaidUpdate({ id: 'even-newer-event', revision: 1 }, next, { transitionFrom: previous.id }), false);
  assert.equal(canAcceptRaidUpdate(next, { ...next, revision: 0 }, { authoritative: true }), false);
});
