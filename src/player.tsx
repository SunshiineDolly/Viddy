import {isMac} from './platform'
import {MacPlayer} from './mac-player'
import {configureYouTubeFrame} from './youtube-embed'
import {RefreshCw,Volume2,VolumeX} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {playbackClock} from './playback-clock'
import type {RoomPlayback} from './watch-together'
type Player = {destroy():void;getCurrentTime():number;getDuration():number;getPlayerState():number;getVideoUrl():string;getVolume():number;setVolume(volume:number):void;isMuted():boolean;mute():void;unMute():void;loadVideoById(id:string):void;seekTo(position:number,allow:boolean):void;playVideo():void;pauseVideo():void}
type Events = {onReady:()=>void;onError:(e:{data:number})=>void;onStateChange:(e:{data:number})=>void}
declare global { interface Window { YT?:{Player:new (frame:HTMLIFrameElement, config:{events:Events})=>Player};onYouTubeIframeAPIReady?:()=>void } }
let api:Promise<NonNullable<Window['YT']>>|undefined
export function playerApi() {
 return api??=new Promise((resolve,reject)=>{
   if(window.YT?.Player) {resolve(window.YT);return}
   const script=document.createElement('script')
   const timer=setTimeout(()=>{script.remove();reject(new Error('The YouTube player could not be initialized.'))},12000)
   window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);if(window.YT) resolve(window.YT)}
   script.src='https://www.youtube.com/iframe_api'
   script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('The YouTube player could not be loaded.'))}
   document.head.appendChild(script)
 }).catch(e=>{api=undefined;throw e}) as Promise<NonNullable<Window['YT']>>
}
export function PlayerFrame({id,start,live=false,onSample,onPlay,onElapsed,onEnded,onController,onRestricted,onPlaybackError,onVideoChange,volumeControls=false,sampleInterval=8,roomPlayback,onRoomController}:{id:string;start:number;live?:boolean;onSample:(position:number,duration:number,playing:number)=>void;onPlay:()=>void;onElapsed:(seconds:number)=>void;onEnded?:()=>void;onController?:(position:()=>number)=>void;onRestricted?:()=>void;onPlaybackError?:(code:number)=>void;onVideoChange?:(id:string)=>void;sampleInterval?:number;volumeControls?:boolean;roomPlayback?:RoomPlayback;onRoomController?:(read:()=>RoomPlayback|undefined)=>void}) {
 const mount=useRef<HTMLDivElement>(null), callbacks=useRef({onSample,onPlay,onElapsed,onEnded,onController,onRestricted,onPlaybackError,onVideoChange,onRoomController})
 const initial=useRef(start)
 const roomTarget=useRef(roomPlayback)
 roomTarget.current=roomPlayback
 const syncRoom=useRef(()=>{})
 useEffect(()=>{syncRoom.current()},[roomPlayback])
 const resume=useRef(start),seekWhenReady=useRef(()=>{})
 resume.current=start
 useEffect(()=>{seekWhenReady.current()},[start])
 const [error,setError]=useState(''),[volume,setVolume]=useState(100),[muted,setMuted]=useState(false)
 const volumePlayer=useRef<Player|undefined>(undefined)
 function adjustVolume(value:number){const p=volumePlayer.current;if(!p)return;p.setVolume(value);if(value>0)p.unMute();setVolume(value);setMuted(value===0);try{localStorage.setItem('viddy-volume',String(value))}catch{}}
 function toggleMute(){const p=volumePlayer.current;if(!p)return;if(muted||volume===0){if(volume===0){p.setVolume(50);setVolume(50)}p.unMute();setMuted(false)}else{p.mute();setMuted(true)}}
 const [liveState,setLiveState]=useState<'connecting'|'playing'|'paused'|'buffering'|'ended'>('connecting')
 const jump=useRef<()=>void>(()=>{})
 callbacks.current={onSample,onPlay,onElapsed,onEnded,onController,onRestricted,onPlaybackError,onVideoChange,onRoomController}
 useEffect(()=>{
   const host=mount.current!
   const frame=document.createElement('iframe')
   frame.title='YouTube video player'
   frame.dataset.videoId=id
   frame.dataset.start=String(initial.current)
   frame.dataset.autoplay=roomTarget.current?.playing===false?'0':'1'
   frame.allow=isMac?'autoplay *; encrypted-media *; fullscreen *; picture-in-picture *':'autoplay; encrypted-media; fullscreen; picture-in-picture'
   frame.allowFullscreen=true
   const params=new URLSearchParams({autoplay:roomTarget.current?.playing===false?'0':'1',controls:'1',enablejsapi:'1',origin:location.origin,rel:'0',playsinline:'1'})
   if(!live&&initial.current>0)params.set('start',String(Math.floor(initial.current)))
   let closed=false, player:Player|undefined, ready=false, played=false, timed=0, lastPosition=-1
   const clock=playbackClock(performance.now())
   const count=(playing?:boolean)=>{
     const elapsed=clock.advance(performance.now(),playing)
     timed+=elapsed
     if(elapsed>0)callbacks.current.onElapsed(elapsed)
   }
   let bufferedAt=0,pausedAt=0,hiddenAt=0,lastJump=-Infinity,ended=false
   let roomPlaying=false
   syncRoom.current=()=>{
     const target=roomTarget.current
     if(closed||live||!ready||!player||target?.video!==id)return
     const state=player.getPlayerState()
     const delta=Math.abs(player.getCurrentTime()-target.position)
     if(delta>(target.playing?1.8:0.5))player.seekTo(target.position,true)
     if(target.playing&&state!==1&&state!==3)player.playVideo()
     if(!target.playing&&(state===1||state===3))player.pauseVideo()
   }
   callbacks.current.onRoomController?.(()=>ready&&!closed&&!live&&player
     ?{video:id,position:player.getCurrentTime()||0,playing:roomPlaying}:undefined)
   let resumed=initial.current>0
   seekWhenReady.current=()=>{
     if(!live&&ready&&player&&!resumed&&resume.current>0&&player.getCurrentTime()<5){
       resumed=true;player.seekTo(resume.current,true)
     }
   }
   const goLive=(manual=false)=>{
     if(closed||!live||!ready||!player||ended||(!manual&&Date.now()-lastJump<30_000))return
     lastJump=Date.now();bufferedAt=0;pausedAt=0;setLiveState('connecting')
     player.loadVideoById(id)
   }
   jump.current=()=>goLive(true)
   const sample=(force=false)=>{
     if(ready && player) {
       const playing=player.getPlayerState()===1
       if(force)count();else count(playing)
       if(live&&bufferedAt&&Date.now()-bufferedAt>14_000&&!document.hidden)goLive()
       const position=player.getCurrentTime(), duration=player.getDuration()
       if(force || timed>=sampleInterval || (duration>0&&playing&&Math.abs(position-lastPosition)>=sampleInterval)) {
         callbacks.current.onSample(position,duration,timed)
         lastPosition=position;timed=0
       }
     }
   }
   const timer=setInterval(sample,1000)
   void (isMac?Promise.resolve():configureYouTubeFrame(frame,id,params)).then(()=>{
     if(closed)return
     host.appendChild(frame)
     return isMac?{Player:MacPlayer}:playerApi()
   }).then(YT=>{
     if(closed||!YT) return
     player=new YT.Player(frame,{events:{
       onReady:()=>{ready=true;volumePlayer.current=player;let initialVolume=player?.getVolume()??100;try{const saved=localStorage.getItem('viddy-volume');if(saved!==null&&Number.isFinite(Number(saved))){initialVolume=Math.max(0,Math.min(100,Number(saved)));player?.setVolume(initialVolume)}}catch{};setVolume(initialVolume);setMuted((player?.isMuted()??false)||initialVolume===0);sample();callbacks.current.onController?.(()=>player?.getCurrentTime()??0);if(roomTarget.current)syncRoom.current();else seekWhenReady.current()},
       onStateChange:e=>{
         if(closed)return
         if(e.data!==3)roomPlaying=e.data===1
         if(e.data===1&&player){try{const selected=new URL(player.getVideoUrl()).searchParams.get('v');if(selected&&/^[\w-]{11}$/.test(selected)&&selected!==id){callbacks.current.onVideoChange?.(selected);return}}catch{}}
         count(e.data===1)
         if(e.data===1 && !played) {played=true;callbacks.current.onPlay()}
         if(live){
           if(e.data===1){
             if(pausedAt&&Date.now()-pausedAt>12_000){goLive();pausedAt=0;return}
             pausedAt=0;bufferedAt=0;setLiveState('playing')
           }else if(e.data===2){pausedAt=Date.now();bufferedAt=0;setLiveState('paused')}
           else if(e.data===3){bufferedAt||=Date.now();setLiveState('buffering')}
           else if(e.data===0){ended=true;setLiveState('ended')}
         }
         if(e.data===0 || e.data===2) sample(true)
         if(e.data===0&&!live)callbacks.current.onEnded?.()
       },
       onError:e=>{if(closed)return;count(false);if(isMac?e.data===101:[101,150].includes(e.data))callbacks.current.onRestricted?.();callbacks.current.onPlaybackError?.(e.data);setError(e.data===153?'YouTube couldn’t play this video in Viddy. Try another result.':[101,150].includes(e.data)?(isMac?'YouTube refused embedded playback. You can retry in this player.':'The creator has disabled embedded playback.'):e.data===100?'This video is unavailable or private.':'YouTube could not play this video here.')}
     }})
   }).catch(e=>{if(!closed){setError(String(e.message??e));callbacks.current.onPlaybackError?.(0)}})
   const flush=()=>{if(played) sample(true)}
   const visibility=()=>{
     if(document.hidden){hiddenAt=Date.now();return}
     if(hiddenAt&&Date.now()-hiddenAt>18_000&&player?.getPlayerState()!==2)goLive()
     hiddenAt=0
   }
   if(live)document.addEventListener('visibilitychange',visibility)
   window.addEventListener('pagehide',flush)
   return ()=>{closed=true;volumePlayer.current=undefined;jump.current=()=>{};seekWhenReady.current=()=>{};document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',flush);clearInterval(timer);flush();player?.destroy();host.replaceChildren()}
 },[id,live])
 return <><div className="player" ref={mount}/>{volumeControls&&<div className="compact-volume"><button className="icon" aria-label={muted?'Unmute video':'Mute video'} title={muted?'Unmute':'Mute'} onClick={toggleMute}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button><input type="range" min={0} max={100} value={muted?0:volume} aria-label="Video volume" onChange={e=>adjustVolume(Number(e.target.value))}/><output>{muted?0:volume}%</output></div>}{live&&!error&&<div className="live-control row">
   <span role="status">{liveState==='ended'?'Stream ended':liveState==='paused'?'Paused':liveState==='buffering'?'Buffering live stream…':liveState==='playing'?'Live stream':'Connecting to live stream…'}</span>
   {liveState!=='ended'&&<button className="button" title="Reconnect to the current live position" onClick={()=>jump.current()}><RefreshCw size={14}/> Resync live</button>}
 </div>}{error&&<p role="status" className="notice">{error}</p>}</>
}
