import { Router } from 'express';
import { debit, numericBalance } from './domain.js';
import { companionView, COMPANION_CONFIG } from './companion-domain.js';
import { characterBuild, equipmentState, GEAR, playerLevel, validateLook, wardrobeState, WARDROBE_ITEMS } from './customization-domain.js';
import { HttpError, asyncHandler, serialize } from './shared.js';

export function createCustomizationRouter({ db, now = () => new Date() }) {
  const router = Router();
  const users = db.collection('users');
  router.use((req, _res, next) => req.auth?.uid ? next() : next(new HttpError(401, 'Authentication required.')));
  const requireUser = snapshot => {
    if (!snapshot.exists) throw new HttpError(404, 'User profile not found.');
    return snapshot.data();
  };
  const reply = (res, kind, user, extra = {}) => res.json(serialize(kind === 'wardrobe'
    ? { wardrobe: wardrobeState(user), items: WARDROBE_ITEMS, level: playerLevel(user), coins: numericBalance(user.coins),
      companion: companionView(user, now()), config: COMPANION_CONFIG, serverTime: now(), ...extra }
    : { ...equipmentState(user), items: GEAR, build: characterBuild(user), coins: numericBalance(user.coins), ...extra }));
  for (const kind of ['wardrobe', 'equipment']) {
    router.get(`/${kind}`, asyncHandler(async (req, res) => {
      const ref = users.doc(req.auth.uid);
      const user = await db.runTransaction(async transaction => {
        const previous = requireUser(await transaction.get(ref));
        const value = kind === 'wardrobe' ? wardrobeState(previous) : equipmentState(previous);
        // Persist inferred starter/level grants so later profile changes cannot remove ownership.
        if (JSON.stringify(previous[kind]) !== JSON.stringify(value)) transaction.update(ref, { [kind]: value });
        return { ...previous, [kind]: value };
      });
      reply(res, kind, user);
    }));
    router.post(`/${kind}/items/:itemId/purchase`, asyncHandler(async (req, res) => {
      const item = (kind === 'wardrobe' ? WARDROBE_ITEMS : GEAR).find(entry => entry.id === req.params.itemId);
      if (!item) throw new HttpError(404, 'Item not found.');
      const shop = kind === 'wardrobe' ? item.unlock.type === 'shop' : item.unlock === 'shop';
      if (!shop) throw new HttpError(403, 'This item must be earned through its listed unlock.');
      const price = kind === 'wardrobe' ? item.unlock.coins : item.price;
      const userRef = users.doc(req.auth.uid);
      const ledgerRef = userRef.collection('transactions').doc(`${kind}_${item.id}`);
      const result = await db.runTransaction(async transaction => {
        const [snapshot, ledger] = await Promise.all([transaction.get(userRef), transaction.get(ledgerRef)]);
        const previous = requireUser(snapshot);
        const state = kind === 'wardrobe' ? wardrobeState(previous) : equipmentState(previous);
        if (state.ownedItemIds.includes(item.id) || ledger.exists) return { user: previous, purchased: false };
        const coins = debit(previous.coins, price);
        state.ownedItemIds.push(item.id);
        transaction.update(userRef, { coins, [kind]: state });
        transaction.set(ledgerRef, { type: `${kind}_purchase`, description: item.name, amount: -price, balance: coins, sourceId: item.id, createdAt: now() });
        return { user: { ...previous, coins, [kind]: state }, purchased: true };
      });
      reply(res, kind, result.user, { purchased: result.purchased });
    }));
  }
  async function changeWardrobe(req, res, operation) {
    const userRef = users.doc(req.auth.uid);
    const user = await db.runTransaction(async transaction => {
      const previous = requireUser(await transaction.get(userRef));
      const wardrobe = wardrobeState(previous);
      operation(wardrobe);
      transaction.update(userRef, { wardrobe });
      return { ...previous, wardrobe };
    });
    reply(res, 'wardrobe', user);
  }
  router.patch('/wardrobe/equip', asyncHandler((req, res) => changeWardrobe(req, res, wardrobe => {
    wardrobe.equipped = validateLook(req.body, wardrobe.ownedItemIds);
  })));
  const slot = req => {
    if (!/^[012]$/.test(req.params.slot)) throw new HttpError(400, 'Choose favorite slot 0, 1 or 2.');
    return Number(req.params.slot);
  };
  router.put('/wardrobe/presets/:slot', asyncHandler((req, res) => {
    const index = slot(req);
    return changeWardrobe(req, res, wardrobe => { wardrobe.presets[index] = validateLook(req.body, wardrobe.ownedItemIds); });
  }));
  router.post('/wardrobe/presets/:slot/equip', asyncHandler((req, res) => {
    const index = slot(req);
    return changeWardrobe(req, res, wardrobe => {
      if (!wardrobe.presets[index]) throw new HttpError(404, 'This favorite slot is empty.');
      wardrobe.equipped = validateLook(wardrobe.presets[index], wardrobe.ownedItemIds);
    });
  }));
  router.post('/equipment/items/:itemId/equip', asyncHandler(async (req, res) => {
    const item = GEAR.find(entry => entry.id === req.params.itemId);
    if (!item) throw new HttpError(404, 'Equipment item not found.');
    const userRef = users.doc(req.auth.uid);
    const user = await db.runTransaction(async transaction => {
      const previous = requireUser(await transaction.get(userRef));
      const equipment = equipmentState(previous);
      if (!equipment.ownedItemIds.includes(item.id)) throw new HttpError(403, 'Own this item before equipping it.');
      equipment.equipped[item.slot] = item.id;
      transaction.update(userRef, { equipment });
      return { ...previous, equipment };
    });
    reply(res, 'equipment', user);
  }));
  return router;
}
