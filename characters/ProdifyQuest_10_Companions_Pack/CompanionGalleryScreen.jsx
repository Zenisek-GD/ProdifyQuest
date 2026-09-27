import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Companion from './Companion';
import { COMPANIONS, COMPANIONS_BY_ID } from './catalog';
import { buyShopCompanion, claimBossChest, createDemoPlayer, getBossChestOdds, getUnlockLabel, grantLevelRewards } from './rewardRules';

export default function CompanionGalleryScreen() {
  const sprite = useRef(null);
  const [selectedId, setSelectedId] = useState('apprentice-mage');
  const [equippedId, setEquippedId] = useState('apprentice-mage');
  const [player, setPlayer] = useState(createDemoPlayer);
  const [studying, setStudying] = useState(false);
  const [raidNumber, setRaidNumber] = useState(1);
  const [message, setMessage] = useState('Preview any companion. Unlock it before equipping.');
  const { width } = useWindowDimensions();
  const selected = COMPANIONS_BY_ID[selectedId];
  const owned = player.ownedIds.includes(selectedId);
  const raidId = `demo-raid-${raidNumber}`;
  const claimed = player.claimedRaidIds.includes(raidId);

  function buySelected() {
    try { setPlayer(buyShopCompanion(player, selectedId)); setMessage(`${selected.name} joined your collection.`); sprite.current?.play('celebrate'); }
    catch (error) { setMessage(error.message); }
  }
  function gainDemoLevel() {
    const result = grantLevelRewards({ ...player, level: player.level < 10 ? 10 : player.level + 10 });
    setPlayer(result.player);
    setMessage(result.unlockedIds.length ? `Unlocked: ${result.unlockedIds.map(id => COMPANIONS_BY_ID[id].name).join(', ')}` : `Reached level ${result.player.level}.`);
  }
  function openDemoChest() {
    const result = claimBossChest(player, { raidId, defeated: true, eligible: true, randomValue: Math.random() });
    setPlayer(result.player);
    if (result.reward.type === 'companion') { setSelectedId(result.reward.companionId); setMessage(`Chest reward: ${result.reward.name}!`); }
    else if (result.reward.type === 'coins') setMessage(`Duplicate ${result.reward.name}: +${result.reward.amount} coins.`);
    else setMessage('This raid chest has already been claimed.');
  }
  const Button = ({ label, onPress, disabled = false }) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PRODIFYQUEST · COMPANION GALLERY</Text>
      <Text style={styles.heading}>Find your next companion.</Text>
      <Text style={styles.caption}>Demo only · Level {player.level} · {player.coins} coins</Text>
      <View style={styles.stage}>
        <Text style={styles.name}>{selected.name}</Text>
        <Text style={styles.caption}>{selected.rarity} · {owned ? 'Owned' : getUnlockLabel(selected)}</Text>
        <Companion ref={sprite} companionId={selectedId} width={Math.min(368, Math.max(180, width - 48))} restingState={studying ? 'study' : 'idle'} onError={setMessage} />
      </View>
      <View style={styles.row}>
        <Button label="Wave" onPress={() => sprite.current?.play('wave')} />
        <Button label={studying ? 'Idle' : 'Study'} onPress={() => setStudying(value => !value)} />
        <Button label="Celebrate" onPress={() => sprite.current?.play('celebrate')} />
        <Button label="Attack" onPress={() => sprite.current?.play('attack')} />
      </View>
      <View style={styles.row}>
        <Button label={equippedId === selectedId ? 'Equipped' : owned ? 'Equip companion' : 'Unlock to equip'} disabled={!owned || equippedId === selectedId} onPress={() => { setEquippedId(selectedId); setMessage(`${selected.name} equipped for this demo.`); }} />
        {selected.unlock.type === 'shop' && !owned && <Button label={`Buy · ${selected.unlock.coins} coins`} onPress={buySelected} />}
      </View>
      <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text>
      <View style={styles.collection}>
        {COMPANIONS.map(item => <Pressable key={item.id} onPress={() => setSelectedId(item.id)} accessibilityRole="button" accessibilityLabel={`Preview ${item.name}`} style={[styles.card, { width: Math.max(130, (width - 58) / 2) }, item.id === selectedId && styles.selected]}>
          <Image source={item.portrait} style={styles.portrait} resizeMode="contain" />
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.small}>{player.ownedIds.includes(item.id) ? 'Owned' : getUnlockLabel(item)}</Text>
        </Pressable>)}
      </View>
      <View style={styles.demoPanel}>
        <Text style={styles.name}>Try the reward rules</Text>
        <Text style={styles.small}>Local demo state resets when this screen remounts.</Text>
        <View style={styles.row}>
          <Button label="Next level milestone" onPress={gainDemoLevel} />
          <Button label={claimed ? 'Chest claimed' : 'Open boss chest'} disabled={claimed} onPress={openDemoChest} />
          <Button label="New demo boss victory" onPress={() => { setRaidNumber(value => value + 1); setMessage('A new earned test chest is ready.'); }} />
        </View>
        <Text style={styles.small}>Chest odds: {getBossChestOdds().map(item => `${item.name} ${Math.round(item.probability * 100)}%`).join(' · ')}</Text>
        <Text style={styles.small}>Real purchases, levels, eligibility and chest claims must be confirmed by your backend. These buttons do not affect your live app.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f3ff' },
  content: { paddingHorizontal: 24, paddingTop: 62, paddingBottom: 48 },
  eyebrow: { color: '#7951d4', fontSize: 11, letterSpacing: 1.5, fontWeight: '800' },
  heading: { color: '#2e253c', fontSize: 29, fontWeight: '800', marginTop: 12 },
  caption: { color: '#82718f', fontSize: 13, marginTop: 8, lineHeight: 19 },
  stage: { backgroundColor: '#ece4ff', borderRadius: 24, marginTop: 20, paddingTop: 20, alignItems: 'center', overflow: 'hidden' },
  name: { fontSize: 19, color: '#3b2f4d', fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  button: { backgroundColor: '#7951d4', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, marginRight: 7, marginBottom: 7 },
  disabled: { opacity: 0.42 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  message: { color: '#57426c', marginVertical: 13, lineHeight: 21 },
  collection: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8dff1', borderRadius: 18, padding: 12, marginBottom: 10, alignItems: 'center' },
  selected: { borderColor: '#7951d4', borderWidth: 2 },
  portrait: { width: 104, height: 116 },
  cardName: { color: '#382a49', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  small: { color: '#8b7c98', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'left' },
  demoPanel: { marginTop: 18, padding: 18, backgroundColor: '#fff', borderRadius: 20 },
});
