import assert from 'node:assert/strict';
import {DEMO_TASKS,GEAR,GEAR_BY_ID} from './battleConfig.js';
import * as b from './battleRules.js';
const p=b.createBattleDemo(),snapshot=JSON.stringify(p);
assert.throws(()=>b.attackBoss(p,{raidId:p.raid.id,attackId:'a',roll:0}),/charge/);
let charged=b.completeDemoTask(p,DEMO_TASKS[0].id);assert.equal(charged.charges,1);assert.equal(b.completeDemoTask(charged,DEMO_TASKS[0].id).charges,1);
let hit=b.attackBoss(charged,{raidId:p.raid.id,attackId:'a',roll:0});assert(hit.result.critical);assert.equal(hit.model.charges,0);assert.equal(hit.model.raid.hp,p.raid.hp-hit.result.damage);
const replay=b.attackBoss(hit.model,{raidId:p.raid.id,attackId:'a',roll:.999});assert.equal(replay.model,hit.model);assert.equal(replay.result,hit.result);assert(replay.replayed);
assert.throws(()=>b.attackBoss(charged,{raidId:'old',attackId:'b',roll:0}),/changed/);
assert.throws(()=>b.attackBoss(charged,{raidId:p.raid.id,attackId:'b',roll:1}));
assert.deepEqual([b.getBuild(p).attack,b.getBuild(p).normalDamage,b.getBuild(p).criticalDamage],[34,28,42]);assert.equal(b.attackBoss(charged,{raidId:p.raid.id,attackId:'boundary',roll:b.getBuild(p).critChance}).result.critical,false);
const bought=b.buyGear(p,'focus-staff');assert.equal(bought.wardrobe.coins,p.wardrobe.coins-180);const equipped=b.equipGear(bought,'focus-staff');assert.equal(b.getBuild(equipped).attack,b.getBuild(p).attack+5);assert.throws(()=>b.equipGear(p,'sentinel-core'),/own/);assert.throws(()=>b.buyGear(bought,'focus-staff'),/already/);assert.throws(()=>b.buyGear({...p,wardrobe:{...p.wardrobe,coins:0}},'focus-staff'),/coins/);
let near={...charged,raid:{...charged.raid,hp:3,contributions:{you:247}}};let last=b.attackBoss(near,{raidId:p.raid.id,attackId:'last',roll:0});assert.equal(last.result.damage,3);assert.equal(last.model.raid.hp,0);assert.equal(last.model.raid.contributions.you,250);assert.throws(()=>b.attackBoss(last.model,{raidId:p.raid.id,attackId:'after',roll:0}),/defeated/);
for(const[roll,id]of[[0,'sunbrand'],[.39999,'sunbrand'],[.4,'warden-plate'],[.69999,'warden-plate'],[.7,'vanguard-cape'],[.89999,'vanguard-cape'],[.9,'sentinel-core'],[.9999,'sentinel-core']]){const x=b.claimBossLoot(last.model,roll);assert.equal(x.reward.gearId,id)}
const loot=b.claimBossLoot(last.model,0);assert(loot.model.ownedGearIds.includes('sunbrand'));assert.equal(b.claimBossLoot(loot.model,.99).model,loot.model);assert.throws(()=>b.claimBossLoot(p,0),/Defeat/);assert.throws(()=>b.claimBossLoot({...p,raid:{...p.raid,hp:0,contributions:{you:0,'ally-1':250}}},0),/Contribute/);
const duplicate=b.claimBossLoot({...last.model,ownedGearIds:[...last.model.ownedGearIds,'sunbrand']},0);assert.equal(duplicate.reward.type,'coins');assert.equal(duplicate.model.wardrobe.coins,last.model.wardrobe.coins+100);
assert.throws(()=>b.nextDemoRaid(last.model),/Claim/);assert.equal(b.nextDemoRaid(loot.model).raid.number,2);
let scenario=b.createBattleDemo();for(const t of DEMO_TASKS)scenario=b.completeDemoTask(scenario,t.id);scenario=b.simulateGuildHit(scenario).model;scenario=b.simulateGuildHit(scenario).model;assert.throws(()=>b.simulateGuildHit(scenario),/Both/);for(let i=0;scenario.raid.hp>0&&i<6;i++)scenario=b.attackBoss(scenario,{raidId:scenario.raid.id,attackId:'scenario-'+i,roll:.99}).model;assert.equal(scenario.raid.hp,0);scenario=b.claimBossLoot(scenario,.99).model;assert.deepEqual(b.restoreBattleModel(JSON.parse(JSON.stringify(scenario))),scenario);
assert.equal(JSON.stringify(p),snapshot);console.log('PASS: task claims, damage and crits, attack replay, stale raid, purchases/equips, overkill cap, loot odds and duplicates, contribution eligibility, full boss defeat and save hydration.');
