import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
export const BOSS_ANIMATIONS = { idle:{row:0,times:[650,550,650],loop:true},enraged:{row:1,times:[320,340,380],loop:true},hit:{row:2,times:[160,220,300],loop:false},defeat:{row:3,times:[300,400,900],loop:false} };
export default function BossSprite({ action='idle', size=170, active=true, eventKey=0 }) {
 const [frame,setFrame]=useState(0),[ready,setReady]=useState(false);
 useEffect(()=>{
  const a=BOSS_ANIMATIONS[action]||BOSS_ANIMATIONS.idle;let f=0,elapsed=0,last,raf,running=true;setFrame(!active&&action==='defeat'?2:0);
  if(!active||!ready)return;
  function tick(now){if(!running)return;if(last!=null)elapsed+=Math.min(100,now-last);last=now;while(elapsed>=a.times[f]){elapsed-=a.times[f];if(f===2){if(!a.loop){running=false;break}f=0}else f++;setFrame(f)}if(running)raf=requestAnimationFrame(tick)}
  raf=requestAnimationFrame(tick);return()=>{running=false;cancelAnimationFrame(raf)};
 },[action,active,ready,eventKey]);
 const a=BOSS_ANIMATIONS[action]||BOSS_ANIMATIONS.idle;
 return <View accessible accessibilityRole="image" accessibilityLabel={`Dreadroot Sentinel, ${action}`} style={{width:size,height:size,overflow:'hidden'}}><Image accessible={false} source={require('./assets/boss/atlas.png')} resizeMode="stretch" fadeDuration={0} onLoad={()=>setReady(true)} style={{position:'absolute',width:size*3,height:size*4,left:-frame*size,top:-a.row*size,opacity:ready?1:0}}/></View>;
}
