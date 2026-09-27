// Literal paths let Metro include every asset in the app bundle.
export const BACKGROUNDS = {
  'study-room': require('./assets/backgrounds/study-room.png'),
  'moon-garden': require('./assets/backgrounds/moon-garden.png'),
  'sky-island': require('./assets/backgrounds/sky-island.png'),
};
export const AURAS = {
  starfall: require('./assets/auras/starfall.png'),
  'leaf-dance': require('./assets/auras/leaf-dance.png'),
  'arcane-halo': require('./assets/auras/arcane-halo.png'),
};
export const PETS = {
  'mint-slime': { atlas: require('./assets/pets/mint-slime/atlas.png'), portrait: require('./assets/pets/mint-slime/portrait.png') },
  'moon-owl': { atlas: require('./assets/pets/moon-owl/atlas.png'), portrait: require('./assets/pets/moon-owl/portrait.png') },
  'ember-drake': { atlas: require('./assets/pets/ember-drake/atlas.png'), portrait: require('./assets/pets/ember-drake/portrait.png') },
};
export function itemPortrait(item) { return BACKGROUNDS[item.id] || AURAS[item.id] || PETS[item.id]?.portrait; }
