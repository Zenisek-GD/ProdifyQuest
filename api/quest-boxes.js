import express from 'express';
import { CARD_CATALOG } from './catalog.js';
import { awardCompanion, companionState, COMPANION_COSMETICS } from './companion-domain.js';
import { normalizeCharacter, numericBalance } from './domain.js';
import { asyncHandler, HttpError, serialize } from './shared.js';
import {
  normalizeQuestBoxConfig, questBoxProgressView, questBoxRules, questBoxView, randomQuestBoxRoll,
  validateQuestBoxRoll, weightedQuestBoxChoice, QUEST_BOX_COSMETICS, QUEST_BOX_RARITIES, QUEST_BOX_REWARDS,
} from './quest-box-domain.js';

const requireUser = snapshot => {
  if (!snapshot.exists) throw new HttpError(404, 'User profile not found.');
  return snapshot.data();
};
const documentId = id => {
  if (typeof id !== 'string' || !id.startsWith('task_') || id.length <= 5 || id.length > 205 || id.includes('/')) throw new HttpError(400, 'Invalid quest box ID.');
  return id;
};
const time = value => value?.toDate ? value.toDate().getTime() : new Date(value).getTime();
const latestFirst = (left, right, field) => (time(right[field]) || 0) - (time(left[field]) || 0) || left.id.localeCompare(right.id);

function selectReward(draws, config) {
  const selected = weightedQuestBoxChoice(QUEST_BOX_REWARDS, draws[0]).kind;
  const base = { kind: selected, coins: 0, xp: 0, duplicate: false };
  if (selected === 'coins') {
    const coins = config.coinMin + Math.floor(draws[1] * (config.coinMax - config.coinMin + 1));
    return { ...base, coins, label: `${coins} coins`, description: 'Added to your coin balance.' };
  }
  if (selected === 'companion_xp') return { ...base, xp: config.companionXP, label: `${config.companionXP} companion XP`, description: 'Added to companion experience. Bond and spell charge stay unchanged.' };
  if (selected === 'character') {
    const tier = weightedQuestBoxChoice(QUEST_BOX_RARITIES, draws[2]).tier;
    const cards = CARD_CATALOG.filter(card => card.tier === tier && card.questBoxEligible !== false);
    const card = cards[Math.floor(draws[3] * cards.length)];
    if (!card) throw new Error('Quest box companion catalog is incomplete.');
    return { ...base, label: card.name, description: 'Added to your companion collection. Equip it in Companions.', character: { id: card.id, name: card.name, tier: card.tier, imagePath: card.imagePath } };
  }
  const id = QUEST_BOX_COSMETICS[Math.floor(draws[3] * QUEST_BOX_COSMETICS.length)];
  const cosmetic = COMPANION_COSMETICS.find(item => item.id === id && item.source === 'box');
  if (!cosmetic) throw new Error('Quest box cosmetic catalog is incomplete.');
  return { ...base, label: cosmetic.name, description: 'Added to your companion wardrobe. Equip it in Companions.', cosmetic: { id: cosmetic.id, name: cosmetic.name, category: cosmetic.category, color: cosmetic.color } };
}

export function createQuestBoxRouter({ db, now = () => new Date(), random = randomQuestBoxRoll, config: overrides = {} }) {
  const config = normalizeQuestBoxConfig(overrides);
  const router = express.Router();
  const users = db.collection('users');
  const collection = db.collection('userCharacterCollection');

  router.get('/quest-boxes', asyncHandler(async (req, res) => {
    const at = now();
    const userRef = users.doc(req.auth.uid);
    const result = await db.runTransaction(async transaction => {
      const [userSnapshot, boxesSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(userRef.collection('questBoxes'))]);
      const user = requireUser(userSnapshot);
      const all = boxesSnapshot.docs.map(doc => questBoxView(doc.id, doc.data()));
      const unopened = all.filter(box => box.status === 'unopened').sort((a, b) => latestFirst(a, b, 'createdAt'));
      const history = all.filter(box => box.status === 'opened').sort((a, b) => latestFirst(a, b, 'openedAt')).slice(0, 20);
      return { boxes: unopened.slice(0, 100), history, unopenedCount: unopened.length, progress: questBoxProgressView(user, at, config), rules: questBoxRules(at, config) };
    });
    res.json(serialize(result));
  }));

  router.post('/quest-boxes/:id/open', asyncHandler(async (req, res) => {
    const id = documentId(req.params.id);
    if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new HttpError(400, 'Opening a quest box does not accept reward choices.');
    const uid = req.auth.uid;
    const at = now();
    const userRef = users.doc(uid);
    const boxRef = userRef.collection('questBoxes').doc(id);
    const ledgerRef = userRef.collection('transactions').doc(`box_${id}`);
    const collectionRef = collection.doc();
    // Generate once per HTTP request, outside the callback Firestore may retry.
    const draws = Array.from({ length: 4 }, () => validateQuestBoxRoll(random()));
    const result = await db.runTransaction(async transaction => {
      const [userSnapshot, boxSnapshot, ledger, ownedCollection] = await Promise.all([
        transaction.get(userRef), transaction.get(boxRef), transaction.get(ledgerRef),
        transaction.get(collection.where('userId', '==', uid)),
      ]);
      const user = requireUser(userSnapshot);
      if (!boxSnapshot.exists) throw new HttpError(404, 'Quest box not found.');
      const box = boxSnapshot.data();
      if (box.status === 'opened') return { box: questBoxView(id, box), awarded: false };
      if (box.status !== 'unopened' || ledger.exists) throw new HttpError(409, 'This quest box cannot be opened.');
      const reward = selectReward(draws, config);
      let companion = companionState(user);
      let newCard = null;
      if (reward.kind === 'character') {
        const card = CARD_CATALOG.find(entry => entry.id === reward.character.id);
        const owned = new Set(ownedCollection.docs.map(doc => normalizeCharacter(doc.data().characterName)));
        owned.add(normalizeCharacter(user.character?.image));
        if (owned.has(normalizeCharacter(card.characterName))) {
          reward.duplicate = true;
          reward.coins = Math.floor(card.price / 2);
          reward.label = `Duplicate ${card.name}: ${reward.coins} coins`;
          reward.description = `You already own ${card.name}. Added ${reward.coins} coins instead (half its shop price).`;
        } else newCard = card;
      } else if (reward.kind === 'cosmetic') {
        if (companion.ownedCosmetics.includes(reward.cosmetic.id)) {
          reward.duplicate = true;
          reward.coins = config.duplicateCosmeticCoins;
          reward.label = `Duplicate ${reward.cosmetic.name}: ${reward.coins} coins`;
          reward.description = `You already own ${reward.cosmetic.name}. Added ${reward.coins} coins instead.`;
        } else companion.ownedCosmetics = [...companion.ownedCosmetics, reward.cosmetic.id];
      } else if (reward.kind === 'companion_xp') {
        if (!Number.isSafeInteger(companion.xp + reward.xp)) throw new HttpError(409, 'Your companion experience is at its limit.');
        companion = awardCompanion(user, { xp: reward.xp });
      }
      const coins = numericBalance(user.coins) + reward.coins;
      if (!Number.isSafeInteger(coins)) throw new HttpError(409, 'Your coin balance is at its limit.');
      const opened = { ...box, status: 'opened', openedAt: at, reward };
      transaction.update(userRef, { coins, companion });
      if (newCard) transaction.set(collectionRef, {
        userId: uid, characterName: newCard.characterName, characterTier: newCard.tier,
        imagePath: newCard.imagePath, price: newCard.price, addedAt: at, catalogId: newCard.id,
        source: 'quest_box', sourceId: id,
      });
      transaction.update(boxRef, { status: 'opened', openedAt: at, reward });
      transaction.set(ledgerRef, {
        type: 'box_reward', description: `Quest box: ${reward.label}`, amount: reward.coins,
        balance: coins, exp: reward.xp, rewardKind: reward.kind, duplicate: reward.duplicate,
        sourceId: id, createdAt: at,
      });
      return { box: questBoxView(id, opened), awarded: true };
    });
    res.json(serialize(result));
  }));
  return router;
}
