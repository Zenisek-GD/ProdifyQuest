import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Action, Badge, Choice, colors, Confirm, Copy, Dialog, Empty, ErrorNotice, Loading, Screen, styles } from '@/components/quest-ui';
import { CharacterPortrait } from '@/components/character-portrait';
import { InventoryNavigation } from '@/components/wardrobe/inventory-navigation';
import { useAuth } from '@/context/auth';
import { useResource } from '@/hooks/use-resource';
import { api, errorMessage } from '@/scripts/api';

type Character = { id: string; name: string; tier: string; price: number; imagePath: string; owned: boolean; equipped: boolean; stats?: { level: number; attack: number; critChance: number; normalDamage: number }; animated?: boolean; unlock?: { type: 'shop' | 'level' | 'boss_chest'; level?: number; weight?: number; duplicateCoins?: number } };
function unlockLabel(card: Character) {
  if (card.unlock?.type === 'level') return `Companion Lv. ${card.unlock.level}`;
  if (card.unlock?.type === 'boss_chest') return 'Boss chest';
  return `${card.price} coins`;
}
function CharacterArt({ card, large = false }: { card: Character; large?: boolean }) {
  return <View style={{ height: large ? 220 : 138, alignItems: 'center', justifyContent: 'center' }}><CharacterPortrait id={card.id} name={card.name} imagePath={card.imagePath} size={large ? 200 : 124} /></View>;
}
export default function Cards() {
  const { user, refreshUser } = useAuth();
  const { data, loading, error, reload } = useResource<{ cards: Character[] }>('/cards');
  const [filter, setFilter] = useState('Owned');
  const [selected, setSelected] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<Character | null>(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const cards = data?.cards || [];
  const detail = cards.find(card => card.id === selected);
  const visible = cards.filter(card => filter === 'All' || (filter === 'Owned' ? card.owned : filter === 'Levels' ? card.unlock?.type === 'level' : filter === 'Boss' ? card.unlock?.type === 'boss_chest' : !card.owned && (!card.unlock || card.unlock.type === 'shop')));
  async function buy() {
    if (!purchase || busy) return;
    setBusy(purchase.id); setActionError('');
    try { await api.post(`/cards/${purchase.id}/purchase`); setSuccess(`${purchase.name} collected`); setPurchase(null); await Promise.all([reload(), refreshUser()]); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function equip(card: Character) {
    if (busy) return;
    setBusy(card.id); setActionError('');
    try { await api.post(`/cards/${card.id}/equip`); setSuccess(`${card.name} equipped`); await Promise.all([reload(), refreshUser()]); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  return <Screen title="Inventory" subtitle="" onRefresh={reload}>
    <InventoryNavigation active="characters" />
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View style={styles.wrap}>{['Owned', 'Shop', 'Levels', 'Boss', 'All'].map(value => <Choice key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</View><Copy>{cards.filter(card => card.owned).length}/{cards.length}</Copy></View>
    <ErrorNotice message={error} onRetry={reload} />{!detail && !purchase && <ErrorNotice message={actionError} />}{!!success && <View accessibilityRole="alert"><Badge tone="green">{success}</Badge></View>}
    {loading ? <Loading /> : !error && !visible.length ? <Empty icon="style" title="No characters yet" message="Find your next companion in the shop or a chest." action={<Action label="Browse shop" onPress={() => setFilter('Shop')} />} /> : <View style={[styles.wrap, { gap: 16 }]}>{visible.map(card => <Pressable key={card.id} accessibilityRole="button" accessibilityLabel={`View ${card.name}`} onPress={() => { setActionError(''); setSelected(card.id); }} style={{ width: '46%', maxWidth: 220, gap: 5, paddingBottom: 15 }}>
      <CharacterArt card={card} /><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>{card.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{card.stats ? `${card.stats.attack} ATK · ${Math.round(card.stats.critChance * 100)}% crit` : card.tier}</Text><Text style={{ color: card.equipped ? colors.purple : colors.muted, fontSize: 12, fontWeight: '600' }}>{card.equipped ? 'Equipped' : card.owned ? 'Owned' : unlockLabel(card)}</Text>
    </Pressable>)}</View>}
    <Dialog visible={!!detail && !purchase} title={detail?.name || 'Character'} onClose={() => setSelected(null)} busy={!!busy}>
      {detail && <><CharacterArt card={detail} large /><Badge>{detail.tier}</Badge>{detail.stats && <Copy>Lv. {detail.stats.level} · {detail.stats.attack} ATK · {Math.round(detail.stats.critChance * 100)}% crit · {detail.stats.normalDamage} raid damage</Copy>}<Copy>{detail.owned ? 'In your collection' : unlockLabel(detail)}</Copy><ErrorNotice message={actionError} />{detail.owned ? <Action label={detail.equipped ? 'Equipped' : 'Equip character'} icon="verified" disabled={detail.equipped || !!busy} busy={busy === detail.id} onPress={() => equip(detail)} /> : detail.unlock?.type === 'level' || detail.unlock?.type === 'boss_chest' ? <Copy>{detail.unlock.type === 'level' ? `Unlocks at companion level ${detail.unlock.level}.` : `${detail.unlock.weight}% chance per boss chest. Duplicates give ${detail.unlock.duplicateCoins} coins.`}</Copy> : <Action label={`Buy · ${detail.price} coins`} icon="add" disabled={(user?.coins || 0) < detail.price || !!busy} onPress={() => { setActionError(''); setPurchase(detail); }} />}</>}
    </Dialog>
    <Confirm visible={!!purchase} title="Collect character?" message={`${purchase?.name || ''} · ${purchase?.price || 0} coins`} label="Purchase card" busy={!!busy} error={actionError} onConfirm={buy} onClose={() => { setPurchase(null); setActionError(''); }} />
  </Screen>;
}
