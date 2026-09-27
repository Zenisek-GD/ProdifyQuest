import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Companion from './wardrobe/companions/Companion';
import { COMPANIONS_BY_ID } from './wardrobe/companions/catalog';
import useMotionEnabled from './wardrobe/useMotionEnabled';
import BossSprite from './BossSprite';
import { BOSS } from './battleConfig';

// The animation displays an already-confirmed result. It never calculates damage.
const BattleArena=forwardRef(function BattleArena({raid,width=360,onBusyChange,onImpact},ref){
 const enabled=useMotionEnabled(true),enabledRef=useRef(enabled);enabledRef.current=enabled;
 const [shownHp,setShownHp]=useState(raid.hp),[hero,setHero]=useState(null),[bossAction,setBossAction]=useState(raid.hp===0?'defeat':'idle'),[eventKey,setEventKey]=useState(0),[damage,setDamage]=useState(null);
 const heroRef=useRef(null),timers=useRef([]),busy=useRef(false),pending=useRef(null),started=useRef(false),impacted=useRef(false),currentRaid=useRef(raid);
 const busyCallback=useRef(onBusyChange),impactCallback=useRef(onImpact);busyCallback.current=onBusyChange;impactCallback.current=onImpact;currentRaid.current=raid;
 const heroOpacity=useRef(new Animated.Value(0)).current,heroX=useRef(new Animated.Value(-20)).current,projectile=useRef(new Animated.Value(0)).current,projectileOpacity=useRef(new Animated.Value(0)).current,floatY=useRef(new Animated.Value(0)).current;
 const clearTimers=()=>{timers.current.forEach(clearTimeout);timers.current=[]};
 const later=(fn,ms)=>{timers.current.push(setTimeout(fn,ms))};
 function restAction(hp){return hp===0?'defeat':hp/BOSS.maxHp<=BOSS.enrageAt?'enraged':'idle'}
 function publishImpact(result){if(!impacted.current){impacted.current=true;impactCallback.current?.(result)}}
 function settle(){
  clearTimers();const result=pending.current;
  heroOpacity.stopAnimation();heroX.stopAnimation();projectile.stopAnimation();projectileOpacity.setValue(0);floatY.stopAnimation();
  if(result){setShownHp(result.afterHp);setBossAction(restAction(result.afterHp));publishImpact(result)}
  setHero(null);setDamage(null);pending.current=null;started.current=false;busy.current=false;busyCallback.current?.(false);
 }
 useEffect(()=>{if(!busy.current){setShownHp(raid.hp);setBossAction(restAction(raid.hp))}},[raid.hp,raid.id]);
 useEffect(()=>{if(!enabled&&busy.current)settle()},[enabled]);
 useEffect(()=>()=>{clearTimers();heroOpacity.stopAnimation();heroX.stopAnimation();projectile.stopAnimation();floatY.stopAnimation();busyCallback.current?.(false)},[]);
 function beginPresentation(){
  const result=pending.current;
  if(!result||started.current||!enabledRef.current)return;
  started.current=true;clearTimers();
  Animated.parallel([Animated.timing(heroOpacity,{toValue:1,duration:230,useNativeDriver:true}),Animated.timing(heroX,{toValue:0,duration:230,useNativeDriver:true})]).start();
  later(()=>heroRef.current?.play('attack'),260);
  later(()=>{projectileOpacity.setValue(1);Animated.timing(projectile,{toValue:1,duration:220,easing:Easing.linear,useNativeDriver:true}).start()},700);
  later(()=>{
   projectileOpacity.setValue(0);setShownHp(result.afterHp);setBossAction(result.afterHp===0?'defeat':'hit');setDamage(result);floatY.setValue(0);Animated.timing(floatY,{toValue:-27,duration:650,useNativeDriver:true}).start();publishImpact(result);
  },920);
  later(()=>{if(result.afterHp>0)setBossAction(restAction(result.afterHp));setDamage(null)},1700);
  later(()=>Animated.timing(heroOpacity,{toValue:0,duration:220,useNativeDriver:true}).start(),2450);
  later(settle,2700);
 }
 useImperativeHandle(ref,()=>({play(result){
  if(busy.current)throw new Error('Wait for this attack to finish.');
  busy.current=true;pending.current=result;impacted.current=false;busyCallback.current?.(true);setShownHp(result.beforeHp);setEventKey(k=>k+1);
  if(!enabledRef.current){setShownHp(result.afterHp);setBossAction(restAction(result.afterHp));publishImpact(result);settle();return}
  setHero(result.companionId);setDamage(null);heroOpacity.setValue(0);heroX.setValue(-20);projectile.setValue(0);projectileOpacity.setValue(0);
  later(settle,8000); // Keep the confirmed result even if the local image fails to load.

 }}),[]);
 const w=width,h=w*.75,heroWidth=w*.66,heroScale=heroWidth/368,bossSize=w*.43,footY=h*.70;
 return <View>
  <View style={s.hpRow}><Text style={s.hpName}>{shownHp===0?'Boss defeated':BOSS.name}</Text><Text style={s.hpText}>{shownHp} / {raid.maxHp} HP</Text></View>
  <View accessibilityRole="progressbar" accessibilityLabel="Guild boss health" accessibilityValue={{min:0,max:raid.maxHp,now:shownHp}} style={s.hpTrack}><View style={[s.hpFill,{width:`${shownHp/raid.maxHp*100}%`}]} /></View>
  <View style={{width:w,height:h,overflow:'hidden',borderRadius:20,backgroundColor:'#324935'}}>
   <Image accessible={false} source={require('./assets/arena/forest.png')} resizeMode="cover" style={{position:'absolute',width:w,height:h}}/>
   <View style={{position:'absolute',left:w*.77-bossSize*.5,top:footY-bossSize*.96}}><BossSprite action={bossAction} size={bossSize} active={enabled} eventKey={eventKey}/></View>
   {hero&&<Animated.View style={{position:'absolute',left:w*.19-136*heroScale,top:footY-228*heroScale,opacity:heroOpacity,transform:[{translateX:heroX}]}}><Companion key={hero} ref={heroRef} companionId={hero} width={heroWidth} active={enabled} onReady={beginPresentation} onError={settle}/></Animated.View>}
   <Animated.View pointerEvents="none" style={{position:'absolute',left:w*.35,top:footY-bossSize*.44,width:12,height:12,borderRadius:6,backgroundColor:COMPANIONS_BY_ID[hero]?.accent||'#d3b8ff',borderWidth:2,borderColor:'#fff',opacity:projectileOpacity,transform:[{translateX:projectile.interpolate({inputRange:[0,1],outputRange:[0,w*.41]})}]}}/>
   {damage&&<Animated.Text style={[s.damage,{left:w*.58,width:w*.40,textAlign:'center',fontSize:Math.max(14,Math.min(22,w*.055)),top:footY-bossSize*.8,transform:[{translateY:floatY}]}]}>{damage.critical?'CRIT! ':''}-{damage.damage}</Animated.Text>}
   {!hero&&shownHp>0&&<Text style={[s.platformLabel,{left:w*.04,top:h*.79}]}>Your attack platform</Text>}
   {shownHp===0&&<View style={s.victory}><Text style={s.victoryText}>GUILD VICTORY</Text></View>}
  </View>
 </View>;
});
export default BattleArena;
const s=StyleSheet.create({hpRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:8,flexWrap:'wrap'},hpName:{fontSize:16,color:'#382a48',fontWeight:'800'},hpText:{fontSize:12,color:'#8b7199',fontWeight:'700'},hpTrack:{height:9,backgroundColor:'#e7ddea',borderRadius:5,overflow:'hidden',marginBottom:14},hpFill:{height:9,backgroundColor:'#a86eca'},damage:{position:'absolute',color:'#fff8ba',fontSize:22,fontWeight:'900',textShadowColor:'#39213b',textShadowRadius:4,textShadowOffset:{width:1,height:2}},platformLabel:{position:'absolute',color:'#fff',fontSize:11,fontWeight:'700',textShadowColor:'#263323',textShadowRadius:3},victory:{position:'absolute',bottom:15,left:0,right:0,alignItems:'center'},victoryText:{backgroundColor:'#324029dd',paddingHorizontal:18,paddingVertical:10,borderRadius:13,color:'#f4edaa',fontSize:14,fontWeight:'900',letterSpacing:2}});
