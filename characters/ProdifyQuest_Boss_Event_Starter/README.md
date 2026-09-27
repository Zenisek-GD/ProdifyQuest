# ProdifyQuest — boss event, character builds and inventory

A React Native/Expo starter that turns completed tasks into attacks against a shared guild boss. Includes Dreadroot Sentinel artwork and four animated states, a battle arena, character builds, equipment inventory, the previous wardrobe, and a playable offline preview.

This is a local prototype. It has no connection to your actual task records, guild members or backend. The companion/wardrobe packs previously delivered remain separate files.

## Try it immediately

Extract the ZIP and open `preview.html`. Complete a sample task to earn a charge, then press **Attack boss**. Explore **Inventory & build** to buy and equip items, change the companion and compare damage. Two simulated guild allies can contribute. Defeat the boss and claim an equipment chest.

`preview.gif` shows the animation sequence; it is a rendered asset preview, not a phone recording. Individual boss GIFs are under `assets/boss`.

## Install into your Expo project

1. Copy this entire folder to `components/prodifyquest-boss/`, or `src/components/prodifyquest-boss/` when using `src/app`.
2. Keep the included `wardrobe`, `assets`, and JavaScript files together. This pack already contains all 11 existing companions.
3. From your existing project's root, run:

```bash
npx expo install @react-native-async-storage/async-storage react-native-safe-area-context
```

4. In an App.js project:

```jsx
import BossEventDemo from './components/prodifyquest-boss/BossEventDemo';
export default BossEventDemo;
```

For Expo Router, create `app/boss.jsx` or `src/app/boss.jsx`:

```jsx
export { default } from '../components/prodifyquest-boss/BossEventDemo';
```

Navigate to `/boss` through your existing router.

5. Run `npx expo start` and open the project in a compatible Expo Go version.

This is a component pack, not a fully initialized Expo project. It uses React Native core image/animation APIs and the two Expo-supported packages above. No custom native animation engine is required.

## What the player can do

- Complete sample tasks to gain attack charges. One task occurrence earns one charge; repeated completion of the same sample task does not award again.
- Equip a companion and one weapon, armor, cape and trinket.
- See attack, critical chance, critical multiplier and estimated damage against this boss.
- Spend one charge to attack. The hero appears on the left platform, plays its existing attack animation, launches an energy projectile, and the boss reacts with a hit animation and floating damage number.
- Watch shared boss HP and each member's contribution. Demo allies are explicitly labeled simulations.
- See Dreadroot's powered-up idle at 40% HP or below, then defeat when HP reaches zero.
- Claim one equipment chest after a victory if the player contributed damage. New items enter inventory; duplicates give coins.
- Open the included Wardrobe tab to change backgrounds, pets and auras and save favorite cosmetic looks.
- Keep demo progression on the same device through AsyncStorage. Browser preview saves separately.

The powered-up state is visual only in this version: it does not change defense, damage or rewards. There is no boss retaliation, so player HP and defense stats are intentionally absent. All characters are unlocked for demo comparisons; real ownership must come from your backend.

## Character build rules

The demo uses the player's shared level for the active companion. Base attack and base critical chance differ slightly by companion in `battleConfig.js`.

| Companion rarity | Base attack multiplier |
|---|---:|
| Common | 1.00 |
| Uncommon | 1.05 |
| Rare | 1.10 |
| Epic | 1.15 |
| Legendary | 1.20 |

```text
characterAttack = floor((baseAttack + 2 × (level − 1)) × rarityMultiplier)
attack = characterAttack + equipped gear attack bonuses
critChance = min(50%, baseCritChance + gear critical chance bonuses)
critMultiplier = min(2.50, 1.50 + gear critical multiplier bonuses)
normalDamage = max(1, floor(attack × 100 / (100 + bossDefense)))
criticalDamage = max(1, floor(attack × 100 / (100 + bossDefense) × critMultiplier))
appliedDamage = min(remainingBossHP, rolledDamage)
```

Example: Level 1 Frost Scholar with the starter gear has 34 ATK, 13% critical chance and ×1.50 critical damage. Against Dreadroot's 20 defense, that gives **28 normal damage or 42 critical damage**. An attack consumes one charge in either case.

Equipment bonuses are explicit values; item rarity describes the item tier and is not multiplied a second time. The coin prices, stats, boss HP and rarity bonuses are proposed starting values for playtesting, not proven economy balance. Scale real guild boss HP to the event duration and expected participation.

## Inventory and equipment

Inventory tracks ownership separately from equipped slots. Buying an item adds it to inventory; equipping selects one owned item for its slot. Characters in this prototype share the same equipment inventory and slot setup.

| Item | Slot | Bonus | Acquisition |
|---|---|---|---|
| Practice Focus | Weapon | +5 ATK | Starter |
| Focus Staff | Weapon | +10 ATK | 180 coins |
| Storm Sigil | Weapon | +6 ATK, +6 percentage points crit | 250 coins |
| Sunbrand Focus | Weapon | +14 ATK | Boss chest 40% |
| Apprentice Robe | Armor | +4 ATK | Starter |
| Scholar Vest | Armor | +3 ATK, +5 percentage points crit | 140 coins |
| Warden Plate | Armor | +12 ATK | Boss chest 30% |
| Linen Cape | Cape | +2 percentage points crit | Starter |
| Nightweave Cape | Cape | +8 percentage points crit | 200 coins |
| Vanguard Cape | Cape | +6 ATK, +4 percentage points crit | Boss chest 20% |
| Wooden Charm | Trinket | +3 percentage points crit | Starter |
| Scholar Lens | Trinket | +0.15 critical multiplier | 160 coins |
| Sentinel Core | Trinket | +2 percentage points crit, +0.30 critical multiplier | Boss chest 10% |

There are 13 equipment items across four slots. Equipment changes combat stats. **Swappable wearable artwork is not implemented:** the existing character outfits, weapons and capes remain baked into their sprites. The separate wardrobe backgrounds/pets/auras retain cosmetic behavior and do not add combat power. Boss arena scenery replaces the personal background during this event, and mini pets/auras are not displayed in the arena yet.

The example inventory keeps one copy of each unique gear item. Duplicate boss drops convert to coins: Sunbrand 100, Warden Plate 100, Vanguard Cape 120, Sentinel Core 200. This equipment chest is a separate pool from the earlier cosmetic and companion chest demos. There is no pity mechanic, item upgrading, trading, selling or consumable stacking in this prototype.

## Animation and state flow

1. The player presses Attack. The app requests one attack for a specific raid and unique attack ID.
2. The rules validate the raid and available charge, calculate the build and critical roll, spend one charge, apply damage and save the result together.
3. `BattleArena` receives that already-confirmed result. It waits for the hero image to load, then begins the presentation.
4. The hero enters over roughly 230 ms and starts its attack at 260 ms. A projectile travels at 700–920 ms. At 920 ms, the hit/defeat animation, damage label and displayed HP update occur together.
5. The animation finishes around 2.7 seconds. Attacks and build/tab changes stay disabled while it plays.

Animation callbacks do not award or apply damage. If the app backgrounds or reduced motion is enabled, the presentation settles to the confirmed result. If the hero image fails to load, the result is still retained. The backend result must remain valid even if the app closes before the animation finishes.

In the demo, the confirmed result comes from local pure functions. A real backend adapter must return the same information before calling `arenaRef.current.play(result)`. Client animation timing should never decide whether damage was earned.

## Connect a real guild backend

Use server-owned state for task completion, charges, coin balances, owned equipment, equipped items, player level, boss HP and reward claims. The included AsyncStorage data and `Math.random()` are for the local demo only.

Suggested operations:

| Operation | Input from client | Server work |
|---|---|---|
| Complete task | Actual task occurrence ID | Validate completion and eligibility, award charge once |
| Equip item | Owned item ID and slot | Validate ownership/compatibility and save loadout |
| Buy item | Item ID | Validate price and funds; atomically deduct and grant |
| Attack raid | Raid ID, unique attack ID | Validate membership/event/charge, snapshot build, roll crit, update charge and HP atomically |
| Claim reward | Raid ID | Require victory and contribution; choose loot once and atomically grant ownership/duplicate coins |

For simultaneous guild attacks, lock or conditionally update the raid record in a transaction; clamp applied damage to remaining HP and prevent HP from going below zero. Store a unique `(raid_id, user_id, attack_id)` attack record and return the original result on retry. Store a unique `(raid_id, user_id)` reward claim. If another member has already defeated the boss, reject a new attack without spending a charge. Generate crit and loot rolls on the server.

Broadcast or poll the updated raid revision/HP and contributions so every member sees the same state. Reject stale event IDs and ignore out-of-order older revisions in the client. Each eligible member should receive a reward claim; the final hit should not be required to earn one.

A completed task occurrence must have a real unique completion ID. Do not trust the local demo task button, a client-provided damage amount, a rarity label, equipment stats, a random roll or a simulated ally. Repeatedly editing or splitting a task should not generate extra charges. Define the validation and daily earning rules for your own productivity workflow.

No server, database migration, WebSocket transport or live guild synchronization is implemented in this pack.

## Key files

- `BossEventDemo.jsx`: tabs, task demo, battle controls, stats, inventory and equipment purchase/equip controls.
- `BattleArena.jsx`: result-driven hero entrance, projectile, damage number and health presentation.
- `BossSprite.jsx`: four boss animation states.
- `battleConfig.js`: character stats, rarity multipliers, gear, demo tasks and boss balance.
- `battleRules.js`: pure example state changes.
- `battleRules.test.mjs`: meaningful rule tests; run `node battleRules.test.mjs` in this folder using a recent Node version.
- `useBattleStore.js`: persistent local demo data and ordered saves.
- `wardrobe/`: the previous wardrobe assets and components. The copied companion component adds an `onReady` callback for battle image loading.
- `assets/boss/manifest.json`: frame dimensions, rows and timing.
- `GENERATION_PROMPTS.json`: boss/arena prompt set, generated with the built-in image tool.

Local save keys are `prodifyquest:boss-demo:v1` in Expo and `prodifyquest:boss-browser:v1` in the browser. Previous wardrobe demo saves are not automatically migrated. An unsupported/corrupt Expo save offers retry or an explicit new-demo reset.

## Verification and limits

Checked: all JavaScript/JSX syntax and imports, sprite metadata, visual battle composition, task repeat protection, charge spending, rarity/gear damage calculations, attack replay, stale raids, critical boundaries, overkill, purchases/equipping, loot boundaries/duplicates/eligibility, full defeat-to-inventory flow and save roundtrip. Offline interaction logic was exercised with a DOM test harness.

Not tested: native rendering on a phone/emulator or actual browser rendering. No existing repository was edited and no production backend was connected. Test the demo on your target Expo Go device for rendering, safe-area layout, animation timing, image memory, and local save behavior.

References for implementation choices:

- https://reactnative.dev/docs/animated
- https://docs.expo.dev/versions/latest/sdk/async-storage/
- https://docs.expo.dev/versions/latest/sdk/safe-area-context/
- https://docs.unity.com/en-us/cloud-code/server-authority (general server-authority principle; this starter does not use Unity)
