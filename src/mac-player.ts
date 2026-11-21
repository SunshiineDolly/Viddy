import {macYouTubePlayerUrl} from './youtube-embed'

type Events={onReady:()=>void;onError:(e:{data:number})=>void;onStateChange:(e:{data:number})=>void}
// The YouTube API runs inside the HTTP document, rather than the app's custom origin.
export class MacPlayer {
 private frame:HTMLIFrameElement
 private origin=''
 private alive=true
 private nonce=crypto.randomUUID()
 private snapshot={time:0,duration:0,state:-1,volume:100,muted:false,url:''}
 private receive:(event:MessageEvent)=>void
 constructor(frame:HTMLIFrameElement,{events}:{events:Events}){
  this.frame=frame
  this.receive=event=>{
   if(!this.alive||event.source!==frame.contentWindow||event.origin!==this.origin||event.data?.type!=='viddy-player'||event.data.nonce!==this.nonce)return
   const data=event.data
   if(data.event==='sample'&&data.sample){const s=data.sample;if([s.time,s.duration,s.state,s.volume].every(Number.isFinite))this.snapshot={time:s.time,duration:s.duration,state:s.state,volume:s.volume,muted:!!s.muted,url:typeof s.url==='string'?s.url:''}}
   if(data.event==='ready'){const start=Number(frame.dataset.start);if(Number.isFinite(start)&&start>0)this.seekTo(start,true);events.onReady()}
   if(data.event==='state'&&Number.isFinite(data.value)){this.snapshot.state=data.value;events.onStateChange({data:data.value})}
   if(data.event==='error'&&Number.isFinite(data.value))events.onError({data:data.value})
  }
  window.addEventListener('message',this.receive)
  const id=frame.dataset.videoId!
  void macYouTubePlayerUrl(id,'watch').then(address=>{
   if(!this.alive)return
   const url=new URL(address);const params=new URLSearchParams(url.hash.slice(1));params.set('nonce',this.nonce);url.hash=params.toString();this.origin=url.origin;frame.src=url.href
  }).catch(()=>{if(this.alive)events.onError({data:0})})
 }
 private command(method:string,args:unknown[]=[]){this.frame.contentWindow?.postMessage({type:'viddy-player-command',nonce:this.nonce,method,args},this.origin)}
 destroy(){this.alive=false;window.removeEventListener('message',this.receive);this.frame.remove()}
 getCurrentTime(){return this.snapshot.time}
 getDuration(){return this.snapshot.duration}
 getPlayerState(){return this.snapshot.state}
 getVideoUrl(){return this.snapshot.url}
 getVolume(){return this.snapshot.volume}
 isMuted(){return this.snapshot.muted}
 setVolume(value:number){this.snapshot.volume=value;this.command('setVolume',[value])}
 mute(){this.snapshot.muted=true;this.command('mute')}
 unMute(){this.snapshot.muted=false;this.command('unMute')}
 loadVideoById(id:string){this.command('loadVideoById',[id])}
 seekTo(at:number,allow:boolean){this.command('seekTo',[at,allow])}
 playVideo(){this.command('playVideo')}
 pauseVideo(){this.command('pauseVideo')}
}
