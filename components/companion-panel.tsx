import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Action, Badge, Choice, colors, Copy, Dialog, ErrorNotice, Field, Heading, Panel, styles } from '@/components/quest-ui';
import { CompanionScene } from '@/components/companion-scene';
import type { MageHandle } from '@/components/mage/MageCompanion';
import { useCompanion } from '@/context/companion';
import { api, errorMessage } from '@/scripts/api';
import { useAuth } from '@/context/auth';
import { shareInvitation } from '@/scripts/share-invitation';
import { WardrobePanel } from '@/components/wardrobe/wardrobe-panel';

export function CompanionPanel({ customize = false }: { customize?: boolean }) {
  const { data, error, reload, mutate, remainingSeconds: remaining, studying } = useCompanion();
  const { refreshUser } = useAuth();
  const mage = useRef<MageHandle>(null);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [nickname, setNickname] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [greeting, setGreeting] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);
  const c = data?.companion;
  const focus = data?.focus;
  const focusActive = focus?.status === 'running' || focus?.status === 'paused';
  const invitationLink = Linking.createURL('/auth/register');
  const spellTarget = data?.config.spellChargeTasks ?? 3;
  const focusChoices = data?.config.focusMinutes ?? [5, 15, 25, 50];
  const selectedMinutes = focusChoices.includes(minutes) ? minutes : data?.config.focusDefaultMinutes ?? focusChoices[0];
  useEffect(() => {
    let mounted = true;
    api.post('/companion/visit').then(response => { if (mounted) setGreeting(response.data.greeting || response.data.companion?.dialogue || 'Welcome back. Your next small step is enough.'); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  async function act(path: string, body?: object, celebrate = false) {
    if (busy) return;
    setBusy(path); setProblem(''); setNotice(''); setGreeting('');
    try {
      const response = await mutate(path, body);
      if (celebrate && response.data.awarded !== false) { mage.current?.play('celebrate'); setNotice('Focus complete. You made time for what matters, and your bond grew.'); }
      // The confirmed response already updates both companions; profile refresh is supplemental.
      void refreshUser().catch(() => {});
    } catch (cause) { setProblem(errorMessage(cause)); }
    finally { setBusy(''); }
  }
  async function rename() {
    if (nickname === null || busy) return;
    setBusy('nickname'); setProblem('');
    try { await mutate('/companion', { nickname }, 'PATCH'); setNickname(null); void refreshUser().catch(() => {}); }
    catch (cause) { setProblem(errorMessage(cause)); }
    finally { setBusy(''); }
  }
  async function share() {
    if (!c || sharing) return;
    setSharing(true); setShareError(''); setShareNotice('');
    try { setShareNotice(await shareInvitation('My ProdifyQuest companion', `${c.nickname} and I reached ${c.stage}, level ${c.level}! Small steps add up. Join me on ProdifyQuest: ${invitationLink}`)); }
    catch (cause) { setShareError(errorMessage(cause)); }
    finally { setSharing(false); }
  }
  return <Panel>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View style={{ gap: 5 }}><Text style={{ color: colors.purple, fontWeight: '700', fontSize: 11, letterSpacing: 1.6 }}>YOUR STUDY PARTNER</Text><Heading>{c?.nickname || 'Apprentice Mage'}</Heading></View><Badge>Level {c?.level || 1}</Badge></View>
    <CompanionScene ref={mage} companion={c} active={!shareOpen && nickname === null} studying={studying} />
    {!customize && <View style={{ gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 16 }}><Heading>Study together</Heading>{focusActive ? <><Text accessibilityRole="timer" style={{ fontSize: 40, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] }}>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</Text><Copy>{remaining <= 0 ? 'Your time is complete. Save your focus progress.' : focus?.status === 'paused' ? 'Paused. Take a breath; continue when you are ready.' : 'One thing at a time. Your companion is studying beside you.'}</Copy><View style={styles.wrap}>{remaining <= 0 ? <Action label="Complete focus" icon="check" busy={busy.endsWith('/complete')} disabled={!!busy} onPress={() => act(`/focus/${focus!.id}/complete`, undefined, true)} /> : <Action label={focus?.status === 'paused' ? 'Resume focus' : 'Pause focus'} icon={focus?.status === 'paused' ? 'play-arrow' : 'pause'} disabled={!!busy} onPress={() => act(`/focus/${focus!.id}/${focus?.status === 'paused' ? 'resume' : 'pause'}`)} />}<Action label="End session" variant="ghost" disabled={!!busy} onPress={() => act(`/focus/${focus!.id}/cancel`)} /></View></> : <><View style={styles.wrap}>{focusChoices.map(value => <Choice key={value} label={`${value} min`} selected={selectedMinutes === value} onPress={() => setMinutes(value)} />)}</View><Action label="Start Focus" icon="play-arrow" disabled={!!busy || !c} busy={busy === '/focus'} onPress={() => act('/focus', { minutes: selectedMinutes })} /><Copy>Finish the full session to earn {data?.config.xpFocus ?? 20} companion XP and {data?.config.bondFocus ?? 10} bond. Pausing stops the clock.</Copy></>}</View>}
    {!!greeting && <Copy>{greeting}</Copy>}
    <View accessibilityLiveRegion="polite" style={{ backgroundColor: '#F8F5FE', padding: 14, borderRadius: 12 }}><Copy>“{notice || c?.dialogue || 'One page, one idea, one small step. We can do this together.'}”</Copy></View>
    <View style={styles.wrap}><Badge tone="green">Bond {c?.bond || 0}</Badge><Badge>{c?.xp || 0} companion XP</Badge>{c?.isMage && <Badge tone={c.spellCharge >= spellTarget ? 'amber' : 'neutral'}>Spell {c.spellCharge}/{spellTarget} {c.spellCharge >= spellTarget ? '· Ready' : ''}</Badge>}</View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Bond progress to next unlock" accessibilityValue={{ min: 0, max: c?.nextUnlock?.bond || Math.max(c?.bond || 0, 100), now: c?.bond || 0 }} style={{ height: 8, borderRadius: 8, backgroundColor: colors.pale, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.min(100, (c?.bond || 0) / (c?.nextUnlock?.bond || 100) * 100)}%`, backgroundColor: colors.purple }} /></View>
    <Copy>{c?.nextUnlock ? `Next: ${c.nextUnlock.label || c.nextUnlock.name || 'a new milestone'} at ${c.nextUnlock.bond} bond.` : 'Your bond keeps growing. Every step you take together counts.'} Your bond never decreases while you are away.</Copy>
    <View style={styles.wrap}><Action label="Say hello" icon="waving-hand" small variant="secondary" onPress={() => { mage.current?.play('wave'); setNotice('Glad to be on your team. What is one thing you want to learn today?'); }} />{c?.capabilities?.highFive && <Action label="High five" icon="back-hand" variant="secondary" small onPress={() => { mage.current?.play('celebrate'); setNotice('High five! Your steady effort is paying off.'); }} />}{c?.isMage && c.capabilities?.cast && <Action label="Practice spell" icon="auto-awesome" variant="ghost" small onPress={() => { mage.current?.play('cast'); setNotice('A little practice keeps the magic bright. Your charged spell waits for your next eligible guild attack.'); }} />}{customize && <Action label="Nickname" variant="ghost" small onPress={() => setNickname(c?.nickname || '')} />}{c?.capabilities?.share && <Action label="Share companion" icon="share" variant="ghost" small onPress={() => { setShareError(''); setShareNotice(''); setShareOpen(true); }} />}</View>
    {customize && <WardrobePanel />}
    {customize && <><Heading>Bond cosmetics</Heading><Copy>Outfits recolor your Mage’s robe; accessories add a brooch. Room backgrounds and evolved auras complete the look.</Copy><View style={styles.wrap}>{c?.cosmetics.map(item => <View key={item.id} style={{ flexBasis: 200, flexGrow: 1, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 10 }}><View style={{ height: 20, backgroundColor: item.color || colors.pale, borderRadius: 6 }} /><Text style={styles.heading}>{item.name}</Text><Copy>{item.category} · {item.owned ? 'Owned' : item.source === 'box' ? 'Quest mystery box exclusive' : item.source === 'raid' ? 'Deadline Dragon victory chest' : `${item.price} coins · bond ${item.requiredBond}`}</Copy><Action label={item.equipped ? 'Equipped' : item.owned ? `Equip ${item.name}` : item.source === 'box' ? 'Quest box reward' : item.source === 'raid' ? 'Guild victory reward' : !item.unlocked ? `Unlock at bond ${item.requiredBond}` : `Buy ${item.name}`} small variant="secondary" disabled={!!busy || item.equipped || (!item.owned && (!item.unlocked || ['raid', 'box'].includes(item.source || '')))} onPress={() => act(`/companion/cosmetics/${item.id}/${item.owned ? 'equip' : 'purchase'}`)} /></View>)}</View></>}
    <ErrorNotice message={error} onRetry={reload} /><ErrorNotice message={problem} />
    <Dialog visible={nickname !== null} title="Name your study partner" onClose={() => setNickname(null)} busy={!!busy}><Field label="Companion nickname" value={nickname || ''} maxLength={32} onChangeText={setNickname} /><ErrorNotice message={problem} /><Action label="Save nickname" busy={busy === 'nickname'} onPress={rename} /></Dialog>
    <Dialog visible={shareOpen} title="Share your companion" onClose={() => setShareOpen(false)} busy={sharing}>
      <View style={{ gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.pale }}><Text style={{ color: colors.purple, fontWeight: '800', letterSpacing: 2 }}>PRODIFYQUEST</Text><CompanionScene companion={c} active={false} compact /><Heading>{c?.nickname} · {c?.stage}</Heading><Copy>Level {c?.level} · Small steps add up.</Copy></View>
      <Copy>Share this achievement and an invitation to study together. Your tasks and focus history stay private.</Copy><Field label="Companion invitation link" value={invitationLink} editable={false} selectTextOnFocus /><ErrorNotice message={shareError} />{!!shareNotice && <Badge tone="green">{shareNotice}</Badge>}<Action label="Share achievement" icon="share" busy={sharing} onPress={share} />
    </Dialog>
  </Panel>;
}
