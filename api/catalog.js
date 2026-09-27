import { COMPANION_DEFINITIONS } from '../characters/ProdifyQuest_10_Companions_Pack/companionDefinitions.js';

const tiers = [
  ['common', 30, [
    ['apprenticemage', 'Apprentice Mage'], ['basicarcher', 'Basic Archer'], ['DesertWanderer', 'Desert Wanderer'],
    ['minerdwarf', 'Miner Dwarf'], ['rookieswordsman', 'Rookie Swordsman'], ['streetthief', 'Street Thief'],
    ['town-guard', 'Town Guard'], ['VillageFarmer', 'Village Farmer'],
  ]],
  ['uncommon', 60, [
    ['herbaldruid', 'Herbal Druid'], ['Desertnomad', 'Desert Nomad'], ['forestranger', 'Forest Ranger'],
    ['scoutrogue', 'Scout Rogue'], ['tundrahunter', 'Tundra Hunter'],
  ]],
  ['rare', 120, [['knightprotector', 'Knight Protector'], ['mechanizedsoldier', 'Mechanized Soldier'], ['stormsorcerer', 'Storm Sorcerer']]],
  ['epic', 240, [['arcanesamurai', 'Arcane Samurai'], ['battlewitch', 'Battle Witch'], ['shadowassasin', 'Shadow Assassin']]],
  ['legendary', 500, [['Goldenlionknight', 'Golden Lion Knight'], ['CelestialAngel', 'Celestial Angel'], ['dragonslayer', 'Dragon Slayer'], ['sunpalladin', 'Sun Paladin']]],
];

export const CARD_CATALOG = [
  ...tiers.flatMap(([tier, price, entries]) => entries.map(([characterName, name]) => ({
    id: characterName.toLowerCase(), characterName, name, tier, price,
    unlock: { type: 'shop', coins: price }, questBoxEligible: true,
    imagePath: `/characters/common/${characterName}.png`,
  }))),
  ...COMPANION_DEFINITIONS.filter(item => item.unlock.type !== 'starter').map(item => ({
    id: item.id, characterName: item.id, name: item.name, tier: item.rarity.toLowerCase(),
    price: item.unlock.type === 'shop' ? item.unlock.coins : 0, unlock: { ...item.unlock },
    animated: true, questBoxEligible: false,
    imagePath: `/characters/ProdifyQuest_10_Companions_Pack/assets/${item.id}/portrait.png`,
  })),
];

export const BOSS_CHEST_COMPANIONS = CARD_CATALOG.filter(card => card.unlock.type === 'boss_chest').map(card => ({
  id: card.id, name: card.name, tier: card.tier, imagePath: card.imagePath,
  weight: card.unlock.weight, duplicateCoins: card.unlock.duplicateCoins,
}));
