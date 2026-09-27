import express from 'express';
import { debit, numericBalance, textField } from './domain.js';
import { HttpError, asyncHandler, serialize } from './shared.js';
import { awardCompanion, companionState, companionView, COMPANION_CONFIG, COMPANION_COSMETICS } from './companion-domain.js';
import { wardrobeState } from './customization-domain.js';

const requireUser = snapshot => {
  if (!snapshot.exists) throw new HttpError(404, 'User profile not found.');
  return snapshot.data();
};
const documentId = id => {
  if (typeof id !== 'string' || !id || id.includes('/') || id.length > 200) throw new HttpError(400, 'Invalid record ID.');
  return id;
};
const milliseconds = value => value?.toDate ? value.toDate().getTime() : new Date(value).getTime();
const elapsedMilliseconds = (focus, now) => Math.min(focus.durationSeconds * 1000,
  Math.max(0, focus.elapsedMilliseconds || 0) + (focus.status === 'running' ? Math.max(0, now.getTime() - milliseconds(focus.runningSince)) : 0));

export function focusView(id, focus, now = new Date()) {
  if (!focus) return null;
  const elapsed = elapsedMilliseconds(focus, now);
  return {
    id, status: focus.status, durationSeconds: focus.durationSeconds,
    elapsedSeconds: Math.floor(elapsed / 1000), remainingSeconds: Math.max(0, Math.ceil(focus.durationSeconds - elapsed / 1000)),
    startedAt: focus.startedAt, updatedAt: focus.updatedAt, completedAt: focus.completedAt || null,
  };
}

export function createCompanionRouter({ db, now = () => new Date(), config: overrides = {} }) {
  const config = { ...COMPANION_CONFIG, ...overrides };
  for (const field of ['xpTask', 'bondTask', 'xpFocus', 'bondFocus', 'xpPerLevel']) {
    if (!Number.isSafeInteger(config[field]) || config[field] < (field === 'xpPerLevel' ? 1 : 0)) throw new Error(`Invalid companion configuration: ${field}`);
  }
  if (!Array.isArray(config.focusMinutes) || !config.focusMinutes.length || config.focusMinutes.some(minutes => !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 180)) {
    throw new Error('Focus durations must be whole minutes between 1 and 180.');
  }
  config.focusMinutes = [...new Set(config.focusMinutes)];
  if (!config.focusMinutes.includes(config.focusDefaultMinutes)) config.focusDefaultMinutes = config.focusMinutes[0];
  const router = express.Router();
  const users = db.collection('users');
  const reply = (res, user, extra = {}, status = 200, at = now()) => res.status(status).json(serialize({
    companion: companionView(user, at, config), wardrobe: wardrobeState(user), serverTime: at, config, ...extra,
  }));

  router.get('/companion', asyncHandler(async (req, res) => {
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const result = await db.runTransaction(async transaction => {
      const user = requireUser(await transaction.get(userRef));
      const focusId = companionState(user).activeFocusId;
      const focus = focusId ? await transaction.get(userRef.collection('focusSessions').doc(focusId)) : null;
      const wardrobe = wardrobeState(user);
      if (JSON.stringify(user.wardrobe) !== JSON.stringify(wardrobe)) transaction.update(userRef, { wardrobe });
      return { user: { ...user, wardrobe }, focus: focus?.exists ? focusView(focusId, focus.data(), at) : null };
    });
    reply(res, result.user, { focus: result.focus }, 200, at);
  }));

  router.patch('/companion', asyncHandler(async (req, res) => {
    const nickname = textField(req.body?.nickname, 'Nickname', 32, true);
    if (Object.keys(req.body).some(key => key !== 'nickname')) throw new HttpError(400, 'Only the companion nickname can be changed here.');
    const userRef = users.doc(req.auth.uid);
    const user = await db.runTransaction(async transaction => {
      const previous = requireUser(await transaction.get(userRef));
      const companion = { ...companionState(previous), nickname };
      transaction.update(userRef, { companion });
      return { ...previous, companion };
    });
    reply(res, user);
  }));

  router.post('/companion/visit', asyncHandler(async (req, res) => {
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const result = await db.runTransaction(async transaction => {
      const previous = requireUser(await transaction.get(userRef));
      const greeting = companionView(previous, at, config).greeting;
      const companion = { ...companionState(previous), lastVisitAt: at };
      transaction.update(userRef, { companion });
      return { user: { ...previous, companion }, greeting };
    });
    reply(res, result.user, { greeting: result.greeting }, 200, at);
  }));

  for (const operation of ['purchase', 'equip']) router.post(`/companion/cosmetics/:id/${operation}`, asyncHandler(async (req, res) => {
    const cosmetic = COMPANION_COSMETICS.find(item => item.id === req.params.id);
    if (!cosmetic) throw new HttpError(404, 'Cosmetic not found.');
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const ledgerRef = userRef.collection('transactions').doc(`cosmetic_${cosmetic.id}`);
    const result = await db.runTransaction(async transaction => {
      const [snapshot, ledger] = await Promise.all([transaction.get(userRef), transaction.get(ledgerRef)]);
      const user = requireUser(snapshot);
      const companion = companionState(user);
      const owned = companion.ownedCosmetics.includes(cosmetic.id);
      if (companion.bond < cosmetic.requiredBond) throw new HttpError(403, `Reach ${cosmetic.requiredBond} bond to unlock this cosmetic.`);
      if (operation === 'equip') {
        if (!owned) throw new HttpError(403, 'Own this cosmetic before equipping it.');
        companion.equipped = { ...companion.equipped, [cosmetic.category]: cosmetic.id };
        transaction.update(userRef, { companion });
        return { user: { ...user, companion }, purchased: false };
      }
      if (owned || ledger.exists) throw new HttpError(409, 'You already own this cosmetic.');
      if (cosmetic.source !== 'shop') throw new HttpError(403, cosmetic.source === 'raid' ? 'Earn this cosmetic from a guild victory chest.' : cosmetic.source === 'box' ? 'Find this cosmetic in a quest mystery box.' : 'Earn this cosmetic by growing your bond.');
      const coins = debit(user.coins, cosmetic.price);
      companion.ownedCosmetics = [...companion.ownedCosmetics, cosmetic.id];
      transaction.update(userRef, { coins, companion });
      transaction.set(ledgerRef, { type: 'cosmetic_purchase', description: cosmetic.name, amount: -cosmetic.price, balance: coins, sourceId: cosmetic.id, createdAt: at });
      return { user: { ...user, coins, companion }, purchased: true };
    });
    reply(res, result.user, { coins: numericBalance(result.user.coins), purchased: result.purchased }, result.purchased ? 201 : 200, at);
  }));

  router.post('/focus', asyncHandler(async (req, res) => {
    const minutes = req.body?.minutes ?? config.focusDefaultMinutes;
    if (!config.focusMinutes.includes(minutes)) throw new HttpError(400, `Choose a focus session from these durations: ${config.focusMinutes.join(', ')} minutes.`);
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const focusRef = userRef.collection('focusSessions').doc();
    const result = await db.runTransaction(async transaction => {
      const user = requireUser(await transaction.get(userRef));
      const companion = companionState(user);
      if (companion.activeFocusId) {
        const current = await transaction.get(userRef.collection('focusSessions').doc(companion.activeFocusId));
        if (current.exists && ['running', 'paused'].includes(current.data().status)) throw new HttpError(409, 'Finish or cancel your current focus session before starting another.');
      }
      const focus = { status: 'running', durationSeconds: minutes * 60, elapsedMilliseconds: 0, runningSince: at, startedAt: at, updatedAt: at };
      companion.activeFocusId = focusRef.id;
      transaction.set(focusRef, focus);
      transaction.update(userRef, { companion });
      return { user: { ...user, companion }, focus };
    });
    reply(res, result.user, { focus: focusView(focusRef.id, result.focus, at) }, 201, at);
  }));

  for (const action of ['pause', 'resume', 'cancel', 'complete']) router.post(`/focus/:id/${action}`, asyncHandler(async (req, res) => {
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const focusRef = userRef.collection('focusSessions').doc(documentId(req.params.id));
    const result = await db.runTransaction(async transaction => {
      const [userSnapshot, focusSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(focusRef)]);
      const user = requireUser(userSnapshot);
      if (!focusSnapshot.exists) throw new HttpError(404, 'Focus session not found.');
      const focus = focusSnapshot.data();
      if (action === 'complete' && focus.status === 'completed' || action === 'cancel' && focus.status === 'cancelled') return { user, focus, awarded: false };
      if (!['running', 'paused'].includes(focus.status)) throw new HttpError(409, 'This focus session has already ended.');
      let companion = companionState(user);
      if (companion.activeFocusId !== focusRef.id) throw new HttpError(409, 'This is no longer your active focus session.');
      const elapsed = elapsedMilliseconds(focus, at);
      let changes = {};
      let awarded = false;
      if (action === 'pause' && focus.status === 'running') changes = { status: 'paused', elapsedMilliseconds: elapsed, runningSince: null };
      if (action === 'resume' && focus.status === 'paused') changes = { status: 'running', runningSince: at };
      if (action === 'cancel') {
        changes = { status: 'cancelled', elapsedMilliseconds: elapsed, runningSince: null, cancelledAt: at };
        companion.activeFocusId = null;
      }
      if (action === 'complete') {
        if (elapsed < focus.durationSeconds * 1000) throw new HttpError(409, 'Your focus timer has not finished yet.');
        changes = { status: 'completed', elapsedMilliseconds: focus.durationSeconds * 1000, runningSince: null, completedAt: at, rewardAwardedAt: at };
        companion = { ...awardCompanion(user, { xp: config.xpFocus, bond: config.bondFocus }), activeFocusId: null, lastActivity: 'focus' };
        awarded = true;
      }
      if (Object.keys(changes).length) {
        changes.updatedAt = at;
        transaction.update(focusRef, changes);
        transaction.update(userRef, { companion });
      }
      return { user: { ...user, companion }, focus: { ...focus, ...changes }, awarded };
    });
    reply(res, result.user, { focus: focusView(focusRef.id, result.focus, at), awarded: result.awarded }, 200, at);
  }));

  return router;
}
