import { useState } from 'react';
import { Text, View } from 'react-native';
import { Action, Choice, colors, ErrorNotice, Heading, Panel, styles } from '@/components/quest-ui';
import { useCompanion } from '@/context/companion';
import { useAuth } from '@/context/auth';
import { errorMessage } from '@/scripts/api';

export function FocusPanel() {
  const { data, mutate, remainingSeconds, error, reload } = useCompanion();
  const { refreshUser } = useAuth();
  const [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const focus = data?.focus;
  const active = focus?.status === 'running' || focus?.status === 'paused';
  const choices = data?.config.focusMinutes ?? [5, 15, 25, 50];
  const selected = choices.includes(minutes) ? minutes : data?.config.focusDefaultMinutes ?? choices[0];
  async function act(path: string, body?: object) {
    if (busy) return;
    setBusy(true); setProblem(''); setNotice('');
    try {
      const response = await mutate(path, body);
      if (path.endsWith('/complete') && response.data.awarded !== false) setNotice('Focus saved. XP earned!');
      void refreshUser().catch(() => {});
    } catch (cause) { setProblem(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Panel>
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Heading>Focus</Heading><Text style={styles.label}>{active ? focus?.status === 'paused' ? 'Paused' : 'Studying' : `+${data?.config.xpFocus ?? 20} XP`}</Text></View>
    {active ? <>
      <Text accessibilityRole="timer" style={{ fontSize: 40, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] }}>{String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:{String(remainingSeconds % 60).padStart(2, '0')}</Text>
      <View style={styles.wrap}>{remainingSeconds <= 0 ? <Action label="Complete focus" icon="check" busy={busy} onPress={() => act(`/focus/${focus!.id}/complete`)} /> : <Action label={focus?.status === 'paused' ? 'Resume focus' : 'Pause focus'} icon={focus?.status === 'paused' ? 'play-arrow' : 'pause'} busy={busy} onPress={() => act(`/focus/${focus!.id}/${focus?.status === 'paused' ? 'resume' : 'pause'}`)} />}<Action label="End session" variant="ghost" disabled={busy} onPress={() => act(`/focus/${focus!.id}/cancel`)} /></View>
    </> : <><View style={styles.wrap}>{choices.map(value => <Choice key={value} label={`${value} min`} selected={selected === value} onPress={() => setMinutes(value)} />)}</View><Action label="Start Focus" icon="play-arrow" busy={busy} disabled={!data?.companion} onPress={() => act('/focus', { minutes: selected })} /></>}
    {!!notice && <Text accessibilityRole="alert" style={{ color: colors.green }}>{notice}</Text>}
    <ErrorNotice message={error} onRetry={reload} /><ErrorNotice message={problem} />
  </Panel>;
}
