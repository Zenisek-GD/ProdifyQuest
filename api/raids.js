import { createHash } from 'node:crypto';
import { Router } from 'express';
import { HttpError, asyncHandler, serialize } from './shared.js';
import { numericBalance, textField } from './domain.js';
import { awardCompanion, COMPANION_CONFIG } from './companion-domain.js';
import { bossChestOdds, bossCompanionReward, randomBossChestRoll } from './character-rewards.js';
import { calculateAttack, DREADROOT_CONFIG, instant, isDreadroot, nextRevision, RAID_CONFIG, raidParticipants, raidStatus, raidView, utcDay } from './raid-domain.js';
import { characterBuild, equipmentState, GEAR_POOL, itemOdds, itemReward, wardrobeState, WARDROBE_POOL } from './customization-domain.js';

const id = value => {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 200) throw new HttpError(400, 'Invalid record ID.');
  return value;
};
const membersOf = guild => Array.isArray(guild.members) ? guild.members : [];
const memberName = user => typeof user?.username === 'string' && user.username.trim() ? user.username.trim().slice(0, 80) : 'Adventurer';
const requireMember = (snapshot, uid) => {
  if (!snapshot.exists) throw new HttpError(404, 'Guild not found.');
  const guild = snapshot.data();
  if (!membersOf(guild).includes(uid)) throw new HttpError(403, 'You must be a guild member to access this guild.');
  return guild;
};
const requireOwner = (guild, uid) => {
  if (guild.createdBy !== uid) throw new HttpError(403, 'Only the guild owner can manage raids and accept project milestones.');
};
const requireUser = snapshot => {
  if (!snapshot.exists) throw new HttpError(404, 'User profile not found.');
  return snapshot.data();
};
const requireRaid = (snapshot, guildId) => {
  if (!snapshot.exists || snapshot.data().guildId !== guildId) throw new HttpError(404, 'Raid not found.');
  return snapshot.data();
};
const noAttack = reason => ({ apply() {}, raidAttack: { damage: 0, bonusDamage: 0, defeated: false, reason } });

/**
 * Complete every read before calling apply(). Safe to combine with the parent task
 * transaction. Private titles and task identifiers never enter shared activity.
 */
export async function prepareRaidAttack({ db, transaction, uid, user, taskId, task, now = new Date(), eventType = 'task', requiredGuildId }) {
  if (!user.activeRaidId) return noAttack('no_active_raid');
  const raidRef = db.collection('guildRaids').doc(id(user.activeRaidId));
  const eventId = createHash('sha256').update(`${eventType}:${uid}:${taskId}`).digest('hex');
  const eventRef = raidRef.collection('contributions').doc(eventId);
  const [raidSnapshot, eventSnapshot] = await Promise.all([transaction.get(raidRef), transaction.get(eventRef)]);
  if (!raidSnapshot.exists) return noAttack('no_active_raid');
  const raid = raidSnapshot.data();
  if (requiredGuildId && raid.guildId !== requiredGuildId) return noAttack('different_guild');
  const guildRef = db.collection('guilds').doc(id(raid.guildId));
  const guildSnapshot = await transaction.get(guildRef);
  if (!guildSnapshot.exists || !membersOf(guildSnapshot.data()).includes(uid)) return noAttack('not_a_member');
  if (!Object.hasOwn(raid.participants || {}, uid)) return noAttack('not_participating');
  if (eventSnapshot.exists) return noAttack('already_counted');
  if (raidStatus(raid, now) !== 'active' || instant(now) < instant(raid.startedAt)) return noAttack('raid_inactive');
  if (task.raidCreditId || task.acceptedMilestoneId) return noAttack('already_counted');
  if (task.completedAt && (instant(task.completedAt) < instant(raid.startedAt) || instant(task.completedAt) >= instant(raid.expiresAt))) return noAttack('completion_outside_raid');
  const guild = guildSnapshot.data();
  if (isDreadroot(raid)) {
    const previous = raid.participants[uid];
    const dailyCharges = previous.chargeDay === utcDay(now) ? previous.dailyCharges || 0 : 0;
    const chargesEarned = dailyCharges < raid.config.dailyChargeLimit ? 1 : 0;
    const participant = { ...previous, charges: (previous.charges || 0) + chargesEarned,
      chargeDay: utcDay(now), dailyCharges: dailyCharges + chargesEarned };
    return {
      companion: user.companion,
      raidAttack: { raidId: raidRef.id, damage: 0, bonusDamage: 0, defeated: false, chargesEarned, charges: participant.charges,
        ...(chargesEarned ? {} : { reason: 'daily_charge_limit' }) },
      apply() {
        transaction.update(raidRef, { participants: { ...raid.participants, [uid]: participant }, revision: nextRevision(raid) });
        transaction.set(eventRef, { uid, sourceId: taskId, sourceType: eventType, damage: 0, chargesEarned, createdAt: now });
      },
    };
  }
  const attack = calculateAttack(raid, uid, user, task.size, now);
  const defeated = attack.hp === 0;
  const recentAttack = {
    uid, username: memberName(user), companion: user.companion?.nickname || 'Study companion',
    damage: attack.damage, bonusDamage: attack.bonusDamage, createdAt: now,
  };
  const changes = {
    hp: attack.hp, participants: { ...raid.participants, [uid]: attack.participant }, revision: nextRevision(raid),
    ...(attack.damage > 0 ? { recentAttacks: [...(raid.recentAttacks || []), recentAttack].slice(-30) } : {}),
    ...(defeated ? { status: 'defeated', defeatedAt: now } : {}),
  };
  return {
    companion: attack.companion,
    raidAttack: { raidId: raidRef.id, damage: attack.damage, bonusDamage: attack.bonusDamage,
      defeated, ...(attack.damage === 0 ? { reason: 'daily_limit' } : {}) },
    apply() {
      transaction.update(raidRef, changes);
      transaction.set(eventRef, { uid, sourceId: taskId, sourceType: eventType, damage: attack.damage, bonusDamage: attack.bonusDamage, createdAt: now });
      if (defeated) {
        const trophies = Array.isArray(guild.trophies) ? guild.trophies : [];
        transaction.update(guildRef, { trophies: [...trophies.filter(trophy => trophy.raidId !== raidRef.id),
          { raidId: raidRef.id, bossName: raid.bossName, defeatedAt: now }].slice(-100) });
      }
    },
  };
}

function milestoneInput(input, partial = false) {
  const result = {};
  if (!partial || 'title' in input) result.title = textField(input.title, 'Milestone title', 160, true);
  if (!partial || 'category' in input) result.category = textField(input.category ?? 'research', 'Category', 40, true);
  if (!partial || 'assigneeId' in input) result.assigneeId = id(input.assigneeId);
  if (!partial || 'size' in input) {
    if (!['small', 'medium', 'large'].includes(input.size ?? 'small')) throw new HttpError(400, 'Size must be small, medium, or large.');
    result.size = input.size ?? 'small';
  }
  if (!partial || 'taskId' in input) result.taskId = input.taskId ? id(input.taskId) : null;
  if (partial && !Object.keys(result).length) throw new HttpError(400, 'No milestone changes were provided.');
  return result;
}

export function createRaidRouter({ db, now: clock = () => new Date(), config = RAID_CONFIG, bossChestRandom = randomBossChestRoll,
  battleRandom = randomBossChestRoll, gearRandom = randomBossChestRoll, wardrobeRandom = randomBossChestRoll }) {
  const router = Router();
  const guilds = db.collection('guilds');
  const raids = db.collection('guildRaids');
  const users = db.collection('users');
  const projects = db.collection('guildProjects');
  const reply = (res, body, status = 200) => res.status(status).json(serialize(body));
  router.use((req, _res, next) => req.auth?.uid ? next() : next(new HttpError(401, 'Authentication required.')));

  // Read earned, unopened chests without claiming them. Query the raid archive,
  // rather than the capped trophy feed, so saving a chest never ages it out.
  router.get('/inventory/chests', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const now = clock();
    const memberships = await guilds.where('members', 'array-contains', uid).get();
    const entries = await Promise.all(memberships.docs.map(async guildSnapshot => {
      const guild = guildSnapshot.data();
      const history = await raids.where('guildId', '==', guildSnapshot.id).get();
      return history.docs.filter(snapshot => raidView(snapshot.id, snapshot.data(), uid, guild, now).canClaim)
        .map(snapshot => {
          const raid = snapshot.data();
          return { id: snapshot.id, raidId: snapshot.id, guildId: guildSnapshot.id, guildName: guild.name,
            bossId: raid.bossId || 'deadline-dragon', bossName: raid.bossName, defeatedAt: raid.defeatedAt || null,
            rewardCoins: raid.config.rewardCoins, rewardXp: raid.config.rewardXp,
            companionOdds: bossChestOdds(raid.config.rewardCompanions),
            gearOdds: isDreadroot(raid) ? itemOdds(raid.config.rewardGear) : [],
            wardrobeOdds: isDreadroot(raid) ? itemOdds(raid.config.rewardWardrobe) : [] };
        });
    }));
    reply(res, { bossChests: entries.flat().sort((a, b) => instant(a.defeatedAt) - instant(b.defeatedAt)), serverTime: now });
  }));

  router.get('/guilds/:id/raid', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const now = clock();
    const result = await db.runTransaction(async transaction => {
      const guild = requireMember(await transaction.get(guildRef), uid);
      const snapshot = guild.activeRaidId ? await transaction.get(raids.doc(id(guild.activeRaidId))) : null;
      const history = await Promise.all((guild.trophies || [])
        .filter(trophy => trophy.raidId !== guild.activeRaidId)
        .map(trophy => transaction.get(raids.doc(id(trophy.raidId)))));
      const pendingRewards = history.filter(entry => entry.exists).map(entry => raidView(entry.id, entry.data(), uid, guild, now))
        .filter(entry => entry.canClaim).map(entry => ({ raidId: entry.id, bossName: entry.bossName,
          rewardCoins: entry.config.rewardCoins, rewardXp: entry.config.rewardXp }));
      return { raid: snapshot?.exists ? raidView(snapshot.id, snapshot.data(), uid, guild, now) : null,
        config, bossCompanionOdds: bossChestOdds(snapshot?.data()?.config?.rewardCompanions),
        bossGearOdds: itemOdds(snapshot?.data()?.config?.rewardGear || GEAR_POOL),
        bossWardrobeOdds: itemOdds(snapshot?.data()?.config?.rewardWardrobe || WARDROBE_POOL),
        trophies: guild.trophies || [], pendingRewards, serverTime: now };
    });
    reply(res, result);
  }));

  router.post('/guilds/:id/raids', asyncHandler(async (req, res) => {
    const bossId = req.body?.bossId ?? 'deadline-dragon';
    if (!['deadline-dragon', 'dreadroot'].includes(bossId)) throw new HttpError(400, 'Choose Deadline Dragon or Dreadroot Sentinel.');
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const raidRef = raids.doc();
    const now = clock();
    const result = await db.runTransaction(async transaction => {
      const guild = requireMember(await transaction.get(guildRef), uid);
      requireOwner(guild, uid);
      if (guild.activeRaidId) {
        const previous = await transaction.get(raids.doc(id(guild.activeRaidId)));
        if (previous.exists && ['recruiting', 'active'].includes(raidStatus(previous.data(), now))) throw new HttpError(409, 'This guild already has an open raid.');
      }
      const raid = { guildId: guildRef.id, bossId, bossName: bossId === 'dreadroot' ? 'Dreadroot Sentinel' : 'Deadline Dragon', createdBy: uid,
        status: 'recruiting', config: structuredClone(bossId === 'dreadroot' ? DREADROOT_CONFIG : config), revision: 1, participants: {}, maxHp: 0, hp: 0,
        createdAt: now, startedAt: null, expiresAt: null, recentAttacks: [] };
      transaction.set(raidRef, raid);
      transaction.update(guildRef, { activeRaidId: raidRef.id });
      return { raid: raidView(raidRef.id, raid, uid, guild, now) };
    });
    reply(res, result, 201);
  }));

  router.post('/guilds/:id/raids/:raidId/join', asyncHandler(async (req, res) => {
    if (req.body?.acceptRequirements !== true) throw new HttpError(400, 'Review the raid rewards and contribution requirement before joining.');
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const raidRef = raids.doc(id(req.params.raidId));
    const userRef = users.doc(uid);
    const now = clock();
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, raidSnapshot, userSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(raidRef), transaction.get(userRef)]);
      const guild = requireMember(guildSnapshot, uid);
      const raid = requireRaid(raidSnapshot, guildRef.id);
      const user = requireUser(userSnapshot);
      if (raidStatus(raid, now) !== 'recruiting' || guild.activeRaidId !== raidRef.id) throw new HttpError(409, 'Participants are locked once the raid starts.');
      const alreadyJoined = Object.hasOwn(raid.participants, uid);
      if (!alreadyJoined && raidParticipants(raid).length >= 100) throw new HttpError(409, 'This raid is full.');
      if (user.activeRaidId && user.activeRaidId !== raidRef.id) {
        const previous = await transaction.get(raids.doc(id(user.activeRaidId)));
        if (previous.exists && ['recruiting', 'active'].includes(raidStatus(previous.data(), now))) {
          const previousGuild = await transaction.get(guilds.doc(id(previous.data().guildId)));
          if (previousGuild.exists && membersOf(previousGuild.data()).includes(uid)) throw new HttpError(409, 'You are already participating in another open raid.');
        }
      }
      if (alreadyJoined) {
        if (user.activeRaidId !== raidRef.id) transaction.update(userRef, { activeRaidId: raidRef.id });
        return { raid: raidView(raidRef.id, raid, uid, guild, now) };
      }
      const updated = { ...raid, revision: nextRevision(raid), participants: { ...raid.participants, [uid]: {
        username: memberName(user), damage: 0, dailyDay: '', dailyDamage: 0, claimed: false, joinedAt: now,
        ...(isDreadroot(raid) ? { charges: 0, chargeDay: '', dailyCharges: 0 } : {}),
      } } };
      transaction.update(raidRef, { participants: updated.participants, revision: updated.revision });
      transaction.update(userRef, { activeRaidId: raidRef.id });
      return { raid: raidView(raidRef.id, updated, uid, guild, now) };
    });
    reply(res, result);
  }));

  router.post('/guilds/:id/raids/:raidId/start', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const raidRef = raids.doc(id(req.params.raidId));
    const now = clock();
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, raidSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(raidRef)]);
      const guild = requireMember(guildSnapshot, uid);
      requireOwner(guild, uid);
      const raid = requireRaid(raidSnapshot, guildRef.id);
      if (raid.status !== 'recruiting' || guild.activeRaidId !== raidRef.id) throw new HttpError(409, 'This raid has already started.');
      const candidates = Object.entries(raid.participants).filter(([member]) => membersOf(guild).includes(member));
      const profiles = await Promise.all(candidates.map(([member]) => transaction.get(users.doc(member))));
      // Someone may leave, join another raid, and later return before this raid starts.
      // Lock health only for members still committed to this recruitment.
      const participants = Object.fromEntries(candidates.filter((_, index) => profiles[index].data()?.activeRaidId === raidRef.id));
      const count = Object.keys(participants).length;
      if (!count) throw new HttpError(409, 'At least one member must join before starting.');
      const maxHp = count * raid.config.hpPerParticipant;
      const changes = { participants, status: 'active', maxHp, hp: maxHp, startedAt: now, revision: nextRevision(raid),
        expiresAt: new Date(instant(now) + raid.config.durationDays * 86400000) };
      transaction.update(raidRef, changes);
      return { raid: raidView(raidRef.id, { ...raid, ...changes }, uid, guild, now) };
    });
    reply(res, result);
  }));

  router.post('/guilds/:id/raids/:raidId/attack', asyncHandler(async (req, res) => {
    const attackId = req.body?.attackId;
    if (typeof attackId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(attackId)) throw new HttpError(400, 'Provide a unique attack ID of 8 to 100 letters, numbers, underscores or hyphens.');
    if (Object.keys(req.body).some(key => key !== 'attackId')) throw new HttpError(400, 'Only an attack ID is accepted; attack stats are calculated by the server.');
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const raidRef = raids.doc(id(req.params.raidId));
    const userRef = users.doc(uid);
    const attackRef = raidRef.collection('attacks').doc(createHash('sha256').update(JSON.stringify([uid, attackId])).digest('hex'));
    const now = clock();
    const roll = battleRandom();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Invalid battle random draw.');
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, raidSnapshot, userSnapshot, previous] = await Promise.all([
        transaction.get(guildRef), transaction.get(raidRef), transaction.get(userRef), transaction.get(attackRef),
      ]);
      const guild = requireMember(guildSnapshot, uid);
      const raid = requireRaid(raidSnapshot, guildRef.id);
      const user = requireUser(userSnapshot);
      if (!isDreadroot(raid)) throw new HttpError(409, 'This boss takes damage directly from eligible task completions.');
      // Replays remain available after victory or a newer event, without spending again.
      if (previous.exists) return { raid: raidView(raidRef.id, raid, uid, guild, now), attack: previous.data().result, replayed: true };
      const participant = raid.participants?.[uid];
      if (!participant || user.activeRaidId !== raidRef.id) throw new HttpError(403, 'Join this raid before contributing attacks.');
      if (guild.activeRaidId !== raidRef.id || raidStatus(raid, now) !== 'active' || instant(now) < instant(raid.startedAt) || raid.hp <= 0) throw new HttpError(409, 'This raid is no longer active. Your charge was not spent.');
      if (!Number.isSafeInteger(participant.charges) || participant.charges < 1) throw new HttpError(409, 'Complete an eligible task to earn an attack charge.');
      const equipment = equipmentState(user);
      const build = characterBuild(user, equipment, raid.config.defense);
      const critical = roll < build.critChance;
      const rolledDamage = critical ? build.criticalDamage : build.normalDamage;
      const damage = Math.min(raid.hp, rolledDamage);
      const hpAfter = raid.hp - damage;
      const revision = nextRevision(raid);
      const attack = { attackId, raidId: raidRef.id, companionId: build.companionId, imagePath: build.imagePath,
        build, equipped: equipment.equipped, damage, rolledDamage, critical, hpBefore: raid.hp, hpAfter,
        defeated: hpAfter === 0, revision, createdAt: now };
      const member = { ...participant, charges: participant.charges - 1, damage: (participant.damage || 0) + damage };
      const recentAttack = { uid, username: memberName(user), companion: build.name, damage, bonusDamage: 0, critical, createdAt: now };
      const changes = { hp: hpAfter, revision, participants: { ...raid.participants, [uid]: member },
        recentAttacks: [...(raid.recentAttacks || []), recentAttack].slice(-30),
        ...(hpAfter === 0 ? { status: 'defeated', defeatedAt: now } : {}) };
      transaction.update(raidRef, changes);
      transaction.set(attackRef, { uid, result: attack });
      if (hpAfter === 0) {
        const trophies = Array.isArray(guild.trophies) ? guild.trophies : [];
        transaction.update(guildRef, { trophies: [...trophies.filter(trophy => trophy.raidId !== raidRef.id),
          { raidId: raidRef.id, bossName: raid.bossName, defeatedAt: now }].slice(-100) });
      }
      return { raid: raidView(raidRef.id, { ...raid, ...changes }, uid, guild, now), attack, replayed: false };
    });
    reply(res, result);
  }));

  router.post('/guilds/:id/raids/:raidId/claim', asyncHandler(async (req, res) => {
    const uid = req.auth.uid;
    const guildRef = guilds.doc(id(req.params.id));
    const raidRef = raids.doc(id(req.params.raidId));
    const userRef = users.doc(uid);
    const ledgerRef = userRef.collection('transactions').doc(`raid_${raidRef.id}`);
    const now = clock();
    const companionRoll = bossChestRandom();
    const gearRoll = gearRandom();
    const wardrobeRoll = wardrobeRandom();
    const characterCollection = db.collection('userCharacterCollection');
    const newCharacterRef = characterCollection.doc();
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, raidSnapshot, userSnapshot, ledgerSnapshot, collection] = await Promise.all([
        transaction.get(guildRef), transaction.get(raidRef), transaction.get(userRef), transaction.get(ledgerRef),
        transaction.get(characterCollection.where('userId', '==', uid)),
      ]);
      const guild = requireMember(guildSnapshot, uid);
      const raid = requireRaid(raidSnapshot, guildRef.id);
      const user = requireUser(userSnapshot);
      const participant = Object.hasOwn(raid.participants, uid) ? raid.participants[uid] : null;
      if (raid.status !== 'defeated' || !participant || participant.damage < raid.config.minimumContribution) throw new HttpError(409, 'Defeat the boss and meet the contribution requirement to claim the chest.');
      if (participant.claimed || ledgerSnapshot.exists) return { raid: raidView(raidRef.id, raid, uid, guild, now), awarded: false,
        companionReward: participant.companionReward || null,
        ...(isDreadroot(raid) ? { gearReward: participant.gearReward || null, wardrobeReward: participant.wardrobeReward || null } : {}) };
      const selected = bossCompanionReward({ roll: companionRoll, user, collection, pool: raid.config.rewardCompanions });
      const equipment = equipmentState(user);
      const wardrobe = wardrobeState(user);
      const gearReward = isDreadroot(raid) ? itemReward(gearRoll, raid.config.rewardGear, equipment.ownedItemIds) : null;
      const wardrobeReward = isDreadroot(raid) ? itemReward(wardrobeRoll, raid.config.rewardWardrobe, wardrobe.ownedItemIds) : null;
      if (gearReward && !gearReward.duplicate) equipment.ownedItemIds.push(gearReward.id);
      if (wardrobeReward && !wardrobeReward.duplicate) wardrobe.ownedItemIds.push(wardrobeReward.id);
      const rewardCoins = raid.config.rewardCoins + selected.reward.coins + (gearReward?.coins || 0) + (wardrobeReward?.coins || 0);
      const coins = numericBalance(user.coins) + rewardCoins;
      if (!Number.isSafeInteger(coins)) throw new HttpError(409, 'Coin balance limit reached.');
      const companion = awardCompanion(user, { xp: raid.config.rewardXp, bond: 0 });
      companion.lastActivity = 'raid';
      if (!isDreadroot(raid)) companion.ownedCosmetics = [...new Set([...(companion.ownedCosmetics || []), raid.config.rewardCosmetic])];
      const extraRewards = isDreadroot(raid) ? { gearReward, wardrobeReward } : {};
      const updated = { ...raid, revision: nextRevision(raid), participants: { ...raid.participants, [uid]: { ...participant, claimed: true, claimedAt: now, companionReward: selected.reward, ...extraRewards } } };
      transaction.update(userRef, { coins, companion, ...(isDreadroot(raid) ? { equipment, wardrobe } : {}) });
      if (!selected.reward.duplicate) transaction.set(newCharacterRef, {
        userId: uid, characterName: selected.card.characterName, characterTier: selected.card.tier,
        imagePath: selected.card.imagePath, catalogId: selected.card.id, price: 0, addedAt: now, source: 'boss_chest', sourceId: raidRef.id,
      });
      transaction.update(raidRef, { participants: updated.participants, revision: updated.revision });
      transaction.set(ledgerRef, { type: 'raid_victory', description: `${raid.bossName} victory chest: ${selected.reward.name}${selected.reward.duplicate ? ` (duplicate: ${selected.reward.coins} coins)` : ''}${gearReward ? `, ${gearReward.description} ${wardrobeReward.description}` : ''}`,
        amount: rewardCoins, exp: raid.config.rewardXp, balance: coins, sourceId: raidRef.id, companionReward: selected.reward, ...extraRewards, createdAt: now });
      return { raid: raidView(raidRef.id, updated, uid, guild, now), awarded: true, companionReward: selected.reward, ...extraRewards,
        rewards: { coins: rewardCoins, xp: raid.config.rewardXp, cosmetic: isDreadroot(raid) ? wardrobeReward.id : raid.config.rewardCosmetic } };
    });
    reply(res, result);
  }));

  router.get('/guilds/:id/project', asyncHandler(async (req, res) => {
    const guildRef = guilds.doc(id(req.params.id));
    const result = await db.runTransaction(async transaction => {
      const guild = requireMember(await transaction.get(guildRef), req.auth.uid);
      const [projectSnapshot, ...memberSnapshots] = await Promise.all([transaction.get(projects.doc(guildRef.id)),
        ...membersOf(guild).map(uid => transaction.get(users.doc(uid)))]);
      return { project: projectSnapshot.exists ? projectSnapshot.data() : null,
        members: memberSnapshots.map(snapshot => ({ id: snapshot.id, username: memberName(snapshot.data()) })) };
    });
    reply(res, result);
  }));

  router.put('/guilds/:id/project', asyncHandler(async (req, res) => {
    const guildRef = guilds.doc(id(req.params.id));
    const projectRef = projects.doc(guildRef.id);
    const title = textField(req.body?.title, 'Project title', 160, true);
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, projectSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(projectRef)]);
      const guild = requireMember(guildSnapshot, req.auth.uid);
      requireOwner(guild, req.auth.uid);
      const project = { ...(projectSnapshot.exists ? projectSnapshot.data() : { milestones: [], createdAt: clock() }), title, updatedAt: clock() };
      transaction.set(projectRef, project);
      return { project };
    });
    reply(res, result);
  }));

  async function validateAssignment(transaction, guild, milestone) {
    if (!membersOf(guild).includes(milestone.assigneeId)) throw new HttpError(400, 'The assignee must be a current guild member.');
    const user = requireUser(await transaction.get(users.doc(milestone.assigneeId)));
    if (milestone.taskId) {
      const task = await transaction.get(db.collection('todos').doc(milestone.taskId));
      if (!task.exists || task.data().userId !== milestone.assigneeId) throw new HttpError(400, 'A linked task must belong to the assignee.');
      if (task.data().recurrence === 'daily') throw new HttpError(409, 'Use a one-time task for a project milestone. Daily tasks contribute to the raid when completed.');
      if (task.data().acceptedMilestoneId) throw new HttpError(409, 'This task has already counted toward an accepted milestone.');
    }
    return memberName(user);
  }

  router.post('/guilds/:id/project/milestones', asyncHandler(async (req, res) => {
    const input = milestoneInput(req.body ?? {});
    const guildRef = guilds.doc(id(req.params.id));
    const projectRef = projects.doc(guildRef.id);
    const milestoneId = projects.doc().id;
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, projectSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(projectRef)]);
      const guild = requireMember(guildSnapshot, req.auth.uid);
      requireOwner(guild, req.auth.uid);
      if (!projectSnapshot.exists) throw new HttpError(404, 'Create a project first.');
      const project = projectSnapshot.data();
      if (project.milestones.length >= 100) throw new HttpError(409, 'A project can contain up to 100 milestones.');
      const assigneeName = await validateAssignment(transaction, guild, input);
      const milestone = { ...input, id: milestoneId, assigneeName, status: 'pending', createdAt: clock() };
      const updated = { ...project, milestones: [...project.milestones, milestone], updatedAt: clock() };
      transaction.set(projectRef, updated);
      return { project: updated, milestone };
    });
    reply(res, result, 201);
  }));

  router.patch('/guilds/:id/project/milestones/:milestoneId', asyncHandler(async (req, res) => {
    const input = milestoneInput(req.body ?? {}, true);
    const guildRef = guilds.doc(id(req.params.id));
    const projectRef = projects.doc(guildRef.id);
    const milestoneId = id(req.params.milestoneId);
    const result = await db.runTransaction(async transaction => {
      const [guildSnapshot, projectSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(projectRef)]);
      const guild = requireMember(guildSnapshot, req.auth.uid);
      requireOwner(guild, req.auth.uid);
      const project = projectSnapshot.data();
      const previous = project?.milestones?.find(milestone => milestone.id === milestoneId);
      if (!previous) throw new HttpError(404, 'Milestone not found.');
      if (previous.status !== 'pending') throw new HttpError(409, 'Only pending milestones can be edited.');
      const milestone = { ...previous, ...input };
      milestone.assigneeName = await validateAssignment(transaction, guild, milestone);
      const updated = { ...project, milestones: project.milestones.map(entry => entry.id === milestoneId ? milestone : entry), updatedAt: clock() };
      transaction.set(projectRef, updated);
      return { project: updated, milestone };
    });
    reply(res, result);
  }));

  for (const action of ['submit', 'accept']) {
    router.post(`/guilds/:id/project/milestones/:milestoneId/${action}`, asyncHandler(async (req, res) => {
      const guildRef = guilds.doc(id(req.params.id));
      const projectRef = projects.doc(guildRef.id);
      const milestoneId = id(req.params.milestoneId);
      const now = clock();
      const result = await db.runTransaction(async transaction => {
        const [guildSnapshot, projectSnapshot] = await Promise.all([transaction.get(guildRef), transaction.get(projectRef)]);
        const guild = requireMember(guildSnapshot, req.auth.uid);
        const project = projectSnapshot.data();
        const milestone = project?.milestones?.find(entry => entry.id === milestoneId);
        if (!milestone) throw new HttpError(404, 'Milestone not found.');
        if (action === 'submit') {
          if (milestone.assigneeId !== req.auth.uid) throw new HttpError(403, 'Only the assignee can submit this milestone.');
        } else requireOwner(guild, req.auth.uid);
        if (milestone.status === 'accepted' || (action === 'submit' && milestone.status === 'submitted')) return { project, milestone, awarded: false };
        if (action === 'accept' && milestone.status !== 'submitted') throw new HttpError(409, 'The assignee must submit the milestone first.');
        if (!membersOf(guild).includes(milestone.assigneeId)) throw new HttpError(409, 'Reassign this milestone to a current guild member.');
        const taskRef = milestone.taskId ? db.collection('todos').doc(milestone.taskId) : null;
        const taskSnapshot = taskRef ? await transaction.get(taskRef) : null;
        const task = taskSnapshot?.data();
        if (taskRef && (!task || task.userId !== milestone.assigneeId)) throw new HttpError(409, 'The linked task is no longer available to its assignee.');
        if (task?.recurrence === 'daily') throw new HttpError(409, 'Use a one-time task for a project milestone. Daily tasks contribute to the raid when completed.');
        if (task && (!task.isCompleted || !task.completedAt)) throw new HttpError(409, 'Complete the linked task before submitting this milestone.');
        if (task?.acceptedMilestoneId && task.acceptedMilestoneId !== milestoneId) throw new HttpError(409, 'The linked task has already counted toward another milestone.');
        let attack = noAttack('not_accepted');
        let companion;
        let userRef;
        if (action === 'accept') {
          userRef = users.doc(milestone.assigneeId);
          const user = requireUser(await transaction.get(userRef));
          companion = task ? user.companion : awardCompanion(user, { xp: COMPANION_CONFIG.xpTask, bond: COMPANION_CONFIG.bondTask, chargeTask: true });
          attack = await prepareRaidAttack({ db, transaction, uid: milestone.assigneeId, user: { ...user, companion },
            taskId: task ? milestone.taskId : `${guildRef.id}_${milestoneId}`, task: task || { size: milestone.size },
            eventType: task ? 'task' : 'milestone', requiredGuildId: guildRef.id, now });
          companion = attack.companion || companion;
        }
        const updatedMilestone = { ...milestone, status: action === 'submit' ? 'submitted' : 'accepted',
          ...(action === 'submit' ? { submittedAt: now } : { acceptedAt: now, acceptedBy: req.auth.uid, raidAttack: attack.raidAttack }) };
        const updated = { ...project, milestones: project.milestones.map(entry => entry.id === milestoneId ? updatedMilestone : entry), updatedAt: now };
        transaction.set(projectRef, updated);
        if (action === 'accept') {
          attack.apply();
          if (companion) transaction.update(userRef, { companion });
          if (taskRef) transaction.update(taskRef, { acceptedMilestoneId: milestoneId,
            ...(attack.raidAttack.raidId ? { raidCreditId: attack.raidAttack.raidId } : {}) });
        }
        return { project: updated, milestone: updatedMilestone, raidAttack: attack.raidAttack, awarded: action === 'accept' };
      });
      reply(res, result);
    }));
  }

  return router;
}
