import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Action, Badge, Choice, Copy, ErrorNotice, colors, styles } from '@/components/quest-ui';
import { CompanionScene } from '@/components/companion-scene';
import { useAuth } from '@/context/auth';
import { useCompanion } from '@/context/companion';
import { api, errorMessage } from '@/scripts/api';
import type { WardrobeItem, WardrobeLook, WardrobeResponse } from '@/scripts/companion-types';
import { itemPortrait } from './assets';

const SLOT = { background: 'backgroundId', pet: 'petId', aura: 'auraId' } as const;
const sameLook = (left: WardrobeLook, right: WardrobeLook) => left.backgroundId === right.backgroundId && left.petId === right.petId && left.auraId === right.auraId;
function unlockLabel(item: WardrobeItem) {
  if (item.unlock.type === 'shop') return `${item.unlock.coins} coins`;
  if (item.unlock.type === 'level') return `Player Lv. ${item.unlock.level}`;
  if (item.unlock.type === 'boss') return 'Boss chest';
  return 'Starter';
}

export function WardrobePanel() {
  const { data, mutate, studying } = useCompanion();
  const { user, refreshUser } = useAuth();
  const [catalog, setCatalog] = useState<WardrobeResponse | null>(null);
  const [category, setCategory] = useState<WardrobeItem['category']>('background');
  const [draft, setDraft] = useState<WardrobeLook | null>(null);
  const [favorites, setFavorites] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const writing = useRef(false);
  const reload = useCallback(async () => {
    if (writing.current) return;
    const version = ++request.current;
    try {
      const response = await api.get<WardrobeResponse>('/wardrobe');
      if (request.current === version) { setCatalog(response.data); setError(''); }
    } catch (cause) { if (request.current === version) setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => { clearTimeout(timer); request.current += 1; }; }, [reload]);
  const wardrobe = data?.wardrobe ?? catalog?.wardrobe;
  const look = draft ?? wardrobe?.equipped;
  const owned = new Set(wardrobe?.ownedItemIds ?? []);
  const allOwned = !!look && [look.backgroundId, look.petId, look.auraId].every(id => id == null || owned.has(id));
  const equipped = !!look && !!wardrobe && sameLook(look, wardrobe.equipped);
  const coins = user?.coins ?? catalog?.coins ?? 0;
  function preview(item: WardrobeItem) {
    if (!look || busy) return;
    setDraft({ ...look, [SLOT[item.category]]: item.id }); setNotice('');
  }
  async function commit(path: string, body: object | undefined, method: 'POST' | 'PATCH' | 'PUT', message: string, reset = false) {
    if (writing.current) return;
    writing.current = true;
    setBusy(path); setError(''); setNotice(''); request.current += 1;
    try {
      const response = await mutate(path, body, method);
      setCatalog(response.data as WardrobeResponse);
      if (reset) setDraft(null);
      setNotice(message);
      void refreshUser().catch(() => {});
    } catch (cause) { setError(errorMessage(cause)); }
    finally { writing.current = false; setBusy(''); }
  }
  return <View testID="wardrobe-panel" style={{ gap: 16 }}>
    {look ? <><View testID="wardrobe-preview"><CompanionScene companion={data?.companion} wardrobeLook={look} compact studying={studying} /></View>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Copy>{equipped ? 'Equipped look' : allOwned ? 'Preview' : 'Preview · locked items'}</Copy><View style={styles.wrap}><Action label="Reset" variant="ghost" small disabled={!!busy || equipped} onPress={() => setDraft(null)} /><Action label="Equip look" icon="check" small disabled={!!busy || !allOwned || equipped} busy={busy === '/wardrobe/equip'} onPress={() => commit('/wardrobe/equip', look, 'PATCH', 'Look equipped', true)} /></View></View>
    </> : <Copy>Loading looks…</Copy>}
    <View style={styles.wrap}>{(['background', 'pet', 'aura'] as const).map(value => <Choice key={value} label={{ background: 'Scenes', pet: 'Pets', aura: 'Auras' }[value]} selected={category === value} onPress={() => setCategory(value)} />)}{look && category !== 'background' && <Choice label="None" selected={look[SLOT[category]] === null} onPress={() => { if (!busy) setDraft({ ...look, [SLOT[category]]: null }); }} />}</View>
    <View style={[styles.wrap, { gap: 16 }]}>{catalog?.items.filter(item => item.category === category).map(item => {
      const isOwned = owned.has(item.id);
      const selected = look?.[SLOT[item.category]] === item.id;
      const price = item.unlock.coins ?? 0;
      return <View key={item.id} testID={`wardrobe-item-${item.id}`} style={{ width: '46%', maxWidth: 220, gap: 7, paddingBottom: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${item.name}`} accessibilityState={{ selected }} disabled={!!busy || !look} onPress={() => preview(item)} style={{ gap: 6 }}>
          <Image accessible={false} source={itemPortrait(item.id)} resizeMode={item.category === 'background' ? 'cover' : 'contain'} style={{ width: '100%', height: 100, borderRadius: 8, backgroundColor: item.category === 'aura' ? '#302942' : colors.pale, borderWidth: selected ? 2 : 0, borderColor: colors.purple }} />
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{item.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{item.rarity} · {isOwned ? 'Owned' : unlockLabel(item)}</Text>
        </Pressable>
        {selected && !isOwned && item.unlock.type === 'shop' && <Action label={`Buy ${item.name}`} small disabled={!!busy || coins < price} busy={busy === `/wardrobe/items/${item.id}/purchase`} onPress={() => commit(`/wardrobe/items/${item.id}/purchase`, undefined, 'POST', `${item.name} collected`)} />}
      </View>;
    })}</View>
    <Action label={favorites ? 'Hide favorite looks' : 'Favorite looks'} icon="favorite-border" variant="ghost" small onPress={() => setFavorites(value => !value)} />
    {favorites && <View style={{ gap: 12 }}>{[0, 1, 2].map(slot => {
      const saved = wardrobe?.presets[slot];
      return <View key={slot} style={[styles.row, { flexWrap: 'wrap', borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }]}><Text style={{ flex: 1, color: colors.ink, fontWeight: '600' }}>Look {slot + 1}{saved ? '' : ' · empty'}</Text><Action label={`Save favorite ${slot + 1}`} small variant="secondary" disabled={!!busy || !allOwned} onPress={() => commit(`/wardrobe/presets/${slot}`, look, 'PUT', `Look ${slot + 1} saved`)} /><Action label={`Wear favorite ${slot + 1}`} small variant="ghost" disabled={!!busy || !saved} onPress={() => commit(`/wardrobe/presets/${slot}/equip`, undefined, 'POST', `Look ${slot + 1} equipped`, true)} /></View>;
    })}</View>}
    {!!notice && <View accessibilityLiveRegion="polite"><Badge tone="green">{notice}</Badge></View>}<ErrorNotice message={error} onRetry={reload} />
  </View>;
}
