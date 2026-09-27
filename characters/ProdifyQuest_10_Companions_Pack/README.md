# ProdifyQuest: 10 animated companions

Ten new companions, each with idle, wave, study, celebrate and attack animations. Includes 300 transparent poses in PNG atlases, 50 animated GIFs, 50 animated WebPs, shop portraits, and a React Native starter. The Apprentice Mage is included as a bonus starter character.

## Try in Expo Go

1. Copy this entire folder into your existing Expo project as `components/prodifyquest-companions`. Keep its assets and JavaScript files together.
2. For an App.js project, replace your demo screen with:

```jsx
import CompanionGalleryScreen from './components/prodifyquest-companions/CompanionGalleryScreen';
export default CompanionGalleryScreen;
```

For Expo Router, create `app/companions.jsx` (or `src/app/companions.jsx`) and re-export the gallery with the correct relative path to the copied folder. Navigate to `/companions`.

3. Run `npx expo start` in your existing project and open it in Expo Go.

The component uses React and React Native core APIs and local PNG assets; it needs no additional native animation package. Use an Expo SDK supported by your installed Expo Go. This pack was not run on a phone: verify rendering and performance on your target devices before release.

## Add a companion to a screen

```jsx
import React, { useRef } from 'react';
import { Button, View } from 'react-native';
import Companion from './components/prodifyquest-companions/Companion';

export default function FocusCompanion() {
  const companion = useRef(null);
  return (
    <View>
      <Companion ref={companion} companionId="frost-scholar"
        width={300} restingState="study" active={true} />
      <Button title="Task completed"
        onPress={() => companion.current?.play('celebrate')} />
    </View>
  );
}
```

Use `idle` or `study` as the resting state. Call `play('wave')`, `play('celebrate')`, or `play('attack')` for a one-shot action. Pass `active={false}` while the screen is hidden. Background pause and the system reduced-motion preference are handled by the component. `cast` remains an alias for `attack` for older Mage integrations.

## Editable unlock settings

These are sample balancing values, editable in `companionDefinitions.js`.

| Companion | Rarity | Unlock |
|---|---|---|
| Sprout Ranger | Common | Shop: 400 coins |
| Copper Knight | Common | Shop: 600 coins |
| Sun Cleric | Uncommon | Shop: 900 coins |
| Frost Scholar | Rare | Level 10 |
| Storm Runner | Rare | Level 20 |
| Moon Bard | Epic | Level 30 |
| Clockwork Scribe | Epic | Level 40 |
| Prism Fox | Rare | Boss chest: 60% |
| Ember Dragonling | Epic | Boss chest: 30% |
| Astral Guardian | Legendary | Boss chest: 10% |

Level companions are granted automatically by the sample helper when the threshold is reached, including skipped milestones. They are not additional coin purchases. Each earned boss chest selects one character. A duplicate gives 100 coins for Prism Fox, 250 for Ember Dragonling, or 500 for Astral Guardian. Odds stay the same after ownership; there is no pity mechanic in this starter.

## Connect your real progression

`rewardRules.js` provides pure example rules; `CompanionGalleryScreen.jsx` demonstrates buying, equipping, level grants, and chest claims using temporary local state. Restarting the screen resets the demo. The demo victory button simulates an already-defeated boss; it does not implement a shared guild boss or verify task completion.

For your real app, have the backend validate completed tasks and apply guild boss damage. After defeat, determine eligible members and record one reward claim per member per raid. Generate the random reward on the server and atomically save the claim, ownership, and duplicate compensation. A unique member/raid claim prevents repeated requests from awarding twice. Apply shop coin deductions and level grants atomically too. Do not trust a client-supplied victory, level, balance, eligibility flag or random value.

Use the confirmed task result to play `attack`, the confirmed level unlock to play `celebrate`, and the selected reward ID to reveal its companion. Chest-opening artwork and a networked boss battle are not included.

## Preview and asset details

Extract the ZIP and open `preview.html` for an offline animation browser, or view `preview.gif` for the full roster. Animated previews repeat every action; the React Native player plays one-shot actions once and returns to idle/study.

Each atlas is 2208 × 1280 pixels: 6 columns × 5 rows of 368 × 256 frames. Rows are idle, wave, study, celebrate, attack. Foot anchor is (136, 228). Per-frame timings are in each `animation-manifest.json`. PNG atlases are the runtime assets; GIF/WebP files are previews and optional exports. Artwork is stylized raster pixel art, not editable vector or skeletal animation.

Validation completed: visual frame/alignment inspection, pure progression/claim rule checks, animation queue checks and asset metadata checks. No device runtime test or integration with your existing repository was performed.
