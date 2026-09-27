import { FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Action, Badge, colors, Copy, Dialog, ErrorNotice, Heading, Loading, momentLabel, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useBattlePresentation } from '@/context/battle-presentation';
import { useGuildRaid } from '@/components/boss/use-guild-raid';
import { DreadrootRaid } from '@/components/boss/DreadrootRaid';
import { BattleArena } from '@/components/boss/BattleArena';
import type { RaidConfig } from '@/scripts/battle-types';
import { api, errorMessage } from '@/scripts/api';
import { shareInvitation } from '@/scripts/share-invitation';

export type GuildSummary = { id: string; name: string; description: string; inviteCode: string; createdBy: string; memberCount: number };

export function guildInvitation(guild: GuildSummary) {
  return Linking.createURL('/guild', { queryParams: { invite: guild.inviteCode } });
}

export async function shareGuildInvitation(guild: GuildSummary, victory = false, bossName = 'Deadline Dragon') {
  const url = guildInvitation(guild);
  const title = victory ? `${guild.name} defeated the ${bossName}!` : `Study together with ${guild.name}`;
  const message = `${title}\nJoin our ProdifyQuest guild and turn small steps into shared progress.\nInvite code: ${guild.inviteCode}\n${url}`;
  return shareInvitation(title, message);
}

function timeRemaining(expiresAt: string | null, now: number) {
  if (!expiresAt) return 'Starts when your guild is ready';
  const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));
  if (!minutes) return 'Time is up';
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return days ? `${days}d ${hours}h remaining` : `${hours}h ${minutes % 60}m remaining`;
}

function Rules({ config }: { config: RaidConfig }) {
  return <View style={{ gap: 14 }}>
    <View style={styles.wrap}><Badge tone="amber">{config.durationDays} days</Badge><Badge>{config.hpPerParticipant} HP / participant</Badge><Badge tone="green">{config.minimumContribution} damage to qualify</Badge></View>
    <Copy>Join before the owner starts. Starting health locks to the number of participants. Your first completion of an eligible task during this raid attacks automatically; reopening a task never earns another attack.</Copy>
    <View style={styles.wrap}>{(['small', 'medium', 'large'] as const).map(size => <View key={size} style={raidStyles.rule}><Text style={styles.label}>{size[0].toUpperCase() + size.slice(1)} effort</Text><Text style={raidStyles.ruleValue}>{config.damage[size]} damage</Text></View>)}</View>
    <Copy>Up to {config.dailyLimit} damage per person each day, including spell bonuses. Resets at {config.resetTime}. Effort is separate from priority. You can participate in one ongoing raid at a time.</Copy>
    <View style={raidStyles.reward}><MaterialIcons name="redeem" color={colors.amber} size={24} /><View style={{ flex: 1, gap: 5 }}><Text style={{ color: colors.ink, fontWeight: '700' }}>Guaranteed rewards for every qualifying member</Text><Copy>{config.rewardCoins} coins · {config.rewardXp} companion XP · Dragon Scholar cosmetic · a trophy for your guild</Copy></View></View>
    <Copy>Contribute at least {config.minimumContribution} damage and defeat the dragon to claim your chest. Your personal task rewards stay yours even if the raid expires. Private task titles never appear in attack activity.</Copy>
    {!!config.rewardCompanions?.length && <><Heading>A companion in every victory chest</Heading><Copy>Each qualifying member also receives one random companion. Your base coins, XP, and cosmetic are the same for every qualifying member.</Copy>{config.rewardCompanions.map(item => <Copy key={item.id}>{item.name}: {Math.round(item.weight / config.rewardCompanions!.reduce((sum, row) => sum + row.weight, 0) * 100)}% · duplicates become {item.duplicateCoins} coins.</Copy>)}</>}
  </View>;
}

export function GuildRaid({ guild }: { guild: GuildSummary }) {
  const { user } = useAuth();
  const { setBusy: setPresenting } = useBattlePresentation();
  const resource = useGuildRaid(guild.id);
  const { data, loading, error, reload, accept } = resource;
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const raid = data?.raid;
  const config = raid?.config || data?.config;
  const now = data?.serverTime ? new Date(data.serverTime).getTime() : 0;
  const expired = raid?.status === 'expired' || (raid?.status === 'active' && !!raid.expiresAt && new Date(raid.expiresAt).getTime() <= now);
  const active = raid?.status === 'active' && !expired;
  const defeated = raid?.status === 'defeated';
  const recruiting = raid?.status === 'recruiting';
  const owner = user?.id === guild.createdBy;
  const waitingChests = (data?.pendingRewards?.length || 0) + (raid?.canClaim ? 1 : 0);
  async function act(action: 'create' | 'join' | 'start', bossId?: string) {
    if (lock.current || (action !== 'create' && !raid)) return;
    lock.current = true;
    setBusy(action); setActionError(''); setSuccess('');
    try {
      const path = action === 'create' ? `/guilds/${guild.id}/raids` : `/guilds/${guild.id}/raids/${raid!.id}/${action}`;
      const response = await api.post(path, action === 'create' ? { bossId } : action === 'join' ? { acceptRequirements: true } : {});
      if (response.data.raid) accept({ raid: response.data.raid }, action === 'create' ? { transitionFrom: raid?.id ?? null } : undefined);
      setRulesOpen(false);
      setSuccess({ create: 'Raid ready to join.', join: 'You joined the raid.', start: 'Raid started.' }[action]);
      void reload();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { lock.current = false; setBusy(''); }
  }
  async function share() {
    if (lock.current) return;
    lock.current = true; setBusy('share'); setActionError('');
    try { setSuccess(await shareGuildInvitation(guild, true)); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { lock.current = false; setBusy(''); }
  }
  if (loading && !data) return <Loading />;
  if (!data || !config) return <ErrorNotice message={error || 'The raid could not be loaded.'} onRetry={reload} />;
  if (raid?.bossId === 'dreadroot') return <DreadrootRaid key={raid.id} guild={guild} resource={resource} shareVictory={() => shareGuildInvitation(guild, true, raid.bossName)} />;
  return <View style={{ gap: 16 }}>
    <ErrorNotice message={error} onRetry={reload} />{!rulesOpen && <ErrorNotice message={actionError} />}
    {!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}
    {raid && <View style={styles.wrap}><Badge tone={defeated ? 'green' : active ? 'amber' : 'neutral'}>{defeated ? 'Victory' : expired ? 'Ended' : active ? 'Active' : 'Recruiting'}</Badge><Badge tone="neutral">{raid.participantCount} players</Badge>{active && <Badge tone="neutral">{timeRemaining(raid.expiresAt, now)}</Badge>}</View>}
    {raid && raid.maxHp > 0 ? <BattleArena key={raid.id} raid={raid} companionId={user?.character?.image} imagePath={user?.imagePath} onBusyChange={setPresenting} /> : <View style={{ alignItems: 'center', gap: 14, paddingVertical: 20 }}><FontAwesome5 name="dragon" size={76} color={colors.purple} /><Heading>Deadline Dragon</Heading><Copy>{config.durationDays} days · task completions attack automatically</Copy></View>}
    {raid?.me && <View style={[styles.row, { justifyContent: 'space-between' }]}><Badge>{raid.me.damage} damage dealt</Badge><Text style={styles.label}>{raid.me.dailyDamage} / {config.dailyLimit} today</Text></View>}
    {active && <Copy>{raid?.me ? 'Complete tasks to attack.' : 'Join the next raid to participate.'}</Copy>}
    {!!waitingChests && <Action label={`Open Inventory · ${waitingChests} ${waitingChests === 1 ? 'chest' : 'chests'}`} icon="inventory-2" variant="secondary" disabled={!!busy} onPress={() => router.push('/cards/chests')} />}
    <View style={styles.wrap}>
      {recruiting && raid.canJoin && <Action label="Review & join raid" icon="group-add" disabled={!!busy} onPress={() => { setActionError(''); setRulesOpen(true); }} />}
      {recruiting && raid.canStart && <Action label="Start guild raid" icon="play-arrow" busy={busy === 'start'} disabled={!!busy} onPress={() => act('start')} />}
      {(!raid || defeated || expired) && owner && <><Action label={raid ? 'Prepare next raid' : 'Prepare a raid'} icon="auto-awesome" busy={busy === 'create'} disabled={!!busy} onPress={() => act('create')} /><Action label="Prepare Dreadroot raid" variant="secondary" icon="park" disabled={!!busy} onPress={() => act('create', 'dreadroot')} /></>}
    </View>
    {!raid && !owner && <Copy>Your guild owner can prepare a raid.</Copy>}
    {recruiting && <Copy>{owner ? 'Invite your party before starting.' : 'Waiting for the guild owner to start.'}</Copy>}
    <View style={styles.wrap}><Action label="Rules" icon="info-outline" variant="ghost" small disabled={!!busy} onPress={() => setRulesOpen(true)} /><Action label="Activity" icon="history" variant="ghost" small disabled={!!busy} onPress={() => setActivityOpen(true)} />{defeated && <Action label="Share victory" icon="share" variant="ghost" small busy={busy === 'share'} disabled={!!busy} onPress={share} />}</View>
    <Dialog visible={rulesOpen} title="Raid rules & rewards" onClose={() => setRulesOpen(false)} busy={!!busy}><Rules config={config} /><Copy>Earned chests are stored in Inventory until you open them.</Copy><ErrorNotice message={actionError} />{recruiting && raid?.canJoin && <Action label="Accept requirements & join" icon="check" busy={busy === 'join'} onPress={() => act('join')} />}</Dialog>
    <Dialog visible={activityOpen} title="Raid activity" onClose={() => setActivityOpen(false)}>
      {!!raid?.participants.length && <><Heading>Contributions</Heading>{raid.participants.map(member => <View key={member.uid} style={[styles.row, { justifyContent: 'space-between' }]}><Copy>{member.username}</Copy><Badge>{member.damage} damage</Badge></View>)}</>}
      {!!raid?.recentAttacks.length && <><Heading>Recent attacks</Heading>{raid.recentAttacks.slice(-8).reverse().map((attack, index) => <Copy key={`${attack.uid}-${index}`}>{attack.username} · {attack.damage} damage · {momentLabel(attack.createdAt)}</Copy>)}</>}
      {!!data.trophies.length && <><Heading>Trophies</Heading>{data.trophies.slice(-6).reverse().map(trophy => <Badge key={trophy.raidId} tone="amber">{trophy.bossName} · {new Date(trophy.defeatedAt).toLocaleDateString()}</Badge>)}</>}
      {!raid?.participants.length && !data.trophies.length && <Copy>No activity yet.</Copy>}
    </Dialog>
  </View>;
}
const raidStyles = StyleSheet.create({
  rule: { flexBasis: 125, flexGrow: 1, gap: 7, padding: 13, borderRadius: 12, backgroundColor: colors.canvas },
  ruleValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  reward: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 13, backgroundColor: '#FFF8E9', alignItems: 'center' },
});
