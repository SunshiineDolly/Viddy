import {isMac} from './platform'
import {macYouTubePreviewUrl} from './youtube-embed'
import {configureYouTubeFrame} from './youtube-embed'
import {createContext,useContext,useEffect,useRef,useState} from 'react'
import {Play} from 'lucide-react'
import type {Video} from './domain'
import {clock} from './components'
import {playerApi} from './player'

export const VideoPreviews=createContext(true)

function MacYouTubePreview({id}:{id:string}){
 const mount=useRef<HTMLSpanElement>(null)
 const [failed,setFailed]=useState(false)
 useEffect(()=>{
  const host=mount.current!
  let active=true,origin=''
  const frame=document.createElement('iframe')
  frame.title='Muted YouTube video preview';frame.tabIndex=-1;frame.allow='autoplay *; encrypted-media *'
  const receive=(event:MessageEvent)=>{
   if(!active||event.source!==frame.contentWindow||event.origin!==origin||event.data?.type!=='viddy-video-preview'||event.data.id!==id)return
   if(['error','blocked','ended'].includes(event.data.state)){frame.remove();setFailed(true)}
  }
  window.addEventListener('message',receive)
  void macYouTubePreviewUrl(id).then(url=>{
   if(!active)return
   origin=new URL(url).origin;frame.src=url;host.appendChild(frame)
  }).catch(()=>{if(active)setFailed(true)})
  return()=>{active=false;window.removeEventListener('message',receive);host.replaceChildren()}
 },[id])
 if(failed)return null
 return <span ref={mount} className="thumbnail-preview thumbnail-preview-mac" aria-hidden="true"/>
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
   {previewId===v.id&&(isMac?<MacYouTubePreview key={v.id} id={v.id}/>:<YouTubePreview key={v.id} id={v.id}/>)}
   {v.duration>0&&<span className="duration">{clock(v.duration)}</span>}
   {v.live&&<span className="live-badge">Live</span>}
   {!!(v.scheduledAt||v.upcoming)&&!v.live&&<span className="live-badge scheduled-badge">Scheduled</span>}
   {checked&&v.date>checked&&<span className="new-badge">New</span>}
   {!!progress?.at&&<span className="progress" style={{width:Math.min(100,100*progress.at/progress.duration)+'%'}}/>}
 </button>
}
