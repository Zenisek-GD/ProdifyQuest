# ProdifyQuest Companion Wardrobe — first customization pack

A React Native starter for mixing backgrounds, animated mini pets and animated auras with your existing companions. Includes all 10 expansion companions plus the Apprentice Mage, so this pack is self-contained.

## What is included

- 3 backgrounds: Sunlit Study, Moon Garden, Sky Sanctuary.
- 3 mini pets: Mint Slime, Moon Owl, Ember Drake. Each has 3 idle frames and 3 happy frames. Celebrate makes both the companion and pet react.
- 3 aura overlays: Leaf Dance, Starfall, Arcane Halo. The Expo player animates a gentle opacity and scale pulse.
- All 11 companion atlases, with idle, study, wave, celebrate and attack.
- Live preview, owned/locked items, coin purchases, equip/reset preview, 3 favorite outfit slots, and persistent demo storage on the device.
- Sample level grants, earned boss chest selection, duplicate compensation, and repeat-claim protection in local demo state.
- `preview.html`: an offline browser preview. Extract the ZIP first, then open this file. Browser saves are separate from Expo saves.
- `preview.gif`: three example animated outfits. This visual montage demonstrates the sprite combinations; it is not a phone recording.

This is the first phase: interchangeable wearable gear and capes are not included. Existing clothing remains baked into the character images. Backgrounds, pets and auras are independent layers and work across the roster.

## Add to your existing Expo project

1. Copy this entire folder into `components/prodifyquest-wardrobe/`. If your app uses `src/app`, put it under `src/components/prodifyquest-wardrobe/` instead. Keep the `assets` and `companions` folders inside it.
2. Run this in your Expo project root:

```bash
npx expo install @react-native-async-storage/async-storage react-native-safe-area-context
```

3. For an App.js project, use:

```jsx
import WardrobeDemo from './components/prodifyquest-wardrobe/WardrobeDemo';
export default WardrobeDemo;
```

For Expo Router, create `app/wardrobe.jsx` or `src/app/wardrobe.jsx`:

```jsx
export { default } from '../components/prodifyquest-wardrobe/WardrobeDemo';
```

Open the `/wardrobe` route using your existing navigation.

4. Start your existing project with `npx expo start`, then open it in an Expo Go version compatible with your project's Expo SDK. No custom native animation module is required.

This is a component pack, not an entire initialized Expo project: run commands from your existing project's root, not from this extracted folder.

## Try the demo

1. Start with Frost Scholar, Sunlit Study and Mint Slime. All 11 companions are available in this demo to test combinations.
2. Select Scenes, Pets or Auras and tap an item. Locked items can be previewed; they cannot be equipped or saved in favorites.
3. Buy a shop item if you have enough coins, then tap **Equip look**. Buying does not automatically equip it.
4. Save the preview into a favorite slot. **Wear** applies that favorite; **Reset preview** restores the currently equipped outfit.
5. Open **Try rewards (demo)**. The next milestone grants level items; opening the demo chest rewards a cosmetic or duplicate coins. A new demo victory makes another test chest available after the current one is claimed.
6. Restart the screen/app to check local persistence. Preview changes are temporary; equipped look, favorites, ownership, coins, levels and claims are saved.

The initial demo balance is 1,600 coins. Demo controls do not connect to your real task system or guild boss. Companion ownership is intentionally unlocked in the demo; replace `ownedCompanionIds` with your actual collection for a real integration.

## Sample cosmetic economy

Edit `items.js` to change names, prices, thresholds and chest weights.

| Item | Slot | Unlock | Duplicate coins |
|---|---|---|---:|
| Sunlit Study | Background | Starter gift | — |
| Moon Garden | Background | 650 coins | — |
| Sky Sanctuary | Background | Level 20 | — |
| Mint Slime | Pet | Starter gift | — |
| Moon Owl | Pet | Level 10 | — |
| Ember Drake | Pet | Boss chest, 35% | 200 |
| Leaf Dance | Aura | 350 coins | — |
| Starfall | Aura | Boss chest, 50% | 100 |
| Arcane Halo | Aura | Boss chest, 15% | 300 |

The cosmetic chest is a separate sample reward pool from the earlier companion chest. Each chest selects exactly one reward from this cosmetic pool. Ownership does not change the odds; duplicates give coins. There is no pity counter. Reaching a higher level grants every missing level item below it. These cosmetic rewards do not increase task XP or boss damage.

## Use the scene on your own screen

```jsx
import React, { useRef } from 'react';
import { Button, View } from 'react-native';
import CompanionScene from './components/prodifyquest-wardrobe/CompanionScene';

export default function FocusScreen() {
  const scene = useRef(null);
  // In your app, use the player's confirmed equipped outfit.
  const outfit = {
    companionId: 'frost-scholar',
    backgroundId: 'moon-garden',
    petId: 'moon-owl',
    auraId: 'arcane-halo',
  };
  return (
    <View>
      <CompanionScene ref={scene} outfit={outfit}
        width={340} restingState="study" active />
      <Button title="Preview task celebration"
        onPress={() => scene.current?.play('celebrate')} />
    </View>
  );
}
```

- Use `restingState="idle"` or `"study"`.
- Ref methods: `play('wave')`, `play('celebrate')`, `play('attack')`, `stop()`.
- `petId` and `auraId` may be `null` to remove those layers. A background is required.
- Pass `active={false}` when the containing screen is hidden. Pass an available width from your layout. The composition scales with it.
- App backgrounding and the system reduced-motion preference pause the animation. The wardrobe also includes a manual Pause button.
- `CompanionScene` is a renderer, so it can show any known asset. Validate ownership before changing your saved equipped outfit.

## Files and integration boundaries

| File | Purpose |
|---|---|
| `WardrobeDemo.jsx` | Safe-area wrapper and local demo storage |
| `WardrobeScreen.jsx` | Preview, purchase, equip and favorites interface |
| `CompanionScene.jsx` | Background, aura, animated companion and mini pet composition |
| `PetSprite.jsx` | Idle loop and happy reaction playback |
| `useLocalWardrobe.js` | Ordered AsyncStorage writes, hydration and save status |
| `wardrobeRules.js` | Pure example ownership, purchase, level, chest and preset rules |
| `items.js` | Editable cosmetic definitions |
| `assetCatalog.js` | Literal asset imports for Metro |
| `companions/` | Existing character renderer, timing and images |
| `GENERATION_PROMPTS.json` | Artwork prompt set; built-in image generation was used |

`WardrobeScreen` accepts `profile` and `onCommit`. In this local starter, `onCommit` accepts a synchronous updater and returns the resulting profile. It is not an asynchronous API adapter. For production, adapt purchase/equip/reward handlers to await server confirmation and then publish the confirmed profile; do not pass an async function into this synchronous demo callback unchanged. Set `demo={false}` in the production screen. Remount with a user-specific key when switching accounts.

Keep actual coins, ownership, levels, task completion and boss eligibility authoritative on your backend. Award boss loot with server randomness and an atomic, unique user/raid claim; apply duplicates and ownership in the same transaction. Atomically validate and deduct shop coins. The included local duplicate check is a demonstration, not distributed claim protection. Store equipped item IDs and up to three presets per player on your backend; AsyncStorage can cache cosmetic preferences.

Demo storage keys:

- Expo: `prodifyquest:wardrobe-demo:v1`
- Browser: `prodifyquest-wardrobe-browser-v1`

These contain non-sensitive demo data. The Expo loader reports corrupt/unavailable storage and offers retry or an explicit new-demo reset. Save failures are shown with a retry action.

## Art and animation format

- Backgrounds: 960 × 720 PNG.
- Auras: 384 × 384 transparent PNG, animated with React Native `Animated` scale and opacity.
- Mini pets: 384 × 256 transparent PNG atlas; 3 columns × 2 rows; 128 × 128 frame. Row 0 idle (1000, 220, 680 ms), row 1 happy (160, 200, 320 ms). The runtime plays happy once then returns to idle. Exported pet GIFs loop for preview.
- Companions: 2208 × 1280 transparent PNG atlas; 6 columns × 5 rows; 368 × 256 frames. The original five actions and timings are retained.
- Runtime uses PNG atlases, not GIF playback, to keep frame selection consistent.
- No character clothing was removed or altered. A later wearable system needs matching cape/gear layers and compatibility rules for each body and pose.

## Checks performed and remaining

Completed: JavaScript/JSX parsing, asset path and image metadata checks, visual inspection of composed outfits, pure-rule checks for ownership/equipping/purchases/level grants/chest boundaries/duplicate rewards/claim replay/presets/hydration, and offline preview script/interaction checks using a DOM test harness.

Not performed: React Native rendering on an emulator or physical device, an actual browser rendering test, or integration into your existing repository/backend. Run on your target phones to check layout, image memory, animation performance and storage persistence. Keep only the companions you need in a release bundle if size becomes a concern.

Official references:

- https://docs.expo.dev/develop/user-interface/assets/
- https://docs.expo.dev/versions/latest/sdk/async-storage/
- https://docs.expo.dev/versions/latest/sdk/safe-area-context/
- https://reactnative.dev/docs/animated
