import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { CARD_CATALOG } from '../api/catalog.js';
import { advanceStreak, calendarDay, currentStreak, debit, taskInput, rewardInput, validDate, addExperience, normalizeCharacter } from '../api/domain.js';

test('task validation rejects blank titles, invalid calendar dates, privileged fields, and unknown enums', () => {
  for (const input of [{ title: ' ' }, { title: 'Math', difficulty: 'extreme' }, { title: 'Math', priority: 'urgent' }, { title: 'Math', dueDate: '2026-02-30' }, { title: 'Math', isCompleted: true }]) {
    assert.throws(() => taskInput(input), { status: 400 });
  }
  assert.equal(taskInput({ title: '  Read  ' }).title, 'Read');
  assert.equal(validDate('2026-12-01T15:00:00+08:00').toISOString(), '2026-12-01T07:00:00.000Z');
  assert.throws(() => validDate('2026-12-01T15:00:00'), { status: 400 });
  assert.throws(() => validDate('2026-12-01T24:00:00Z'), { status: 400 });
  assert.throws(() => validDate('2026-13-01'), { status: 400 });
  assert.throws(() => validDate('2026-02-29'), { status: 400 });
  assert.equal(validDate('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z');
});

test('reward costs and debits cannot mint coins or overspend', () => {
  for (const cost of [-10, 0, 0.5, '20', NaN, Infinity, 1000001]) assert.throws(() => rewardInput({ name: 'Break', cost }), { status: 400 });
  assert.equal(debit(20, 20), 0);
  assert.throws(() => debit(19, 20), { status: 409 });
  assert.throws(() => debit(-1, 1));
});

test('streak increments once per local calendar day and resets after a missed day', () => {
  const now = new Date('2026-09-25T17:00:00Z');
  assert.equal(calendarDay(now, 'Asia/Manila'), '2026-09-26');
  const user = { timeZone: 'Asia/Manila', lastCompletedDate: '2026-09-25', streak: 4, bestStreak: 8 };
  const updated = { ...user, ...advanceStreak(user, now) };
  assert.equal(updated.streak, 5);
  assert.equal(advanceStreak(updated, now).streak, 5);
  assert.equal(currentStreak(updated, new Date('2026-09-28T05:00:00Z')), 0);
  assert.equal(advanceStreak(updated, new Date('2026-09-28T05:00:00Z')).streak, 1);
  assert.equal(updated.bestStreak, 8);
});

test('streak uses calendar dates over daylight saving changes', () => {
  const user = { timeZone: 'America/New_York', lastCompletedDate: '2026-03-07', streak: 2 };
  assert.equal(advanceStreak(user, new Date('2026-03-09T03:30:00Z')).streak, 3);
});

test('experience advances level without losing progress', () => {
  assert.deepEqual(addExperience({ level: 1, exp: 90, image: 'basicarcher' }, 20), { level: 2, exp: 10, image: 'basicarcher' });
  assert.deepEqual(addExperience(null, 20), { level: 1, exp: 20 });
});

test('catalog names match existing assets and preserve legacy character names', async () => {
  assert.equal(new Set(CARD_CATALOG.map(card => card.id)).size, CARD_CATALOG.length);
  for (const card of CARD_CATALOG) await access(new URL(`..${card.imagePath}`, import.meta.url));
  assert.equal(normalizeCharacter('Apprentice Mage'), normalizeCharacter('/common/apprenticemage.png'));
  assert.equal(normalizeCharacter('aracanasamurai'), normalizeCharacter('arcanesamurai'));
});
