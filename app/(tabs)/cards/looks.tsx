import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Action, Badge, Choice, Copy, Dialog, ErrorNotice, Screen, colors, styles } from '@/components/quest-ui';
import { InventoryNavigation } from '@/components/wardrobe/inventory-navigation';
import { WardrobePanel } from '@/components/wardrobe/wardrobe-panel';
import { useCompanion } from '@/context/companion';
import { useAuth } from '@/context/auth';
import { errorMessage } from '@/scripts/api';

export default function Looks() {
  const { data, mutate } = useCompanion();
  const { refreshUser } = useAuth();
  const [tab, setTab] = useState('Wardrobe');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const item = data?.companion.cosmetics.find(value => value.id === selected);
  async function apply() {
    if (!item || busy) return;
    setBusy(true); setError('');
    try { await mutate(`/companion/cosmetics/${item.id}/${item.owned ? 'equip' : 'purchase'}`); void refreshUser().catch(() => {}); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title="Inventory" subtitle=""><InventoryNavigation active="looks" /><View style={styles.wrap}>{['Wardrobe', 'Bond cosmetics'].map(value => <Choice key={value} label={value} selected={tab === value} onPress={() => setTab(value)} />)}</View>
    {tab === 'Wardrobe' ? <WardrobePanel /> : <View style={[styles.wrap, { gap: 16 }]}>{data?.companion.cosmetics.map(cosmetic => <Pressable key={cosmetic.id} accessibilityRole="button" accessibilityLabel={`View ${cosmetic.name}`} onPress={() => { setError(''); setSelected(cosmetic.id); }} style={{ width: '46%', maxWidth: 220, gap: 6, paddingBottom: 12 }}><View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={cosmetic.category === 'outfit' ? 'tshirt-crew' : cosmetic.category === 'background' ? 'image-outline' : 'star-four-points'} color={cosmetic.color || colors.purple} size={65} /></View><Text style={{ color: colors.ink, fontWeight: '700' }}>{cosmetic.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{cosmetic.equipped ? 'Equipped' : cosmetic.owned ? 'Owned' : ['box', 'raid'].includes(cosmetic.source || '') ? 'Chest reward' : `${cosmetic.price} coins · ${cosmetic.requiredBond} bond`}</Text></Pressable>)}</View>}
    <Dialog visible={!!item} title={item?.name || 'Cosmetic'} onClose={() => setSelected(null)} busy={busy}>{item && <><Badge>{item.category}</Badge><Copy>{item.equipped ? 'Equipped' : item.owned ? 'Owned' : ['raid', 'box'].includes(item.source || '') ? 'Found in a chest' : `${item.price} coins · Requires ${item.requiredBond} bond`}</Copy><ErrorNotice message={error} /><Action label={item.equipped ? 'Equipped' : item.owned ? `Equip ${item.name}` : `Buy ${item.name}`} busy={busy} disabled={busy || item.equipped || (!item.owned && (!item.unlocked || ['raid', 'box'].includes(item.source || '')))} onPress={apply} /></>}</Dialog>
  </Screen>;
}
