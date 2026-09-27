import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Action, Badge, Choice, Copy, Dialog, ErrorNotice, Loading, colors, styles } from '@/components/quest-ui';
import { useAuth } from '@/context/auth';
import { useBattlePresentation } from '@/context/battle-presentation';
import { api, errorMessage } from '@/scripts/api';
import type { EquipmentResponse, EquipmentSlot } from '@/scripts/battle-types';
import { gearSummary } from './boss/raid-state';

const slots: EquipmentSlot[] = ['weapon', 'armor', 'cape', 'trinket'];
const icons = { weapon: 'sword', armor: 'tshirt-crew', cape: 'shield-half-full', trinket: 'diamond-stone' } as const;
export function EquipmentPanel() {
  const { user, refreshUser } = useAuth();
  const { busy: presenting } = useBattlePresentation();
  const [equipment, setEquipment] = useState<EquipmentResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const writing = useRef(false);
  const [slot, setSlot] = useState<EquipmentSlot>('weapon');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (writing.current) return;
    const request = ++sequence.current;
    try {
      const response = await api.get<EquipmentResponse>('/equipment');
      if (mounted.current && request === sequence.current) { setEquipment(response.data); setError(''); }
    } catch (err) { if (mounted.current && request === sequence.current) setError(errorMessage(err)); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; sequence.current++; };
  }, [reload]));
  useEffect(() => { if (mounted.current) void reload(); }, [reload, user?.character?.image, user?.character?.level, user?.character?.tier, user?.coins]);
  async function act(id: string, action: 'purchase' | 'equip') {
    if (busy || presenting) return;
    writing.current = true; sequence.current++;
    setBusy(id); setActionError(''); setNotice('');
    try {
      const response = await api.post<EquipmentResponse>(`/equipment/items/${id}/${action}`);
      if (!mounted.current) return;
      setEquipment(response.data);
      setNotice(action === 'purchase' ? 'Gear collected' : 'Gear equipped');
      void refreshUser().catch(() => {});
    } catch (err) { setActionError(errorMessage(err)); }
    finally { writing.current = false; if (mounted.current) setBusy(''); }
  }
  if (loading && !equipment) return <Loading />;
  if (!equipment) return <ErrorNotice message={error || 'Equipment could not be loaded.'} onRetry={reload} />;
  const build = equipment.build;
  const detail = equipment.items.find(item => item.id === selected);
  return <View style={{ gap: 16 }}>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Copy>Lv. {build.level} build</Copy><View style={styles.wrap}><Badge>{build.attack} ATK</Badge><Badge>{Math.round(build.critChance * 100)}% crit</Badge><Badge>×{build.critMultiplier.toFixed(2)}</Badge></View></View>
    <View style={styles.wrap}>{slots.map(value => <Choice key={value} label={value[0].toUpperCase() + value.slice(1)} selected={slot === value} onPress={() => { if (!busy && !presenting) setSlot(value); }} />)}</View>
    <ErrorNotice message={actionError || error} />
    {!!notice && <View accessibilityRole="alert"><Badge tone="green">{notice}</Badge></View>}
    <View style={[styles.wrap, { gap: 16 }]}>{equipment.items.filter(item => item.slot === slot).map(item => {
      const owned = equipment.ownedItemIds.includes(item.id);
      const equipped = equipment.equipped[item.slot] === item.id;
      return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`View ${item.name}`} disabled={!!busy || presenting} onPress={() => setSelected(item.id)} style={{ width: '46%', maxWidth: 220, gap: 5, paddingBottom: 16 }}>
        <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icons[item.slot]} color={equipped ? colors.purple : owned ? colors.ink : colors.muted} size={62} /></View><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{item.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{gearSummary(item)}</Text><Text style={{ color: equipped ? colors.purple : colors.muted, fontSize: 12 }}>{equipped ? 'Equipped' : owned ? 'Owned' : item.unlock === 'shop' ? `${item.price} coins` : 'Boss chest'}</Text>
      </Pressable>;
    })}</View>
    <Dialog visible={!!detail} title={detail?.name || 'Gear'} busy={!!busy} onClose={() => setSelected(null)}>
      {detail && <><View style={{ alignItems: 'center', padding: 24 }}><MaterialCommunityIcons name={icons[detail.slot]} size={90} color={colors.purple} /></View><Badge>{detail.rarity}</Badge><Copy>{gearSummary(detail)}</Copy><ErrorNotice message={actionError} />{equipment.ownedItemIds.includes(detail.id) ? <Action label={equipment.equipped[detail.slot] === detail.id ? 'Equipped' : `Equip ${detail.name}`} disabled={equipment.equipped[detail.slot] === detail.id || !!busy || presenting} busy={busy === detail.id} onPress={() => act(detail.id, 'equip')} /> : detail.unlock === 'shop' ? <Action label={`Buy ${detail.name} · ${detail.price} coins`} disabled={!!busy || presenting || equipment.coins < (detail.price || 0)} busy={busy === detail.id} onPress={() => act(detail.id, 'purchase')} /> : <Copy>{detail.weight}% per Dreadroot chest · {detail.duplicateCoins} coins for duplicates.</Copy>}<Copy>Damage against Dreadroot: {build.normalDamage} · Critical: {build.criticalDamage}</Copy></>}
    </Dialog>
  </View>;
}
