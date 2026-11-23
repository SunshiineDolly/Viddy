import {isMac} from './platform'
import {macPreviewSource,prepareMacPreviews,forgetMacPreview} from './mac-preview'
import {recordNativePreview} from './playback-diagnostics'
import {configureYouTubeFrame} from './youtube-embed'
import {createContext,useContext,useEffect,useRef,useState} from 'react'
import {Play} from 'lucide-react'
import type {Video} from './domain'
import {clock} from './components'
import {playerApi} from './player'

export const VideoPreviews=createContext(true)

function MacVideoPreview({id,poster}:{id:string;poster:string}){
 const mount=useRef<HTMLSpanElement>(null)
 const [failed,setFailed]=useState(false)
 useEffect(()=>{
  const host=mount.current!,controller=new AbortController(),video=document.createElement('video')
  let active=true,advanced=false,firstTime:number|undefined
  video.muted=true;video.defaultMuted=true;video.volume=0;video.playsInline=true;video.loop=true;video.preload='auto';video.controls=false;video.disablePictureInPicture=true;video.poster=poster
  video.setAttribute('muted','');video.setAttribute('playsinline','');video.tabIndex=-1
  const fail=(code:number|null=null)=>{if(active){active=false;controller.abort();forgetMacPreview(id);recordNativePreview('error',code);video.pause();video.removeAttribute('src');video.load();host.replaceChildren();setFailed(true)}}
  video.addEventListener('error',()=>fail(video.error?.code??null))
  video.addEventListener('playing',()=>{if(active)recordNativePreview('playing')})
  video.addEventListener('timeupdate',()=>{
   if(!active)return
   firstTime??=video.currentTime
   if(!advanced&&video.currentTime>firstTime+.5){advanced=true;host.dataset.playing='true';recordNativePreview('time-advanced')}
   if(video.currentTime>=20)video.currentTime=0
  })
  host.appendChild(video);recordNativePreview('preparing')
  void macPreviewSource(id,controller.signal).then(url=>{
   if(!active)return
   recordNativePreview('source-ready');video.src=url
   void video.play().catch(error=>{if(error?.name!=='AbortError')fail(video.error?.code??null)})
  }).catch(error=>{if(error?.name!=='AbortError')fail()})
  return()=>{active=false;controller.abort();video.pause();video.removeAttribute('src');video.load();host.replaceChildren();recordNativePreview('stopped')}
 },[id,poster])
 if(failed)return <span className="preview-unavailable" aria-hidden="true">Preview unavailable</span>
 return <span ref={mount} className="thumbnail-preview thumbnail-preview-native" aria-hidden="true"/>
}

function YouTubePreview({id}:{id:string}){
 const mount=useRef<HTMLSpanElement>(null)
 const [playing,setPlaying]=useState(false)
 useEffect(()=>{
   const host=mount.current!
   let disposed=false
   let player:InstanceType<NonNullable<Window['YT']>['Player']>|undefined
   const frame=document.createElement('iframe')
   frame.title='Muted YouTube preview'
   frame.tabIndex=-1
   frame.allow='autoplay; encrypted-media'
   const params=new URLSearchParams({
     autoplay:'1',mute:'1',controls:'0',playsinline:'1',rel:'0',
     enablejsapi:'1',origin:location.origin,cc_load_policy:'0',
   })
   void configureYouTubeFrame(frame,id,params).then(()=>{
     if(disposed)return
     host.appendChild(frame)
     return playerApi()
   }).then(YT=>{
     if(disposed||!YT)return
     player=new YT.Player(frame,{events:{
       onReady:()=>{if(!disposed){player?.mute();player?.playVideo()}},
       onStateChange:({data})=>{
         if(disposed)return
         if(data===1)setPlaying(true)
         if(data===0)setPlaying(false)
       },
       onError:()=>{if(!disposed)setPlaying(false)},
     }})
   }).catch(()=>{})
   return ()=>{disposed=true;player?.destroy();host.replaceChildren()}
 },[id])
 return <span ref={mount} className="thumbnail-preview" data-playing={playing} aria-hidden="true"/>
}

export function Thumbnail({video:v,onWatch,progress,checked}:{video:Video;onWatch:(v:Video)=>void;progress?:{at:number;duration:number};checked?:string}){
 const previews=useContext(VideoPreviews)
 const [previewId,setPreviewId]=useState<string>()
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 const stop=()=>{
   clearTimeout(timer.current)
   setPreviewId(undefined)
 }
 function start(){
   if(!previews||v.live||v.upcoming||v.scheduledAt||v.paid||!v.embeddable)return
   if(!matchMedia('(hover:hover)').matches||(!isMac&&matchMedia('(prefers-reduced-motion:reduce)').matches))return
   clearTimeout(timer.current)
   timer.current=setTimeout(()=>setPreviewId(v.id),450)
 }
 useEffect(()=>{
   if(!previews)stop()
   if(isMac&&previews)void prepareMacPreviews().catch(()=>{})
   const hidden=()=>{if(document.hidden)stop()}
   document.addEventListener('visibilitychange',hidden)
   return ()=>{
     document.removeEventListener('visibilitychange',hidden)
     clearTimeout(timer.current)
   }
 },[v.id,previews])
 return <button className="thumbnail video-thumbnail" aria-label={'Watch '+v.title} onClick={()=>{stop();onWatch(v)}} onMouseEnter={start} onMouseLeave={stop} onBlur={stop}>
   <span className="thumb-placeholder" aria-hidden="true"><Play size={21}/></span>
   {v.image&&<img src={v.image} loading="lazy" decoding="async" alt=""/>}
   {previewId===v.id&&(isMac?<MacVideoPreview key={v.id} id={v.id} poster={v.image}/>:<YouTubePreview key={v.id} id={v.id}/>)}
   {v.duration>0&&<span className="duration">{clock(v.duration)}</span>}
   {v.live&&<span className="live-badge">Live</span>}
   {!!(v.scheduledAt||v.upcoming)&&!v.live&&<span className="live-badge scheduled-badge">Scheduled</span>}
   {checked&&v.date>checked&&<span className="new-badge">New</span>}
   {!!progress?.at&&<span className="progress" style={{width:Math.min(100,100*progress.at/progress.duration)+'%'}}/>}
 </button>
}
