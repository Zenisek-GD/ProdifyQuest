// Example balance values. Adjust after playtesting your task economy.
export const BOSS = { id: 'dreadroot', name: 'Dreadroot Sentinel', maxHp: 250, defense: 20, enrageAt: 0.4 };
export const RARITY_MULTIPLIER = { Common: 1, Uncommon: 1.05, Rare: 1.10, Epic: 1.15, Legendary: 1.20 };
export const CHARACTER_BASE = {
 'apprentice-mage': { attack: 22, critChance: .06 }, 'sprout-ranger': { attack: 21, critChance: .10 },
 'copper-knight': { attack: 24, critChance: .04 }, 'sun-cleric': { attack: 22, critChance: .07 },
 'frost-scholar': { attack: 23, critChance: .08 }, 'storm-runner': { attack: 22, critChance: .12 },
 'moon-bard': { attack: 22, critChance: .10 }, 'clockwork-scribe': { attack: 24, critChance: .06 },
 'prism-fox': { attack: 21, critChance: .12 }, 'ember-dragonling': { attack: 24, critChance: .07 },
 'astral-guardian': { attack: 24, critChance: .08 },
};
export const GEAR = [
 {id:'practice-focus',name:'Practice Focus',slot:'weapon',rarity:'Common',attack:5,unlock:'starter'},
 {id:'focus-staff',name:'Focus Staff',slot:'weapon',rarity:'Rare',attack:10,unlock:'shop',price:180},
 {id:'storm-sigil',name:'Storm Sigil',slot:'weapon',rarity:'Rare',attack:6,critChance:.06,unlock:'shop',price:250},
 {id:'sunbrand',name:'Sunbrand Focus',slot:'weapon',rarity:'Epic',attack:14,unlock:'boss',weight:40,duplicateCoins:100},
 {id:'apprentice-robe',name:'Apprentice Robe',slot:'armor',rarity:'Common',attack:4,unlock:'starter'},
 {id:'scholar-vest',name:'Scholar Vest',slot:'armor',rarity:'Uncommon',attack:3,critChance:.05,unlock:'shop',price:140},
 {id:'warden-plate',name:'Warden Plate',slot:'armor',rarity:'Epic',attack:12,unlock:'boss',weight:30,duplicateCoins:100},
 {id:'linen-cape',name:'Linen Cape',slot:'cape',rarity:'Common',critChance:.02,unlock:'starter'},
 {id:'nightweave',name:'Nightweave Cape',slot:'cape',rarity:'Rare',critChance:.08,unlock:'shop',price:200},
 {id:'vanguard-cape',name:'Vanguard Cape',slot:'cape',rarity:'Epic',attack:6,critChance:.04,unlock:'boss',weight:20,duplicateCoins:120},
 {id:'wooden-charm',name:'Wooden Charm',slot:'trinket',rarity:'Common',critChance:.03,unlock:'starter'},
 {id:'scholar-lens',name:'Scholar Lens',slot:'trinket',rarity:'Rare',critMultiplier:.15,unlock:'shop',price:160},
 {id:'sentinel-core',name:'Sentinel Core',slot:'trinket',rarity:'Legendary',critChance:.02,critMultiplier:.30,unlock:'boss',weight:10,duplicateCoins:200},
];
export const GEAR_BY_ID=Object.fromEntries(GEAR.map(i=>[i.id,i]));
export const GEAR_SLOTS=['weapon','armor','cape','trinket'];
export const DEMO_TASKS=[
 {id:'priorities',title:'Plan today’s three priorities'}, {id:'focus',title:'Finish one focus session'},
 {id:'assignment',title:'Complete an assignment step'}, {id:'review',title:'Review your study notes'},
 {id:'organize',title:'Organize tomorrow’s materials'}, {id:'reflection',title:'Write a short daily reflection'},
];
export function gearSummary(item){return [item.attack?`+${item.attack} ATK`:null,item.critChance?`+${Math.round(item.critChance*100)}% crit`:null,item.critMultiplier?`+${Math.round(item.critMultiplier*100)}% crit damage`:null].filter(Boolean).join(' · ')}
