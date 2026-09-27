import type { ImageSourcePropType } from 'react-native';

export type CollectedCompanion = { id: string; name: string; source: ImageSourcePropType };

// Metro discovers each local atlas through a literal require. Preview GIFs and
// WebPs are deliberately excluded from the runtime bundle.
export const COLLECTED_COMPANIONS: Record<string, CollectedCompanion> = {
  'sprout-ranger': { id: 'sprout-ranger', name: 'Sprout Ranger', source: require('./assets/sprout-ranger.png') },
  'copper-knight': { id: 'copper-knight', name: 'Copper Knight', source: require('./assets/copper-knight.png') },
  'sun-cleric': { id: 'sun-cleric', name: 'Sun Cleric', source: require('./assets/sun-cleric.png') },
  'frost-scholar': { id: 'frost-scholar', name: 'Frost Scholar', source: require('./assets/frost-scholar.png') },
  'storm-runner': { id: 'storm-runner', name: 'Storm Runner', source: require('./assets/storm-runner.png') },
  'moon-bard': { id: 'moon-bard', name: 'Moon Bard', source: require('./assets/moon-bard.png') },
  'clockwork-scribe': { id: 'clockwork-scribe', name: 'Clockwork Scribe', source: require('./assets/clockwork-scribe.png') },
  'prism-fox': { id: 'prism-fox', name: 'Prism Fox', source: require('./assets/prism-fox.png') },
  'ember-dragonling': { id: 'ember-dragonling', name: 'Ember Dragonling', source: require('./assets/ember-dragonling.png') },
  'astral-guardian': { id: 'astral-guardian', name: 'Astral Guardian', source: require('./assets/astral-guardian.png') },
};
