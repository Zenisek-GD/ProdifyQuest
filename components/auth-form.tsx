import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/scripts/api';

export default function AuthForm({ registering = false }: { registering?: boolean }) {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ invite?: string }>();
  const invite = typeof params.invite === 'string' && /^[a-zA-Z0-9]{1,24}$/.test(params.invite) ? params.invite : undefined;
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (auth.loading) return <View style={s.center}><ActivityIndicator color="#6242cf" accessibilityLabel="Loading" /></View>;
  if (auth.user) return <Redirect href={invite ? { pathname: '/(tabs)/guild', params: { invite } } : '/(tabs)/home'} />;
  async function submit() {
    if (busy) return;
    setError(''); setNotice('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (!reset && !password) { setError('Enter your password.'); return; }
    if (registering && (username.trim().length < 2 || username.trim().length > 60)) { setError('Your name must have 2 to 60 characters.'); return; }
    if (registering && password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    if (registering && password !== confirm) { setError('Your passwords do not match.'); return; }
    setBusy(true);
    try {
      if (reset) { const { data } = await api.post('/auth/reset-password', { email: email.trim() }); setNotice(data.message); }
      else if (registering) await auth.register(username.trim(), email.trim(), password);
      else await auth.signIn(email.trim(), password);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <View style={s.brand}><View style={s.mark}><MaterialIcons name="auto-awesome" size={27} color="white" /></View><Text style={s.brandName}>ProdifyQuest</Text></View>
          <View style={s.card}>
            <Text style={s.eyebrow}>A LITTLE PROGRESS, EVERY DAY</Text>
            <Text accessibilityRole="header" style={s.title}>{reset ? 'A fresh start.' : registering ? 'Start your next chapter.' : 'Welcome back, adventurer.'}</Text>
            <Text style={s.subtitle}>{reset ? 'Enter your email to request a password reset link.' : registering ? 'Turn your to-dos into progress worth celebrating.' : 'Your tasks, your rewards, your journey. Pick up where you left off.'}</Text>
            {registering && <><Text style={s.label}>Your name</Text><TextInput accessibilityLabel="Your name" style={s.input} value={username} onChangeText={setUsername} placeholder="What should we call you?" maxLength={60} autoComplete="name" editable={!busy} /></>}
            <Text style={s.label}>Email address</Text>
            <TextInput accessibilityLabel="Email address" style={s.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} editable={!busy} />
            {!reset && <><Text style={s.label}>Password</Text><View style={s.password}><TextInput accessibilityLabel="Password" style={[s.input, s.passwordInput]} value={password} onChangeText={setPassword} placeholder={registering ? 'At least 8 characters' : 'Your password'} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete={registering ? 'new-password' : 'current-password'} maxLength={128} editable={!busy} onSubmitEditing={!registering ? submit : undefined} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(!showPassword)} style={s.eye}><MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={22} color="#746886" /></Pressable></View></>}
            {registering && <><Text style={s.label}>Confirm password</Text><TextInput accessibilityLabel="Confirm password" style={s.input} value={confirm} onChangeText={setConfirm} placeholder="Enter your password again" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} onSubmitEditing={submit} /></>}
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
            {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={submit} style={[s.button, busy && s.disabled]}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.buttonText}>{reset ? 'Send reset link' : registering ? 'Create my account' : 'Continue my quest'}</Text>}</Pressable>
            {!registering && <Pressable accessibilityRole="button" disabled={busy} style={s.link} onPress={() => { setReset(!reset); setError(''); setNotice(''); }}><Text style={s.linkText}>{reset ? 'Back to sign in' : 'Forgot your password?'}</Text></Pressable>}
            <View style={s.divider} />
            <Text style={s.footer}>{registering ? 'Already have an account?' : 'Ready for a new adventure?'}</Text>
            <Pressable accessibilityRole="link" style={s.link} disabled={busy} onPress={() => router.replace({ pathname: registering ? '/auth/login' : '/auth/register', params: invite ? { invite } : {} })}><Text style={s.linkText}>{registering ? 'Sign in to ProdifyQuest' : 'Create an account'}</Text></Pressable>
          </View>
          <Text style={s.tagline}>Make time for what matters. Reward yourself along the way.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 }, safe: { flex: 1, backgroundColor: '#f5f2fb' }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  page: { flexGrow: 1, justifyContent: 'center', padding: 24, alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 26 }, mark: { backgroundColor: '#6242cf', padding: 10, borderRadius: 14 }, brandName: { fontWeight: '800', color: '#302341', fontSize: 24 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 28, maxWidth: 470, width: '100%', borderWidth: 1, borderColor: '#e9e2f5' },
  eyebrow: { color: '#7255b5', fontSize: 10, letterSpacing: 1.7, fontWeight: '700', marginBottom: 12 }, title: { color: '#302341', fontSize: 29, fontWeight: '800', lineHeight: 35 },
  subtitle: { color: '#70657e', fontSize: 15, lineHeight: 23, marginTop: 10, marginBottom: 22 }, label: { color: '#42354f', fontWeight: '600', fontSize: 13, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ddd5e9', borderRadius: 11, backgroundColor: '#fdfbff', color: '#302341', minHeight: 49, paddingHorizontal: 14, fontSize: 15 },
  password: { position: 'relative' }, passwordInput: { paddingRight: 52 }, eye: { position: 'absolute', right: 0, top: 0, width: 48, height: 49, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#a82539', backgroundColor: '#fff0f2', padding: 12, borderRadius: 8, lineHeight: 20, marginTop: 18 }, notice: { color: '#236c4c', backgroundColor: '#eef9f3', padding: 12, borderRadius: 8, lineHeight: 20, marginTop: 18 },
  button: { backgroundColor: '#6242cf', borderRadius: 11, minHeight: 50, justifyContent: 'center', alignItems: 'center', marginTop: 25 }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 }, disabled: { opacity: 0.55 },
  link: { padding: 12, alignItems: 'center' }, linkText: { color: '#6242cf', fontWeight: '600', fontSize: 14 }, divider: { height: 1, backgroundColor: '#eee8f4', marginVertical: 15 }, footer: { textAlign: 'center', color: '#70657e', fontSize: 13 },
  tagline: { maxWidth: 350, textAlign: 'center', color: '#83738f', fontSize: 12, lineHeight: 19, marginTop: 24 },
});
