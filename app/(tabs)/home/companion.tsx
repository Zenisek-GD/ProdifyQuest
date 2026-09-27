import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Share, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Action, Badge, Copy, Dialog, ErrorNotice, Field, Screen, styles } from '@/components/quest-ui';
import { CompanionScene } from '@/components/companion-scene';
import type { MageHandle } from '@/components/mage/MageCompanion';
import { useCompanion } from '@/context/companion';
import { errorMessage } from '@/scripts/api';

export default function CompanionDetails() {
  const { data, studying, mutate, error, reload } = useCompanion();
  const mage = useRef<MageHandle>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const c = data?.companion;
  async function rename() {
    if (busy || nickname === null) return;
    setBusy(true); setProblem('');
    try { await mutate('/companion', { nickname }, 'PATCH'); setNickname(null); }
    catch (cause) { setProblem(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function share() {
    try { await Share.share({ message: `${c?.nickname} and I reached companion level ${c?.level}! Join us: ${Linking.createURL('/auth/register')}` }); }
    catch (cause) { setProblem(errorMessage(cause)); }
  }
  return <Screen title={c?.nickname || 'Companion'} action={<Action label="Back" icon="arrow-back" variant="ghost" onPress={() => router.back()} />}>
    <CompanionScene ref={mage} companion={c} studying={studying} />
    <View style={styles.wrap}><Badge>Level {c?.level || 1}</Badge><Badge tone="green">Bond {c?.bond || 0}</Badge><Badge>{c?.xp || 0} XP</Badge></View>
    {!!c?.nextUnlock && <Copy>Next: {c.nextUnlock.label || c.nextUnlock.name} at {c.nextUnlock.bond} bond</Copy>}
    <View style={styles.wrap}><Action label="Say hello" icon="waving-hand" variant="secondary" onPress={() => mage.current?.play('wave')} />{c?.capabilities?.highFive && <Action label="High five" variant="secondary" onPress={() => mage.current?.play('celebrate')} />}{c?.isMage && c.capabilities?.cast && <Action label="Practice spell" variant="secondary" onPress={() => mage.current?.play('cast')} />}<Action label="Nickname" variant="ghost" onPress={() => setNickname(c?.nickname || '')} />{c?.capabilities?.share && <Action label="Share companion" icon="share" variant="ghost" onPress={share} />}</View>
    <Action label="Change look" variant="secondary" icon="palette" onPress={() => router.push('/(tabs)/cards/looks')} />
    <ErrorNotice message={error} onRetry={reload} />{nickname === null && <ErrorNotice message={problem} />}
    <Dialog visible={nickname !== null} title="Companion nickname" onClose={() => setNickname(null)} busy={busy}><Field label="Companion nickname" value={nickname || ''} maxLength={32} onChangeText={setNickname} /><ErrorNotice message={problem} /><Action label="Save nickname" busy={busy} onPress={rename} /></Dialog>
  </Screen>;
}
