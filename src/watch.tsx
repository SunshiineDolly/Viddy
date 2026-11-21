import {PlaylistSaver} from './playlist-saver'
import {PlaylistPlayer,type PlaylistQueue} from './playlist-queue'
import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {Clock3,Heart,Share2,PictureInPicture2,X,Play,ArrowUpLeft,Users,ListPlus,RectangleHorizontal} from 'lucide-react'
import {PlayerFrame} from './player'
import type {RoomPlayback} from './watch-together'
import {linkVideo} from './public-feeds'
import {CreatorAvatar} from './creator-avatar'
import {CreatorByline,useWatchCreator} from './creator-links'
import {DownloadButton} from './downloads'
import {VideoComments} from './comments'
import {useUpNext,UpNext} from './up-next'
import {ScheduledDetails,useScheduledStatus} from './live'
import {LiveChat} from './live-chat'
import {Empty,day} from './components'
import {Notice,type Shared} from './screens'
import {rememberVideo,toggled} from './library'
import {errorText,visible,type Video} from './domain'
type Props={onOpenRoom:()=>void;roomPlayback?:RoomPlayback;inRoom:boolean;onRoomController:(read:()=>RoomPlayback|undefined)=>void;playlist?:PlaylistQueue;onQueueChange:(queue:PlaylistQueue|undefined)=>void;onQueueWatch:(index:number)=>void;onQueueClose:()=>void;onQueueRepeat:()=>void;docked?:boolean;onRestore:()=>void;onStop:()=>void;video:Video;shared:Shared;theater:boolean;setTheater:(v:boolean)=>void;onSample:(id:string,p:number,d:number,t:number,live?:boolean)=>void;onElapsed:(seconds:number)=>void;popped:boolean;returned?:number;onPopout:(video:Video,start:number)=>Promise<void>}
export function Watch({onOpenRoom,roomPlayback,inRoom,onRoomController,playlist,onQueueChange,onQueueWatch,onQueueClose,onQueueRepeat,docked=false,onRestore,onStop,video:v,shared,theater,setTheater,onSample,onElapsed,popped,returned,onPopout}:Props){
 const {data,change,follow,channel}=shared
 const [share,setShare]=useState(false),[message,setMessage]=useState(''),[ended,setEnded]=useState(false),[restricted,setRestricted]=useState(false),[opening,setOpening]=useState(false)
 const [showQueue,setShowQueue]=useState(false)
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),2600);return()=>clearTimeout(timer)},[message])
 const playerPosition=useRef<()=>number>(()=>0)
 const scheduledAt=data.liveReminders[v.id]?.at??v.scheduledAt
 const status=useScheduledStatus(v.id,scheduledAt,v.upcoming),checked=useWatchCreator(v.id,true),uploader=checked.creator
 const video=uploader?{...v,channelId:uploader.id,channel:uploader.name,date:v.date||uploader.date,title:v.title==='YouTube video'?uploader.title||v.title:v.title,description:uploader.description??v.description,metadataComplete:true,views:v.views||uploader.views,duration:v.duration||uploader.duration||0}:v
 const live=status==='live'||(uploader?uploader.live:!!v.live),waiting=!!(scheduledAt||v.upcoming)&&status==='waiting'&&!live
 const allowed=!restricted
 const [embedError,setEmbedError]=useState<number>(),[embedAttempt,setEmbedAttempt]=useState(0)
 const openedFallback=useRef(false)
 const next=useUpNext(video,data,Object.values(shared.feeds.states).flatMap(s=>s.feed?.videos??[]).filter(v=>!Object.values(shared.live.states).some(s=>!s.error&&s.video?.id===v.id)))
 useEffect(()=>{if(uploader&&data.settings.history)change(d=>rememberVideo(d,video))},[uploader?.id,uploader?.title,uploader?.date])
 function played(){if(data.settings.history)change(d=>({...rememberVideo(d,video),history:{...d.history,[v.id]:Date.now()}}))}
  async function original(comments=false){
   setOpening(true);setMessage('')
   try{await invoke('original_player',{id:v.id,dark:data.settings.theme==='dark',comments});if(!comments)setMessage('Opened YouTube playback in Viddy.')}
   catch(e){setMessage(errorText(e))}
   finally{setOpening(false)}
 }
 if(!visible(video,data.settings))return <Empty title="Video hidden" detail="This video matches one of your content filters."/>
 if(data.settings.blocked.length&&!video.channelId){
   return <Empty title={checked.loading?'Checking content filters':'Creator could not be verified'} detail="Viddy checks the creator when channel filters are active."/>
 }
 if(data.settings.keywords.length&&!video.metadataComplete&&checked.loading){
   return <Empty title="Checking content filters" detail="Checking the full video description."/>
 }
 const later=data.later.includes(v.id),fav=data.favorites.includes(v.id),progress=data.settings.progress?data.progress[v.id]:undefined
 const start=roomPlayback?.video===v.id?roomPlayback.position:returned??(progress&&progress.at<progress.duration-5?progress.at:0)
 return <div className={'watch '+(live?'with-live-chat ':'')+(theater?'theater':'')+(docked?' watch-docked':'')+(showQueue?' dock-queue-open':'')+(popped?' watch-popped':'')}>
 <div className="watch-media-layout">{docked&&<div className="dock-header"><button onClick={onRestore} title="Return to video">{video.title}</button><button className="icon" title="Return to video" aria-label="Return to video page" onClick={onRestore}><ArrowUpLeft size={16}/></button><button className="icon" aria-label="Show queue" onClick={()=>{if(!playlist)shared.enqueue(video);setShowQueue(playlist?!showQueue:true)}}>☷</button><button className="icon" aria-label="Close mini player" onClick={onStop}><X size={16}/></button></div>}<div className="watch-media">
 {popped?<div className="popped-placeholder"><PictureInPicture2 size={36}/><p>Playing in your mini player</p><button className="button" onClick={()=>void invoke('close_player')}>Bring back here</button></div>:waiting?<div className="scheduled-watch">{v.image&&<img src={v.image} alt=""/>}<ScheduledDetails video={v} data={data} change={change}/></div>:allowed?<PlayerFrame key={embedAttempt} onPlaybackError={setEmbedError} roomPlayback={roomPlayback} onRoomController={onRoomController} volumeControls={docked} onVideoChange={id=>{if(!roomPlayback)shared.watch(linkVideo(id))}} id={v.id} live={live} start={live||checked.loading?0:start} onController={getter=>{playerPosition.current=getter}} onRestricted={()=>setRestricted(true)} onEnded={()=>{if(!inRoom)setEnded(true)}} onElapsed={onElapsed} onSample={(p,d,t)=>onSample(v.id,p,d,t,live)} onPlay={played}/>:<div className="original-player-card"><img src={v.image||'https://i.ytimg.com/vi/'+v.id+'/hqdefault.jpg'} alt=""/><div><span className="eyebrow">ORIGINAL YOUTUBE PLAYER</span><h2>This video plays on YouTube’s own player</h2><p>YouTube refused embedded playback. Retry here, or choose to open the original player.</p><button className="button accent" disabled={opening} onClick={()=>void original()}><Play size={17}/>{opening?'Opening…':openedFallback.current?'Reopen playback':'Open playback'}</button></div></div>}
  {allowed&&embedError!==undefined&&!popped&&!waiting&&<div className="row wrap playback-recovery"><button className="button" onClick={()=>{setEmbedError(undefined);setEmbedAttempt(attempt=>attempt+1)}}>Retry player</button><button className="button" disabled={opening} onClick={()=>void original()}>Open original player</button></div>}
 </div>{live&&<LiveChat key={v.id} id={v.id}/>}</div>
 {!docked&&<><div className="watch-view-controls"><div className="watch-player-actions"><button onClick={()=>shared.enqueue(video)}><ListPlus size={15}/> Queue</button><button aria-pressed={theater} onClick={()=>setTheater(!theater)}><RectangleHorizontal size={15}/>{theater?'Exit theater':'Theater'}</button><button disabled={inRoom||popped||waiting||!allowed} onClick={()=>void onPopout({...video,live},live?0:playerPosition.current()).catch(e=>setMessage(errorText(e)))}><PictureInPicture2 size={14}/> Pop out</button></div></div>
 <section className="watch-overview"><h1>{video.title}</h1><div className="watch-identity-row"><div className="watch-creator">{video.channelId&&<CreatorAvatar id={video.channelId} name={video.channel} src={video.creators?.[0]?.image||video.channelImage}/>}<div><CreatorByline video={video} onChannel={channel}/>{uploader?.subscribers&&<p className="subscriber-count">{uploader.subscribers}</p>}<p className="watch-video-meta">{[video.views,day(video.date)||video.publishedLabel].filter(Boolean).join(' · ')}</p></div>{video.channelId&&<button className={'button '+(!data.follows.includes(video.channelId)?'accent':'')} onClick={()=>follow(video.channelId)}>{data.follows.includes(video.channelId)?'Following':'Follow'}</button>}</div><div className="watch-actions watch-social-actions"><button className="button" aria-haspopup="dialog" aria-label="Watch Together" onClick={onOpenRoom}><Users size={16}/>{inRoom?'Watch Together · In room':'Watch Together'}</button><button className="button" aria-pressed={later} onClick={()=>change(d=>({...rememberVideo(d,video),later:toggled(d.later,v.id)}))}><Clock3 size={15}/>{later?'Saved for later':'Watch later'}</button><button className="button" aria-label={fav?'Remove favorite':'Favorite'} title="Favorite" aria-pressed={fav} onClick={()=>change(d=>({...rememberVideo(d,video),favorites:toggled(d.favorites,v.id)}))}><Heart size={16}/></button><button className="button" aria-expanded={share} onClick={()=>{setShare(!share);setMessage('')}}><Share2 size={15}/> Share</button><DownloadButton video={video} disabled={live||waiting}/></div></div>
 {share&&<div className="share-panel row wrap" onKeyDown={e=>{if(e.key==='Escape')setShare(false)}}><label>Video link<input readOnly value={'https://www.youtube.com/watch?v='+v.id} onFocus={e=>e.currentTarget.select()}/></label><button className="button accent" onClick={()=>void navigator.clipboard.writeText('https://www.youtube.com/watch?v='+v.id).then(()=>{setShare(false);setMessage('Link copied.')},()=>setMessage('Select the link and copy it.'))}>Copy link</button><button className="icon" aria-label="Close share" onClick={()=>setShare(false)}><X size={16}/></button></div>}
 {message&&<div className="viddy-toast" role="status"><span aria-hidden="true">✦</span>{message}</div>}
 <div className="watch-details-row">{video.description&&<details className="watch-description"><summary>Description</summary><p className="description">{video.description}</p></details>}<PlaylistSaver video={video} data={data} change={change} onSaved={setMessage}/></div></section></>}
 <div className="watch-bottom-grid">
 {!docked&&!live&&!waiting&&<VideoComments key={v.id} id={v.id} onChannel={channel} onOriginal={()=>void original(true)}/>}
 <aside className="watch-sidebar">{playlist&&!popped&&<aside className="watch-playlist"><PlaylistPlayer queue={playlist} data={data} ended={ended} onWatch={onQueueWatch} onClose={()=>{onQueueClose();setShowQueue(false)}} onRepeat={onQueueRepeat} onChange={onQueueChange}/></aside>}
 {!waiting&&!popped&&<aside className="watch-recommendations"><UpNext filters={data.settings} videos={next.videos} pages={next.pages} onMore={next.more} busy={next.busy} error={next.error} onQueue={shared.enqueue} queued={playlist?.ids} queueActive={!!playlist} autoplay={!inRoom&&!live&&!playlist&&data.settings.autoplay} ended={!live&&!playlist&&ended} onToggle={()=>change(d=>({...d,settings:{...d.settings,autoplay:!d.settings.autoplay}}))} onWatch={docked?shared.playNext:shared.watch}/></aside>}
 </aside></div>{!docked&&<p className="player-attribution">Playback provided by YouTube.</p>}
 </div>
}
