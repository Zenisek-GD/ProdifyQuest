import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Image, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import MageCompanion, { MageHandle } from '@/components/mage/MageCompanion';
import CollectedCompanion, { CollectedCompanionHandle } from '@/components/collected-companions/CollectedCompanion';
import { COLLECTED_COMPANIONS } from '@/components/collected-companions/catalog';
import type { Companion, WardrobeLook } from '@/scripts/companion-types';
import { API_URL } from '@/scripts/api';
import { useAuth } from '@/context/auth';
import { useCompanion } from '@/context/companion';
import { BACKGROUNDS } from '@/components/wardrobe/assets';
import { Aura } from '@/components/wardrobe/aura';
import { PetSprite, PetHandle } from '@/components/wardrobe/pet-sprite';
import { useMotionEnabled } from '@/components/wardrobe/use-motion-enabled';

export const CompanionScene = forwardRef<MageHandle, { companion?: Companion; studying?: boolean; compact?: boolean; thumbnail?: boolean; active?: boolean; wardrobeLook?: WardrobeLook }>(function CompanionScene({ companion, studying = false, compact = false, thumbnail = false, active = true, wardrobeLook }, ref) {
  const mage = useRef<MageHandle>(null);
  const collectedHandle = useRef<CollectedCompanionHandle>(null);
  const pet = useRef<PetHandle>(null);
  const focused = useIsFocused();
  const { user } = useAuth();
  const { data } = useCompanion();
  const look = wardrobeLook ?? data?.wardrobe?.equipped;
  const motion = useMotionEnabled(focused && active);
  const { width: windowWidth } = useWindowDimensions();
  const width = thumbnail ? 100 : Math.max(150, Math.min(compact ? 220 : 320, windowWidth - 96));
  const cosmetic = (category: string) => companion?.cosmetics.find(item => item.category === category && item.equipped);
  const evolved = companion?.capabilities?.evolved ?? false;
  useImperativeHandle(ref, () => ({
    play(action) {
      (collectedHandle.current || mage.current)?.play(action);
      if ((Array.isArray(action) ? action : [action]).includes('celebrate')) pet.current?.celebrate();
    },
    stop() { (collectedHandle.current || mage.current)?.stop(); pet.current?.stop(); },
  }), []);
  const isMage = companion?.isMage ?? (!user?.character?.image || user.character.image.toLowerCase() === 'apprenticemage');
  const collected = COLLECTED_COMPANIONS[user?.character?.image || ''];
  const height = thumbnail ? 86 : compact ? 160 : 220;
  const footY = height * (look?.backgroundId === 'sky-island' ? 0.82 : 0.9);
  // The atlas body is left of the 368px frame center. Register every layer to
  // the same (136, 228) foot anchor, rather than centering the empty frame.
  const animated = isMage || !!collected;
  const anchorX = animated ? width * 136 / 368 : width / 2;
  const anchorY = animated ? width * 228 / 368 : width * 0.7;
  const auraSize = width * (animated ? 0.62 : 0.8);
  return <View style={{ overflow: 'hidden', height, backgroundColor: cosmetic('background')?.color || '#F0EBFC', borderRadius: thumbnail ? 12 : 18, borderWidth: evolved ? 2 : 1, borderColor: evolved ? '#D6AF5D' : '#E1D8F4' }}>
    {look && <Image testID={`wardrobe-background-${look.backgroundId}`} accessible={false} source={BACKGROUNDS[look.backgroundId] || BACKGROUNDS['study-room']} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />}
    {look && cosmetic('background')?.color && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, backgroundColor: cosmetic('background')?.color, opacity: 0.2 }} />}
    <View pointerEvents="none" style={{ position: 'absolute', width: auraSize, height: auraSize, borderRadius: width, backgroundColor: evolved ? '#FFF3CC88' : '#FFFFFF22', left: '50%', marginLeft: -auraSize / 2, top: footY - auraSize * 0.88, borderWidth: companion?.capabilities?.archmage ? 3 : 0, borderColor: '#DBC28A' }} />
    {look?.auraId && <View testID="companion-aura-anchor" pointerEvents="none" style={{ position: 'absolute', left: '50%', marginLeft: -auraSize / 2, top: footY - auraSize * 0.88 }}><Aura auraId={look.auraId} size={auraSize} enabled={motion} /></View>}
    <View pointerEvents="none" style={{ position: 'absolute', top: footY - 3, left: '50%', marginLeft: -width * 0.15, width: width * 0.3, height: 6, backgroundColor: '#65538722', borderRadius: 100 }} />
    <View testID="companion-body-anchor" style={{ position: 'absolute', left: '50%', marginLeft: -anchorX, top: footY - anchorY }}>
      {isMage ? <MageCompanion ref={mage} width={width} active={focused && active} restingState={studying ? 'study' : 'idle'} outfitColor={cosmetic('outfit')?.color} accessoryColor={cosmetic('accessory')?.color} /> : collected ? <CollectedCompanion key={collected.id} ref={collectedHandle} companion={collected} width={width} active={focused && active} restingState={studying ? 'study' : 'idle'} /> : <Image accessibilityLabel="Active companion" source={{ uri: `${API_URL}${user?.imagePath}` }} style={{ width, height: width * 0.7 }} resizeMode="contain" />}
    </View>
    {look?.petId && <View pointerEvents="none" style={{ position: 'absolute', left: '50%', marginLeft: width * 0.19, top: footY - width * 0.27 * 0.84 }}><PetSprite key={look.petId} ref={pet} petId={look.petId} size={width * 0.27} enabled={motion} /></View>}
  </View>;
});
