import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { API_URL } from '@/scripts/api';
import { colors } from '@/components/quest-theme';

/** Display-only clipping keeps legacy card frames and printed labels out of the grid. */
export function CharacterPortrait({ id, name, imagePath, size = 124 }: { id: string; name: string; imagePath: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const mage = id === 'apprenticemage' || id === 'apprentice-mage';
  const sourcePath = mage ? '/characters/ProdifyQuest_10_Companions_Pack/assets/apprentice-mage/portrait.png' : imagePath;
  const legacy = !mage && sourcePath.includes('/characters/common/');
  const width = size / .8;
  const height = width * 136 / 105;
  return <View accessible accessibilityRole="image" accessibilityLabel={name} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    {failed ? <MaterialIcons name="person" size={size * .6} color={colors.purple} /> : <View style={{ width: size, height: legacy ? size * .87 : size, overflow: 'hidden', borderRadius: legacy ? 10 : 0 }}>
      <Image accessible={false} source={{ uri: sourcePath.startsWith('http') ? sourcePath : `${API_URL}${sourcePath.startsWith('/') ? '' : '/'}${sourcePath}` }} resizeMode={legacy ? 'stretch' : 'contain'} style={legacy ? { position: 'absolute', width, height, left: -width * .1, top: -height * .065 } : { width: '100%', height: '100%' }} onError={() => setFailed(true)} />
    </View>}
  </View>;
}
