import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Share, Text, View } from 'react-native';
import { Action, Badge, Choice, colors, Copy, Empty, ErrorNotice, Heading, Loading, momentLabel, Panel, Screen, Stat, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';

export type Report = {
  summary: { totalTasks: number; totalCompletions: number; completedTasks: number; pendingTasks: number; overdueTasks: number; completionRate: number; coins: number; coinsEarned: number; coinsSpent: number; cardsPurchased: number; rewardsRedeemed: number };
  daily: { date: string; completed: number }[];
  transactions: { id: string; type: string; description: string; amount: number; balance: number; createdAt: string }[];
  historyTruncated: boolean; historyLimit: number; historyNote?: string;
};
const typeLabels: Record<string, string> = { task_completion: 'Task completed', card_purchase: 'Companion purchased', cosmetic_purchase: 'Cosmetic purchased', raid_victory: 'Raid victory reward', box_reward: 'Quest box opened', reward_redemption: 'Reward redeemed' };

export default function Reports() { return <ReportsView />; }

export function ReportsView({ history = false }: { history?: boolean }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useResource<Report>('/reports');
  const [filter, setFilter] = useState('All activity');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [success, setSuccess] = useState('');
  const [limit, setLimit] = useState(20);
  const filterType: Record<string, string> = { Tasks: 'task_completion', Companions: 'card_purchase', Cosmetics: 'cosmetic_purchase', Raids: 'raid_victory', Boxes: 'box_reward', Rewards: 'reward_redemption' };
  const transactions = (data?.transactions || []).filter(entry => filter === 'All activity' || entry.type === filterType[filter]);
  const max = Math.max(1, ...(data?.daily.map(day => day.completed) || []));
  async function exportHistory() {
    if (exporting) return;
    setExporting(true); setExportError(''); setSuccess('');
    try {
      const response = await api.get<string>('/reports/export', { responseType: 'text' });
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'prodifyquest-history.csv'; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setSuccess('Your history download is ready.');
      } else await Share.share({ title: 'ProdifyQuest activity history', message: response.data });
    } catch (err) { setExportError(errorMessage(err)); }
    finally { setExporting(false); }
  }
  return <Screen title={history ? 'Activity' : 'Progress'} onRefresh={reload} action={history ? <Action label="Back" variant="ghost" icon="arrow-back" onPress={() => router.replace('/(tabs)/reports')} /> : <Action label="History" variant="secondary" icon="history" small onPress={() => router.push('/(tabs)/reports/history')} />}>
    <ErrorNotice message={error} onRetry={reload} /><ErrorNotice message={exportError} />{!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}
    {loading ? <Loading /> : data && <>
      {!history ? <>
        <View style={styles.wrap}><Stat label="Tasks completed" value={data.summary.completedTasks} icon="task-alt" /><Stat label="Pending" value={data.summary.pendingTasks} icon="schedule" /><Stat label="Coins earned" value={data.summary.coinsEarned} icon="add-circle-outline" tone={colors.green} /><Stat label="Coins spent" value={data.summary.coinsSpent} icon="shopping-bag" tone={colors.amber} /></View>
        <Panel><View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Heading>Last 14 days</Heading><Text style={styles.label}>{user?.timeZone || 'UTC'}</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 150 }}>{data.daily.map(day => <View key={day.date} accessible accessibilityLabel={`${day.date}: ${day.completed} tasks completed`} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}><Text style={{ color: colors.muted, fontSize: 10 }}>{day.completed || ''}</Text><View style={{ width: '100%', maxWidth: 36, height: Math.max(4, day.completed / max * 100), borderRadius: 4, backgroundColor: day.completed ? colors.purple : colors.border }} /><Text style={{ color: colors.muted, fontSize: 9 }}>{Number(day.date.slice(-2))}</Text></View>)}</View>
        </Panel>
        <View style={{ gap: 14 }}>{[
          ['Recorded completions', data.summary.totalCompletions], ['Completion rate', `${data.summary.completionRate}%`],
          ['Overdue', data.summary.overdueTasks], ['Characters purchased', data.summary.cardsPurchased], ['Rewards redeemed', data.summary.rewardsRedeemed],
        ].map(([label, value]) => <View key={label} style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.body}>{label}</Text><Text style={{ color: colors.ink, fontWeight: '700' }}>{value}</Text></View>)}</View>
      </> : <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{['All activity', 'Tasks', 'Companions', 'Cosmetics', 'Raids', 'Boxes', 'Rewards'].map(value => <Choice key={value} label={value} selected={filter === value} onPress={() => { setFilter(value); setLimit(20); }} />)}</ScrollView>
        {transactions.length === 0 ? <Empty icon="history" title="No activity yet" message="Your progress will appear here." /> : <View>{transactions.slice(0, limit).map(entry => <View key={entry.id} style={[styles.row, { paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border, alignItems: 'flex-start' }]}><View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>{entry.description}</Text><Text style={styles.label}>{typeLabels[entry.type] || 'Activity'} · {momentLabel(entry.createdAt)}</Text></View><View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ color: entry.amount >= 0 ? colors.green : colors.amber, fontWeight: '800', fontSize: 16 }}>{entry.amount > 0 ? '+' : ''}{entry.amount}</Text><Text style={styles.label}>{entry.balance} left</Text></View></View>)}{transactions.length > limit && <Action label="Show more" variant="secondary" onPress={() => setLimit(limit + 20)} />}</View>}
        {data.historyTruncated && <Copy>Latest {data.historyLimit} entries. Export to see all activity.</Copy>}
        {!!data.historyNote && <Copy>{data.historyNote}</Copy>}
      </>}
      <Action label={Platform.OS === 'web' ? 'Export CSV' : 'Share history'} icon="file-download" variant="secondary" busy={exporting} onPress={exportHistory} />
    </>}
  </Screen>;
}
