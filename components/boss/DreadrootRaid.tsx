import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAxiosError } from 'axios';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { GuildSummary } from '@/components/guild-raid';
import { Action, Badge, Copy, Dialog, ErrorNotice, Heading, colors, momentLabel, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useBattlePresentation } from '@/context/battle-presentation';
import { api, errorMessage } from '@/scripts/api';
import type { AttackResponse, ChestResponse, LootOdds, RaidResponse } from '@/scripts/battle-types';
import { BattleArena, BattleArenaHandle } from './BattleArena';
import BossSprite from './BossSprite';
import { canPresentAttack } from './raid-state';
import type { useGuildRaid } from './use-guild-raid';
import { useBattleMotion } from './use-battle-motion';

function Odds({ title, items }: { title: string; items?: LootOdds[] }) {
  if (!items?.length) return null;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  return <View style={{ gap: 7 }}><Heading>{title}</Heading>{items.map(item => <Copy key={item.id}>{item.name}: {Math.round(item.weight / total * 100)}% · duplicates give {item.duplicateCoins} coins.</Copy>)}</View>;
}

function Rules({ data }: { data: RaidResponse }) {
  const config = data.raid!.config;
  return <View style={{ gap: 14 }}>
    <View style={styles.wrap}><Badge>{config.durationDays} days</Badge><Badge>{config.hpPerParticipant} HP / participant</Badge><Badge tone="green">{config.minimumContribution} damage to qualify</Badge></View>
    <Copy>Join before the owner starts. The participant list and boss health lock when the event starts. You may participate in one ongoing raid at a time.</Copy>
    <Copy>Complete eligible tasks or project milestones to earn one attack charge per unique completion, up to {config.dailyChargeLimit || 5} charges per day. Daily earning resets at {config.resetTime}. Reopening a task or repeating the same milestone never earns another charge.</Copy>
    <Copy>Spend one charge with Attack boss. Damage uses your active companion, player level, and equipped gear. Dreadroot has 20 defense and becomes visually enraged at 40% health. It does not damage your companion.</Copy>
    <Copy>Defeat Dreadroot and contribute at least {config.minimumContribution} damage to claim one victory chest: {config.rewardCoins} coins, {config.rewardXp} companion XP, one companion, one equipment item, and one wardrobe cosmetic. Each pool is rolled separately. Every qualifying participant can claim; the final hit is not required.</Copy>
    <Odds title="Companion chest odds" items={config.rewardCompanions} />
    <Odds title="Equipment chest odds" items={data.bossGearOdds} />
    <Odds title="Wardrobe chest odds" items={data.bossWardrobeOdds} />
    <Copy>Boss scenery replaces your personal background in the arena. Pets and auras remain in your companion scene. Personal task rewards remain yours if the event expires.</Copy>
  </View>;
}

type Props = { guild: GuildSummary; resource: ReturnType<typeof useGuildRaid>; shareVictory: () => Promise<string> };
export function DreadrootRaid({ guild, resource, shareVictory }: Props) {
  const motion = useBattleMotion();
  const { user } = useAuth();
  const { busy: presenting, setBusy: setPresenting } = useBattlePresentation();
  const { data, error, reload, accept, latest } = resource;
  const raid = data!.raid!;
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<string | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const arena = useRef<BattleArenaHandle>(null);
  const lock = useRef(false);
  const storageKey = `prodifyquest:pending-attack:${user!.id}:${guild.id}:${raid.id}`;
  const active = raid.status === 'active';
  const recruiting = raid.status === 'recruiting';
  const defeated = raid.status === 'defeated';
  const owner = user?.id === guild.createdBy;
  const disabled = !!busy || presenting;
  const config = raid.config;
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(storageKey).then(value => { if (mounted) { setPendingAttack(value); setPendingLoaded(true); } }).catch(() => { if (mounted) setActionError('Could not read your pending attack. Reopen this guild before attacking.'); });
    return () => { mounted = false; };
  }, [storageKey]);

  async function act(action: 'join' | 'start' | 'create', bossId?: string) {
    if (lock.current || presenting) return;
    lock.current = true; setBusy(action); setActionError(''); setNotice('');
    try {
      const response = await api.post<ChestResponse>(action === 'create' ? `/guilds/${guild.id}/raids` : `/guilds/${guild.id}/raids/${raid.id}/${action}`, action === 'create' ? { bossId } : action === 'join' ? { acceptRequirements: true } : {});
      if (response.data.raid) accept({ raid: response.data.raid }, action === 'create' ? { transitionFrom: raid.id } : undefined);
      setRulesOpen(false);
      setNotice({ create: 'Raid ready to join.', join: 'You joined the raid.', start: 'Raid started.' }[action]);
      void reload();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { lock.current = false; setBusy(''); }
  }

  async function attack() {
    if (lock.current || presenting || !pendingLoaded) return;
    lock.current = true; setBusy('attack'); setActionError(''); setNotice('');
    const attackId = pendingAttack || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    try {
      // Persist before sending: a lost response or app restart retries this exact ID.
      await AsyncStorage.setItem(storageKey, attackId);
      setPendingAttack(attackId);
      const response = await api.post<AttackResponse>(`/guilds/${guild.id}/raids/${raid.id}/attack`, { attackId });
      setPendingAttack(null);
      await AsyncStorage.removeItem(storageKey).catch(() => {});
      const result = response.data;
      accept({ raid: result.raid });
      const current = latest.current?.raid;
      if (current && canPresentAttack(current, result.attack)) arena.current?.play(result.attack);
      setNotice(`${result.replayed ? 'Recovered attack' : result.attack.critical ? 'Critical hit' : 'Attack confirmed'}: ${result.attack.damage} damage. One charge spent.`);
    } catch (err) {
      const definitive = isAxiosError(err) && !!err.response && err.response.status >= 400 && err.response.status < 500 && ![408, 429].includes(err.response.status);
      if (definitive) { setPendingAttack(null); await AsyncStorage.removeItem(storageKey).catch(() => {}); }
      setActionError(`${errorMessage(err)}${definitive ? '' : ' Use Retry pending attack to recover this attempt safely.'}`);
      void reload();
    } finally { lock.current = false; setBusy(''); }
  }

  async function share() {
    if (disabled) return;
    setBusy('share'); setActionError('');
    try { setNotice(await shareVictory()); } catch (err) { setActionError(errorMessage(err)); } finally { setBusy(''); }
  }
  const waitingChests = (data!.pendingRewards?.length || 0) + (raid.canClaim ? 1 : 0);
  return <View style={{ gap: 16 }}>
    <View style={styles.wrap}><Badge tone={defeated ? 'green' : active ? 'amber' : 'neutral'}>{recruiting ? 'Recruiting' : defeated ? 'Victory' : active ? 'Active' : 'Ended'}</Badge><Badge tone="neutral">{raid.participantCount} players</Badge></View>
    {raid.maxHp > 0 ? <BattleArena key={raid.id} ref={arena} raid={raid} companionId={user?.character?.image} imagePath={user?.imagePath} onBusyChange={setPresenting} attackControl={(active || pendingAttack) && (raid.me || pendingAttack) ? <Action label={pendingAttack ? 'Retry pending attack' : 'Attack boss'} icon="flash-on" busy={busy === 'attack'} disabled={disabled || !pendingLoaded || (!pendingAttack && (!active || !raid.me?.charges))} onPress={attack} /> : undefined} /> : <View style={{ alignItems: 'center', gap: 8 }}><BossSprite action="idle" size={150} active={motion} /><Heading>Dreadroot Sentinel</Heading><Copy>{config.durationDays} days · earn charges from tasks</Copy></View>}
    <ErrorNotice message={error} onRetry={reload} /><ErrorNotice message={actionError} />
    {!!notice && <View accessibilityRole="alert"><Badge tone="green">{notice}</Badge></View>}
    {raid.me && <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View style={{ gap: 5 }}><Text testID="charge-count" style={{ fontSize: 18, fontWeight: '800', color: colors.purple }}>{raid.me.charges || 0} charges</Text><Text style={styles.label}>{raid.me.dailyCharges || 0} / {config.dailyChargeLimit || 5} earned today</Text></View><Badge>{raid.me.damage} damage dealt</Badge></View>}
    {active && <Copy>{raid.me ? 'Complete tasks to earn attack charges.' : 'Join the next raid to participate.'}</Copy>}
    {!!raid.expiresAt && <Text style={styles.label}>{raid.status === 'expired' ? 'Ended' : 'Ends'} {momentLabel(raid.expiresAt)}</Text>}
    {!!waitingChests && <Action label={`Open Inventory · ${waitingChests} ${waitingChests === 1 ? 'chest' : 'chests'}`} icon="inventory-2" variant="secondary" disabled={disabled} onPress={() => router.push('/cards/chests')} />}
    <View style={styles.wrap}>
      {recruiting && raid.canJoin && <Action label="Review & join raid" icon="group-add" disabled={disabled} onPress={() => setRulesOpen(true)} />}
      {recruiting && raid.canStart && <Action label="Start guild raid" icon="play-arrow" disabled={disabled} busy={busy === 'start'} onPress={() => act('start')} />}
      {(defeated || raid.status === 'expired') && owner && <><Action label="Prepare Dreadroot raid" disabled={disabled} busy={busy === 'create'} onPress={() => act('create', 'dreadroot')} /><Action label="Prepare Deadline Dragon raid" variant="secondary" disabled={disabled} onPress={() => act('create', 'deadline-dragon')} /></>}
    </View>
    {recruiting && <Copy>{owner ? 'Invite your party before starting.' : 'Waiting for the guild owner to start.'}</Copy>}
    <View style={styles.wrap}><Action label="Rules" icon="info-outline" variant="ghost" small disabled={disabled} onPress={() => setRulesOpen(true)} /><Action label="Activity" icon="history" variant="ghost" small disabled={disabled} onPress={() => setActivityOpen(true)} />{defeated && <Action label="Share victory" icon="share" variant="ghost" small disabled={disabled} onPress={share} />}</View>
    <Dialog visible={rulesOpen} title="Raid rules & rewards" onClose={() => setRulesOpen(false)} busy={disabled}><Rules data={data!} /><Copy>Earned chests are stored in Inventory until you open them.</Copy><ErrorNotice message={actionError} />{recruiting && raid.canJoin && <Action label="Accept requirements & join" icon="check" busy={busy === 'join'} onPress={() => act('join')} />}</Dialog>
    <Dialog visible={activityOpen} title="Raid activity" onClose={() => setActivityOpen(false)}>
      {!!raid.participants.length && <><Heading>Contributions</Heading>{raid.participants.map(member => <View key={member.uid} style={[styles.row, { justifyContent: 'space-between' }]}><Copy>{member.username}</Copy><Badge tone={member.damage >= config.minimumContribution ? 'green' : 'neutral'}>{member.damage} damage</Badge></View>)}</>}
      {!!raid.recentAttacks.length && <><Heading>Recent attacks</Heading>{raid.recentAttacks.slice(-8).reverse().map((item, index) => <Copy key={`${item.uid}-${item.createdAt}-${index}`}>{item.username} · {item.critical ? 'Critical · ' : ''}{item.damage} damage · {momentLabel(item.createdAt)}</Copy>)}</>}
      {!!data!.trophies.length && <><Heading>Trophies</Heading>{data!.trophies.slice(-6).reverse().map(trophy => <Badge key={trophy.raidId} tone="amber">{trophy.bossName} · {new Date(trophy.defeatedAt).toLocaleDateString()}</Badge>)}</>}
      {!raid.participants.length && !data!.trophies.length && <Copy>No activity yet.</Copy>}
    </Dialog>
  </View>;
}
