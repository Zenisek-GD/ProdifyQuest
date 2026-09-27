import { createHash } from 'node:crypto';
import { calendarDay, shiftDay, timeZone } from './domain.js';
import { HttpError } from './shared.js';

const dateValue = value => {
  const date = value?.toDate ? value.toDate() : new Date(value ?? NaN);
  return Number.isFinite(date.getTime()) ? date : null;
};
const localParts = (date, zone) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, clock: `${values.hour}:${values.minute}:${values.second}` };
};

/** Keep the same wall-clock due time through DST. Use the first repeated time,
 * or the later corresponding time when a clock jump skips the selected time. */
export function zonedDayTime(day, clock, zone) {
  const target = Date.parse(`${day}T${clock}Z`);
  const offsets = new Set([-36, -12, 0, 12, 36].map(hours => {
    const sample = new Date(target + hours * 3600000);
    const local = localParts(sample, zone);
    return Date.parse(`${local.day}T${local.clock}Z`) - sample.getTime();
  }));
  const candidates = [...offsets].map(offset => new Date(target - offset)).sort((a, b) => a - b);
  const exact = candidates.find(date => { const local = localParts(date, zone); return local.day === day && local.clock === clock; });
  if (exact) return exact;
  return candidates.find(date => { const local = localParts(date, zone); return `${local.day}T${local.clock}` > `${day}T${clock}`; }) || candidates.at(-1);
}

export const taskHasCompletion = task => !!(task.isCompleted || task.completedAt || task.rewardAwardedAt || task.completedOccurrenceDay);

export function recurrenceStart(task, user, now) {
  const today = calendarDay(now, user.timeZone);
  const due = dateValue(task.dueDate);
  return due ? [today, calendarDay(due, user.timeZone)].sort().at(-1) : today;
}

/** A view is also the reward input: old occurrence fields must never prevent a
 * new day's raid contribution or carry yesterday's completed checklist. */
export function taskOccurrence(task, user = {}, now = new Date()) {
  const zone = timeZone(user.timeZone);
  const daily = task.recurrence === 'daily';
  const common = { recurrence: daily ? 'daily' : 'none', recurrenceLocked: taskHasCompletion(task),
    recurrenceTimeZone: zone, occurrenceDay: null, recurrenceStartDay: null, nextResetAt: null, occurrenceAvailable: true };
  if (!daily) return { ...task, ...common };
  const today = calendarDay(now, zone);
  const start = task.recurrenceStartDay || recurrenceStart(task, user, dateValue(task.createdAt) || now);
  const day = today < start ? start : today;
  const completed = task.completedOccurrenceDay === day;
  const due = dateValue(task.dueDate);
  const stepsCurrent = task.subtasksOccurrenceDay === day;
  return { ...task, ...common, occurrenceDay: day, recurrenceStartDay: start,
    occurrenceAvailable: today >= start, isCompleted: completed,
    nextResetAt: zonedDayTime(shiftDay(today, 1), '00:00:00', zone),
    dueDate: due ? zonedDayTime(day, localParts(due, zone).clock, zone) : null,
    completedAt: completed ? task.completedAt : null, rewardAwardedAt: completed ? task.rewardAwardedAt : null,
    raidCreditId: completed ? task.raidCreditId || null : null,
    questBoxId: completed ? task.questBoxId || null : null,
    subtasks: (Array.isArray(task.subtasks) ? task.subtasks : []).map(step => ({ ...step, done: stepsCurrent && step.done === true })),
  };
}

export function requireOccurrence(view, requestedDay, { allowFuture = false } = {}) {
  if (view.recurrence === 'daily') {
    if (!allowFuture && !view.occurrenceAvailable) throw new HttpError(409, 'This daily task has not started yet.');
    if (requestedDay !== view.occurrenceDay) throw new HttpError(409, 'This daily task has refreshed. Reload your tasks before continuing.');
  } else if (requestedDay !== undefined && requestedDay !== null) {
    throw new HttpError(409, 'This task no longer repeats. Reload your tasks before continuing.');
  }
}

export function taskOccurrenceKey(id, day) {
  return day ? `daily_${createHash('sha256').update(JSON.stringify([id, day])).digest('hex')}` : id;
}
