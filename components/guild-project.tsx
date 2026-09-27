import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { GuildSummary } from '@/components/guild-raid';
import { Action, Badge, Choice, colors, Copy, Dialog, ErrorNotice, Field, Heading, Loading, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';
import { CompanionScene } from '@/components/companion-scene';
import type { MageHandle } from '@/components/mage/MageCompanion';

type Milestone = {
  id: string; title: string; category: string; assigneeId: string; assigneeName: string;
  size: 'small' | 'medium' | 'large'; taskId: string | null; status: 'pending' | 'submitted' | 'accepted'; acceptedAt?: string | null;
};
type ProjectResponse = { project: { title: string; milestones: Milestone[] } | null; members: { id: string; username: string }[] };
type PrivateTask = { id: string; title: string; isCompleted: boolean; recurrence?: 'none' | 'daily' };
type Form = { title: string; category: string; assigneeId: string; size: Milestone['size']; taskId: string | null };
const presets = [
  { category: 'Research', title: 'Gather sources and summarize key findings' },
  { category: 'Writing', title: 'Draft the introduction and objectives' },
  { category: 'Design', title: 'Create diagrams and visual materials' },
  { category: 'Presentation', title: 'Prepare slides and rehearse the presentation' },
];

export function GuildProject({ guild }: { guild: GuildSummary }) {
  const { user, refreshUser } = useAuth();
  const mage = useRef<MageHandle>(null);
  const [reaction, setReaction] = useState<{ damage: number } | null>(null);
  useEffect(() => { if (reaction) mage.current?.play(reaction.damage ? ['celebrate', 'cast'] : 'celebrate'); }, [reaction]);
  const { data, loading, error, reload } = useResource<ProjectResponse>(`/guilds/${guild.id}/project`, 10000);
  const [dialog, setDialog] = useState<'project' | 'milestone' | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [form, setForm] = useState<Form>({ title: '', category: 'Research', assigneeId: '', size: 'medium', taskId: null });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const tasks = useResource<{ tasks: PrivateTask[] }>(dialog === 'milestone' && form.assigneeId === user?.id ? '/tasks' : null);
  const owner = user?.id === guild.createdBy;
  const project = data?.project;
  const accepted = project?.milestones.filter(milestone => milestone.status === 'accepted').length || 0;

  function editMilestone(milestone?: Milestone) {
    setEditing(milestone || null);
    setForm(milestone ? { title: milestone.title, category: milestone.category || 'Research', assigneeId: milestone.assigneeId, size: milestone.size, taskId: milestone.taskId } : { title: '', category: 'Research', assigneeId: user?.id || '', size: 'medium', taskId: null });
    setActionError(''); setDialog('milestone');
  }

  async function save() {
    if (busy) return;
    if (dialog === 'project' && !projectTitle.trim()) { setActionError('Give your shared project a title.'); return; }
    if (dialog === 'milestone' && (!form.title.trim() || !form.category.trim() || !form.assigneeId)) { setActionError('Add a milestone title, category, and assigned guild member.'); return; }
    setBusy('save'); setActionError(''); setSuccess('');
    try {
      if (dialog === 'project') await api.put(`/guilds/${guild.id}/project`, { title: projectTitle.trim() });
      else {
        const body = { ...form, title: form.title.trim(), category: form.category.trim() };
        if (editing) await api.patch(`/guilds/${guild.id}/project/milestones/${editing.id}`, body);
        else await api.post(`/guilds/${guild.id}/project/milestones`, body);
      }
      setSuccess(dialog === 'project' ? 'Your shared project is saved.' : editing ? 'Milestone updated.' : 'A new milestone is ready for your team.');
      setDialog(null); await reload();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  async function transition(milestone: Milestone, action: 'submit' | 'accept') {
    if (busy) return;
    setBusy(milestone.id); setActionError(''); setSuccess('');
    try {
      const response = await api.post(`/guilds/${guild.id}/project/milestones/${milestone.id}/${action}`);
      const attack = response.data.raidAttack;
      const damage = attack?.damage || 0;
      setSuccess(action === 'submit' ? 'Milestone submitted for your guild owner to review.' : `Milestone accepted. ${attack?.chargesEarned ? 'An attack charge is ready for the assigned member in this raid.' : attack?.reason === 'daily_charge_limit' ? 'Daily attack-charge limit reached; milestone progress is saved.' : damage ? `${damage} guild damage recorded.` : 'Eligible raid contribution is recorded once.'}`);
      await Promise.all([reload(), refreshUser()]);
      if (response.data.awarded && milestone.assigneeId === user?.id) setReaction({ damage });
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }

  return <View style={{ gap: 16 }}>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View style={{ flexGrow: 1, flexBasis: 160 }}><Heading>{project?.title || 'Shared project'}</Heading></View>{owner && <Action label={project ? 'Edit project' : 'Create project'} icon="edit-note" variant="secondary" small disabled={!!busy} onPress={() => { setProjectTitle(project?.title || ''); setActionError(''); setDialog('project'); }} />}</View>
    <ErrorNotice message={error} onRetry={reload} />{!dialog && <ErrorNotice message={actionError} />}
    {!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}
    {!!reaction && <CompanionScene ref={mage} companion={user?.companion} compact />}
    {loading && !data ? <Loading /> : project ? <>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Badge tone="green">{accepted} / {project.milestones.length} milestones accepted</Badge>{owner && <Action label="Add milestone" icon="add" small disabled={!!busy} onPress={() => editMilestone()} />}</View>
      {!project.milestones.length && <View style={{ backgroundColor: colors.canvas, padding: 18, borderRadius: 12, gap: 7 }}><Text style={{ color: colors.ink, fontWeight: '600' }}>Start with one manageable step</Text><Copy>{owner ? 'Add a milestone, choose its expected effort, and assign it to a guild member.' : 'Your guild owner can add and assign the first milestone.'}</Copy></View>}
      {project.milestones.map(milestone => <View key={milestone.id} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 14, gap: 10 }}>
        <View style={[styles.row, { alignItems: 'flex-start' }]}><MaterialIcons name={milestone.status === 'accepted' ? 'check-circle' : milestone.status === 'submitted' ? 'hourglass-top' : 'radio-button-unchecked'} size={21} color={milestone.status === 'accepted' ? colors.green : colors.purple} /><View style={{ flex: 1, gap: 6 }}><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15, lineHeight: 21 }}>{milestone.title}</Text><Text style={styles.label}>Assigned to {milestone.assigneeId === user?.id ? 'you' : milestone.assigneeName || 'a guild member'}</Text></View></View>
        <View style={styles.row}><Text style={styles.label}>{milestone.category || 'Study'} · {milestone.size}</Text><Badge tone={milestone.status === 'accepted' ? 'green' : milestone.status === 'submitted' ? 'amber' : 'neutral'}>{milestone.status === 'submitted' ? 'In review' : milestone.status === 'accepted' ? 'Accepted' : 'In progress'}</Badge></View>
        <View style={[styles.wrap, { justifyContent: 'flex-end' }]}>{owner && milestone.status === 'pending' && <Action label="Edit milestone" icon="edit" variant="ghost" small disabled={!!busy} onPress={() => editMilestone(milestone)} />}{milestone.assigneeId === user?.id && milestone.status === 'pending' && <Action label="Submit for review" icon="check" small busy={busy === milestone.id} disabled={!!busy} onPress={() => transition(milestone, 'submit')} />}{owner && milestone.status === 'submitted' && <Action label="Accept milestone" icon="task-alt" small busy={busy === milestone.id} disabled={!!busy} onPress={() => transition(milestone, 'accept')} />}</View>
      </View>)}
    </> : !error && <Copy>{owner ? 'Create a project to keep the real schoolwork visible beside your shared adventure.' : 'Your guild owner can create a project and assign milestones to the team.'}</Copy>}
    <Dialog visible={!!dialog} title={dialog === 'project' ? project ? 'Edit your shared project' : 'Create a shared project' : editing ? 'Edit milestone' : 'A step for your team'} onClose={() => setDialog(null)} busy={!!busy}>
      {dialog === 'project' ? <><Field label="Project title" placeholder="Capstone: our research project" value={projectTitle} maxLength={120} onChangeText={setProjectTitle} /><Copy>The title and milestones are visible to your guild. Use this space for shared project work.</Copy></> : <>
        {!editing && <View style={{ gap: 9 }}><Text style={styles.label}>Start with a suggestion, then make it yours</Text><View style={styles.wrap}>{presets.map(preset => <Choice key={preset.category} label={preset.category} selected={form.category === preset.category} onPress={() => setForm({ ...form, title: preset.title, category: preset.category })} />)}</View></View>}
        <Field label="Milestone title" placeholder="Draft our research objectives" value={form.title} maxLength={160} onChangeText={title => setForm({ ...form, title })} />
        <Field label="Milestone category" value={form.category} maxLength={40} onChangeText={category => setForm({ ...form, category })} />
        <View style={{ gap: 9 }}><Text style={styles.label}>Assign to a guild member</Text><View style={styles.wrap}>{data?.members.map(member => <Choice key={member.id} label={member.id === user?.id ? `${member.username} (you)` : member.username} selected={form.assigneeId === member.id} onPress={() => setForm({ ...form, assigneeId: member.id, taskId: null })} />)}</View></View>
        <View style={{ gap: 9 }}><Text style={styles.label}>Expected effort · separate from urgency</Text><View style={styles.wrap}>{(['small', 'medium', 'large'] as const).map(size => <Choice key={size} label={size[0].toUpperCase() + size.slice(1)} selected={form.size === size} onPress={() => setForm({ ...form, size })} />)}</View></View>
        {form.assigneeId === user?.id ? <View style={{ gap: 10 }}><Text style={styles.label}>Link one of your tasks (optional)</Text><Copy>The task’s private title stays private. Link a one-time task; its completion and this milestone share a single raid contribution. Daily tasks contribute separately when completed.</Copy><ErrorNotice message={tasks.error} onRetry={tasks.reload} /><View style={styles.wrap}><Choice label="No linked task" selected={!form.taskId} onPress={() => setForm({ ...form, taskId: null })} />{tasks.data?.tasks.filter(task => task.recurrence !== 'daily').map(task => <Choice key={task.id} label={`${task.title}${task.isCompleted ? ' · completed' : ''}`} selected={form.taskId === task.id} onPress={() => setForm({ ...form, taskId: task.id })} />)}</View>{tasks.loading && <Copy>Loading your tasks…</Copy>}</View> : <Copy>You can link your own task when assigning a milestone to yourself. Other members’ private task lists are not shared here.</Copy>}
        <Copy>The assigned member submits completed work. The guild owner accepts it after review.</Copy>
      </>}
      <ErrorNotice message={actionError} /><Action label={dialog === 'project' ? 'Save project' : editing ? 'Save milestone' : 'Add milestone'} icon="check" busy={busy === 'save'} onPress={save} />
    </Dialog>
  </View>;
}
