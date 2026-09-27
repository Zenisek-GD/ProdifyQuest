import type { ImageSourcePropType } from 'react-native';

export const BACKGROUNDS: Record<string, ImageSourcePropType> = {
  'study-room': require('./assets/backgrounds/study-room.png'),
  'moon-garden': require('./assets/backgrounds/moon-garden.png'),
  'sky-island': require('./assets/backgrounds/sky-island.png'),
};
export const AURAS: Record<string, ImageSourcePropType> = {
  'leaf-dance': require('./assets/auras/leaf-dance.png'),
  starfall: require('./assets/auras/starfall.png'),
  'arcane-halo': require('./assets/auras/arcane-halo.png'),
};
export const PETS: Record<string, { atlas: ImageSourcePropType; portrait: ImageSourcePropType }> = {
  'mint-slime': { atlas: require('./assets/pets/mint-slime/atlas.png'), portrait: require('./assets/pets/mint-slime/portrait.png') },
  'moon-owl': { atlas: require('./assets/pets/moon-owl/atlas.png'), portrait: require('./assets/pets/moon-owl/portrait.png') },
  'ember-drake': { atlas: require('./assets/pets/ember-drake/atlas.png'), portrait: require('./assets/pets/ember-drake/portrait.png') },
};
export const itemPortrait = (id: string) => BACKGROUNDS[id] || AURAS[id] || PETS[id]?.portrait;
