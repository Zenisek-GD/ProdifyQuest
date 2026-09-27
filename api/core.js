import express from 'express';
import { HttpError, asyncHandler, serialize } from './shared.js';
import { CARD_CATALOG } from './catalog.js';
import { characterBuild } from './customization-domain.js';
import { awardCompanion, companionState, companionView, COMPANION_CONFIG } from './companion-domain.js';
import { prepareRaidAttack } from './raids.js';
import { isDreadroot, RAID_CONFIG, raidStatus } from './raid-domain.js';
import { prepareQuestBoxDrop, questBoxProgressView, randomQuestBoxRoll } from './quest-box-domain.js';
import { recurrenceStart, requireOccurrence, taskHasCompletion, taskOccurrence, taskOccurrenceKey } from './task-recurrence.js';
import { addExperience, advanceStreak, calendarDay, currentStreak, debit, normalizeCharacter, numericBalance, rewardInput, shiftDay, taskInput, taskReward, textField, timeZone } from './domain.js';

const HISTORY_LIMIT = 500;
const documentId = id => {
  if (typeof id !== 'string' || !id || id.includes('/') || id.length > 200) throw new HttpError(400, 'Invalid record ID.');
  return id;
};
const requireUser = snapshot => {
  if (!snapshot.exists) throw new HttpError(404, 'User profile not found.');
  return snapshot.data();
};
const requireOwned = (snapshot, uid, label) => {
  if (!snapshot.exists || snapshot.data().userId !== uid) throw new HttpError(404, `${label} not found.`);
  return snapshot.data();
};
const milliseconds = value => {
  try {
    const date = value?.toDate ? value.toDate() : new Date(value ?? 0);
    return date.getTime() || 0;
  } catch { return 0; }
};
const storedDate = value => {
  if (!value) return null;
  const timestamp = milliseconds(value);
  return timestamp ? new Date(timestamp) : null;
};
const newestFirst = (a, b) => milliseconds(b.createdAt) - milliseconds(a.createdAt);
const taskView = (id, storedTask, user = {}, now = new Date()) => {
  const task = taskOccurrence(storedTask, user, now);
  return ({
  ...task, id, title: typeof task.title === 'string' ? task.title : 'Untitled task',
  description: typeof task.description === 'string' ? task.description : '',
  category: typeof task.category === 'string' && task.category.trim() ? task.category : 'Personal',
  priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium',
  difficulty: ['easy', 'normal', 'hard'].includes(task.difficulty) ? task.difficulty : 'easy', dueDate: storedDate(task.dueDate),
  isCompleted: task.isCompleted === true,
  size: ['small', 'medium', 'large'].includes(task.size) ? task.size : 'medium',
  subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
  });
};
const getCard = id => {
  const card = CARD_CATALOG.find(entry => entry.id === id);
  if (!card) throw new HttpError(404, 'Card not found.');
  return card;
};
const ownedNames = (user, collection) => new Set([
  normalizeCharacter(user.character?.image),
  ...companionState(user).unlockedCharacters.map(normalizeCharacter),
  ...collection.docs.map(doc => normalizeCharacter(doc.data().characterName)),
]);
const cardView = (card, user, names) => ({
  ...card, owned: names.has(normalizeCharacter(card.characterName)),
  equipped: normalizeCharacter(user.character?.image) === normalizeCharacter(card.characterName),
  stats: (() => {
    const build = characterBuild({ ...user, character: { ...user.character, image: card.characterName } });
    return { level: build.level, attack: build.attack, critChance: build.critChance, normalDamage: build.normalDamage };
  })(),
});

export function publicUser(uid, user, now = new Date()) {
  const equipped = CARD_CATALOG.find(card => normalizeCharacter(card.characterName) === normalizeCharacter(user.character?.image));
  return {
    id: uid, username: user.username || 'Adventurer', email: user.email || '', coins: numericBalance(user.coins),
    streak: currentStreak(user, now), bestStreak: Number(user.bestStreak) || 0,
    level: user.character?.level || 1, exp: user.character?.exp || 0, timeZone: timeZone(user.timeZone),
    character: user.character || {}, imagePath: equipped?.imagePath || '/characters/common/apprenticemage.png',
    companion: companionView(user, now),
  };
}

export function createCoreRouter({ db, now: clock = () => new Date(), questBoxRandom = randomQuestBoxRoll }) {
  const router = express.Router();
  const users = db.collection('users');
  const todos = db.collection('todos');
  const rewards = db.collection('rewards');
  const legacyCards = db.collection('userCharacterCollection');
  const reply = (res, data, status = 200) => res.status(status).json(serialize(data));

  router.get('/me', asyncHandler(async (req, res) => {
    const snapshot = await users.doc(req.auth.uid).get();
    reply(res, { user: publicUser(req.auth.uid, requireUser(snapshot)) });
  }));

  router.patch('/me', asyncHandler(async (req, res) => {
    const username = textField(req.body?.username, 'Username', 60, true);
    const ref = users.doc(req.auth.uid);
    const user = await db.runTransaction(async transaction => {
      const previous = requireUser(await transaction.get(ref));
      transaction.update(ref, { username, updatedAt: new Date() });
      return { ...previous, username };
    });
    reply(res, { user: publicUser(req.auth.uid, user) });
  }));

  router.get('/tasks', asyncHandler(async (req, res) => {
    const [snapshot, profile] = await Promise.all([todos.where('userId', '==', req.auth.uid).get(), users.doc(req.auth.uid).get()]);
    const user = requireUser(profile);
    const now = clock();
    const activeRaid = user.activeRaidId ? await db.collection('guildRaids').doc(documentId(user.activeRaidId)).get() : null;
    const raid = activeRaid?.data();
    const dreadroot = raid && isDreadroot(raid) && raidStatus(raid, now) === 'active';
    reply(res, { tasks: snapshot.docs.map(doc => taskView(doc.id, doc.data(), user, now)).sort(newestFirst), serverTime: now,
      raidRules: { damage: RAID_CONFIG.damage, dailyLimit: RAID_CONFIG.dailyLimit, resetTime: RAID_CONFIG.resetTime,
        bossId: dreadroot ? 'dreadroot' : 'deadline-dragon', attackMode: dreadroot ? 'charges' : 'automatic',
        ...(dreadroot ? { dailyChargeLimit: raid.config.dailyChargeLimit } : {}) } });
  }));

  router.post('/tasks', asyncHandler(async (req, res) => {
    const now = clock();
    const user = requireUser(await users.doc(req.auth.uid).get());
    const data = { ...taskInput(req.body ?? {}), userId: req.auth.uid, isCompleted: false, createdAt: now };
    if (data.recurrence === 'daily') {
      data.recurrenceStartDay = recurrenceStart(data, user, now);
      data.subtasksOccurrenceDay = data.recurrenceStartDay;
    }
    const ref = await todos.add(data);
    reply(res, { task: taskView(ref.id, data, user, now) }, 201);
  }));

  router.patch('/tasks/:id', asyncHandler(async (req, res) => {
    const now = clock();
    const input = { ...taskInput(req.body ?? {}, true), updatedAt: now };
    const ref = todos.doc(documentId(req.params.id));
    const result = await db.runTransaction(async transaction => {
      const [snapshot, profile, legacyLedger] = await Promise.all([transaction.get(ref), transaction.get(users.doc(req.auth.uid)),
        transaction.get(users.doc(req.auth.uid).collection('transactions').doc(`task_${ref.id}`))]);
      const previous = requireOwned(snapshot, req.auth.uid, 'Task');
      const user = requireUser(profile);
      const changes = { ...input };
      const saved = taskView(ref.id, previous, user, now);
      if ('subtasks' in changes) requireOccurrence(saved, req.body?.occurrenceDay, { allowFuture: true });
      if ('recurrence' in changes && changes.recurrence !== saved.recurrence) {
        if (taskHasCompletion(previous) || legacyLedger.exists) throw new HttpError(409, 'Repeat settings are locked after a completion. Delete this task to stop repeating; its reward history is kept.');
        if (previous.acceptedMilestoneId) throw new HttpError(409, 'A task linked to an accepted milestone cannot become a daily task.');
        if (changes.recurrence === 'daily') {
          changes.recurrenceStartDay = recurrenceStart({ ...previous, ...changes }, user, now);
          changes.subtasksOccurrenceDay = changes.recurrenceStartDay;
        }
      }
      if ((saved.recurrence === 'daily' ? saved.isCompleted : taskHasCompletion(previous) || legacyLedger.exists) && ('size' in changes || 'difficulty' in changes)) {
        if ((changes.size !== undefined && changes.size !== saved.size) || (changes.difficulty !== undefined && changes.difficulty !== saved.difficulty)) throw new HttpError(409, 'Completed task effort and rewards are locked.');
      }
      if (saved.recurrence === 'daily' && 'subtasks' in changes) changes.subtasksOccurrenceDay = saved.occurrenceDay;
      transaction.update(ref, changes);
      return { task: { ...previous, ...changes }, user };
    });
    reply(res, { task: taskView(ref.id, result.task, result.user, now) });
  }));

  router.delete('/tasks/:id', asyncHandler(async (req, res) => {
    const ref = todos.doc(documentId(req.params.id));
    await db.runTransaction(async transaction => {
      requireOwned(await transaction.get(ref), req.auth.uid, 'Task');
      transaction.delete(ref);
    });
    reply(res, { success: true });
  }));

  router.post('/tasks/:id/complete', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const taskRef = todos.doc(documentId(req.params.id));
    const userRef = users.doc(uid);
    const now = clock();
    // Keep the random draw fixed across Firestore's automatic transaction retries.
    const boxRoll = questBoxRandom();
    const result = await db.runTransaction(async transaction => {
      const [taskSnapshot, userSnapshot] = await Promise.all([transaction.get(taskRef), transaction.get(userRef)]);
      const storedTask = requireOwned(taskSnapshot, uid, 'Task');
      const user = requireUser(userSnapshot);
      const task = taskView(taskRef.id, storedTask, user, now);
      requireOccurrence(task, req.body?.occurrenceDay);
      const occurrenceKey = taskOccurrenceKey(taskRef.id, task.occurrenceDay);
      const ledgerRef = userRef.collection('transactions').doc(`task_${occurrenceKey}`);
      const ledgerSnapshot = await transaction.get(ledgerRef);
      // Old versions could reset completed tasks; a historical completion still counts as paid.
      if (task.isCompleted || task.completedAt || task.rewardAwardedAt || ledgerSnapshot.exists) {
        const completed = { ...task, isCompleted: true };
        if (!task.isCompleted) transaction.update(taskRef, { isCompleted: true });
        return { task: completed, user, awarded: false };
      }
      const earned = taskReward(task.difficulty);
      const coins = numericBalance(user.coins) + earned.coins;
      if (!Number.isSafeInteger(coins)) throw new HttpError(409, 'Coin balance limit reached.');
      const companion = awardCompanion(user, { xp: COMPANION_CONFIG.xpTask, bond: COMPANION_CONFIG.bondTask, chargeTask: true });
      const raid = await prepareRaidAttack({ db, transaction, uid, user: { ...user, companion }, taskId: occurrenceKey, task, now });
      const drop = prepareQuestBoxDrop({ uid, user, taskId: occurrenceKey, now, roll: boxRoll });
      const userChanges = { coins, character: addExperience(user.character, earned.exp), companion: raid.companion || companion, questBoxProgress: drop.progress, ...advanceStreak(user, now) };
      const taskChanges = { isCompleted: true, completedAt: now, rewardAwardedAt: now };
      if (task.recurrence === 'daily') Object.assign(taskChanges, {
        completedOccurrenceDay: task.occurrenceDay, subtasksOccurrenceDay: task.occurrenceDay, subtasks: task.subtasks,
        raidCreditId: null, questBoxId: null,
      });
      if (raid.raidAttack?.raidId) taskChanges.raidCreditId = raid.raidAttack.raidId;
      if (drop.box) taskChanges.questBoxId = drop.box.id;
      raid.apply();
      if (drop.box) transaction.set(userRef.collection('questBoxes').doc(drop.box.id), drop.box);
      transaction.update(taskRef, taskChanges);
      transaction.update(userRef, userChanges);
      transaction.set(ledgerRef, {
        type: 'task_completion', description: task.occurrenceDay ? `${task.title} (${task.occurrenceDay})` : task.title, amount: earned.coins, exp: earned.exp,
        balance: coins, sourceId: taskRef.id, createdAt: now,
        ...(task.occurrenceDay ? { occurrenceDay: task.occurrenceDay, recurrence: 'daily' } : {}),
      });
      return { task: { ...storedTask, ...taskChanges }, user: { ...user, ...userChanges }, awarded: true, raidAttack: raid.raidAttack, questBox: drop.box };
    });
    reply(res, { task: taskView(taskRef.id, result.task, result.user, now), user: publicUser(uid, result.user, now), awarded: result.awarded, raidAttack: result.raidAttack || null, questBox: result.questBox || null, questBoxProgress: questBoxProgressView(result.user, now) });
  }));

  router.get('/rewards', asyncHandler(async (req, res) => {
    const snapshot = await rewards.where('userId', '==', req.auth.uid).get();
    reply(res, { rewards: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort(newestFirst) });
  }));

  router.post('/rewards', asyncHandler(async (req, res) => {
    const data = { ...rewardInput(req.body ?? {}), userId: req.auth.uid, redeemed: false, createdAt: new Date() };
    const ref = await rewards.add(data);
    reply(res, { reward: { ...data, id: ref.id } }, 201);
  }));

  router.patch('/rewards/:id', asyncHandler(async (req, res) => {
    const changes = { ...rewardInput(req.body ?? {}, true), updatedAt: new Date() };
    const ref = rewards.doc(documentId(req.params.id));
    const reward = await db.runTransaction(async transaction => {
      const previous = requireOwned(await transaction.get(ref), req.auth.uid, 'Reward');
      if (previous.redeemed) throw new HttpError(409, 'A redeemed reward cannot be edited.');
      transaction.update(ref, changes);
      return { ...previous, ...changes };
    });
    reply(res, { reward: { ...reward, id: ref.id } });
  }));

  router.delete('/rewards/:id', asyncHandler(async (req, res) => {
    const ref = rewards.doc(documentId(req.params.id));
    await db.runTransaction(async transaction => {
      const reward = requireOwned(await transaction.get(ref), req.auth.uid, 'Reward');
      if (reward.redeemed) throw new HttpError(409, 'Redeemed rewards are kept in your history.');
      transaction.delete(ref);
    });
    reply(res, { success: true });
  }));

  router.post('/rewards/:id/redeem', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const rewardRef = rewards.doc(documentId(req.params.id));
    const userRef = users.doc(uid);
    const ledgerRef = userRef.collection('transactions').doc(`reward_${rewardRef.id}`);
    const now = new Date();
    const result = await db.runTransaction(async transaction => {
      const [rewardSnapshot, userSnapshot, ledgerSnapshot] = await Promise.all([transaction.get(rewardRef), transaction.get(userRef), transaction.get(ledgerRef)]);
      const reward = requireOwned(rewardSnapshot, uid, 'Reward');
      const user = requireUser(userSnapshot);
      if (reward.redeemed || ledgerSnapshot.exists) throw new HttpError(409, 'Reward already redeemed.');
      const coins = debit(user.coins, reward.cost);
      const changes = { redeemed: true, redeemedAt: now };
      transaction.update(userRef, { coins });
      transaction.update(rewardRef, changes);
      transaction.set(ledgerRef, { type: 'reward_redemption', description: reward.name, amount: -reward.cost, balance: coins, sourceId: rewardRef.id, createdAt: now });
      return { reward: { ...reward, ...changes, id: rewardRef.id }, user: { ...user, coins } };
    });
    reply(res, { reward: result.reward, user: publicUser(uid, result.user) });
  }));

  router.get('/cards', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const [snapshot, collection] = await Promise.all([users.doc(uid).get(), legacyCards.where('userId', '==', uid).get()]);
    const user = requireUser(snapshot);
    const names = ownedNames(user, collection);
    reply(res, { cards: CARD_CATALOG.map(card => cardView(card, user, names)) });
  }));

  router.post('/cards/:id/purchase', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const card = getCard(req.params.id);
    if (card.unlock.type !== 'shop') throw new HttpError(403, card.unlock.type === 'level' ? 'Earn companion XP to unlock this character at its required level.' : 'Find this companion in an eligible guild boss victory chest.');
    const userRef = users.doc(uid);
    const ledgerRef = userRef.collection('transactions').doc(`card_${card.id}`);
    const collectionRef = legacyCards.doc();
    const now = new Date();
    const result = await db.runTransaction(async transaction => {
      const [snapshot, collection, ledger] = await Promise.all([
        transaction.get(userRef), transaction.get(legacyCards.where('userId', '==', uid)), transaction.get(ledgerRef),
      ]);
      const user = requireUser(snapshot);
      const names = ownedNames(user, collection);
      if (names.has(normalizeCharacter(card.characterName)) || ledger.exists) throw new HttpError(409, 'You already own this card.');
      const coins = debit(user.coins, card.price);
      transaction.update(userRef, { coins });
      transaction.set(collectionRef, {
        userId: uid, characterName: card.characterName, characterTier: card.tier,
        imagePath: card.imagePath, price: card.price, addedAt: now, catalogId: card.id,
      });
      transaction.set(ledgerRef, { type: 'card_purchase', description: card.name, amount: -card.price, balance: coins, sourceId: card.id, createdAt: now });
      names.add(normalizeCharacter(card.characterName));
      return { user: { ...user, coins }, names };
    });
    reply(res, { card: cardView(card, result.user, result.names), user: publicUser(uid, result.user) }, 201);
  }));

  router.post('/cards/:id/equip', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const card = getCard(req.params.id);
    const ref = users.doc(uid);
    const result = await db.runTransaction(async transaction => {
      const [snapshot, collection] = await Promise.all([transaction.get(ref), transaction.get(legacyCards.where('userId', '==', uid))]);
      const user = requireUser(snapshot);
      const names = ownedNames(user, collection);
      if (!names.has(normalizeCharacter(card.characterName))) throw new HttpError(403, 'Unlock or collect this companion before equipping it.');
      // Preserve the starter card when switching away from a legacy account's unrecorded starter.
      const previous = CARD_CATALOG.find(entry => normalizeCharacter(entry.characterName) === normalizeCharacter(user.character?.image));
      const previousName = previous?.characterName || (typeof user.character?.image === 'string' ? user.character.image : '');
      if (previousName && !collection.docs.some(doc => normalizeCharacter(doc.data().characterName) === normalizeCharacter(previousName))) {
        transaction.set(legacyCards.doc(), { userId: uid, characterName: previousName, characterTier: previous?.tier || user.character?.tier || 'common', imagePath: previous?.imagePath || '', addedAt: new Date(), price: 0, source: 'starter' });
      }
      const character = { ...(user.character || { level: 1, exp: 0 }), image: card.characterName, tier: card.tier };
      transaction.update(ref, { character });
      return { user: { ...user, character }, names };
    });
    reply(res, { card: cardView(card, result.user, result.names), user: publicUser(uid, result.user) });
  }));

  const buildReport = async (uid, includeAllTransactions = false) => {
    const [userSnapshot, taskSnapshot, ledgerSnapshot, rewardSnapshot, collection] = await Promise.all([
      users.doc(uid).get(), todos.where('userId', '==', uid).get(), users.doc(uid).collection('transactions').get(),
      rewards.where('userId', '==', uid).get(), legacyCards.where('userId', '==', uid).get(),
    ]);
    const user = requireUser(userSnapshot);
    const now = clock();
    const tasks = taskSnapshot.docs.map(doc => taskView(doc.id, doc.data(), user, now));
    const transactions = ledgerSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort(newestFirst);
    const completedTasks = tasks.filter(task => task.isCompleted).length;
    const today = calendarDay(now, user.timeZone);
    const daily = Array.from({ length: 14 }, (_, index) => ({ date: shiftDay(today, index - 13), completed: 0 }));
    const counts = new Map(daily.map(day => [day.date, day]));
    const recordedTasks = new Set();
    const countCompletion = date => {
      const timestamp = milliseconds(date);
      if (!timestamp) return;
      const day = counts.get(calendarDay(new Date(timestamp), user.timeZone));
      if (day) day.completed += 1;
    };
    for (const entry of transactions) {
      if (entry.type === 'task_completion') { recordedTasks.add(entry.sourceId); countCompletion(entry.createdAt); }
    }
    for (const task of tasks) if (task.isCompleted && !recordedTasks.has(task.id)) countCompletion(task.completedAt);
    const purchasedCards = new Set(transactions.filter(entry => entry.type === 'card_purchase').map(entry => normalizeCharacter(entry.sourceId)));
    for (const doc of collection.docs) if (doc.data().price > 0) purchasedCards.add(normalizeCharacter(doc.data().characterName));
    return serialize({
      summary: {
        totalTasks: tasks.length, completedTasks, pendingTasks: tasks.length - completedTasks,
        totalCompletions: transactions.filter(entry => entry.type === 'task_completion').length + tasks.filter(task => task.isCompleted && !recordedTasks.has(task.id)).length,
        overdueTasks: tasks.filter(task => !task.isCompleted && storedDate(task.dueDate) && milliseconds(task.dueDate) < now.getTime()).length,
        completionRate: tasks.length ? Math.round(completedTasks / tasks.length * 100) : 0,
        coins: numericBalance(user.coins),
        coinsEarned: transactions.reduce((sum, entry) => sum + Math.max(0, entry.amount || 0), 0),
        coinsSpent: transactions.reduce((sum, entry) => sum + Math.max(0, -(entry.amount || 0)), 0),
        cardsPurchased: purchasedCards.size,
        rewardsRedeemed: rewardSnapshot.docs.filter(doc => doc.data().redeemed).length,
      },
      daily, transactions: includeAllTransactions ? transactions : transactions.slice(0, HISTORY_LIMIT), historyLimit: HISTORY_LIMIT,
      historyTruncated: transactions.length > HISTORY_LIMIT,
      historySince: transactions.at(-1)?.createdAt || null,
      historyNote: 'Coin totals and transaction history cover activity recorded by this version. Earlier balances are preserved.',
    });
  };

  router.get('/reports', asyncHandler(async (req, res) => {
    reply(res, await buildReport(req.auth.uid));
  }));

  router.get('/reports/export', asyncHandler(async (req, res) => {
    const report = await buildReport(req.auth.uid, true);
    const csvCell = value => {
      let text = String(value ?? '');
      // Spreadsheet apps must not execute user-controlled task/reward names as formulas.
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [['Created at', 'Type', 'Description', 'Coins', 'Balance'],
      ...report.transactions.map(entry => [entry.createdAt, entry.type, entry.description, entry.amount, entry.balance])];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="prodifyquest-history.csv"');
    res.send(rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
  }));

  return router;
}
