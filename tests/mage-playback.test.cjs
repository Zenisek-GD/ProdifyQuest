/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const mageFolder = path.resolve(__dirname, '../components/mage');
const playbackModule = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(mageFolder, 'magePlayback.js'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { module: playbackModule, exports: playbackModule.exports }, { filename: 'magePlayback.js' });
const { SHEET, ANIMATIONS, createPlayback, getPose, startActions, setRestingState, advancePlayback } = playbackModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const duration = name => ANIMATIONS[name].durations.reduce((total, milliseconds) => total + milliseconds, 0);

test('idle and study loops preserve timing at frame boundaries and after long pauses', () => {
  for (const resting of ['idle', 'study']) {
    const initial = createPlayback(resting);
    assert.deepEqual(plain(getPose(initial)), { animation: resting, frame: 0 });
    const before = advancePlayback(initial, ANIMATIONS[resting].durations[0] - 1);
    assert.equal(before.playback.frame, 0);
    const boundary = advancePlayback(before.playback, 1);
    assert.equal(boundary.playback.frame, 1);
    assert.equal(boundary.playback.elapsed, 0);
    const loop = advancePlayback(initial, duration(resting));
    assert.deepEqual(plain(loop.playback), plain(initial));
    assert.deepEqual(plain(loop.completed), []);
    const longPause = advancePlayback(initial, duration(resting) * 1000000 + 17);
    assert.deepEqual(plain(getPose(longPause.playback)), { animation: resting, frame: 0 });
    assert.equal(longPause.playback.elapsed, 17);
    assert.deepEqual(plain(longPause.completed), []);
  }
});

test('celebration and casting finish once in order and return to the latest study state', () => {
  let state = startActions(createPlayback(), ['celebrate', 'cast']);
  state = setRestingState(state, 'study');
  assert.deepEqual(plain(getPose(state)), { animation: 'celebrate', frame: 0 });
  const celebrate = advancePlayback(state, duration('celebrate'));
  assert.deepEqual(plain(celebrate.completed), ['celebrate']);
  assert.deepEqual(plain(getPose(celebrate.playback)), { animation: 'cast', frame: 0 });
  const cast = advancePlayback(celebrate.playback, duration('cast'));
  assert.deepEqual(plain(cast.completed), ['cast']);
  assert.deepEqual(plain(getPose(cast.playback)), { animation: 'study', frame: 0 });
  const after = advancePlayback(cast.playback, duration('study') * 3);
  assert.deepEqual(plain(after.completed), []);
  const oneJump = advancePlayback(state, duration('celebrate') + duration('cast') + 10);
  assert.deepEqual(plain(oneJump.completed), ['celebrate', 'cast']);
  assert.deepEqual(plain(getPose(oneJump.playback)), { animation: 'study', frame: 0 });
  assert.equal(oneJump.playback.elapsed, 10);
});

test('playing the same action restarts it and a new action replaces the pending sequence', () => {
  const waved = advancePlayback(startActions(createPlayback('study'), 'wave'), 390).playback;
  assert.ok(waved.frame > 0);
  const replayed = startActions(waved, 'wave');
  assert.deepEqual(plain(getPose(replayed)), { animation: 'wave', frame: 0 });
  assert.equal(replayed.elapsed, 0);
  const sequence = startActions(waved, ['celebrate', 'cast']);
  const tapped = startActions(sequence, 'wave');
  assert.deepEqual(plain(tapped.queue), ['wave']);
  const finished = advancePlayback(tapped, duration('wave'));
  assert.deepEqual(plain(finished.completed), ['wave']);
  assert.deepEqual(plain(getPose(finished.playback)), { animation: 'study', frame: 0 });
});

test('playback operations do not mutate caller state or action arrays', () => {
  const actions = Object.freeze(['celebrate', 'cast']);
  const initial = Object.freeze({ restingState: 'idle', queue: Object.freeze([]), frame: 0, elapsed: 0 });
  const initialCopy = plain(initial);
  const sequence = startActions(initial, actions);
  Object.freeze(sequence.queue);
  Object.freeze(sequence);
  const sequenceCopy = plain(sequence);
  advancePlayback(sequence, duration('celebrate') + 15);
  setRestingState(sequence, 'study');
  startActions(sequence, 'wave');
  assert.deepEqual(plain(initial), initialCopy);
  assert.deepEqual(plain(sequence), sequenceCopy);
  assert.deepEqual(actions, ['celebrate', 'cast']);
  assert.notEqual(sequence.queue, actions);
});

test('invalid animation input is rejected and resting state changes reset an idle loop', () => {
  const state = advancePlayback(createPlayback(), 1000).playback;
  assert.deepEqual(plain(getPose(setRestingState(state, 'study'))), { animation: 'study', frame: 0 });
  assert.deepEqual(plain(getPose(createPlayback('unknown'))), { animation: 'idle', frame: 0 });
  for (const invalid of ['', 'idle', 'study', [], ['cast', 'unknown'], null]) assert.throws(() => startActions(state, invalid), /Mage\.play expects/);
  for (const invalid of [-1, NaN, Infinity, '10']) assert.throws(() => advancePlayback(state, invalid), /finite, non-negative/);
});

test('the bundled transparent PNG atlas matches every configured frame and animation row', () => {
  const png = fs.readFileSync(path.join(mageFolder, 'assets/apprentice-mage-spritesheet.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), SHEET.frameWidth * SHEET.columns);
  assert.equal(png.readUInt32BE(20), SHEET.frameHeight * SHEET.rows);
  assert.equal(png.readUInt32BE(16), 2208);
  assert.equal(png.readUInt32BE(20), 1280);
  assert.ok([4, 6].includes(png[25]), 'The atlas uses a PNG color type with an alpha channel');
  assert.equal(new Set(Object.values(ANIMATIONS).map(animation => animation.row)).size, SHEET.rows);
  for (const animation of Object.values(ANIMATIONS)) {
    assert.ok(animation.row >= 0 && animation.row < SHEET.rows);
    assert.equal(animation.durations.length, SHEET.columns);
    assert.ok(animation.durations.every(milliseconds => Number.isFinite(milliseconds) && milliseconds > 0));
  }
});
