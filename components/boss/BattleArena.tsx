import { ReactNode, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FontAwesome5 } from '@expo/vector-icons';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import CollectedCompanion, { CollectedCompanionHandle } from '@/components/collected-companions/CollectedCompanion';
import { COLLECTED_COMPANIONS } from '@/components/collected-companions/catalog';
import MageCompanion, { MageHandle } from '@/components/mage/MageCompanion';
import { API_URL } from '@/scripts/api';
import type { ConfirmedAttack, Raid } from '@/scripts/battle-types';
import BossSprite, { BossAction } from './BossSprite';
import { bossRestAction } from './raid-state';
import { createBattlePlayback } from './battle-playback';
import { useBattleMotion } from './use-battle-motion';

export type BattleArenaHandle = { play: (attack: ConfirmedAttack) => boolean };
type Props = { raid: Raid; companionId?: string; imagePath?: string; onBusyChange: (busy: boolean) => void; attackControl?: ReactNode };
export const BattleArena = forwardRef<BattleArenaHandle, Props>(function BattleArena({ raid, companionId: equippedCompanionId, imagePath, onBusyChange, attackControl }, ref) {
  const motion = useBattleMotion();
  const [width, setWidth] = useState(300);
  const [shownHp, setShownHp] = useState(raid.hp);
  const [hero, setHero] = useState<ConfirmedAttack | null>(null);
  const [damage, setDamage] = useState<ConfirmedAttack | null>(null);
  const [action, setAction] = useState<BossAction>(() => bossRestAction(raid.hp, raid.maxHp, raid.enrageAt));
  const [eventKey, setEventKey] = useState(0);
  const busy = useRef(false);
  const latest = useRef({ raid, motion, onBusyChange });
  latest.current = { raid, motion, onBusyChange };
  const mage = useRef<MageHandle>(null), collected = useRef<CollectedCompanionHandle>(null);
  const readyCompanion = useRef<string | null>(null);
  const heroOpacity = useRef(new Animated.Value(1)).current, heroX = useRef(new Animated.Value(0)).current;
  const projectile = useRef(new Animated.Value(0)).current, projectileOpacity = useRef(new Animated.Value(0)).current, floatY = useRef(new Animated.Value(0)).current;
  const [playback] = useState(() => {
    function confirmedHp(result: ConfirmedAttack) {
      const current = latest.current.raid;
      return current.id === result.raidId && (current.revision ?? 0) >= result.revision ? Math.min(result.hpAfter, current.hp) : result.hpAfter;
    }
    function rest(hp: number) { return bossRestAction(hp, latest.current.raid.maxHp, latest.current.raid.enrageAt); }
    function stopAnimations() { heroOpacity.stopAnimation(); heroX.stopAnimation(); projectile.stopAnimation(); floatY.stopAnimation(); projectileOpacity.setValue(0); }
    return createBattlePlayback({
      motion: () => latest.current.motion,
      busy: value => { busy.current = value; latest.current.onBusyChange(value); },
      prepare: result => { setShownHp(result.hpBefore); setHero(result); setDamage(null); setEventKey(value => value + 1); setAction(rest(result.hpBefore)); heroOpacity.setValue(1); heroX.setValue(0); projectile.setValue(0); projectileOpacity.setValue(0); },
      entrance: () => { heroOpacity.setValue(1); heroX.setValue(0); },
      attack: () => { if (collected.current) collected.current.play('attack'); else mage.current?.play('cast'); },
      projectile: () => { projectileOpacity.setValue(1); Animated.timing(projectile, { toValue: 1, duration: 220, easing: Easing.linear, useNativeDriver: true }).start(); },
      impact: result => { const hp = confirmedHp(result); projectileOpacity.setValue(0); setShownHp(hp); setAction(hp === 0 ? 'defeat' : 'hit'); setDamage(result); floatY.setValue(0); Animated.timing(floatY, { toValue: -27, duration: 650, useNativeDriver: true }).start(); },
      recover: result => { setAction(rest(confirmedHp(result))); setDamage(null); },
      fade: () => { collected.current?.stop(); mage.current?.stop(); },
      settle: result => { stopAnimations(); heroOpacity.setValue(1); heroX.setValue(0); collected.current?.stop(); mage.current?.stop(); const hp = confirmedHp(result); setShownHp(hp); setAction(rest(hp)); setHero(null); setDamage(null); },
    });
  });
  useImperativeHandle(ref, () => ({ play: playback.play }), [playback]);
  useEffect(() => {
    if (!busy.current) { setShownHp(raid.hp); setAction(bossRestAction(raid.hp, raid.maxHp, raid.enrageAt)); }
  }, [raid.hp, raid.id, raid.maxHp, raid.enrageAt]);
  useEffect(() => { if (!motion && busy.current) playback.settle(); }, [motion, playback]);
  useEffect(() => () => { playback.destroy(); heroOpacity.stopAnimation(); heroX.stopAnimation(); projectile.stopAnimation(); floatY.stopAnimation(); }, [playback, heroOpacity, heroX, projectile, floatY]);
  const height = width * .75, heroWidth = width * .66, heroScale = heroWidth / 368, bossSize = width * .43, footY = height * .7;
  const selectedCompanion = hero?.companionId || equippedCompanionId || 'apprentice-mage';
  const companionId = selectedCompanion === 'apprenticemage' ? 'apprentice-mage' : selectedCompanion;
  // Keep the sprite mounted between attacks. An already loaded companion can
  // start presentation immediately; a newly equipped one waits for its image.
  useEffect(() => { if (hero && readyCompanion.current === companionId) playback.ready(); }, [hero, companionId, playback]);
  function companionReady() { readyCompanion.current = companionId; playback.ready(); }
  const definition = COLLECTED_COMPANIONS[companionId];
  const isMage = ['apprentice-mage', 'apprenticemage', ''].includes(companionId);
  const hp = Math.max(0, shownHp);
  return <View testID="battle-arena" style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 10 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={s.hpRow}><Text style={s.hpName}>{hp === 0 ? 'Boss defeated' : raid.bossName}</Text><Text testID="boss-health" style={s.hpText}>{hp} / {raid.maxHp} HP</Text></View>
    <View accessibilityRole="progressbar" accessibilityLabel="Guild boss health" accessibilityValue={{ min: 0, max: raid.maxHp, now: hp }} style={s.hpTrack}><View style={[s.hpFill, { width: `${raid.maxHp ? hp / raid.maxHp * 100 : 100}%` }]} /></View>
    <View style={{ width, height, overflow: 'hidden', borderRadius: 18, backgroundColor: '#324935' }}>
      <Image accessible={false} source={require('./assets/forest-arena.png')} resizeMode="cover" style={{ position: 'absolute', width, height }} />
      <View style={{ position: 'absolute', left: width * .77 - bossSize * .5, top: footY - bossSize * .96 }}>{raid.bossId === 'dreadroot' ? <BossSprite action={action} size={bossSize} active={motion} eventKey={eventKey} /> : <View accessibilityLabel="Deadline Dragon" style={{ width: bossSize, height: bossSize, alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name={hp === 0 ? 'trophy' : 'dragon'} size={bossSize * .66} color={hp === 0 ? '#F6D27D' : '#D9B5F4'} /></View>}</View>
      <Animated.View testID="raid-companion" key={companionId} pointerEvents="none" style={{ position: 'absolute', left: width * .19 - 136 * heroScale, top: footY - 228 * heroScale, opacity: heroOpacity, transform: [{ translateX: heroX }] }}>
        {isMage ? <MageCompanion ref={mage} width={heroWidth} active={motion} onReady={companionReady} onError={playback.settle} /> : definition ? <CollectedCompanion ref={collected} companion={definition} width={heroWidth} active={motion} onReady={companionReady} onError={playback.settle} /> : <Image accessibilityLabel="Your raid companion" source={{ uri: `${API_URL}${hero?.imagePath || imagePath || ''}` }} resizeMode="contain" style={{ width: heroWidth, height: heroWidth * 256 / 368 }} onLoad={companionReady} onError={playback.settle} />}
      </Animated.View>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: width * .35, top: footY - bossSize * .44, width: 12, height: 12, borderRadius: 6, backgroundColor: '#D3B8FF', borderWidth: 2, borderColor: '#FFF', opacity: projectileOpacity, transform: [{ translateX: projectile.interpolate({ inputRange: [0, 1], outputRange: [0, width * .41] }) }] }} />
      {damage && <Animated.Text style={[s.damage, { left: width * .58, width: width * .4, top: footY - bossSize * .8, fontSize: Math.max(14, Math.min(22, width * .055)), transform: [{ translateY: floatY }] }]}>{damage.critical ? 'CRIT! ' : ''}−{damage.damage}</Animated.Text>}
      {hp === 0 && <View style={[s.victory, !!attackControl && { bottom: 65 }]}><Text style={s.victoryText}>GUILD VICTORY</Text></View>}
      {!!attackControl && <View style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>{attackControl}</View>}
    </View>
  </View>;
});
const s = StyleSheet.create({
  hpRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }, hpName: { fontSize: 16, color: '#382A48', fontWeight: '800' }, hpText: { fontSize: 12, color: '#8B7199', fontWeight: '700' },
  hpTrack: { height: 9, backgroundColor: '#E7DDEA', borderRadius: 5, overflow: 'hidden' }, hpFill: { height: 9, backgroundColor: '#A86ECA' },
  damage: { position: 'absolute', textAlign: 'center', color: '#FFF8BA', fontWeight: '900', textShadowColor: '#39213B', textShadowRadius: 4, textShadowOffset: { width: 1, height: 2 } },
  platformLabel: { position: 'absolute', color: '#FFF', fontSize: 11, fontWeight: '700', textShadowColor: '#263323', textShadowRadius: 3 },
  victory: { position: 'absolute', bottom: 15, left: 0, right: 0, alignItems: 'center' }, victoryText: { backgroundColor: '#324029DD', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 13, color: '#F4EDAA', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
});
