import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { Action, colors, dateLabel, Empty, ErrorNotice, Heading, Loading, Screen, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import type { Task } from '../task';
import type { Report } from '../reports';
import { FocusPanel } from '@/components/focus-panel';
import { TaskPlanner } from '@/components/task-planner';

export default function Home() {
  const { user, refreshUser } = useAuth();
  const report = useResource<Report>('/reports', 60_000);
  const tasks = useResource<{ tasks: Task[] }>('/tasks', 60_000);
  const reloadTasks = tasks.reload;
  const reloadReport = report.reload;
  useFocusEffect(useCallback(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { void reloadTasks(); void reloadReport(); }
    });
    return () => subscription.remove();
  }, [reloadTasks, reloadReport]));
  const upcoming = (tasks.data?.tasks || []).filter(task => !task.isCompleted).sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)).slice(0, 3);
  async function refresh() { await Promise.all([report.reload(), tasks.reload(), refreshUser()]); }
  return <Screen title="Today" onRefresh={() => { void refresh().catch(() => {}); }} action={<Action label="New task" icon="add" small onPress={() => router.push('/(tabs)/task?create=1')} />}>
    <View style={[styles.row, { justifyContent: 'space-around', paddingVertical: 8 }]}>{[
      { label: 'Day streak', value: user?.streak || 0, icon: 'local-fire-department' as const },
      { label: 'Level', value: user?.level || 1, icon: 'military-tech' as const },
      { label: 'Completed', value: report.data?.summary.totalCompletions ?? 0, icon: 'task-alt' as const },
    ].map(item => <View key={item.label} style={{ alignItems: 'center', gap: 4 }}><View style={styles.row}><MaterialIcons name={item.icon} size={20} color={colors.purple} /><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 22 }}>{item.value}</Text></View><Text style={styles.label}>{item.label}</Text></View>)}</View>
    <FocusPanel />
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Heading>Up next</Heading><Action label="All tasks" icon="arrow-forward" variant="ghost" small onPress={() => router.push('/(tabs)/task')} /></View>
    <ErrorNotice message={tasks.error} onRetry={tasks.reload} /><ErrorNotice message={report.error} onRetry={report.reload} />
    {tasks.loading ? <Loading /> : !tasks.error && !upcoming.length ? <Empty icon="check-circle-outline" title="All clear" message="Add your next task when you're ready." /> : <View>{upcoming.map(task => <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={`View task: ${task.title}`} onPress={() => router.push('/(tabs)/task')} style={[styles.row, { paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.border }]}><MaterialIcons name="radio-button-unchecked" size={22} color={colors.purple} /><View style={{ flex: 1, gap: 4 }}><Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>{task.title}</Text><Text style={styles.label}>{task.recurrence === 'daily' ? 'Daily' : dateLabel(task.dueDate)}</Text></View><MaterialIcons name="chevron-right" size={20} color={colors.muted} /></Pressable>)}</View>}
    <TaskPlanner tasks={upcoming} onSaved={tasks.reload} />
  </Screen>;
}
