/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, Date, Error, Promise, Set }, { filename });
  return loaded.exports;
}
const { createPetPlayback, advancePetPlayback } = load('../components/wardrobe/pet-playback.ts');
const { createCompanionStore, focusRemaining } = load('../scripts/companion-store.ts');

test('pet idle atlas timings loop and happy returns to idle once', () => {
  const initial = createPetPlayback();
  const next = advancePetPlayback(initial, 1000);
  assert.equal(next.frame, 1);
  assert.equal(initial.frame, 0, 'Playback inputs stay unchanged');
  assert.equal(advancePetPlayback(next, 220).frame, 2);
  assert.equal(advancePetPlayback(initial, 1900).frame, 0);
  const happy = createPetPlayback('happy');
  assert.equal(advancePetPlayback(happy, 160).frame, 1);
  assert.equal(advancePetPlayback(happy, 360).frame, 2);
  const done = advancePetPlayback(happy, 680);
  assert.equal(done.action, 'idle'); assert.equal(done.frame, 0);
  const later = advancePetPlayback(happy, 680 + 1900 * 200 + 1000);
  assert.equal(later.action, 'idle'); assert.equal(later.frame, 1);
});

test('pet same-action replay restarts, invalid elapsed cannot corrupt clipping', () => {
  const happy = advancePetPlayback(createPetPlayback('happy'), 200);
  assert.equal(happy.frame, 1);
  assert.equal(createPetPlayback('happy').frame, 0);
  for (const elapsed of [-1, Infinity, NaN]) {
    const result = advancePetPlayback(happy, elapsed);
    assert.equal(result.frame, happy.frame); assert.equal(result.elapsed, happy.elapsed);
  }
});

test('bundled wardrobe art dimensions match the actual PNG atlas clipping', () => {
  const root = path.resolve(__dirname, '../components/wardrobe/assets');
  for (const name of ['study-room', 'moon-garden', 'sky-island']) {
    const bytes = fs.readFileSync(path.join(root, 'backgrounds', `${name}.png`));
    assert.equal(bytes.readUInt32BE(16), 960); assert.equal(bytes.readUInt32BE(20), 720);
  }
  for (const name of ['leaf-dance', 'starfall', 'arcane-halo']) {
    const bytes = fs.readFileSync(path.join(root, 'auras', `${name}.png`));
    assert.equal(bytes.readUInt32BE(16), 384); assert.equal(bytes.readUInt32BE(20), 384);
  }
  for (const name of ['mint-slime', 'moon-owl', 'ember-drake']) {
    const bytes = fs.readFileSync(path.join(root, 'pets', name, 'atlas.png'));
    assert.equal(bytes.readUInt32BE(16), 3 * 128); assert.equal(bytes.readUInt32BE(20), 2 * 128);
    assert.ok(fs.statSync(path.join(root, 'pets', name, 'portrait.png')).size > 0);
  }
});

test('wardrobe equip and favorite confirmations publish immediately without restarting a running focus clock', async () => {
  let now = 1000;
  let resolveWrite;
  const writes = [];
  const look = { backgroundId: 'study-room', petId: 'mint-slime', auraId: null };
  const initial = {
    companion: { activeFocusId: 'focus-1' }, focus: { id: 'focus-1', status: 'running', remainingSeconds: 300 },
    wardrobe: { ownedItemIds: ['study-room', 'mint-slime', 'moon-garden'], equipped: look, presets: [null, null, null] },
    config: {}, serverTime: '2026-09-26T00:00:00Z',
  };
  const store = createCompanionStore({
    read: async () => ({ data: initial }),
    write: (url, body, method) => { writes.push({ url, body, method }); return new Promise(resolve => { resolveWrite = resolve; }); },
    isCurrent: () => true, message: cause => cause.message, now: () => now,
  });
  await store.reload();
  now += 10000;
  const nextLook = { ...look, backgroundId: 'moon-garden' };
  const pending = store.mutate('/wardrobe/equip', nextLook, 'PATCH');
  assert.equal(store.getSnapshot().data.wardrobe.equipped.backgroundId, 'study-room', 'Preview cannot equip before confirmation');
  const confirmed = { ...initial, wardrobe: { ...initial.wardrobe, equipped: nextLook } };
  delete confirmed.focus;
  resolveWrite({ data: confirmed }); await pending;
  assert.equal(store.getSnapshot().data.wardrobe.equipped.backgroundId, 'moon-garden');
  assert.equal(focusRemaining(store.getSnapshot(), now), 290);
  const saving = store.mutate('/wardrobe/presets/0', nextLook, 'PUT');
  assert.equal(writes[1].method, 'PUT');
  resolveWrite({ data: { ...confirmed, wardrobe: { ...confirmed.wardrobe, presets: [nextLook, null, null] } } });
  await saving;
  assert.equal(store.getSnapshot().data.wardrobe.presets[0].backgroundId, 'moon-garden');
  assert.equal(focusRemaining(store.getSnapshot(), now), 290);
  store.stop();
});
