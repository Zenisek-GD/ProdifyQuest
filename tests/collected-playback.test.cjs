/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const folder = path.resolve(__dirname, '../components/collected-companions');
const moduleResult = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(folder, 'companionPlayback.js'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { module: moduleResult, exports: moduleResult.exports }, { filename: 'companionPlayback.js' });
const { SHEET, ANIMATIONS, createPlayback, getPose, startActions, setRestingState, advancePlayback } = moduleResult.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const duration = name => ANIMATIONS[name].durations.reduce((total, value) => total + value, 0);

test('all ten collected companions have transparent atlases matching every runtime frame', () => {
  const catalogResult = { exports: {} };
  const requestedAssets = [];
  const compiled = ts.transpileModule(fs.readFileSync(path.join(folder, 'catalog.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: catalogResult, exports: catalogResult.exports,
    require: name => { requestedAssets.push(name); return name; },
  });
  const companions = Object.values(catalogResult.exports.COLLECTED_COMPANIONS);
  assert.equal(companions.length, 10);
  assert.equal(new Set(requestedAssets).size, 10);
  assert.equal(companions.some(companion => companion.id.includes('apprentice')), false, 'Original Mage stays separate');
  for (const companion of companions) {
    const png = fs.readFileSync(path.join(folder, companion.source));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], companion.id);
    assert.equal(png.readUInt32BE(16), SHEET.frameWidth * SHEET.columns, companion.id);
    assert.equal(png.readUInt32BE(20), SHEET.frameHeight * SHEET.rows, companion.id);
    assert.equal(png.readUInt32BE(16), 2208);
    assert.equal(png.readUInt32BE(20), 1280);
    assert.ok([4, 6].includes(png[25]), `${companion.id} has an alpha channel`);
  }
  assert.deepEqual(Object.keys(ANIMATIONS), ['idle', 'wave', 'study', 'celebrate', 'attack']);
  assert.equal(new Set(Object.values(ANIMATIONS).map(animation => animation.row)).size, 5);
  for (const animation of Object.values(ANIMATIONS)) {
    assert.ok(animation.row >= 0 && animation.row < SHEET.rows);
    assert.equal(animation.durations.length, SHEET.columns);
    assert.ok(animation.durations.every(milliseconds => milliseconds > 0 && Number.isFinite(milliseconds)));
  }
});

test('idle and study loop at correct frame boundaries, including long pauses', () => {
  for (const resting of ['idle', 'study']) {
    const initial = createPlayback(resting);
    const before = advancePlayback(initial, ANIMATIONS[resting].durations[0] - 1);
    assert.equal(before.playback.frame, 0);
    assert.equal(advancePlayback(before.playback, 1).playback.frame, 1);
    assert.deepEqual(plain(advancePlayback(initial, duration(resting)).playback), plain(initial));
    const longPause = advancePlayback(initial, duration(resting) * 1000000 + 17);
    assert.equal(longPause.playback.elapsed, 17);
    assert.deepEqual(plain(getPose(longPause.playback)), { animation: resting, frame: 0 });
    assert.deepEqual(plain(longPause.completed), []);
  }
});

test('confirmed task sequence uses cast alias for attack and returns to latest study state', () => {
  const initial = startActions(createPlayback(), ['celebrate', 'cast']);
  const studying = setRestingState(initial, 'study');
  assert.deepEqual(plain(initial.queue), ['celebrate', 'attack']);
  const celebration = advancePlayback(studying, duration('celebrate'));
  assert.deepEqual(plain(celebration.completed), ['celebrate']);
  assert.deepEqual(plain(getPose(celebration.playback)), { animation: 'attack', frame: 0 });
  const attack = advancePlayback(celebration.playback, duration('attack'));
  assert.deepEqual(plain(attack.completed), ['attack']);
  assert.deepEqual(plain(getPose(attack.playback)), { animation: 'study', frame: 0 });
  assert.deepEqual(plain(advancePlayback(attack.playback, duration('study') * 5).completed), []);
});

test('replaying an action restarts it; waving replaces any queued actions', () => {
  const initial = startActions(createPlayback('study'), ['celebrate', 'attack']);
  const advanced = advancePlayback(initial, 500).playback;
  assert.ok(advanced.frame > 0);
  const replay = startActions(advanced, 'celebrate');
  assert.deepEqual(plain(getPose(replay)), { animation: 'celebrate', frame: 0 });
  assert.equal(replay.elapsed, 0);
  const wave = startActions(advanced, 'wave');
  assert.deepEqual(plain(wave.queue), ['wave']);
  const result = advancePlayback(wave, duration('wave'));
  assert.deepEqual(plain(result.completed), ['wave']);
  assert.deepEqual(plain(getPose(result.playback)), { animation: 'study', frame: 0 });
});

test('playback rejects invalid input and preserves caller state and action arrays', () => {
  const actions = Object.freeze(['celebrate', 'cast']);
  const initial = Object.freeze({ restingState: 'idle', queue: Object.freeze([]), frame: 0, elapsed: 0 });
  const sequence = startActions(initial, actions);
  Object.freeze(sequence.queue); Object.freeze(sequence);
  const before = plain(sequence);
  advancePlayback(sequence, 3000);
  setRestingState(sequence, 'study');
  startActions(sequence, 'attack');
  assert.deepEqual(plain(sequence), before);
  assert.deepEqual(actions, ['celebrate', 'cast']);
  for (const value of ['', 'idle', 'study', [], ['attack', 'unknown'], null]) assert.throws(() => startActions(initial, value), /Companion.play expects/);
  for (const value of [-1, NaN, Infinity, '10']) assert.throws(() => advancePlayback(initial, value), /finite, non-negative/);
});
