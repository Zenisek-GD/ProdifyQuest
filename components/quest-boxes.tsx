import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Action, Badge, colors, Copy, Dialog, ErrorNotice, Heading, Loading, styles, momentLabel } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useCompanion } from '@/context/companion';
import { useResource } from '@/hooks/use-resource';
import { api, API_URL, errorMessage } from '@/scripts/api';
import type { QuestBox, QuestBoxOpenResponse, QuestBoxReward, QuestBoxesResponse } from '@/scripts/quest-box-types';
import type { ChestResponse, LootOdds } from '@/scripts/battle-types';
import { itemPortrait } from '@/components/wardrobe/assets';

type BossChest = { id: string; guildId: string; guildName: string; raidId: string; bossId: string; bossName: string; defeatedAt: string; rewardCoins: number; rewardXp: number; companionOdds: LootOdds[]; gearOdds: LootOdds[]; wardrobeOdds: LootOdds[] };
type BossResult = ChestResponse & { awarded?: boolean; rewards?: { coins: number; xp: number; cosmetic?: string } };
type Opening = { kind: 'quest'; id: string } | { kind: 'boss'; id: string; chest: BossChest };
type RewardIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const rewardIcons: Record<QuestBoxReward['kind'], RewardIcon> = { coins: 'circle-multiple', companion_xp: 'star-four-points', character: 'wizard-hat', cosmetic: 'palette-outline' };
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
const uri = (path: string) => /^https?:\/\//i.test(path) ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;

function RewardArt({ reward }: { reward: QuestBoxReward }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ height: 160, alignItems: 'center', justifyContent: 'center' }}>
    {reward.character?.imagePath && !failed ? <Image accessibilityLabel={reward.character.name} source={{ uri: uri(reward.character.imagePath) }} resizeMode="contain" style={{ width: '100%', height: '100%' }} onError={() => setFailed(true)} /> : <MaterialCommunityIcons name={rewardIcons[reward.kind]} size={80} color={reward.cosmetic?.color || (reward.kind === 'coins' ? colors.amber : colors.purple)} />}
  </View>;
}
function Odds({ title, items }: { title: string; items?: LootOdds[] }) {
  if (!items?.length) return null;
  return <View style={{ gap: 8 }}><Heading>{title}</Heading>{items.map(item => <View key={item.id} style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Copy>{item.name}</Copy><Copy>{percent(item.weight / items.reduce((sum, value) => sum + value.weight, 0))} · duplicate {item.duplicateCoins} coins</Copy></View>)}</View>;
}

/** Rewards are only rolled and saved after an explicit, idempotent open request. */
export function QuestBoxes({ refreshKey = 0 }: { refreshKey?: number; compact?: boolean }) {
  const quest = useResource<QuestBoxesResponse>(`/quest-boxes?refresh=${refreshKey}`, 30000);
  const bosses = useResource<{ bossChests: BossChest[] }>('/inventory/chests', 30000);
  const { refreshUser } = useAuth();
  const { reload: reloadCompanion } = useCompanion();
  const opening = useRef(false);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [retry, setRetry] = useState<Opening | null>(null);
  const [syncProblem, setSyncProblem] = useState('');
  const [openedHere, setOpenedHere] = useState<string[]>([]);
  const [reveal, setReveal] = useState<{ box: QuestBox; alreadyOpened: boolean } | null>(null);
  const [bossReveal, setBossReveal] = useState<{ chest: BossChest; result: BossResult } | null>(null);
  const [rules, setRules] = useState<'quest' | BossChest | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pending = (quest.data?.boxes || []).filter(box => !openedHere.includes(`quest:${box.id}`));
  const bossChests = (bosses.data?.bossChests || []).filter(chest => !openedHere.includes(`boss:${chest.id}`));
  const unopenedCount = Math.max(0, (quest.data?.unopenedCount || 0) - (quest.data?.boxes || []).filter(box => openedHere.includes(`quest:${box.id}`)).length) + bossChests.length;
  const reward = reveal?.box.reward;
  const questRules = quest.data?.rules;

  async function refreshAccount() {
    setSyncProblem('');
    const results = await Promise.allSettled([quest.reload(), bosses.reload(), refreshUser(), reloadCompanion()]);
    if (results.some(result => result.status === 'rejected')) setSyncProblem('Reward saved. Pull to refresh your balance.');
  }
  async function openChest(target: Opening) {
    if (opening.current) return;
    opening.current = true;
    const key = `${target.kind}:${target.id}`;
    setBusy(key); setProblem(''); setRetry(null);
    try {
      if (target.kind === 'quest') {
        const { data: result } = await api.post<QuestBoxOpenResponse>(`/quest-boxes/${encodeURIComponent(target.id)}/open`);
        setReveal({ box: result.box, alreadyOpened: !result.awarded });
      } else {
        const { data: result } = await api.post<BossResult>(`/guilds/${encodeURIComponent(target.chest.guildId)}/raids/${encodeURIComponent(target.chest.raidId)}/claim`);
        setBossReveal({ chest: target.chest, result });
      }
      setOpenedHere(previous => previous.includes(key) ? previous : [...previous, key]);
    } catch (cause) { setProblem(errorMessage(cause)); setRetry(target); return; }
    finally { opening.current = false; setBusy(''); }
    // A later profile read cannot turn a confirmed chest into an opening failure.
    await refreshAccount();
  }

  return <View style={{ gap: 16 }}>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Heading>Chests <Text style={{ color: colors.muted }}>({unopenedCount})</Text></Heading><Action label="Rewards & odds" icon="info-outline" small variant="ghost" disabled={!questRules} onPress={() => setRules('quest')} /></View>
    <Copy>Saved here until you open them.</Copy>
    {(quest.loading || bosses.loading) && !quest.data && !bosses.data ? <Loading /> : null}
    <ErrorNotice message={quest.error} onRetry={quest.reload} /><ErrorNotice message={bosses.error} onRetry={bosses.reload} /><ErrorNotice message={problem} onRetry={retry && !busy ? () => openChest(retry) : undefined} /><ErrorNotice message={syncProblem} onRetry={refreshAccount} />
    {!quest.loading && !bosses.loading && !quest.error && !bosses.error && !unopenedCount && <View style={{ alignItems: 'center', gap: 12, padding: 30 }}><MaterialCommunityIcons name="treasure-chest-outline" size={60} color={colors.muted} /><Copy>No unopened chests</Copy></View>}
    <View style={[styles.wrap, { gap: 16 }]}>
      {bossChests.map(chest => <View key={`boss:${chest.id}`} style={{ width: '46%', maxWidth: 220, gap: 8, paddingBottom: 12 }}><View style={{ height: 95, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="treasure-chest" size={70} color={colors.purple} /></View><Text style={{ color: colors.ink, fontWeight: '700' }}>{chest.bossName}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{chest.guildName}</Text><Action label="Open boss chest" small disabled={!!busy} busy={busy === `boss:${chest.id}`} onPress={() => openChest({ kind: 'boss', id: chest.id, chest })} /><Action label="Chest contents" small variant="ghost" onPress={() => setRules(chest)} /></View>)}
      {pending.map((box, index) => <View key={`quest:${box.id}`} style={{ width: '46%', maxWidth: 220, gap: 8, paddingBottom: 12 }}><View style={{ height: 95, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="treasure-chest" size={70} color={colors.amber} /></View><Text style={{ color: colors.ink, fontWeight: '700' }}>Quest chest {index + 1}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{momentLabel(box.createdAt)}</Text><Action label="Open quest chest" small disabled={!!busy} busy={busy === `quest:${box.id}`} onPress={() => openChest({ kind: 'quest', id: box.id })} /></View>)}
    </View>
    {!!quest.data && quest.data.unopenedCount > quest.data.boxes.length && <Copy>More chests appear as you open these.</Copy>}
    {!!quest.data?.history.length && <Action label={historyOpen ? 'Hide recent rewards' : 'Recent rewards'} variant="ghost" small onPress={() => setHistoryOpen(value => !value)} />}
    {historyOpen && quest.data?.history.map(box => <View key={box.id} style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Copy>{box.reward?.label || 'Quest reward'}</Copy><Action label="View reward" variant="ghost" small onPress={() => setReveal({ box, alreadyOpened: true })} /></View>)}
    <Dialog visible={!!reveal} title="Chest reward" onClose={() => setReveal(null)}>{reward && <><RewardArt reward={reward} key={reveal?.box.id} /><Heading>{reward.label}</Heading><View style={styles.wrap}>{reward.coins > 0 && <Badge tone="amber">+{reward.coins} coins</Badge>}{reward.xp > 0 && <Badge>+{reward.xp} XP</Badge>}{reward.duplicate && <Badge tone="neutral">Duplicate converted to coins</Badge>}</View><Copy>{reveal?.alreadyOpened ? 'Previously collected' : 'Saved to your inventory'}</Copy><Action label="Done" onPress={() => setReveal(null)} /></>}</Dialog>
    <Dialog visible={!!bossReveal} title="Boss chest reward" onClose={() => setBossReveal(null)}>{bossReveal && <>
      <View style={styles.wrap}><Badge tone="amber">+{bossReveal.result.rewards?.coins ?? bossReveal.chest.rewardCoins} coins</Badge><Badge>+{bossReveal.result.rewards?.xp ?? bossReveal.chest.rewardXp} XP</Badge></View>
      {bossReveal.result.companionReward && <View style={{ alignItems: 'center', gap: 8 }}><Image source={{ uri: uri(bossReveal.result.companionReward.imagePath) }} accessibilityLabel={bossReveal.result.companionReward.name} style={{ width: 150, height: 150 }} resizeMode="contain" /><Heading>{bossReveal.result.companionReward.name}</Heading>{bossReveal.result.companionReward.duplicate && <Copy>Duplicate · {bossReveal.result.companionReward.coins} coins</Copy>}</View>}
      {[bossReveal.result.gearReward, bossReveal.result.wardrobeReward].filter(Boolean).map(item => <View key={item!.id} style={[styles.row, { gap: 14 }]}>{itemPortrait(item!.id) ? <Image source={itemPortrait(item!.id)} accessibilityLabel={item!.name} resizeMode="contain" style={{ width: 54, height: 54 }} /> : <MaterialCommunityIcons name="sword" size={45} color={colors.purple} />}<View style={{ flex: 1, gap: 4 }}><Text style={{ fontWeight: '700', color: colors.ink }}>{item!.name}</Text><Copy>{item!.duplicate ? `Duplicate · ${item!.coins || 0} coins` : 'Collected'}</Copy></View></View>)}
      {bossReveal.result.rewards?.cosmetic && !bossReveal.result.wardrobeReward && <Copy>Cosmetic: {bossReveal.result.rewards.cosmetic.replaceAll('-', ' ')}</Copy>}<Copy>{bossReveal.result.awarded === false ? 'Previously collected · no extra rewards granted' : 'Saved to your inventory'}</Copy><Action label="Done" onPress={() => setBossReveal(null)} />
    </>}</Dialog>
    <Dialog visible={!!rules} title={rules === 'quest' ? 'Quest chest odds' : rules?.bossName || 'Chest contents'} onClose={() => setRules(null)}>
      {rules === 'quest' && questRules ? <><Copy>{percent(questRules.dropChance)} drop chance · Guaranteed by completion {questRules.guaranteeEvery} · Up to {questRules.dailyLimit}/day (UTC).</Copy><Copy>Earned from each task’s first completion or each daily occurrence. Chests do not expire.</Copy>{questRules.rewards.map(item => <View key={item.kind} style={{ gap: 4 }}><View style={[styles.row, { justifyContent: 'space-between' }]}><Heading>{item.label}</Heading><Badge>{percent(item.chance)}</Badge></View><Copy>{item.description}</Copy></View>)}<Heading>Character rarity</Heading><View style={styles.wrap}>{questRules.companionRarities.map(item => <Badge key={item.tier}>{item.tier} {percent(item.chance)}</Badge>)}</View><Copy>Duplicates: characters give {percent(questRules.duplicateCoins.characterPriceFraction)} of shop price; cosmetics give {questRules.duplicateCoins.cosmetic} coins.</Copy></> : rules && rules !== 'quest' ? <><Copy>{rules.rewardCoins} coins · {rules.rewardXp} XP</Copy><Odds title="One character" items={rules.companionOdds} /><Odds title="One gear item" items={rules.gearOdds} /><Odds title="One cosmetic" items={rules.wardrobeOdds} /><Copy>Each pool rolls independently. Open once, whenever you are ready.</Copy></> : null}
    </Dialog>
  </View>;
}
