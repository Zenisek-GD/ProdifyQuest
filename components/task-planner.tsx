import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Action, Choice, colors, Copy, Dialog, ErrorNotice, styles } from '@/components/quest-ui';
import type { Task } from '@/app/(tabs)/task';
import { api, errorMessage } from '@/scripts/api';
import { makeChecklistStep as makeStep } from '@/scripts/task-checklist';

const presets = {
  Assignment: ['Read the instructions', 'Draft the first section', 'Review and revise'],
  Capstone: ['Draft Objectives', 'Write the Introduction', 'Revise Chapter 1'],
  Revision: ['Choose one topic', 'Review your notes', 'Try three practice questions'],
};

export function TaskPlanner({ tasks, onSaved }: { tasks: Task[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [steps, setSteps] = useState<Task['subtasks']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function chooseTask(task: Task) {
    setSelected(task);
    setSteps(task.subtasks?.length ? task.subtasks.map(step => ({ ...step })) : presets.Assignment.map(title => makeStep(title)));
    setError('');
  }
  async function save() {
    if (!selected || busy) return;
    const subtasks = steps.map(step => ({ ...step, title: step.title.trim() })).filter(step => step.title);
    if (subtasks.length > 20) { setError('Use up to 20 checklist items.'); return; }
    setBusy(true); setError('');
    try {
      await api.patch(`/tasks/${selected.id}`, {
        subtasks,
        ...(selected.recurrence === 'daily' ? { occurrenceDay: selected.occurrenceDay } : {}),
      });
      setOpen(false); setSelected(null); await onSaved();
    } catch (cause) { setError(errorMessage(cause)); void onSaved(); }
    finally { setBusy(false); }
  }
  return <>
    <Action label="Plan task steps" icon="checklist" variant="ghost" small disabled={!tasks.length} onPress={() => { setSelected(null); setError(''); setOpen(true); }} />
    <Dialog visible={open} title="Plan task steps" onClose={() => setOpen(false)} busy={busy}>
      {!selected ? <>{tasks.length ? tasks.map(task => <Action key={task.id} label={`Plan steps: ${task.title}`} variant="secondary" onPress={() => chooseTask(task)} />) : <Copy>Add a task to start planning.</Copy>}</> : <>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={[styles.heading, { flex: 1 }]}>{selected.title}</Text><Action label="Change task" variant="ghost" small disabled={busy} onPress={() => setSelected(null)} /></View>
        <View style={{ gap: 8 }}><Text style={styles.label}>Start from a template</Text><View style={styles.wrap}>{Object.entries(presets).map(([name, titles]) => <Choice key={name} label={name} selected={steps.map(step => step.title).join('\n') === titles.join('\n')} onPress={() => { if (!busy) setSteps(titles.map(title => makeStep(title))); }} />)}</View></View>
        <View>{steps.map((step, index) => <View key={step.id} style={[styles.row, { gap: 8, borderBottomWidth: 1, borderColor: colors.border }]}><MaterialIcons name={step.done ? 'check-box' : 'check-box-outline-blank'} size={21} color={step.done ? colors.green : colors.muted} /><TextInput accessibilityLabel={`Planner checklist item ${index + 1}`} placeholder="Add a small step" placeholderTextColor={colors.muted} value={step.title} maxLength={160} editable={!busy} onChangeText={title => setSteps(current => current.map(item => item.id === step.id ? { ...item, title } : item))} style={{ flex: 1, minWidth: 0, minHeight: 46, fontSize: 14, color: colors.ink, paddingVertical: 10 }} /><Pressable accessibilityRole="button" accessibilityLabel={`Remove planner item ${index + 1}`} disabled={busy} onPress={() => setSteps(current => current.filter(item => item.id !== step.id))} style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}><MaterialIcons name="close" size={19} color={colors.muted} /></Pressable></View>)}</View>
        <Action label="Add planner item" icon="add" small variant="ghost" disabled={busy || steps.length >= 20} onPress={() => { const step = makeStep(); setSteps(current => [...current, step]); }} />
        <ErrorNotice message={error} />
        <Action label="Save task steps" busy={busy} onPress={save} />
      </>}
    </Dialog>
  </>;
}
