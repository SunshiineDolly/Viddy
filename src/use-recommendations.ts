import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {requestCatalog,type CatalogPage} from './catalog'
import {errorText,type Video} from './domain'
import {appendRecommendations,expandRecommendationPlan,followedCandidates,labelRecommendation,recommendationPlan,rankRecommendations,type Surface} from './recommendations'
import type {Library} from './library'

type Source={topic:string;query:string;filter:'all'|'latest';next:CatalogPage['next'];loaded:boolean;visited?:Set<string>}
type Feed={items:Video[];sources:Source[];seed:number;at:number;epoch?:number;planKey?:string;searched?:Set<string>;error?:string;busy:boolean;moreError?:string}
const sessions=new Map<Surface,Feed>()
let memoryVersion=0
const listeners=new Set<()=>void>()
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
export const recommendationIds=(surface:Surface)=>new Set(sessions.get(surface)?.items.map(v=>v.id)??[])
const exposures:Record<string,number>={}
let loaded=false,saveTimer:ReturnType<typeof setTimeout>|undefined
export function resetRecommendationMemory(){
 sessions.clear()
 Object.keys(exposures).forEach(id=>delete exposures[id])
 clearTimeout(saveTimer)
 try{localStorage.removeItem('puretube-recommendation-exposure')}catch{}
 memoryVersion++;listeners.forEach(listener=>listener())
}
function loadExposures(){
 if(loaded)return
 loaded=true
 try{
   const stored:unknown=JSON.parse(localStorage.getItem('puretube-recommendation-exposure')??'{}')
   if(stored&&typeof stored==='object')for(const [id,at]of Object.entries(stored)){
     if(/^[\w-]{11}$/.test(id)&&typeof at==='number'&&Date.now()-at<7*86_400_000)exposures[id]=at
   }
 }catch{}
}
function saveExposure(){
 clearTimeout(saveTimer)
 saveTimer=setTimeout(()=>{
   const entries=Object.entries(exposures).sort((a,b)=>b[1]-a[1]).slice(0,800)
   try{localStorage.setItem('puretube-recommendation-exposure',JSON.stringify(Object.fromEntries(entries)))}catch{}
 },500)
}

export function useRecommendations(surface:Surface,data:Library,knownVideos:Video[]=[]){
 const epoch=useSyncExternalStore(subscribe,()=>memoryVersion)
 const [feed,setFeed]=useState<Feed|undefined>(()=>sessions.get(surface))
 const [iteration,setIteration]=useState(0)
 const nextSource=useRef(0)
 const emptyBatches=useRef(0)
 const current=useRef(data),generation=useRef(0),working=useRef(false)
 const known=useRef(knownVideos);known.current=knownVideos
 current.current=data
 const sessionRef=useRef(feed);sessionRef.current=feed
 function store(next:Feed){if(epoch!==memoryVersion)return;next={...next,epoch};sessions.set(surface,next);sessionRef.current=next;setFeed(next)}
 const other=()=>new Set(sessions.get(surface==='home'?'discover':'home')?.items.map(v=>v.id)??[])
 useEffect(()=>{
   loadExposures()
   const cached=sessions.get(surface)
   if (!iteration && cached && !cached.busy && !cached.error) return
   let active=true
   const run=++generation.current
   const seed=(cached?.seed??Math.floor(Date.now()/1000))+1
   const plan=recommendationPlan(current.current,surface,seed,known.current)
   const planKey=JSON.stringify(plan)
   working.current=false
   emptyBatches.current=0
   const prior=new Set(cached?.items.map(v=>v.id)??[])
   const seen={...exposures}
   // A manual refresh should not immediately return the previous screen,
   // even if the pointer never intersected its cards.
   if(iteration>0)prior.forEach(id=>{seen[id]=Date.now()})
   const sources:Source[]=plan.map(p=>({...p,next:null,loaded:false}))
   const searched=new Set(plan.map(s=>s.filter+':'+s.query))
   const limit=surface==='home'?96:144,pool:Video[]=[],published:Video[]=[]
   let remaining=plan.length,success=false,error:string|undefined
   store({items:cached?.items??[],sources,seed,searched,planKey,at:Date.now(),busy:true})
   // Publish each completed search. A slow or failing source must not hold the
   // first usable results behind a Promise.allSettled barrier.
   const publish=()=>{
     if(!active||generation.current!==run)return
     const followed=surface==='home'?followedCandidates(known.current,current.current,seed):[]
     const ranked=rankRecommendations([...pool,...followed],current.current,seen,seed,other(),limit,surface)
     const next=appendRecommendations(published,ranked,pool.length?limit:12)
     published.splice(0,published.length,...next)
     store({items:published.length?[...published]:remaining?cached?.items??[]:success?[]:cached?.items??[],sources:[...sources],seed,searched,planKey,at:Date.now(),busy:remaining>0,error:remaining||success?undefined:error})
   }
   if(surface==='home'&&known.current.length)publish()
   plan.forEach((source,index)=>{
     void requestCatalog(source.query,source.filter,null,iteration>0).then(page=>{
       if(!active||generation.current!==run)return
       success=true;sources[index]={...sources[index],next:page.next,loaded:true}
       pool.push(...page.items.map(video=>labelRecommendation(video,source.topic)))
     },reason=>{error??=errorText(reason)}).finally(()=>{remaining--;publish()})
   })
   return ()=>{active=false;generation.current++}
 },[surface,iteration,epoch])
 const activeFeed=feed?.epoch===epoch?feed:undefined
 async function more(){
   if(working.current||!activeFeed||activeFeed.busy)return
   let base=activeFeed
   if(surface==='home'){
     const plan=recommendationPlan(current.current,surface,base.seed,known.current),planKey=JSON.stringify(plan)
     if(planKey!==base.planKey){
       const searched=new Set(base.searched)
       const fresh=plan.filter(s=>!searched.has(s.filter+':'+s.query)).map(s=>({...s,next:null,loaded:false}))
       fresh.forEach(s=>searched.add(s.filter+':'+s.query))
       base={...base,planKey,searched,sources:[...fresh,...base.sources.filter(s=>!s.loaded||s.next)].slice(0,24)}
       if(fresh.length)nextSource.current=0
     }
   }
   const order=base.sources.map((_,i)=>(nextSource.current+i)%base.sources.length)
   let sourceIndex=order.find(i=>!base.sources[i].loaded||base.sources[i].next)??-1
   if(sourceIndex<0){
     const seed=activeFeed.seed+1
     const searched=new Set(activeFeed.searched)
     let plan=expandRecommendationPlan(current.current,surface,seed,activeFeed.items,searched)
     if(!plan.length)plan=recommendationPlan(current.current,surface,seed)
     plan.forEach(s=>searched.add(s.filter+':'+s.query))
     const fresh:Source[]=plan.map(source=>({...source,next:null,loaded:false}))
     base={...base,seed,sources:fresh,searched,planKey:JSON.stringify(recommendationPlan(current.current,surface,seed,known.current))};sourceIndex=0
   }
   nextSource.current=(sourceIndex+1)%base.sources.length
   const source=base.sources[sourceIndex]
   working.current=true
   const run=generation.current
   store({...base,busy:true,moreError:undefined})
   try{
     const visited=new Set(source.visited)
     if(source.next)visited.add(source.next.token)
     let page=await requestCatalog(source.query,source.filter,source.next)
     const existing=new Set(sessionRef.current?.items.map(v=>v.id)??[])
     const exclusions=new Set([...other(),...existing])
     const rank=(items:Video[])=>rankRecommendations([...items.map(v=>labelRecommendation(v,source.topic)),...(surface==='home'?followedCandidates(known.current,current.current,base.seed+existing.size):[])],current.current,exposures,base.seed,exclusions,30,surface)
     let candidates=rank(page.items)
     for(let skip=0;!candidates.length&&page.next&&!visited.has(page.next.token)&&skip<2;skip++){
       const cursor=page.next
       visited.add(cursor.token)
       page=await requestCatalog(source.query,source.filter,cursor)
       candidates=rank(page.items)
       if(page.next?.token===cursor.token){page={...page,next:null};break}
     }
     if(generation.current!==run)return
     const latest=sessionRef.current!
     const sources=[...latest.sources]
     sources[sourceIndex]={...source,visited,loaded:true,next:page.next&& !visited.has(page.next.token)?page.next:null}
     const items=appendRecommendations(latest.items,candidates)
     emptyBatches.current=items.length===latest.items.length?emptyBatches.current+1:0
     store({...latest,items,sources,busy:false,moreError:emptyBatches.current>=Math.max(12,sources.length*2)?'No new matches in this mix. Choose another category or try a new mix.':undefined})
   }catch(error){if(generation.current===run)store({...sessionRef.current!,busy:false,moreError:errorText(error)})}
   finally{if(generation.current===run)working.current=false}
 }
 const target=useRef<HTMLDivElement>(null)
 useEffect(()=>{
   if(!target.current)return
   const observer=new IntersectionObserver(entries=>{
     for(const entry of entries){
       if(!entry.isIntersecting)continue
       const id=(entry.target as HTMLElement).dataset.videoId
       if(id){exposures[id]=Date.now();if(current.current.settings.history)saveExposure()}
       observer.unobserve(entry.target)
     }
   },{threshold:.6})
   target.current.querySelectorAll('[data-video-id]').forEach(node=>observer.observe(node))
   return ()=>observer.disconnect()
 },[activeFeed?.items])
 return {feed:activeFeed,target,refresh:()=>setIteration(n=>n+1),more,hasMore:!!activeFeed&&!activeFeed.error}
}
