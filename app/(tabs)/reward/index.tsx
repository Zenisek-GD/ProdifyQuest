import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Action, Badge, Choice, colors, Confirm, Copy, Dialog, Empty, ErrorNotice, Field, Loading, Screen, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';

type Reward = { id: string; name: string; description: string; cost: number; redeemed: boolean; redeemedAt?: string };
export default function Rewards() {
  const { user, refreshUser } = useAuth();
  const { data, loading, error, reload } = useResource<{ rewards: Reward[] }>('/rewards');
  const [filter, setFilter] = useState('Available');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState({ name: '', description: '', cost: '25' });
  const [confirm, setConfirm] = useState<{ reward: Reward; action: 'redeem' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState<Reward | null>(null);
  const rewards = (data?.rewards || []).filter(r => filter === 'Redeemed' ? r.redeemed : !r.redeemed);
  function edit(reward?: Reward) {
    setEditing(reward || null); setActionError('');
    setForm(reward ? { name: reward.name, description: reward.description, cost: String(reward.cost) } : { name: '', description: '', cost: '25' });
    setOpen(true);
  }
  async function save() {
    if (busy) return;
    setActionError('');
    if (!form.name.trim()) { setActionError('Give your reward a name.'); return; }
    if (!/^\d+$/.test(form.cost) || Number(form.cost) < 1 || Number(form.cost) > 1000000) { setActionError('Enter a whole-number coin cost between 1 and 1,000,000.'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), cost: Number(form.cost) };
      if (editing) await api.patch(`/rewards/${editing.id}`, body); else await api.post('/rewards', body);
      setOpen(false); setSuccess(editing ? 'Reward updated.' : 'Something good to work toward.'); await reload();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function act() {
    if (!confirm || busy) return;
    setBusy(true); setActionError('');
    try {
      if (confirm.action === 'delete') await api.delete(`/rewards/${confirm.reward.id}`);
      else await api.post(`/rewards/${confirm.reward.id}/redeem`);
      setSuccess(confirm.action === 'delete' ? 'Reward deleted.' : `You earned it! Enjoy “${confirm.reward.name}”.`);
      setConfirm(null); await Promise.all([reload(), refreshUser()]);
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <Screen title="Rewards" onRefresh={reload} action={<Action label="New reward" icon="add" small disabled={busy} onPress={() => edit()} />}>
    <View style={styles.wrap}>{['Available', 'Redeemed'].map(value => <Choice key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</View>
    <ErrorNotice message={error} onRetry={reload} />{!open && !confirm && <ErrorNotice message={actionError} />}
    {!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}
    {loading ? <Loading /> : !error && rewards.length === 0 ? <Empty icon="redeem" title={filter === 'Redeemed' ? 'No redemptions yet' : 'Choose a reward'} message={filter === 'Redeemed' ? 'Redeemed rewards appear here.' : 'A snack, a break, or something to look forward to.'} /> : <View>{rewards.map(reward => <Pressable key={reward.id} accessibilityRole="button" accessibilityLabel={`Open reward: ${reward.name}`} onPress={() => setSelected(reward)} style={[styles.row, { paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.border }]}>
      <View style={{ width: 50, height: 50, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name={reward.redeemed ? 'check-circle-outline' : 'redeem'} color={colors.purple} size={27} /></View>
      <View style={{ flex: 1, gap: 5 }}><Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>{reward.name}</Text><Text style={styles.label}>{reward.cost} coins{reward.redeemed ? ' · Redeemed' : ''}</Text></View><MaterialIcons name="chevron-right" size={22} color={colors.muted} />
    </Pressable>)}</View>}
    <Dialog visible={!!selected} title={selected?.name || 'Reward'} onClose={() => setSelected(null)}>
      <Badge tone="amber">{selected?.cost || 0} coins</Badge>{!!selected?.description && <Copy>{selected.description}</Copy>}
      {selected?.redeemed ? <Copy>Redeemed{selected.redeemedAt ? ` · ${new Date(selected.redeemedAt).toLocaleDateString()}` : ''}</Copy> : selected && <>
        <Action label="Redeem reward" icon="redeem" disabled={(user?.coins || 0) < selected.cost || busy} onPress={() => { setActionError(''); setConfirm({ reward: selected, action: 'redeem' }); setSelected(null); }} />
        {(user?.coins || 0) < selected.cost && <Copy>{selected.cost - (user?.coins || 0)} more coins needed.</Copy>}
        <View style={styles.wrap}><Action label="Edit" icon="edit" variant="secondary" onPress={() => { edit(selected); setSelected(null); }} /><Action label="Delete" icon="delete-outline" variant="ghost" onPress={() => { setActionError(''); setConfirm({ reward: selected, action: 'delete' }); setSelected(null); }} /></View>
      </>}
    </Dialog>
    <Dialog visible={open} title={editing ? 'Edit reward' : 'Create a personal reward'} onClose={() => setOpen(false)} busy={busy}>
      <Field label="Reward name" placeholder="An evening with my favorite game" value={form.name} maxLength={120} onChangeText={name => setForm({ ...form, name })} />
      <Field label="Description (optional)" placeholder="Make it something you’ll look forward to." value={form.description} multiline maxLength={1000} onChangeText={description => setForm({ ...form, description })} />
      <Field label="Coin cost" value={form.cost} keyboardType="number-pad" maxLength={7} onChangeText={cost => setForm({ ...form, cost })} />
      <ErrorNotice message={actionError} /><Action label={editing ? 'Save changes' : 'Create reward'} busy={busy} onPress={save} />
    </Dialog>
    <Confirm visible={!!confirm} title={confirm?.action === 'delete' ? 'Delete reward?' : 'Ready to treat yourself?'} message={confirm?.action === 'delete' ? `Remove “${confirm.reward.name}” from your rewards?` : `Redeem “${confirm?.reward.name || ''}” for ${confirm?.reward.cost || 0} coins? Your new balance will be ${(user?.coins || 0) - (confirm?.reward.cost || 0)} coins.`} label={confirm?.action === 'delete' ? 'Delete reward' : 'Redeem reward'} danger={confirm?.action === 'delete'} busy={busy} error={actionError} onConfirm={act} onClose={() => { setConfirm(null); setActionError(''); }} />
  </Screen>;
}

