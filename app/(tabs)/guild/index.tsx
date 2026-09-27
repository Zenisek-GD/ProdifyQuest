import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { GuildSummary } from '@/components/guild-raid';
import { Action, colors, Dialog, Empty, ErrorNotice, Field, Loading, Screen, styles } from '@/components/quest-ui';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';

export default function Guilds() {
  const { invite } = useLocalSearchParams<{ invite?: string | string[] }>();
  const code = (Array.isArray(invite) ? invite[0] : invite)?.trim().toUpperCase() || '';
  const [seenInvite, setSeenInvite] = useState('');
  const { data, loading, error, reload } = useResource<{ guilds: GuildSummary[] }>('/guilds');
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [form, setForm] = useState({ name: '', description: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  if (code !== seenInvite) {
    setSeenInvite(code);
    if (code && !/^[A-Z0-9]{1,24}$/.test(code)) setActionError('This invitation is invalid. Ask for a new guild code.');
    else if (code) { setForm({ name: '', description: '', code }); setActionError(''); setDialog('join'); }
  }
  function open(value: 'create' | 'join') { setDialog(value); setActionError(''); setForm({ name: '', description: '', code: '' }); }
  async function save() {
    if (busy || !dialog) return;
    if (dialog === 'create' && !form.name.trim()) { setActionError('Add a guild name.'); return; }
    if (dialog === 'join' && !form.code.trim()) { setActionError('Enter a guild code.'); return; }
    setBusy(true); setActionError('');
    try {
      const response = dialog === 'create' ? await api.post('/guilds', { name: form.name.trim(), description: form.description.trim() }) : await api.post('/guilds/join', { code: form.code.trim() });
      setDialog(null);
      await reload();
      if (response.data.guild?.id) router.push({ pathname: '/guild/[id]', params: { id: response.data.guild.id } });
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <Screen title="Guilds" subtitle="" onRefresh={reload} action={<View style={styles.row}><Action label="Join" icon="login" variant="secondary" small disabled={busy} onPress={() => open('join')} /><Action label="Create" icon="add" small disabled={busy} onPress={() => open('create')} /></View>}>
    <ErrorNotice message={error} onRetry={reload} />{!dialog && <ErrorNotice message={actionError} />}
    {loading ? <Loading /> : !error && !data?.guilds.length ? <Empty icon="groups" title="Find your study group" message="Create a guild or join with a code." /> : <View>{data?.guilds.map(guild => <Pressable key={guild.id} accessibilityRole="button" accessibilityLabel={`Open ${guild.name}`} onPress={() => router.push({ pathname: '/guild/[id]', params: { id: guild.id } })} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.border, opacity: pressed ? .65 : 1 }]}>
      <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="forum" size={24} color={colors.purple} /></View>
      <View style={{ flex: 1, gap: 5 }}><Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{guild.name}</Text><Text style={styles.label}>{guild.memberCount} {guild.memberCount === 1 ? 'member' : 'members'}</Text></View><MaterialIcons name="chevron-right" size={23} color={colors.muted} />
    </Pressable>)}</View>}
    <Dialog visible={!!dialog} title={dialog === 'create' ? 'Create guild' : 'Join guild'} onClose={() => setDialog(null)} busy={busy}>
      {dialog === 'create' ? <><Field label="Guild name" placeholder="The Daily Quest Crew" value={form.name} maxLength={60} onChangeText={name => setForm({ ...form, name })} /><Field label="Description (optional)" value={form.description} multiline maxLength={500} onChangeText={description => setForm({ ...form, description })} /></> : <Field label="Invite code" placeholder="Enter your code" autoCapitalize="characters" autoCorrect={false} value={form.code} maxLength={64} onChangeText={code => setForm({ ...form, code })} />}
      <ErrorNotice message={actionError} /><Action label={dialog === 'create' ? 'Create guild' : 'Join guild'} busy={busy} onPress={save} />
    </Dialog>
  </Screen>;
}
