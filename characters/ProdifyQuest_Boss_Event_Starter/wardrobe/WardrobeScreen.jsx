import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import CompanionScene from './CompanionScene';
import { COMPANIONS, COMPANIONS_BY_ID } from './companions/catalog';
import { ITEMS, ITEMS_BY_ID, SLOT_FOR_CATEGORY, unlockLabel } from './items';
import { itemPortrait } from './assetCatalog';
import { bossOdds, buyItem, claimCosmeticChest, equipOutfit, grantLevelItems, loadPreset, savePreset, validateOutfit } from './wardrobeRules';

function Button({ children, onPress, disabled, secondary, label }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[s.button, secondary && s.secondary, disabled && s.disabled]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{children}</Text></Pressable>;
}
const TABS = [{ id: 'companion', label: 'Companions' }, { id: 'background', label: 'Scenes' }, { id: 'pet', label: 'Pets' }, { id: 'aura', label: 'Auras' }];
const nextRaid = profile => `wardrobe-demo-${1 + Math.max(0, ...profile.claimedRaidIds.map(id => Number(id.match(/^wardrobe-demo-(\d+)$/)?.[1]) || 0))}`;

/** Controlled screen: the host owns profile and onCommit; keep demo controls off in production. */
export default function WardrobeScreen({ profile, onCommit, saveStatus = '', onRetrySave, demo = false, active = true }) {
  const [preview, setPreview] = useState({ ...profile.equipped });
  const [tab, setTab] = useState('background');
  const [message, setMessage] = useState('Tap an item to try it on. Equip the look when you are ready.');
  const [studying, setStudying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [raidId, setRaidId] = useState(() => nextRaid(profile));
  const scene = useRef(null);
  const { width } = useWindowDimensions();
  const stageWidth = Math.max(240, Math.min(560, width - 40));
  const companion = COMPANIONS_BY_ID[preview.companionId];
  const slot = SLOT_FOR_CATEGORY[tab];
  const selected = slot ? ITEMS_BY_ID[preview[slot]] : null;
  const selectedOwned = selected ? profile.ownedItemIds.includes(selected.id) : true;
  const dirty = JSON.stringify(preview) !== JSON.stringify(profile.equipped);
  let equipError = null;
  try { validateOutfit(profile, preview); } catch (e) { equipError = e.message; }
  const list = tab === 'companion' ? COMPANIONS : ITEMS.filter(item => item.category === tab);
  const claimed = profile.claimedRaidIds.includes(raidId);

  function run(change, success) {
    try { const next = onCommit(change); setMessage(success); return next; }
    catch (error) { setMessage(error.message); return null; }
  }
  function equip() {
    if (run(p => equipOutfit(p, preview), 'Your new look is equipped.')) scene.current?.play('celebrate');
  }
  function claim() {
    // Only for the clearly marked local demo. Your backend must issue real claims.
    let reward;
    const next = run(p => { const r = claimCosmeticChest(p, { raidId, eligible: true, defeated: true, randomValue: Math.random() }); reward = r.reward; return r.profile; }, 'Chest opened.');
    if (!next || !reward) return;
    if (reward.type === 'already-claimed') setMessage('This chest has already been claimed.');
    else if (reward.type === 'coins') setMessage(`Duplicate ${reward.item.name}: +${reward.coins} coins.`);
    else { setPreview(p => ({ ...p, [SLOT_FOR_CATEGORY[reward.item.category]]: reward.item.id })); setTab(reward.item.category); setMessage(`Unlocked ${reward.item.name}! Preview it, then equip your look.`); }
  }
  function levelUp() {
    let unlocked = [];
    const next = run(p => { const r = grantLevelItems(p, p.level < 10 ? 10 : p.level + 10); unlocked = r.unlocked; return r.profile; }, 'Level updated.');
    if (next) setMessage(unlocked.length ? `Unlocked ${unlocked.map(i => i.name).join(' and ')}!` : `Reached level ${next.level}.`);
  }
  return <ScrollView style={s.screen} contentContainerStyle={s.content}>
    <View style={[s.wrap, { width: stageWidth }]}>
      <View style={s.headerRow}><Text style={s.brand}>PRODIFYQUEST</Text><Text style={s.wallet}>{profile.coins.toLocaleString()} coins · Lv {profile.level}</Text></View>
      <Text style={s.title}>Make it yours.</Text>
      <Text style={s.subtitle}>A little personality for every quest.</Text>
      <View style={s.previewTitle}><Text style={s.companionName}>{companion.name}</Text><Text style={s.previewBadge}>{dirty ? 'PREVIEW' : 'EQUIPPED'}</Text></View>
      <CompanionScene ref={scene} outfit={preview} width={stageWidth} restingState={studying ? 'study' : 'idle'} active={active && !paused} onError={setMessage} />
      <View style={s.actions}>
        <Button secondary onPress={() => scene.current?.play('wave')}>Wave</Button>
        <Button secondary onPress={() => setStudying(v => !v)}>{studying ? 'Idle' : 'Study'}</Button>
        <Button secondary onPress={() => scene.current?.play('celebrate')}>Celebrate</Button>
        <Button secondary onPress={() => scene.current?.play('attack')}>Attack</Button>
        <Button secondary onPress={() => setPaused(v => !v)}>{paused ? 'Play' : 'Pause'}</Button>
      </View>
      <View style={s.tabs} accessibilityRole="tablist">
        {TABS.map(t => <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} onPress={() => setTab(t.id)} style={[s.tab, tab === t.id && s.activeTab]}><Text style={[s.tabText, tab === t.id && s.activeTabText]}>{t.label}</Text></Pressable>)}
      </View>
      {(tab === 'pet' || tab === 'aura') && <Button secondary onPress={() => setPreview(p => ({ ...p, [slot]: null }))}>No {tab}</Button>}
      <View style={s.grid}>
        {list.map(item => {
          const isCompanion = tab === 'companion';
          const isOwned = (isCompanion ? profile.ownedCompanionIds : profile.ownedItemIds).includes(item.id);
          const isSelected = (isCompanion ? preview.companionId : preview[slot]) === item.id;
          return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Preview ${item.name}${isOwned ? ', owned' : ', locked'}`} accessibilityState={{ selected: isSelected }} onPress={() => setPreview(p => ({ ...p, [isCompanion ? 'companionId' : slot]: item.id }))} style={[s.item, { width: (stageWidth - 12) / 2 }, isSelected && s.selectedItem]}>
            <View style={[s.itemArt, item.category === 'aura' && s.auraArt]}><Image accessible={false} source={isCompanion ? item.portrait : itemPortrait(item)} resizeMode={tab === 'background' ? 'cover' : 'contain'} style={s.itemImage} /></View>
            <View style={s.itemDetails}><Text style={s.itemName}>{item.name}</Text><Text style={s.itemRarity}>{item.rarity}</Text><Text style={s.itemUnlock}>{isOwned ? 'Owned' : isCompanion ? 'Companion locked' : unlockLabel(item)}</Text></View>
          </Pressable>;
        })}
      </View>
      {selected && <View style={s.itemInfo}>
        <Text style={s.infoTitle}>{selected.name}</Text><Text style={s.body}>{selected.description}</Text>
        {!selectedOwned && selected.unlock.type === 'shop' && <Button onPress={() => run(p => buyItem(p, selected.id), `${selected.name} is yours. Equip the look when you are ready.`)}>Buy · {selected.unlock.coins} coins</Button>}
        {!selectedOwned && selected.unlock.type !== 'shop' && <Text style={s.locked}>Unlock through {unlockLabel(selected).toLowerCase()}.</Text>}
      </View>}
      <View style={s.equipRow}>
        <Button disabled={Boolean(equipError) || !dirty} onPress={equip}>{dirty ? 'Equip look' : 'Look equipped'}</Button>
        {dirty && <Button secondary onPress={() => { setPreview({ ...profile.equipped }); setMessage('Showing your equipped outfit.'); }}>Reset preview</Button>}
      </View>
      {equipError && <Text style={s.locked}>{equipError}</Text>}
      <Text style={s.message} accessibilityLiveRegion="polite">{message}</Text>
      <View style={s.sectionHeading}><Text style={s.sectionTitle}>Favorite looks</Text><Text style={s.small}>3 outfit slots</Text></View>
      {[0, 1, 2].map(favoriteSlot => {
        const preset = profile.presets.find(p => p.slot === favoriteSlot);
        return <View key={favoriteSlot} style={s.favoriteRow}>
          <View style={s.favoriteLabel}><Text style={s.infoTitle}>{preset?.name || `Favorite ${favoriteSlot + 1}`}</Text><Text style={s.small}>{preset ? COMPANIONS_BY_ID[preset.outfit.companionId].name : 'Empty slot'}</Text></View>
          <Button secondary label={`Save preview to favorite ${favoriteSlot + 1}`} disabled={Boolean(equipError)} onPress={() => run(p => savePreset(p, favoriteSlot, `Favorite ${favoriteSlot + 1}`, preview), `Saved Favorite ${favoriteSlot + 1}.`)}>Save</Button>
          <Button secondary label={`Wear favorite ${favoriteSlot + 1}`} disabled={!preset} onPress={() => { const next = run(p => loadPreset(p, favoriteSlot), `Equipped Favorite ${favoriteSlot + 1}.`); if (next) setPreview({ ...next.equipped }); }}>Wear</Button>
        </View>;
      })}
      <Text style={s.small}>{saveStatus}</Text>
      {saveStatus.startsWith('Save failed') && onRetrySave && <Button secondary onPress={onRetrySave}>Retry save</Button>}
      {demo && <View style={s.demo}>
        <Button secondary onPress={() => setShowDemo(v => !v)}>{showDemo ? 'Hide demo rewards' : 'Try rewards (demo)'}</Button>
        {showDemo && <>
          <Text style={s.body}>All 11 companions are available in this demo. Cosmetics use the sample unlock rules.</Text>
          <View style={s.actions}><Button onPress={levelUp}>Next level milestone</Button><Button disabled={claimed} onPress={claim}>{claimed ? 'Chest claimed' : 'Open demo chest'}</Button><Button secondary onPress={() => { setRaidId(nextRaid(profile)); setMessage(claimed ? 'A new demo boss victory is ready.' : 'Open the current chest first.'); }}>New demo victory</Button></View>
          <Text style={s.small}>Chest odds: {bossOdds().map(({ item, probability }) => `${item.name} ${Math.round(probability * 100)}%`).join(' · ')}</Text>
          <Text style={s.small}>Duplicate rewards: Starfall 100 coins · Ember Drake 200 coins · Arcane Halo 300 coins.</Text>
        </>}
      </View>}
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbf9ff' }, content: { padding: 20, paddingBottom: 40, alignItems: 'center' }, wrap: {},
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }, brand: { fontSize: 11, letterSpacing: 1.7, color: '#7850b9', fontWeight: '800', marginBottom: 6 }, wallet: { color: '#6b5a7c', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: '#302442', marginTop: 15 }, subtitle: { fontSize: 14, color: '#7a6b89', marginTop: 7, marginBottom: 23 },
  previewTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap' }, companionName: { fontSize: 17, fontWeight: '700', color: '#49365d' }, previewBadge: { fontSize: 10, letterSpacing: 1.2, color: '#7a4dc0', fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }, button: { backgroundColor: '#7952bb', borderRadius: 12, minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, marginRight: 7, marginBottom: 7, justifyContent: 'center' }, secondary: { backgroundColor: '#eee7f8' }, buttonText: { color: '#fff', fontSize: 13, fontWeight: '700' }, secondaryText: { color: '#694499' }, disabled: { opacity: 0.45 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#e7dff0' }, tab: { paddingVertical: 13, paddingHorizontal: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' }, activeTab: { borderBottomColor: '#7a50bd' }, tabText: { fontSize: 13, color: '#8b7d98', fontWeight: '600' }, activeTabText: { color: '#6d40ac', fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, item: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, borderColor: '#e9e2f1', overflow: 'hidden', marginBottom: 12 }, selectedItem: { borderColor: '#9a73d0' }, itemArt: { height: 110, backgroundColor: '#f0eafb', overflow: 'hidden' }, auraArt: { backgroundColor: '#302942' }, itemImage: { width: '100%', height: '100%' }, itemDetails: { padding: 12 }, itemName: { fontSize: 14, fontWeight: '700', color: '#3d2e51' }, itemRarity: { color: '#8b77a0', fontSize: 11, marginTop: 5 }, itemUnlock: { color: '#7245ad', fontSize: 12, fontWeight: '600', marginTop: 7 },
  itemInfo: { paddingVertical: 12 }, infoTitle: { fontSize: 14, color: '#49365e', fontWeight: '700' }, body: { color: '#78658b', fontSize: 13, lineHeight: 20, marginVertical: 7 }, locked: { color: '#8a632d', fontSize: 12, lineHeight: 18, marginBottom: 10 }, equipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }, message: { fontSize: 13, lineHeight: 20, color: '#73588c', marginTop: 4, marginBottom: 24 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13, flexWrap: 'wrap' }, sectionTitle: { fontSize: 19, fontWeight: '700', color: '#40304f' }, small: { fontSize: 12, lineHeight: 18, color: '#8a7898', marginVertical: 4 }, favoriteRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee7f4', paddingVertical: 12, flexWrap: 'wrap' }, favoriteLabel: { flexGrow: 1, minWidth: 100 }, demo: { marginTop: 28, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e7dfee' },
});
