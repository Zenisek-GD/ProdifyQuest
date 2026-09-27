import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Action, Badge, Choice, colors, Confirm, Copy, dateLabel, Dialog, Empty, ErrorNotice, Field, Loading, Screen, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';
import { makeChecklistStep } from '@/scripts/task-checklist';
import { CompanionStatusHeader } from '@/components/companion-status-header';
import type { MageHandle } from '@/components/mage/MageCompanion';
import type { Companion } from '@/scripts/companion-types';

type Step = { id: string; title: string; done: boolean };
export type Task = {
  id: string; title: string; description: string; category: string;
  priority: 'low' | 'medium' | 'high'; difficulty: 'easy' | 'normal' | 'hard';
  dueDate: string | null; isCompleted: boolean; completedAt?: string | null;
  size: 'small' | 'medium' | 'large'; subtasks: Step[];
  recurrence: 'none' | 'daily'; occurrenceDay: string | null; occurrenceAvailable: boolean;
  recurrenceStartDay: string | null; recurrenceTimeZone: string; nextResetAt: string | null;
  recurrenceLocked?: boolean;
};
const coinReward = { easy: 5, normal: 10, hard: 20 };
const blank = { title: '', description: '', category: 'Personal', priority: 'medium' as Task['priority'], difficulty: 'normal' as Task['difficulty'], size: 'medium' as Task['size'], recurrence: 'none' as Task['recurrence'], steps: [] as Step[], date: '', time: '' };
function localParts(value: string | null) {
  if (!value) return { date: '', time: '' };
  const d = new Date(value), pad = (v: number) => String(v).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function scheduledAt(date: string, time: string): string | null {
  if (!date.trim()) {
    if (time.trim()) throw new Error('Add a date for your scheduled time.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use YYYY-MM-DD for the due date.');
  const clock = time.trim() || '23:59';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('Use a 24-hour time, such as 14:30.');
  const d = new Date(`${date}T${clock}:00`);
  if (Number.isNaN(d.getTime()) || localParts(d.toISOString()).date !== date) throw new Error('Enter a valid calendar date.');
  return d.toISOString();
}

export default function Tasks() {
  const { create } = useLocalSearchParams<{ create?: string }>();
  const { data, loading, error, reload } = useResource<{ tasks: Task[]; raidRules: { damage: Record<Task['size'], number>; dailyLimit: number; resetTime: string; bossId?: string; attackMode?: string; dailyChargeLimit?: number } }>('/tasks', 60_000);
  const { user, refreshUser } = useAuth();
  const mage = useRef<MageHandle>(null);
  const [celebration, setCelebration] = useState<{ companion: Companion; previous?: Companion } | null>(null);
  const [filter, setFilter] = useState('Pending');
  const [category, setCategory] = useState('All categories');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(false);
  const [form, setForm] = useState(blank);
  const [remove, setRemove] = useState<Task | null>(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { setNow(Date.now()); void reload(); }
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [reload]));
  const tasks = data?.tasks || [];
  const selected = tasks.find(task => task.id === detailsId);
  const raidRules = data?.raidRules;
  const recurrenceTimeZone = editing?.recurrenceTimeZone || user?.timeZone || 'UTC';
  const damageLabel = (size: Task['size']) => raidRules?.bossId === 'dreadroot' ? '1 attack charge' : raidRules ? `${raidRules.damage[size]} raid damage` : `${size} effort`;
  const categories = Array.from(new Set(tasks.map(task => task.category))).sort();
  const visible = useMemo(() => (data?.tasks || []).filter(task =>
    (filter === 'All tasks' || (filter === 'Daily' ? task.recurrence === 'daily' : filter === 'Completed' ? task.isCompleted : !task.isCompleted))
    && (category === 'All categories' || task.category === category)
    && (task.title + ' ' + task.description).toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)), [data, filter, category, search]);

  const newStep = makeChecklistStep;
  function startEdit(task?: Task) {
    setDetailsId(null); setEditing(task || null); setOptions(false);
    setForm(task ? { title: task.title, description: task.description, category: task.category, priority: task.priority, difficulty: task.difficulty, size: task.size || 'medium', recurrence: task.recurrence || 'none', steps: task.subtasks?.map(step => ({ ...step })) || [], ...localParts(task.dueDate) } : { ...blank, steps: [newStep()] });
    setActionError(''); setOpen(true);
  }
  useFocusEffect(useCallback(() => {
    if (create !== '1') return;
    setDetailsId(null); setEditing(null); setOptions(false);
    setForm({ ...blank, steps: [makeChecklistStep()] });
    setActionError(''); setOpen(true);
    router.setParams({ create: undefined });
  }, [create, setDetailsId, setEditing, setOptions, setForm, setActionError, setOpen]));
  async function save() {
    if (busy) return;
    setActionError('');
    if (!form.title.trim()) { setActionError('Give your task a title.'); return; }
    if (!form.category.trim()) { setActionError('Choose a category or type your own.'); return; }
    try {
      const dueDate = scheduledAt(form.date.trim(), form.time.trim());
      const subtasks = form.steps.map(step => ({ ...step, title: step.title.trim() })).filter(step => step.title);
      if (subtasks.length > 20) throw new Error('Use up to 20 checklist items.');
      setBusy('save');
      const originalDate = editing ? localParts(editing.dueDate) : null;
      const dateChanged = !originalDate || form.date.trim() !== originalDate.date || form.time.trim() !== originalDate.time;
      const payload = {
        title: form.title.trim(), description: form.description.trim(), category: form.category.trim(),
        priority: form.priority, difficulty: form.difficulty, size: form.size, recurrence: form.recurrence, subtasks,
        ...(!editing || dateChanged ? { dueDate } : {}),
        ...(editing?.recurrence === 'daily' ? { occurrenceDay: editing.occurrenceDay } : {}),
      };
      if (editing) await api.patch(`/tasks/${editing.id}`, payload); else await api.post('/tasks', payload);
      setOpen(false); setSuccess(editing ? 'Task updated.' : 'Task added.'); await reload();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function complete(task: Task) {
    if (busy) return;
    setBusy(task.id); setActionError(''); setSuccess('');
    try {
      const response = await api.post(`/tasks/${task.id}/complete`, task.recurrence === 'daily' ? { occurrenceDay: task.occurrenceDay } : undefined);
      const attack = response.data.raidAttack;
      setSuccess(response.data.awarded ? `Quest complete! +${coinReward[task.difficulty]} coins.${attack?.chargesEarned ? ' +1 raid charge.' : attack?.damage ? ` ${attack.damage} raid damage.` : ''}${response.data.questBox ? ' Chest added to Inventory.' : ''}` : task.recurrence === 'daily' ? 'Already completed today.' : 'Already completed.');
      if (response.data.awarded) {
        setCelebration({ companion: response.data.user.companion, previous: user?.companion });
        mage.current?.play(attack?.damage ? ['celebrate', 'cast'] : 'celebrate');
      }
      setDetailsId(null);
      await Promise.all([reload(), refreshUser()]);
    } catch (err) { setActionError(errorMessage(err)); void reload(); }
    finally { setBusy(''); }
  }
  async function deleteTask() {
    if (!remove || busy) return;
    setBusy('delete'); setActionError('');
    try { await api.delete(`/tasks/${remove.id}`); setRemove(null); setSuccess('Task deleted.'); await reload(); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function toggleStep(task: Task, id: string) {
    if (busy) return;
    setBusy(task.id); setActionError('');
    try { await api.patch(`/tasks/${task.id}`, { subtasks: task.subtasks.map(step => step.id === id ? { ...step, done: !step.done } : step), ...(task.recurrence === 'daily' ? { occurrenceDay: task.occurrenceDay } : {}) }); await reload(); }
    catch (cause) { setActionError(errorMessage(cause)); void reload(); }
    finally { setBusy(''); }
  }
  function dueSummary(task: Task) {
    if (task.recurrence === 'daily' && !task.occurrenceAvailable) return `Starts ${task.recurrenceStartDay}`;
    if (task.isCompleted) return task.recurrence === 'daily' ? 'Done today' : 'Done';
    if (task.dueDate) return `${new Date(task.dueDate).getTime() < now ? 'Overdue · ' : ''}${dateLabel(task.dueDate)}`;
    return task.recurrence === 'daily' ? 'Daily' : task.category;
  }

  return <Screen title="Your quests" subtitle="" companionHeader={<CompanionStatusHeader ref={mage} companion={celebration && celebration.previous === user?.companion ? celebration.companion : undefined} active={!open && !remove && !selected} />} onRefresh={reload} action={<Action label="New task" icon="add" onPress={() => startEdit()} disabled={!!busy} />}>
    <View style={[styles.row, { justifyContent: 'space-between', gap: 4 }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>{['Pending', 'Daily', 'Completed', 'All tasks'].map(value => <Choice key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel={showSearch ? 'Hide task search' : 'Search tasks'} accessibilityState={{ expanded: showSearch }} onPress={() => setShowSearch(!showSearch)} style={local.iconButton}><MaterialIcons name={showSearch ? 'close' : 'search'} size={23} color={colors.purple} /></Pressable>
    </View>
    {showSearch && <View style={{ gap: 12 }}><Field label="Find a task" placeholder="Search tasks" value={search} onChangeText={setSearch} />{categories.length > 0 && <View style={styles.wrap}>{['All categories', ...categories].map(value => <Choice key={value} label={value} selected={category === value} onPress={() => setCategory(value)} />)}</View>}</View>}
    {!showSearch && (search || category !== 'All categories') ? <Action label="Clear search filters" icon="filter-alt-off" small variant="ghost" onPress={() => { setSearch(''); setCategory('All categories'); }} /> : null}
    <ErrorNotice message={error} onRetry={reload} />
    {!open && !remove && !selected && <ErrorNotice message={actionError} />}
    {!!success && <View accessibilityRole="alert" style={[styles.row, local.notice]}><MaterialIcons name="check-circle-outline" size={20} color={colors.green} /><Text style={{ flex: 1, color: colors.green, fontSize: 13 }}>{success}</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss task message" onPress={() => setSuccess('')} style={local.iconButton}><MaterialIcons name="close" size={18} color={colors.green} /></Pressable></View>}
    {loading ? <Loading /> : !error && !visible.length ? <Empty icon="task-alt" title={tasks.length ? 'All clear' : 'Your first quest'} message={tasks.length ? 'Try another filter or add a task.' : 'Start with one thing to do.'} action={<Action label="Create a task" icon="add" onPress={() => startEdit()} />} /> : <View>{visible.map(task => {
      const available = task.recurrence !== 'daily' || task.occurrenceAvailable;
      const stepCount = task.subtasks?.length || 0;
      const doneSteps = task.subtasks?.filter(step => step.done).length || 0;
      const overdue = available && !task.isCompleted && task.dueDate && new Date(task.dueDate).getTime() < now;
      return <View key={task.id} style={local.taskRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open task: ${task.title}`} disabled={!!busy} onPress={() => { setDetailsId(task.id); setActionError(''); }} style={({ pressed }) => [local.taskSummary, { opacity: pressed ? 0.65 : 1 }]}>
          <View style={[styles.row, { gap: 7 }]}>{task.recurrence === 'daily' && <MaterialIcons name="repeat" size={17} color={colors.purple} />}<Text style={[local.taskTitle, task.isCompleted && { textDecorationLine: 'line-through', color: colors.muted }]}>{task.title}</Text></View>
          <View style={[styles.row, { flexWrap: 'wrap', gap: 9 }]}><Text style={[local.meta, overdue && { color: colors.red }]}>{dueSummary(task)}</Text>{!!stepCount && <View style={[styles.row, { gap: 4 }]}><MaterialIcons name="checklist" size={15} color={colors.muted} /><Text style={local.meta}>{doneSteps}/{stepCount}</Text></View>}{!task.isCompleted && <Text style={[local.meta, { color: colors.amber }]}>+{coinReward[task.difficulty]} coins</Text>}</View>
          {!!stepCount && <View style={local.progress}><View style={[local.progressFill, { width: `${Math.round(doneSteps / stepCount * 100)}%` }]} /></View>}
        </Pressable>
        {task.isCompleted ? <MaterialIcons name="check-circle" size={24} color={colors.green} /> : <Action label={task.recurrence === 'daily' ? 'Complete today' : 'Complete'} icon="check" small busy={busy === task.id} disabled={!!busy || !available} onPress={() => complete(task)} />}
      </View>;
    })}</View>}

    <Dialog visible={!!selected} title="Task details" onClose={() => setDetailsId(null)} busy={!!busy}>
      {selected && <>
        <Text style={styles.heading}>{selected.title}</Text>
        <View style={styles.wrap}><Badge>{selected.category}</Badge><Badge tone="neutral">{selected.priority} priority</Badge><Badge tone="amber">{coinReward[selected.difficulty]} coins</Badge></View>
        {!!selected.description && <Copy>{selected.description}</Copy>}
        {(selected.dueDate || selected.recurrence === 'daily') && <Copy>{dueSummary(selected)}{selected.dueDate ? ` · ${new Date(selected.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{selected.recurrence === 'daily' ? `\nResets at midnight · ${selected.recurrenceTimeZone}` : ''}</Copy>}
        {selected.recurrence === 'daily' && selected.isCompleted && selected.nextResetAt && <Copy>Next quest: {new Date(selected.nextResetAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: selected.recurrenceTimeZone })}</Copy>}
        {!!selected.subtasks?.length && <View style={{ gap: 3 }}><Text style={styles.label}>Checklist · {selected.subtasks.filter(step => step.done).length}/{selected.subtasks.length}</Text>{selected.subtasks.map(step => <Pressable key={step.id} accessibilityRole="checkbox" accessibilityLabel={`${step.done ? 'Undo' : 'Finish'} step: ${step.title}`} accessibilityState={{ checked: step.done, disabled: !!busy || (selected.recurrence === 'daily' && (!selected.occurrenceAvailable || selected.isCompleted)) }} disabled={!!busy || (selected.recurrence === 'daily' && (!selected.occurrenceAvailable || selected.isCompleted))} onPress={() => toggleStep(selected, step.id)} style={local.checklistRow}><MaterialIcons name={step.done ? 'check-box' : 'check-box-outline-blank'} size={23} color={step.done ? colors.green : colors.purple} /><Text style={[local.checklistText, step.done && { textDecorationLine: 'line-through', color: colors.muted }]}>{step.title}</Text></Pressable>)}</View>}
        <Copy>{selected.size || 'medium'} effort · {damageLabel(selected.size || 'medium')}</Copy>
        <ErrorNotice message={actionError} />
        <View style={styles.wrap}><Action label="Edit" icon="edit" variant="secondary" small disabled={!!busy} onPress={() => startEdit(selected)} /><Action label="Delete" icon="delete-outline" variant="ghost" small disabled={!!busy} onPress={() => { setRemove(selected); setDetailsId(null); setActionError(''); }} />{!selected.isCompleted && <Action label={selected.recurrence === 'daily' ? 'Complete today' : 'Complete'} icon="check" small busy={busy === selected.id} disabled={!!busy || (selected.recurrence === 'daily' && !selected.occurrenceAvailable)} onPress={() => complete(selected)} />}</View>
      </>}
    </Dialog>

    <Dialog visible={open} title={editing ? 'Edit your task' : 'A new quest'} onClose={() => setOpen(false)} busy={!!busy}>
      <Field label="Task title" placeholder="What do you want to finish?" value={form.title} maxLength={160} onChangeText={title => setForm(current => ({ ...current, title }))} />
      <View style={{ gap: 7 }}><View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.label}>Checklist <Text style={{ fontWeight: '400' }}>(optional)</Text></Text><Text style={local.meta}>{form.steps.filter(step => step.title.trim()).length}/20</Text></View>
        {form.steps.map((step, index) => <View key={step.id} style={local.editorRow}><MaterialIcons name={step.done ? 'check-box' : 'check-box-outline-blank'} size={21} color={step.done ? colors.green : colors.muted} /><TextInput accessibilityLabel={`Checklist item ${index + 1}`} placeholder="Add a small step" placeholderTextColor={colors.muted} value={step.title} maxLength={160} editable={!busy} onChangeText={title => setForm(current => ({ ...current, steps: current.steps.map(item => item.id === step.id ? { ...item, title } : item) }))} style={local.stepInput} /><Pressable accessibilityRole="button" accessibilityLabel={`Remove checklist item ${index + 1}`} disabled={!!busy} onPress={() => setForm(current => ({ ...current, steps: current.steps.filter(item => item.id !== step.id) }))} style={local.iconButton}><MaterialIcons name="close" size={19} color={colors.muted} /></Pressable></View>)}
        <Action label="Add checklist item" icon="add" variant="ghost" small disabled={!!busy || form.steps.length >= 20} onPress={() => { const step = newStep(); setForm(current => ({ ...current, steps: [...current.steps, step] })); }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={options ? 'Fewer options' : 'More options'} accessibilityState={{ expanded: options }} onPress={() => setOptions(!options)} style={[styles.row, local.options]}><MaterialIcons name="tune" size={20} color={colors.purple} /><Text style={{ flex: 1, color: colors.purple, fontWeight: '600' }}>{options ? 'Fewer options' : 'More options'}</Text><MaterialIcons name={options ? 'expand-less' : 'expand-more'} size={22} color={colors.purple} /></Pressable>
      {!options && <Text style={local.meta}>{form.recurrence === 'daily' ? 'Daily' : 'One time'} · {form.category} · {coinReward[form.difficulty]} coins{form.date ? ` · ${form.date}` : ''}</Text>}
      {options && <View style={{ gap: 18 }}>
        <View style={{ gap: 9 }}><Text style={styles.label}>Repeat</Text>{editing?.recurrenceLocked ? <><Badge>{form.recurrence === 'daily' ? 'Repeats daily' : 'One time'}</Badge><Copy>Repeat is fixed after the first completion.</Copy></> : <View style={styles.wrap}>{([{ value: 'none', label: 'One time' }, { value: 'daily', label: 'Daily' }] as const).map(option => <Choice key={option.value} label={option.label} selected={form.recurrence === option.value} onPress={() => setForm(current => ({ ...current, recurrence: option.value }))} />)}</View>}{form.recurrence === 'daily' && <Copy>Resets at midnight · {recurrenceTimeZone}</Copy>}</View>
        <Field label="Due date (optional · YYYY-MM-DD)" placeholder="2026-10-01" value={form.date} autoCapitalize="none" maxLength={10} onChangeText={date => setForm(current => ({ ...current, date }))} />
        <Field label="Due time (optional · 24-hour HH:mm)" placeholder="18:00" value={form.time} maxLength={5} onChangeText={time => setForm(current => ({ ...current, time }))} />
        <Text style={local.meta}>Device time · defaults to 23:59.{form.recurrence === 'daily' ? editing?.recurrence === 'daily' ? ' First day stays unchanged.' : ' A future date sets the first day.' : ''}</Text>
        <Field label="Category" value={form.category} maxLength={40} onChangeText={category => setForm(current => ({ ...current, category }))} />
        <View style={styles.wrap}>{['Personal', 'Study', 'Work', 'Health'].map(category => <Choice key={category} label={category} selected={form.category === category} onPress={() => setForm(current => ({ ...current, category }))} />)}</View>
        <View style={{ gap: 9 }}><Text style={styles.label}>Priority</Text><View style={styles.wrap}>{(['low', 'medium', 'high'] as const).map(priority => <Choice key={priority} label={priority[0].toUpperCase() + priority.slice(1)} selected={form.priority === priority} onPress={() => setForm(current => ({ ...current, priority }))} />)}</View></View>
        <View style={{ gap: 9 }}><Text style={styles.label}>Difficulty</Text>{editing?.isCompleted ? <Badge tone="neutral">{form.difficulty} · {coinReward[form.difficulty]} coins</Badge> : <View style={styles.wrap}>{(['easy', 'normal', 'hard'] as const).map(difficulty => <Choice key={difficulty} label={`${difficulty[0].toUpperCase() + difficulty.slice(1)} · ${coinReward[difficulty]} coins`} selected={form.difficulty === difficulty} onPress={() => setForm(current => ({ ...current, difficulty }))} />)}</View>}</View>
        <View style={{ gap: 9 }}><Text style={styles.label}>Expected effort</Text>{editing?.isCompleted ? <Badge tone="neutral">{form.size} · {damageLabel(form.size)}</Badge> : <View style={styles.wrap}>{(['small', 'medium', 'large'] as const).map(size => <Choice key={size} label={`${size} · ${damageLabel(size)}`} selected={form.size === size} onPress={() => setForm(current => ({ ...current, size }))} />)}</View>}</View>
        <Field label="Description (optional)" placeholder="Add a note" value={form.description} maxLength={2000} multiline onChangeText={description => setForm(current => ({ ...current, description }))} />
      </View>}
      <ErrorNotice message={actionError} />
      <Action label={editing ? 'Save changes' : 'Create task'} icon="check" busy={busy === 'save'} onPress={save} />
    </Dialog>
    <Confirm visible={!!remove} title="Delete task?" message={`Remove “${remove?.title || ''}”?${remove?.recurrence === 'daily' ? ' Future daily repeats will stop.' : ''} Earned rewards are kept.`} label="Delete task" danger busy={busy === 'delete'} error={actionError} onConfirm={deleteTask} onClose={() => { setRemove(null); setActionError(''); }} />
  </Screen>;
}

const local = StyleSheet.create({
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 14 },
  taskSummary: { flex: 1, gap: 7, minHeight: 48, justifyContent: 'center' },
  taskTitle: { color: colors.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  progress: { height: 3, backgroundColor: colors.border, borderRadius: 3, maxWidth: 130, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.green },
  iconButton: { minWidth: 40, minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  notice: { backgroundColor: '#E9F6F0', borderRadius: 10, paddingLeft: 12, gap: 7 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 9, borderBottomWidth: 1, borderColor: colors.border },
  checklistText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: colors.border },
  stepInput: { flex: 1, minWidth: 0, minHeight: 46, fontSize: 14, color: colors.ink, paddingVertical: 10 },
  options: { minHeight: 44, paddingVertical: 7, borderTopWidth: 1, borderColor: colors.border },
});
