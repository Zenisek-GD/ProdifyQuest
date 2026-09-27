import { COMPANION_DEFINITIONS } from './companionDefinitions';

// Literal require paths are required by Metro. Only mounted atlas images decode.
const ASSETS = {
  'apprentice-mage': { source: require('./assets/apprentice-mage/atlas.png'), portrait: require('./assets/apprentice-mage/portrait.png') },
  'sprout-ranger': { source: require('./assets/sprout-ranger/atlas.png'), portrait: require('./assets/sprout-ranger/portrait.png') },
  'copper-knight': { source: require('./assets/copper-knight/atlas.png'), portrait: require('./assets/copper-knight/portrait.png') },
  'sun-cleric': { source: require('./assets/sun-cleric/atlas.png'), portrait: require('./assets/sun-cleric/portrait.png') },
  'frost-scholar': { source: require('./assets/frost-scholar/atlas.png'), portrait: require('./assets/frost-scholar/portrait.png') },
  'storm-runner': { source: require('./assets/storm-runner/atlas.png'), portrait: require('./assets/storm-runner/portrait.png') },
  'moon-bard': { source: require('./assets/moon-bard/atlas.png'), portrait: require('./assets/moon-bard/portrait.png') },
  'clockwork-scribe': { source: require('./assets/clockwork-scribe/atlas.png'), portrait: require('./assets/clockwork-scribe/portrait.png') },
  'prism-fox': { source: require('./assets/prism-fox/atlas.png'), portrait: require('./assets/prism-fox/portrait.png') },
  'ember-dragonling': { source: require('./assets/ember-dragonling/atlas.png'), portrait: require('./assets/ember-dragonling/portrait.png') },
  'astral-guardian': { source: require('./assets/astral-guardian/atlas.png'), portrait: require('./assets/astral-guardian/portrait.png') }
};
export const COMPANIONS = COMPANION_DEFINITIONS.map(item => ({ ...item, ...ASSETS[item.id] }));
export const COMPANIONS_BY_ID = Object.fromEntries(COMPANIONS.map(item => [item.id, item]));
