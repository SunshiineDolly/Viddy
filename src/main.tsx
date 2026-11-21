import {UpdateNotice} from './update-notice'
import {VideoPreviews} from './thumbnail'
import {BrandIntro} from './brand-intro'
import {isMac} from './platform'
import {Watch} from './watch'
import {applyPalette} from './palettes'
import {createRoot} from 'react-dom/client'
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import {Download,PictureInPicture2} from 'lucide-react'
import {DownloadButton,DownloadsPage} from './downloads'
import {MiniPlayer} from './mini-player'
import {useUpNext,UpNext} from './up-next'
import {ArrowRight,ArrowLeft, Bookmark, Clock3, Compass, History, House, Maximize, Menu, Minimize, Moon, Radio, Settings as Gear, Sun, UserRound, Users, X, Heart, Share2} from 'lucide-react'
import {clock,day,Empty,Loading} from './components'
import {Preferences} from './settings'
import {Heading,Quiet,Subscriptions,ChannelPage,LibraryPage,Notice,type ChannelTab,type Shared} from './screens'
import {PlayerFrame} from './player'
import {useLibrary} from './hooks'
import {useAccount} from './use-account'
import {videoId,channelId,errorText,visible,type Video} from './domain'
import {linkVideo,parseVideo,usePublicFeeds} from './public-feeds'
import {recordViewing,rememberVideo,toggled} from './library'
import {Discover,RecommendationFeed} from './discover'
import {useUpdates} from './updates'
import {SearchPage,type SearchSource} from './search'
import {LibraryStudio} from './library-studio'
import type {PlaylistQueue} from './playlist-queue'
import {BrandLockup} from './brand'
import {CreatorAvatar} from './creator-avatar'
import {SearchBar} from './search-bar'
import {WindowControls} from './window-controls'
import {ScheduledDetails,useLiveReminders,useScheduledStatus} from './live'
import {CreatorByline,useWatchCreator} from './creator-links'
import {useFollowedLive} from './followed-live'
import {LiveChat} from './live-chat'
import {useWatchTogether,WatchTogether,type RoomPlayback} from './watch-together'
import './styles.css'
import './studio.css'

type Name='home'|'discover'|'following'|'subscriptions'|'library'|'later'|'history'|'settings'|'downloads'
type Route={name:Name}|{name:'search';query:string;source?:SearchSource}|{name:'live';query?:string;mode?:'live'|'scheduled'}|{name:'channel';id:string;tab?:ChannelTab}|{name:'watch';video:Video}
const nav = [{id:'home',name:'Home',Icon:House},{id:'discover',name:'Discover',Icon:Compass},{id:'following',name:'Following',Icon:Users},{id:'live',name:'Live',Icon:Radio},{id:'subscriptions',name:'Manage channels',Icon:Users},{id:'library',name:'Library',Icon:Bookmark},{id:'later',name:'Watch Later',Icon:Clock3},{id:'history',name:'History',Icon:History},{id:'settings',name:'Settings',Icon:Gear}] as const
const localDate=()=>new Date().toLocaleDateString('en-CA')
function createSessionCounter(){
 let seconds=0
 const listeners=new Set<()=>void>()
 return {
   read:()=>seconds,
   subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener)}},
   add:(elapsed:number)=>{if(elapsed<=0||!Number.isFinite(elapsed))return;seconds+=elapsed;listeners.forEach(listener=>listener())},
 }
}
function SessionCounter({counter}:{counter:ReturnType<typeof createSessionCounter>}){
 const seconds=useSyncExternalStore(counter.subscribe,counter.read)
 return <p title="Playback time since Viddy opened" data-session-seconds={Math.floor(seconds)}><Clock3 size={16}/><span>{clock(seconds)} this session</span></p>
}
function App() {
 const {data,ready,failed,error,change,setting,read}=useLibrary(), s=data.settings
 const account=useAccount(ready,read,change)
 const [route,setRoute]=useState<Route>({name:'home'}), routes=useRef<{route:Route;text:string;scroll:number}[]>([])
 const [visitedDiscover,setVisitedDiscover]=useState(false)
 useEffect(()=>{
   if(route.name==='discover')setVisitedDiscover(true)
 },[route.name])

 const restoreScroll=useRef(0)
 const routeRef=useRef(route);routeRef.current=route
 const [notice,setNotice]=useState(''),[reminder,setReminder]=useState('')
 const [updateSettingsRequest,setUpdateSettingsRequest]=useState(0)
 const handledUpdateSettingsRequest=useRef(0)
 const [text,setText]=useState('')
 const [activeVideo,setActiveVideo]=useState<Video>(),[playbackRun,setPlaybackRun]=useState(0)
 const [playlist,setPlaylist]=useState<PlaylistQueue>();const playlistRef=useRef(playlist);playlistRef.current=playlist
 const [floating,setFloating]=useState<{video:Video;start:number}|null>(null),[returned,setReturned]=useState<{id:string;start:number}>()
 const [theater,setTheater]=useState(false),[session]=useState(createSessionCounter)
 const searchRef=useRef<HTMLInputElement>(null),main=useRef<HTMLElement>(null),dataRef=useRef(data)
 dataRef.current=data
 const updates=useUpdates(ready)
 const roomDialog=useRef<HTMLDialogElement>(null)
 const openRoom=()=>roomDialog.current?.showModal()
 const readRoomPlayback=useRef<()=>RoomPlayback|undefined>(()=>undefined)
 const getRoomPlayback=()=>{
   const playback=readRoomPlayback.current()
   return !floating&&playback?.video===activeVideo?.id?playback:undefined
 }
 const watchRoom=useWatchTogether(getRoomPlayback,activeVideo?.id,id=>{
   const video=data.savedVideos[id]??linkVideo(id)
   setPlaylist(undefined)
   if(floating)void invoke('close_player').catch(()=>{})
   setActiveVideo(video)
   go({name:'watch',video})
 })
 const liveAlerts=useLiveReminders(data,change,ready)
 const followIds=data.follows
 const feeds=usePublicFeeds(ready?followIds.filter(id=>!s.blocked.includes(id)):[])
 const followedLive=useFollowedLive(ready?followIds.filter(id=>!s.blocked.includes(id)):[])
 useEffect(()=>applyPalette(s.theme,s.accent),[s.theme,s.accent])
 useEffect(()=>{document.documentElement.dataset.cursor=s.themedCursor?'themed':'system'},[s.themedCursor])
 useEffect(()=>setText(''),[route])
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2600);return()=>clearTimeout(timer)},[notice])
 useEffect(()=>{
   const key=(e:KeyboardEvent)=>{
     if(e.key.toLowerCase()==='k'&&(isMac?e.metaKey:e.ctrlKey)){e.preventDefault();searchRef.current?.focus()}
   }
   window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[])
 useLayoutEffect(()=>{
   if(main.current)main.current.scrollTop=restoreScroll.current
   restoreScroll.current=0
 },[route])
 useLayoutEffect(()=>{
   if(updateSettingsRequest!==handledUpdateSettingsRequest.current&&route.name==='settings'){
    document.getElementById('app-updates')?.scrollIntoView({block:'start'})
    handledUpdateSettingsRequest.current=updateSettingsRequest
   }
 },[updateSettingsRequest,route])
 function go(next:Route) {
   if(next.name==='watch'&&route.name==='watch'&&next.video.id===route.video.id)return
   if(next.name==='channel'&&route.name==='channel'&&next.id===route.id)return
   if(next.name===route.name&&next.name!=='search'&&next.name!=='watch'&&next.name!=='channel')return
   if(next.name==='watch')setActiveVideo(next.video)
   if(next.name==='watch')void invoke('close_original_player').catch(()=>{})
   setText('')
   routes.current.push({route,text:route.name==='search'?route.query:text,scroll:main.current?.scrollTop??0})
   restoreScroll.current=0
   setRoute(next);setNotice('');setTheater(false)
 }
 function back() {
   const entry=routes.current.pop()
   if(entry?.route.name==='watch'){setActiveVideo(entry.route.video);const id=entry.route.video.id;setPlaylist(q=>q?.ids.includes(id)?{...q,index:q.ids.indexOf(id)}:undefined)}
   restoreScroll.current=entry?.scroll??0
   setRoute(entry?.route??{name:'home'});setText('');setTheater(false);setNotice('')
 }
 function playPlaylist(name:string,ids:string[],index=0,first?:Video){
  if(!ids[index])return
  if(floating)void invoke('close_player');setPlaybackRun(n=>n+1);setReturned(undefined);setPlaylist({name,ids,index,repeat:false});go({name:'watch',video:first??data.savedVideos[ids[index]]??linkVideo(ids[index])})
 }
 function queueWatch(index:number){const q=playlistRef.current;if(!q?.ids[index])return;setPlaybackRun(n=>n+1);setReturned(undefined);setPlaylist({...q,index});if(floating)void invoke('close_player');const video=dataRef.current.savedVideos[q.ids[index]]??linkVideo(q.ids[index]);if(route.name==='watch')go({name:'watch',video});else setActiveVideo(video)}
 function submit(value:string) {
   setPlaylist(undefined)
   const term=value.trim()
   if(!term)return
   const link=parseVideo(term)
   if(link?.shorts){setNotice('Shorts are not available in Viddy.');return}
   if(!link){
     if(/^https?:\/\//i.test(term)){setNotice('Paste a valid YouTube video link.');return}
     go({name:'search',query:term})
     return
   }
   const match=Object.values(feeds.states).flatMap(state=>state.feed?.videos??[]).find(v=>v.id===link.id)
   const v={...(match??linkVideo(link.id)),shorts:link.shorts||!!match?.shorts,live:link.live||!!match?.live}
   if(!visible(v,s))setNotice('This video is hidden by your filters.')
   else go({name:'watch',video:v})
 }
 const shared:Shared={data,change,playNext:v=>{setPlaylist(undefined);setActiveVideo(v)},playPlaylist,enqueue:v=>{setPlaylist(q=>{const base=q??{name:'Queue',ids:activeVideo?[activeVideo.id]:[],index:0,repeat:false};return {...base,ids:[...new Set([...base.ids,v.id])]}});change(d=>rememberVideo(d,v));setNotice('');requestAnimationFrame(()=>setNotice('Added to queue'));if(!activeVideo){setActiveVideo(v);go({name:'watch',video:v})}},feeds,followIds,live:followedLive,watch:v=>{setPlaylist(undefined);if(data.settings.history)change(d=>rememberVideo(d,v));if(floating)void invoke('close_player');go({name:'watch',video:v})},channel:id=>go({name:'channel',id}),follow:id=>{if(channelId(id))change(d=>({...d,follows:toggled(d.follows,id)}))},subscriptions:()=>go({name:'subscriptions'}),discover:()=>go({name:'discover'})}
 const noteSample=(id:string,position:number,duration:number,elapsed:number,live=false)=>{
   if(!Number.isFinite(elapsed)||elapsed<0)return
   const settings=dataRef.current.settings
   const saveProgress=settings.progress&&!live&&Number.isFinite(position)&&Number.isFinite(duration)&&duration>0
   if(!saveProgress && !settings.reminder && !settings.history)return
   const today=localDate()
   const old=dataRef.current.daily.date===today?dataRef.current.daily.seconds:0
   if(settings.reminder && old<settings.reminder*60 && old+elapsed>=settings.reminder*60)setReminder('You’ve reached your daily viewing reminder. Take a break whenever you’re ready.')
   change(d=>{
     const nextProgress=saveProgress?{...d.progress,[id]:{at:Math.min(duration,Math.max(0,position)),duration,updated:Date.now()}}:d.progress
     return {...d,progress:nextProgress,viewing:recordViewing(d,id,elapsed),daily:settings.reminder||settings.history?{date:today,seconds:(d.daily.date===today?d.daily.seconds:0)+elapsed}:d.daily}
   })
 }
 useEffect(()=>{
  const subscriptions=[
   listen('open-update-settings',()=>{
    const previous=routeRef.current
    if(previous.name!=='settings'){
     routes.current.push({route:previous,text:previous.name==='search'?previous.query:'',scroll:main.current?.scrollTop??0})
     restoreScroll.current=0;setRoute({name:'settings'});setNotice('');setTheater(false)
    }
    setUpdateSettingsRequest(n=>n+1)
   }),
   listen<string>('embedded-video',({payload:id})=>{if(!videoId(id))return;const previous=routeRef.current;if(previous.name==='watch'&&previous.video.id===id)return;routes.current.push({route:previous,text:previous.name==='search'?previous.query:'',scroll:main.current?.scrollTop??0});setPlaylist(undefined);setPlaybackRun(n=>n+1);setActiveVideo(linkVideo(id));setRoute({name:'watch',video:linkVideo(id)})}),
   listen<{video:Video;position:number;duration:number;elapsed:number;started:boolean}>('player-sample',({payload:p})=>{
    if(p.started&&dataRef.current.settings.history)change(d=>({...rememberVideo(d,p.video),history:{...d.history,[p.video.id]:Date.now()}}))
    if(!p.started){noteSample(p.video.id,p.position,p.duration,p.elapsed,!!p.video.live);session.add(p.elapsed);setFloating(old=>old?{...old,start:p.position}:old)}
   }),
   listen<Video>('player-video',({payload:video})=>{setFloating({video,start:0});setActiveVideo(video);setPlaylist(q=>q&&q.ids.includes(video.id)?{...q,index:q.ids.indexOf(video.id)}:undefined);setRoute(old=>old.name==='watch'?{name:'watch',video}:old)}),
   listen<PlaylistQueue|undefined>('player-queue',({payload:q})=>setPlaylist(q??undefined)),
   listen<boolean>('player-autoplay',({payload:enabled})=>change(d=>({...d,settings:{...d.settings,autoplay:enabled}}))),
   listen<{video:Video;start:number}>('player-closed',({payload:p})=>{setPlaybackRun(n=>n+1);setReturned({id:p.video.id,start:p.start??0});setFloating(null)})
  ];return()=>{subscriptions.forEach(off=>void off.then(f=>f()))}
 },[])
 const navActive=route.name
 const liveChannels=followIds.filter(id=>!!followedLive.states[id]?.video&&!followedLive.states[id]?.error)
 const sidebarFollows=[...liveChannels,...followIds.filter(id=>!liveChannels.includes(id))]
 return <VideoPreviews.Provider value={s.videoPreviews}><div data-platform={isMac?'mac':'windows'} className={'app '+(s.collapsed?'collapsed ':'')+(s.density==='compact'?'compact':'')}>
 {notice&&<div className="viddy-toast" role="status" key={notice}><span aria-hidden="true">✦</span>{notice}</div>}<BrandIntro enabled={ready&&s.intro}/><header className="top" data-tauri-drag-region><div className="header-brand" data-tauri-drag-region>{true&&<button className="icon top-menu" aria-label={s.collapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!s.collapsed} disabled={!ready} onClick={()=>setting('collapsed',!s.collapsed)}><Menu size={23}/></button>}<button className="brand" aria-label="Viddy Home" onClick={()=>go({name:'home'})}><BrandLockup/></button></div>
 <div className="header-center" data-tauri-drag-region>{ <SearchBar inputRef={searchRef} ready={ready} text={text} setText={setText} submit={submit}/>}</div>
 <div className="header-actions">{true&&<>
 <button className="icon theme" aria-label={'Switch to '+(s.theme==='dark'?'light':'dark')+' theme'} disabled={!ready} onClick={()=>setting('theme',s.theme==='dark'?'light':'dark')}>{s.theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button>
 {updates.release&&<button className="button accent" onClick={()=>{go({name:'settings'});setUpdateSettingsRequest(n=>n+1)}}>Update available</button>}
</>}
 <WindowControls/></div>
 </header>
 {true&&<aside className="sidebar"><nav aria-label="Main navigation">{nav.filter(item=>["home","discover","following","live"].includes(item.id)).map(({id,name,Icon})=><button title={name} className={navActive===id?'selected':''} aria-current={navActive===id?'page':undefined} aria-label={name} key={id} onClick={()=>go({name:id})}><Icon size={19}/><span>{name}</span>{id==='live'&&liveChannels.length>0&&<span className="nav-live-count">{liveChannels.length}</span>}</button>)}</nav>
 <div className="sidebar-section"><p className="sidebar-section-label">You</p><nav aria-label="Your library">{nav.filter(item=>["library","later","history"].includes(item.id)).map(({id,name,Icon})=><button title={name} className={navActive===id?'selected':''} aria-current={navActive===id?'page':undefined} aria-label={name} key={id} onClick={()=>go({name:id})}><Icon size={19}/><span>{name}</span>{id==='live'&&liveChannels.length>0&&<span className="nav-live-count">{liveChannels.length}</span>}</button>)}<button aria-label="Downloads" className={route.name==='downloads'?'selected':''} onClick={()=>go({name:'downloads'})}><Download size={19}/><span>Downloads</span></button></nav></div>
 <div className="sidebar-section"><nav aria-label="Manage Viddy">{nav.filter(item=>["subscriptions","settings"].includes(item.id)).map(({id,name,Icon})=><button title={name} className={navActive===id?'selected':''} aria-current={navActive===id?'page':undefined} aria-label={name} key={id} onClick={()=>go({name:id})}><Icon size={19}/><span>{name}</span>{id==='live'&&liveChannels.length>0&&<span className="nav-live-count">{liveChannels.length}</span>}</button>)}</nav></div>
 {!s.collapsed&&followIds.length>0&&<nav className="sidebar-follows" aria-label="Followed creators"><p>Channels you follow <span className="following-count">{followIds.length}</span></p><div className="sidebar-follow-preview">{sidebarFollows.slice(0,5).map(id=>{const name=feeds.states[id]?.feed?.title??id;const broadcast=followedLive.states[id];const liveNow=broadcast?.video&&!broadcast.error;return <button key={id} title={liveNow?name+' — live now':name} onClick={()=>go({name:'channel',id})}><CreatorAvatar id={id} name={name}/><span className="follow-name">{name}</span>{liveNow&&<span className="sidebar-live">LIVE</span>}</button>})}</div></nav>}
 <div className="sidebar-footer">{s.showTime&&<SessionCounter counter={session}/>}
 <span className="sidebar-flourish" aria-hidden="true">✧</span></div></aside>}
 <main ref={main} className="content" id="main-content">
 {routes.current.length>0&&<button className="back" onClick={back}><ArrowLeft size={16}/> Back</button>}
 {error&&<Notice text={error}/>}
 {reminder&&<div className="notice row" role="status"><div className="grow">{reminder}</div><button className="icon small" aria-label="Dismiss reminder" onClick={()=>setReminder('')}><X size={15}/></button></div>}
 {liveAlerts.alerts.map(({id,title})=><div className="notice row wrap" role="status" key={id}><div className="grow"><strong>Now live:</strong> {title}</div><button className="button accent" onClick={()=>{liveAlerts.dismiss(id);go({name:'watch',video:{...linkVideo(id),title,live:true}})}}>Watch live</button><button className="icon small" aria-label="Dismiss live reminder" onClick={()=>liveAlerts.dismiss(id)}><X size={15}/></button></div>)}
 {ready&&!failed&&<>
  <div hidden={route.name!=='home'}><RecommendationFeed shared={shared} surface="home" active={route.name==='home'}/></div>
  {(visitedDiscover||route.name==='discover')&&<div hidden={route.name!=='discover'}><Discover shared={shared} active={route.name==='discover'}/></div>}
 </>}
 {failed?<Empty title="Could not load your local library" detail="Restart Viddy after checking your app data permissions."/>:!ready?<Loading/>:
 route.name==='home'||route.name==='discover'?null:
 route.name==='following'?<Quiet shared={shared}/>:
 route.name==='live'?<SearchPage key="live" shared={shared} query="lofi radio" liveOnly liveQuery={route.query} mode={route.mode} onLiveQuery={query=>setRoute({...route,query})} onMode={mode=>setRoute({...route,mode})}/>:
 route.name==='search'?<SearchPage key={route.query} shared={shared} query={route.query} selectedSource={route.source} onSourceChange={source=>setRoute({...route,source})}/>:
 route.name==='library'?<LibraryStudio shared={shared}/>:
 route.name==='downloads'?<DownloadsPage/>:
 route.name==='settings'?<><Heading label="PREFERENCES" title="Settings" detail="Make Viddy work the way you want."/><Preferences data={data} setting={setting} change={change} updates={updates} account={account}/></>:
 route.name==='subscriptions'?<Subscriptions shared={shared}/>:
 route.name==='channel'?<ChannelPage key={route.id} shared={shared} id={route.id} tab={route.tab} setTab={tab=>setRoute({...route,tab})}/>:
 route.name==='watch'?null:<LibraryPage key={route.name} shared={shared} kind={route.name}/>}
 {activeVideo&&<Watch key={activeVideo.id+':'+playbackRun} video={activeVideo} onOpenRoom={openRoom} roomPlayback={watchRoom.playback} inRoom={!!watchRoom.room} onRoomController={read=>{readRoomPlayback.current=read}} shared={shared} theater={theater} setTheater={setTheater} onSample={noteSample} onElapsed={session.add} playlist={playlist} onQueueChange={q=>{if(playlist?.name&&playlist.name!=='Queue')change(d=>playlist.name==='Favorites'?{...d,favorites:q?.ids??[]}:{...d,collections:d.collections.map(c=>c.name===playlist.name?{...c,ids:q?.ids??[]}:c)});setPlaylist(q);if(q&&q.ids[q.index]!==activeVideo.id){const video=data.savedVideos[q.ids[q.index]]??linkVideo(q.ids[q.index]);setPlaybackRun(n=>n+1);if(route.name==='watch')go({name:'watch',video});else setActiveVideo(video)}}} onQueueWatch={queueWatch} onQueueClose={()=>setPlaylist(undefined)} onQueueRepeat={()=>setPlaylist(q=>q?{...q,repeat:!q.repeat}:q)} docked={route.name!=='watch'} onRestore={()=>{let previous=-1;for(let i=routes.current.length-1;i>=0;i--)if(routes.current[i].route.name==='watch'&&(routes.current[i].route as {video:Video}).video.id===activeVideo.id){previous=i;break}if(previous>=0){const entry=routes.current[previous];routes.current=routes.current.slice(0,previous);restoreScroll.current=entry.scroll;setRoute({name:'watch',video:activeVideo})}else go({name:'watch',video:activeVideo})}} onStop={()=>{if(watchRoom.room)void watchRoom.leave();setActiveVideo(undefined);setPlaylist(undefined);if(floating)void invoke('close_player');setFloating(null)}} popped={floating?.video.id===activeVideo.id} returned={returned?.id===activeVideo.id?returned.start:undefined} onPopout={async(video,start)=>{await invoke('open_player',{payload:{video,start,theme:s.theme,accent:s.accent,autoplay:s.autoplay,playlist}});setFloating({video,start})}}/>}
 {true&&route.name!=='settings'&&<footer className="attribution"><button aria-label="Developed with YouTube; open YouTube" onClick={()=>invoke('open_info',{page:'youtube'}).catch(e=>setNotice(errorText(e)))}><img src={s.theme==='dark'?new URL('./youtube-light.png',import.meta.url).href:new URL('./youtube-dark.png',import.meta.url).href} alt="Developed with YouTube"/></button></footer>}
 </main><UpdateNotice updates={updates}/><WatchTogether session={watchRoom} canHost={!!activeVideo&&!floating&&!activeVideo.live&&!activeVideo.scheduledAt} dialog={roomDialog}/></div></VideoPreviews.Provider>
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('mini')?<MiniPlayer/>:<App/>)
