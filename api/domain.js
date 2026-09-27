import { levelSystem } from '../helpers/levelSystem.js';
import { HttpError } from './shared.js';

export class ValidationError extends HttpError {
  constructor(message) { super(400, message); }
}

export function textField(value, name, max, required = false) {
  if (typeof value !== 'string') throw new ValidationError(`${name} must be text.`);
  const text = value.trim();
  if (required && !text) throw new ValidationError(`${name} is required.`);
  if (text.length > max) throw new ValidationError(`${name} must be ${max} characters or fewer.`);
  return text;
}

export function positiveInteger(value, name = 'Cost') {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000) {
    throw new ValidationError(`${name} must be a whole number between 1 and 1,000,000.`);
  }
  return value;
}

function enumField(value, name, choices) {
  if (!choices.includes(value)) throw new ValidationError(`${name} must be one of: ${choices.join(', ')}.`);
  return value;
}

export function validDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new ValidationError('Due date must be an ISO date or a timestamp with a time zone.');
  }
  if (value.includes('T')) {
    const clock = value.slice(11, 19).split(':');
    if (Number(clock[0]) > 23 || Number(clock[1].slice(0, 2)) > 59 || (clock.length > 2 && Number(clock[2].slice(0, 2)) > 59)) {
      throw new ValidationError('Due time is invalid.');
    }
  }
  const date = new Date(value);
  const day = value.slice(0, 10);
  if (!Number.isFinite(date.getTime()) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new ValidationError('Due date is invalid.');
  }
  return date;
}

export function taskInput(input, partial = false) {
  const result = {};
  if (!partial || 'title' in input) result.title = textField(input.title, 'Title', 160, true);
  if (!partial || 'description' in input) result.description = textField(input.description ?? '', 'Description', 3000);
  if (!partial || 'category' in input) result.category = textField(input.category ?? 'Personal', 'Category', 60, true);
  if (!partial || 'priority' in input) result.priority = enumField(input.priority ?? 'medium', 'Priority', ['low', 'medium', 'high']);
  if (!partial || 'difficulty' in input) result.difficulty = enumField(input.difficulty ?? 'normal', 'Difficulty', ['easy', 'normal', 'hard']);
  if (!partial || 'size' in input) result.size = enumField(input.size ?? 'medium', 'Expected effort', ['small', 'medium', 'large']);
  if (!partial || 'recurrence' in input) result.recurrence = enumField(input.recurrence ?? 'none', 'Repeat', ['none', 'daily']);
  if (!partial || 'subtasks' in input) {
    const subtasks = input.subtasks ?? [];
    if (!Array.isArray(subtasks) || subtasks.length > 20) throw new ValidationError('Use up to 20 subtasks.');
    const ids = new Set();
    result.subtasks = subtasks.map(step => {
      if (!step || typeof step !== 'object' || typeof step.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(step.id) || ids.has(step.id) || typeof step.done !== 'boolean') throw new ValidationError('Each subtask needs a unique ID, title, and completion status.');
      ids.add(step.id);
      return { id: step.id, title: textField(step.title, 'Subtask', 160, true), done: step.done };
    });
  }
  if (!partial || 'dueDate' in input) result.dueDate = validDate(input.dueDate ?? null);
  if ('isCompleted' in input || 'userId' in input || 'coins' in input) throw new ValidationError('Task ownership and completion cannot be changed here.');
  if (partial && !Object.keys(result).length) throw new ValidationError('No task changes were provided.');
  return result;
}

export function rewardInput(input, partial = false) {
  const result = {};
  if (!partial || 'name' in input) result.name = textField(input.name, 'Name', 160, true);
  if (!partial || 'description' in input) result.description = textField(input.description ?? '', 'Description', 3000);
  if (!partial || 'cost' in input) result.cost = positiveInteger(input.cost);
  if ('redeemed' in input || 'userId' in input) throw new ValidationError('Reward ownership and redemption cannot be changed here.');
  if (partial && !Object.keys(result).length) throw new ValidationError('No reward changes were provided.');
  return result;
}

export function timeZone(value) {
  if (typeof value === 'string') {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { /* Legacy invalid zone. */ }
  }
  return 'UTC';
}

export function calendarDay(date = new Date(), zone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone(zone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDay(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function currentStreak(user, now = new Date()) {
  const today = calendarDay(now, user.timeZone);
  if (user.lastCompletedDate === today || user.lastCompletedDate === shiftDay(today, -1)) return Math.max(0, Number(user.streak) || 0);
  return 0;
}

export function advanceStreak(user, now = new Date()) {
  const today = calendarDay(now, user.timeZone);
  const active = currentStreak(user, now);
  const streak = user.lastCompletedDate === today ? Math.max(active, 1) : active + 1;
  return { streak, bestStreak: Math.max(streak, Number(user.bestStreak) || 0), lastCompletedDate: today };
}

export function taskReward(difficulty) {
  return { easy: { coins: 5, exp: 10 }, normal: { coins: 10, exp: 20 }, hard: { coins: 20, exp: 40 } }[difficulty] ?? { coins: 5, exp: 10 };
}

export function addExperience(character = {}, earned) {
  if (!character || typeof character !== 'object' || Array.isArray(character)) character = {};
  const level = Number.isInteger(character.level) && character.level > 0 && character.level <= 50 ? character.level : 1;
  const exp = Number.isFinite(character.exp) && character.exp >= 0 ? character.exp : 0;
  return { ...character, ...levelSystem.calculateLevelFromExp(levelSystem.getTotalExpFromStoredValues(level, exp) + earned) };
}

export function numericBalance(value) {
  const balance = value ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('The stored coin balance is invalid.');
  return balance;
}

export function debit(balance, cost) {
  positiveInteger(cost);
  const current = numericBalance(balance);
  if (current < cost) throw new HttpError(409, 'Not enough coins.');
  return current - cost;
}

export function normalizeCharacter(value = '') {
  return String(value).split('/').pop().replace(/\.png$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase().replace('aracanasamurai', 'arcanesamurai');
}
