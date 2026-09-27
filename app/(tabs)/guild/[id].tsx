import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { GuildRaid, GuildSummary, guildInvitation, shareGuildInvitation } from '@/components/guild-raid';
import { GuildProject } from '@/components/guild-project';
import { Action, Badge, colors, Confirm, Copy, Dialog, Empty, ErrorNotice, Field, Loading, momentLabel, Screen, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useBattlePresentation } from '@/context/battle-presentation';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';

type Message = { id: string; senderId: string; senderName: string; text: string; createdAt: string };
type Conversation = { messages: Message[]; members: { id: string; username: string }[] };

function GuildChat({ guild }: { guild: GuildSummary }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useResource<Conversation>(`/guilds/${guild.id}/messages`, 5000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const chat = useRef<ScrollView>(null);
  const follow = useRef(true);
  const lastMessage = data?.messages[data.messages.length - 1]?.id;
  useEffect(() => { if (follow.current) chat.current?.scrollToEnd({ animated: true }); }, [lastMessage]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setSendError('');
    try { await api.post(`/guilds/${guild.id}/messages`, { text: text.trim() }); setText(''); follow.current = true; await reload(); }
    catch (err) { setSendError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, minHeight: 180, gap: 10 }}>
    <ErrorNotice message={error} onRetry={reload} />
    {loading ? <Loading /> : <ScrollView ref={chat} style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingVertical: 8, flexGrow: 1 }} keyboardShouldPersistTaps="handled" scrollEventThrottle={100} onScroll={event => { const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent; follow.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 70; }} onContentSizeChange={() => { if (follow.current) chat.current?.scrollToEnd({ animated: false }); }}>
      {!data?.messages.length && !error && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Copy>Say hello to your guild.</Copy></View>}
      {data?.messages.map(message => {
        const mine = message.senderId === user?.id;
        return <View key={message.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? colors.pale : '#FFF', borderRadius: 14, padding: 12, gap: 5 }}>
          {!mine && <Text style={{ fontWeight: '700', fontSize: 11, color: colors.purple }}>{message.senderName}</Text>}
          <Text selectable style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>{message.text}</Text><Text style={{ fontSize: 10, color: colors.muted }}>{momentLabel(message.createdAt)}</Text>
        </View>;
      })}
    </ScrollView>}
    <ErrorNotice message={sendError} />
    <View style={[styles.row, { alignItems: 'flex-end' }]}><TextInput accessibilityLabel="Message your guild" placeholder="Message" placeholderTextColor={colors.muted} multiline maxLength={2000} value={text} editable={!busy} onChangeText={setText} style={[styles.input, { flex: 1, minHeight: 44, maxHeight: 110 }]} /><Action label="Send" icon="send" busy={busy} disabled={!text.trim() || !!error} onPress={send} /></View>
  </KeyboardAvoidingView>;
}

export default function GuildPage() {
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const initialTab = params.tab === 'raid' || params.tab === 'project' ? params.tab : 'chat';
  const [tab, setTab] = useState<'chat' | 'raid' | 'project'>(initialTab);
  const { data, loading, error, reload } = useResource<{ guilds: GuildSummary[] }>('/guilds');
  const { busy: presenting } = useBattlePresentation();
  const guild = data?.guilds.find(item => item.id === id);
  const [infoOpen, setInfoOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  async function share() {
    if (!guild || busy) return;
    setBusy(true); setActionError(''); setNotice('');
    try { setNotice(await shareGuildInvitation(guild)); } catch (err) { setActionError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function leave() {
    if (!guild || busy) return;
    setBusy(true); setActionError('');
    try { await api.post(`/guilds/${guild.id}/leave`); setLeaveOpen(false); router.replace('/guild'); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <Screen title={guild?.name || 'Guild'} subtitle="" scroll={tab !== 'chat'} action={<View style={styles.row}><Action label="Guilds" icon="arrow-back" small variant="ghost" disabled={presenting} onPress={() => router.replace('/guild')} />{guild && <Action label="Info" icon="info-outline" small variant="ghost" disabled={presenting} onPress={() => { setActionError(''); setNotice(''); setInfoOpen(true); }} />}</View>}>
    <ErrorNotice message={error} onRetry={reload} />
    {loading ? <Loading /> : !guild ? <Empty icon="groups" title="Guild unavailable" message="Join this guild to open its chat." /> : <>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border }}>{(['chat', 'raid', 'project'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'chat' ? 'Chat' : value === 'raid' ? 'Raid' : 'Project'} accessibilityState={{ selected: tab === value, disabled: presenting }} disabled={presenting} onPress={() => setTab(value)} style={{ flex: 1, paddingVertical: 12, borderBottomWidth: 2, borderColor: tab === value ? colors.purple : 'transparent', alignItems: 'center', opacity: presenting ? .5 : 1 }}><Text style={{ color: tab === value ? colors.purple : colors.muted, fontWeight: '700' }}>{value === 'chat' ? 'Chat' : value === 'raid' ? 'Raid' : 'Project'}</Text></Pressable>)}</View>
      {tab === 'chat' ? <GuildChat key={guild.id} guild={guild} /> : tab === 'raid' ? <GuildRaid key={guild.id} guild={guild} /> : <GuildProject key={guild.id} guild={guild} />}
    </>}
    <Dialog visible={infoOpen && !!guild} title="Guild info" onClose={() => setInfoOpen(false)} busy={busy}>
      <Copy>{guild?.name} · {guild?.memberCount} members</Copy>{!!guild?.description && <Copy>{guild.description}</Copy>}
      <Field label="Invite code" value={guild?.inviteCode} editable={false} selectTextOnFocus /><Field label="Invitation link" value={guild ? guildInvitation(guild) : ''} editable={false} selectTextOnFocus />
      <ErrorNotice message={actionError} />{!!notice && <Badge tone="green">{notice}</Badge>}<Action label="Share invitation" icon="share" busy={busy} onPress={share} /><Action label="Leave guild" variant="danger" onPress={() => { setInfoOpen(false); setActionError(''); setLeaveOpen(true); }} />
    </Dialog>
    <Confirm visible={leaveOpen} title="Leave guild?" message={guild?.memberCount === 1 ? `Leaving deletes ${guild.name} and closes its chat because you are its last member.` : 'You will lose access to guild chat and unclaimed raid chests. You can rejoin with an invite code. Guild ownership transfers to another member if needed.'} label="Leave guild" danger busy={busy} error={actionError} onConfirm={leave} onClose={() => setLeaveOpen(false)} />
  </Screen>;
}
