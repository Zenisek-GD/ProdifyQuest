import {BOSS,CHARACTER_BASE,DEMO_TASKS,GEAR,GEAR_BY_ID,GEAR_SLOTS,RARITY_MULTIPLIER} from './battleConfig.js';
import {createDemoProfile,restoreProfile} from './wardrobe/wardrobeRules.js';
import {COMPANION_DEFINITIONS} from './wardrobe/companions/companionDefinitions.js';
const companions=Object.fromEntries(COMPANION_DEFINITIONS.map(c=>[c.id,c]));
const newRaid=n=>({id:`demo-raid-${n}`,number:n,hp:BOSS.maxHp,maxHp:BOSS.maxHp,revision:0,contributions:{you:0},results:{},reward:null});
export function createBattleDemo(){return{schemaVersion:1,wardrobe:createDemoProfile(),charges:0,completedTaskIds:[],ownedGearIds:GEAR.filter(g=>g.unlock==='starter').map(g=>g.id),equippedGear:{weapon:'practice-focus',armor:'apprentice-robe',cape:'linen-cape',trinket:'wooden-charm'},raid:newRaid(1)}}
export function getBuild(model){
 const id=model.wardrobe.equipped.companionId,c=companions[id],base=CHARACTER_BASE[id];if(!c||!base)throw new Error('Unknown companion.');
 const gear=GEAR_SLOTS.map(slot=>GEAR_BY_ID[model.equippedGear[slot]]).filter(Boolean);
 const level=model.wardrobe.level,rarityMultiplier=RARITY_MULTIPLIER[c.rarity]||1;
 const attack=Math.floor((base.attack+2*(level-1))*rarityMultiplier)+gear.reduce((s,g)=>s+(g.attack||0),0);
 const critChance=Math.min(.5,base.critChance+gear.reduce((s,g)=>s+(g.critChance||0),0));
 const critMultiplier=Math.min(2.5,1.5+gear.reduce((s,g)=>s+(g.critMultiplier||0),0));
 return{companionId:id,name:c.name,rarity:c.rarity,level,baseAttack:base.attack,rarityMultiplier,attack,critChance,critMultiplier,normalDamage:Math.max(1,Math.floor(attack*100/(100+BOSS.defense))),criticalDamage:Math.max(1,Math.floor(attack*100/(100+BOSS.defense)*critMultiplier))};
}
export function completeDemoTask(model,taskId){
 if(!DEMO_TASKS.some(t=>t.id===taskId))throw new Error('Unknown demo task.');
 const key=`${model.raid.id}:${taskId}`;if(model.completedTaskIds.includes(key))return model;
 if(model.raid.hp===0)throw new Error('Start a new demo event first.');
 return{...model,charges:model.charges+1,completedTaskIds:[...model.completedTaskIds,key]};
}
export function equipGear(model,id){const item=GEAR_BY_ID[id];if(!item||!model.ownedGearIds.includes(id))throw new Error('You must own this item to equip it.');return{...model,equippedGear:{...model.equippedGear,[item.slot]:id}}}
export function buyGear(model,id){const item=GEAR_BY_ID[id];if(!item||item.unlock!=='shop')throw new Error('This item cannot be bought.');if(model.ownedGearIds.includes(id))throw new Error('This item is already in your inventory.');if(model.wardrobe.coins<item.price)throw new Error('Not enough coins.');return{...model,wardrobe:{...model.wardrobe,coins:model.wardrobe.coins-item.price},ownedGearIds:[...model.ownedGearIds,id]}}
function validateRoll(roll){if(!Number.isFinite(roll)||roll<0||roll>=1)throw new Error('Random roll must be in [0,1).')}
function applyHit(model,{attackId,actorId,actorName,companionId,damage,critical,build,chargeCost}){
 const appliedDamage=Math.min(model.raid.hp,damage);
 const result={attackId,raidId:model.raid.id,actorId,actorName,companionId,damage:appliedDamage,rolledDamage:damage,critical,build,beforeHp:model.raid.hp,afterHp:model.raid.hp-appliedDamage,revision:model.raid.revision+1,chargesAfter:model.charges-chargeCost};
 const raid={...model.raid,hp:result.afterHp,revision:result.revision,contributions:{...model.raid.contributions,[actorId]:(model.raid.contributions[actorId]||0)+appliedDamage},results:{...model.raid.results,[attackId]:result}};
 return{model:{...model,charges:result.chargesAfter,raid},result,replayed:false};
}
export function attackBoss(model,{attackId,raidId,roll}){
 if(typeof attackId!=='string'||!attackId.trim())throw new Error('An attack ID is required.');
 if(raidId!==model.raid.id)throw new Error('This boss event has changed.');
 if(Object.prototype.hasOwnProperty.call(model.raid.results,attackId))return{model,result:model.raid.results[attackId],replayed:true};
 if(model.raid.hp<=0)throw new Error('The guild has already defeated this boss.');
 if(model.charges<1)throw new Error('Complete a task to earn an attack charge.');
 validateRoll(roll);const build=getBuild(model),critical=roll<build.critChance;
 return applyHit(model,{attackId,actorId:'you',actorName:'You',companionId:build.companionId,damage:critical?build.criticalDamage:build.normalDamage,critical,build,chargeCost:1});
}
export function simulateGuildHit(model){
 if(model.raid.hp<=0)throw new Error('The boss is already defeated.');
 const index=[1,2].find(i=>!model.raid.results[`ally-${i}`]);if(!index)throw new Error('Both demo guild members have contributed.');
 return applyHit(model,{attackId:`ally-${index}`,actorId:`ally-${index}`,actorName:`Demo ally ${index}`,companionId:index===1?'copper-knight':'storm-runner',damage:60,critical:false,build:null,chargeCost:0});
}
export function claimBossLoot(model,roll){
 if(model.raid.reward)return{model,reward:model.raid.reward,replayed:true};
 if(model.raid.hp>0)throw new Error('Defeat the boss first.');
 if(!(model.raid.contributions.you>0))throw new Error('Contribute at least one attack to earn this demo chest.');
 validateRoll(roll);const pool=GEAR.filter(g=>g.unlock==='boss'),total=pool.reduce((s,g)=>s+g.weight,0);let cursor=0,item=pool[pool.length-1];
 for(const g of pool){cursor+=g.weight/total;if(roll<cursor){item=g;break}}
 const duplicate=model.ownedGearIds.includes(item.id),reward={type:duplicate?'coins':'gear',gearId:item.id,name:item.name,coins:duplicate?item.duplicateCoins:0};
 return{model:{...model,ownedGearIds:duplicate?model.ownedGearIds:[...model.ownedGearIds,item.id],wardrobe:{...model.wardrobe,coins:model.wardrobe.coins+reward.coins},raid:{...model.raid,reward}},reward,replayed:false};
}
export function nextDemoRaid(model){if(model.raid.hp>0)throw new Error('Finish this boss event first.');if(model.raid.contributions.you>0&&!model.raid.reward)throw new Error('Claim your chest before starting another event.');return{...model,raid:newRaid(model.raid.number+1)}}
export function restoreBattleModel(raw){
 if(!raw||raw.schemaVersion!==1)throw new Error('Unsupported saved battle format.');
 const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
 if(!integer(raw.charges)||!Array.isArray(raw.completedTaskIds)||!Array.isArray(raw.ownedGearIds))throw new Error('Invalid player data.');
 const model={...raw,wardrobe:restoreProfile(raw.wardrobe),ownedGearIds:[...new Set(raw.ownedGearIds.filter(id=>GEAR_BY_ID[id]))],completedTaskIds:[...new Set(raw.completedTaskIds.filter(id=>typeof id==='string'))],equippedGear:{}};
 for(const slot of GEAR_SLOTS){const id=raw.equippedGear?.[slot];if(!model.ownedGearIds.includes(id)||GEAR_BY_ID[id]?.slot!==slot)throw new Error('Invalid saved equipment.');model.equippedGear[slot]=id}
 const r=raw.raid;
 if(!r||!integer(r.number,1)||r.id!==`demo-raid-${r.number}`||r.maxHp!==BOSS.maxHp||!integer(r.hp)||r.hp>r.maxHp||!integer(r.revision)||!r.results||typeof r.results!=='object'||!r.contributions||typeof r.contributions!=='object')throw new Error('Invalid boss data.');
 if(Object.values(r.contributions).some(v=>!integer(v))||Object.values(r.contributions).reduce((a,b)=>a+b,0)!==r.maxHp-r.hp)throw new Error('Invalid contribution history.');
 for(const [id,result] of Object.entries(r.results)){if(!result||result.attackId!==id||result.raidId!==r.id||!companions[result.companionId]||!integer(result.damage)||!integer(result.afterHp)||result.afterHp>r.maxHp||!integer(result.revision,1)||result.revision>r.revision)throw new Error('Invalid saved attack history.');}
 if(r.reward&&(!GEAR_BY_ID[r.reward.gearId]||r.hp!==0))throw new Error('Invalid saved reward.');
 return model;
}
