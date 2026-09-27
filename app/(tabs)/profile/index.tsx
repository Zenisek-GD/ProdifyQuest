import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Action, Badge, colors, Confirm, Copy, ErrorNotice, Field, Heading, Panel, Screen, Stat, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { api, API_URL, errorMessage } from '@/scripts/api';

export default function Profile() {
  const { user, refreshUser, signOut } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logout, setLogout] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  async function save() {
    if (busy) return;
    if (username.trim().length < 2) { setError('Choose a name with at least two characters.'); return; }
    setBusy('save'); setError(''); setSuccess('');
    try { await api.patch('/me', { username: username.trim() }); await refreshUser(); setSuccess('Your profile is updated.'); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function leave() {
    if (busy) return;
    setBusy('logout'); setError('');
    try { await signOut(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  const src = user?.imagePath;
  return <Screen title="Profile">
    <Panel><View style={[styles.row, { gap: 20, flexWrap: 'wrap' }]}><View style={{ width: 110, height: 120, borderRadius: 20, backgroundColor: colors.pale, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>{src && !imageFailed ? <Image accessibilityLabel="Your active character" source={{ uri: src.startsWith('http') ? src : `${API_URL}${src.startsWith('/') ? '' : '/'}${src}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" onError={() => setImageFailed(true)} /> : <MaterialIcons name="person" size={65} color={colors.purple} />}</View><View style={{ gap: 9, flex: 1, minWidth: 150 }}><Heading>{user?.username}</Heading><Copy>{user?.email}</Copy><Badge>Level {user?.level || 1} adventurer</Badge></View></View></Panel>
    <View style={[styles.wrap, { gap: 14 }]}><Stat label="Current streak" value={`${user?.streak || 0} days`} icon="local-fire-department" tone={colors.amber} /><Stat label="Best streak" value={`${user?.bestStreak || 0} days`} icon="emoji-events" /><Stat label="Experience" value={user?.exp || 0} icon="auto-awesome" /></View>
    <Panel><Field label="Display name" maxLength={40} value={username} onChangeText={setUsername} autoCapitalize="words" /><ErrorNotice message={!logout ? error : ''} />{!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}<View style={{ alignSelf: 'flex-start' }}><Action label="Save profile" icon="check" busy={busy === 'save'} disabled={username.trim() === user?.username || !!busy} onPress={save} /></View></Panel>
    <View style={styles.wrap}><Action label="Companion" icon="auto-awesome" variant="secondary" onPress={() => router.push('/(tabs)/home/companion')} /><Action label="Sign out" icon="logout" variant="danger" disabled={!!busy} onPress={() => { setError(''); setLogout(true); }} /></View>
    <Text style={styles.label}>Time zone: {user?.timeZone || 'UTC'}</Text>
    <Confirm visible={logout} title="Sign out?" message="Your progress is saved. You can pick up where you left off when you sign in again." label="Sign out" busy={busy === 'logout'} error={error} onConfirm={leave} onClose={() => setLogout(false)} />
  </Screen>;
}

