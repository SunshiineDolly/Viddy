import {unique,uploadAge,visible,type Video} from './domain.ts'
import {rankedTopics,topicQuery,topics,categoryFor} from './topics.ts'
import type {Library} from './library.ts'

export type Surface='home'|'discover'
export function hash(value:string){
 let h=2166136261
 for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619)
 return h>>>0
}
const alternatives:Record<string,string[]>={
 'Style & beauty':['personal style outfit ideas','japanese street fashion','skincare routine makeup tutorial'],
 'Gaming':['new games gameplay review','cozy games lets play','gaming challenge funny moments'],
 'Music':['live studio music performance','new music acoustic session','music production behind the scenes'],
 'Food':['cooking recipes from around the world','food travel street food','home cooking baking recipes'],
 'Travel':['travel diary hidden places','walking tour travel documentary','a weekend in japan vlog'],
 'Learning':['how things work explained','history science educational documentary','interesting ideas explained'],
 'Home & lifestyle':['apartment tour interior design','a peaceful day at home','home organization makeover'],
 'Art & design':['artist studio creative process','sketchbook art tutorial','graphic design process'],
 'Vlogs':['weekend in my life vlog','daily life japan vlog','a day in my life'],
}
const genericWords=new Set('about after before best channel episode first from have here into latest like more most official part review series some than that their them then these things this today video videos vlog want watch what when where which while with world would your'.split(' '))
function titleWords(title:string){
 return [...new Set(title.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)
   ?.filter(word=>word.length>=3&&!/^\d+$/.test(word)&&!genericWords.has(word))??[])]
}
export const relatedQuery=(video:Video)=>titleWords(video.title).slice(0,7).join(' ')
export const labelRecommendation=(video:Video,fallback:string):Video=>({...video,category:categoryFor(video)??fallback})
const creatorKey=(v:Video)=>v.channelId||v.channel.toLowerCase()

export function viewingTaste(data:Library,now=Date.now()){
 const categories:Record<string,number>={},creators:Record<string,number>={},terms:Record<string,number>={}
 const examples:Video[]=[]
 if(!data.settings.history)return {categories,creators,terms,examples}
 const recent=Object.entries(data.history).filter(([id])=>data.savedVideos[id])
   .sort(([a,x],[b,y])=>(data.viewing[b]?.at??y)-(data.viewing[a]?.at??x)).slice(0,60)
 const engaged=recent.flatMap(([id,started])=>{
   const video=data.savedVideos[id],watch=data.viewing[id]
   const progress=data.settings.progress?data.progress[id]:undefined
   const seconds=watch?.seconds??progress?.at??0,duration=progress?.duration||video.duration
   const threshold=video.live?45:duration?Math.min(60,Math.max(12,duration*.18)):30
   const lastWatched=watch?.at??progress?.updated??started
   if(lastWatched<=(data.tasteResetAt??0)||seconds<threshold||data.dismissed.includes(id)||!visible(video,data.settings))return []
   const age=Math.max(0,now-lastWatched)/86_400_000
   const completion=!video.live&&duration>0?Math.min(1,seconds/duration):0
   const weight=(1+completion+Math.min(1.5,seconds/480))*2**(-age/14)
   return weight>=.2?[{video,weight}]:[]
 }).sort((a,b)=>b.weight-a.weight).slice(0,24)
 for(const {video,weight} of engaged){
   const category=categoryFor(video),creator=creatorKey(video)
   if(category)categories[category]=(categories[category]??0)+weight
   if(creator)creators[creator]=(creators[creator]??0)+weight
   for(const word of titleWords(video.title))terms[word]=(terms[word]??0)+weight
   examples.push(video)
 }
 return {categories,creators,terms,examples}
}
// Explicit saves remain useful with watch-history collection switched off.
// Count each video once, even if it belongs to several playlists, and bound
// each creator's contribution so a large playlist cannot take over the feed.
export function recommendationTaste(data:Library,now=Date.now()){
 const taste=viewingTaste(data,now),saved=new Map<string,number>(),creators=new Map<string,number>()
 const add=(ids:string[],weight:number)=>{for(const id of ids)if(data.savedVideos[id])saved.set(id,Math.max(weight,saved.get(id)??0))}
 add(data.favorites,2);add(data.later,1.2)
 for(const collection of data.collections)add(collection.ids,1.5)
 const dismissed=new Set(data.dismissed)
 for(const [id,weight] of saved){
  const video=data.savedVideos[id],creator=creatorKey(video)
  if(dismissed.has(id)||!visible(video,data.settings)||(creators.get(creator)??0)>=3)continue
  creators.set(creator,(creators.get(creator)??0)+1)
  const category=categoryFor(video)
  if(category)taste.categories[category]=(taste.categories[category]??0)+weight
  if(creator)taste.creators[creator]=(taste.creators[creator]??0)+weight
  for(const word of titleWords(video.title))taste.terms[word]=(taste.terms[word]??0)+weight
  if(!taste.examples.some(v=>v.id===id))taste.examples.push(video)
 }
 return taste
}

export function recommendationPlan(data:Library,surface:Surface,seed:number,knownVideos:Video[]=[]){
 const taste=surface==='home'?recommendationTaste(data):undefined
 const scores=Object.fromEntries(topics.map(t=>[t.name,(taste?.categories[t.name]??0)*6+(data.preferredTopics.includes(t.name)?8:0)
   +(data.settings.history?Math.min(data.interests[t.name]??0,6)*.4:0)]))
 const preferred=surface==='discover'?[]:rankedTopics(scores).filter(t=>scores[t.name]>0)
 const shuffled=[...topics].sort((a,b)=>hash(surface+seed+a.name)-hash(surface+seed+b.name))
 const chosen=unique([
   ...preferred.slice(0,3).map(t=>({...t,id:t.name})),
   ...shuffled.map(t=>({...t,id:t.name})),
 ]).slice(0,surface==='home'?6:8)
 const plan:{topic:string;query:string;filter:'all'|'latest'}[]=chosen.map((t,index)=>{
   const options=alternatives[t.name]??[topicQuery(t.name),topicQuery(t.name)+' documentary',topicQuery(t.name)+' ideas']
   return {topic:t.name,query:options[(seed+index)%options.length],filter:(index%2===0?'all':'latest') as 'all'|'latest'}
 })
 if(surface==='home'){
  const follows=new Set(data.follows),creators=new Map<string,Video>()
  const remembered=[...Object.values(data.savedVideos),...knownVideos].filter(v=>follows.has(v.channelId))
  for(const video of [...remembered,...taste!.examples])if(video.channel&&video.channel!=='Creator'&&visible(video,data.settings)){
   if(!creators.has(creatorKey(video)))creators.set(creatorKey(video),video)
  }
  const choices=[...creators.values()]
  for(let n=0;n<Math.min(3,choices.length);n++){
   const creator=choices[(seed+n)%choices.length]
   plan.push({topic:categoryFor(creator)??'From creators you watch',query:creator.channel+' latest videos',filter:'latest'})
  }
  const examples=taste!.examples.filter(v=>relatedQuery(v).split(' ').length>=2)
  const example=examples.length?examples[seed%examples.length]:undefined
  if(example)plan.push({topic:categoryFor(example)??'From your watch history',query:relatedQuery(example),filter:'all'})
 }
 return plan
}

export function followedCandidates(videos:Video[],data:Library,seed:number){
 const follows=new Set(data.follows),creators=new Map<string,Video[]>()
 for(const video of videos)if(follows.has(video.channelId)){
  const group=creators.get(video.channelId)??[]
  if(group.length<2)group.push(video)
  creators.set(video.channelId,group)
 }
 const groups=[...creators.values()],result:Video[]=[]
 for(let n=0;n<Math.min(48,groups.length);n++)result.push(...groups[(seed+n)%groups.length])
 return result
}

export function rankRecommendations(items:Video[],data:Library,seen:Record<string,number>,seed:number,excluded:Set<string>,limit=48,surface:Surface='home'){
 if(limit<=0)return []
 const now=Date.now(),personal=surface==='home',taste=personal?recommendationTaste(data,now):undefined
 const dismissed=new Set(data.dismissed),follows=new Set(data.follows)
 const watched=personal&&data.settings.history?data.history:{}
 const candidates=unique(items).filter(v=>!v.live&&!v.upcoming&&!v.scheduledAt&&!excluded.has(v.id)&&!dismissed.has(v.id)&&!watched[v.id]&&!(personal&&data.settings.history&&data.settings.progress&&data.progress[v.id]?.at>0)&&visible(v,data.settings))
 const affinities=new Map<string,number>()
 const score=(v:Video)=>{
   const exposure=seen[v.id]??0
   const penalty=exposure?Math.max(0,1-(now-exposure)/86_400_000)*1000:0
   const topic=categoryFor(v)??''
   const relevance=!taste?0:Math.min(36,(taste.categories[topic]??0)*5)
     +Math.min(34,(taste.creators[creatorKey(v)]??0)*8)
     +Math.min(70,titleWords(v.title).reduce((sum,word)=>sum+Math.min(25,(taste.terms[word]??0)*9),0))
     +(data.preferredTopics.includes(topic)?24:0)+(follows.has(v.channelId)?22:0)
     +(data.settings.history?Math.min(data.interests[topic]??0,8):0)
   affinities.set(v.id,relevance)
   return hash(seed+v.id)%19+relevance+Math.max(0,16-uploadAge(v)/86_400)-penalty
 }
 const scores=new Map(candidates.map(v=>[v.id,score(v)]))
 candidates.sort((a,b)=>scores.get(b.id)!-scores.get(a.id)!)
 const counts=new Map<string,number>(),titles=new Set<string>(),result:Video[]=[]
 for(const video of candidates){
   const creator=video.channelId||video.channel
   const title=video.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
   if((counts.get(creator)??0)>=2||titles.has(title))continue
   counts.set(creator,(counts.get(creator)??0)+1);titles.add(title);result.push(video)
 }
 if(personal&&result.some(v=>(affinities.get(v.id)??0)>=24)){
   const output:Video[]=[]
   while(result.length&&output.length<limit){
     const index=output.length%4===3?result.findIndex(v=>(affinities.get(v.id)??0)<24&&now-(seen[v.id]??0)>=86_400_000):-1
     output.push(...result.splice(Math.max(index,0),1))
   }
   return output
 }
 // On an untuned feed, alternate topics.
 const output:Video[]=[]
 while(result.length&&output.length<limit){
   const index=result.findIndex(v=>(!output.length||v.category!==output.at(-1)?.category)&&scores.get(result[0].id)!-scores.get(v.id)!<=24)
   output.push(...result.splice(index<0?0:index,1))
 }
 return output
}

export function appendRecommendations(existing:Video[],incoming:Video[],limit=Infinity){
 const result=unique(existing).slice(0,limit),ids=new Set(result.map(v=>v.id))
 const recent=result.slice(-24)
 const titleKey=(v:Video)=>v.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
 for(const v of incoming){
   if(result.length>=limit)break
   const creator=v.channelId||v.channel
   if(ids.has(v.id)||recent.some(item=>titleKey(item)===titleKey(v))||recent.filter(item=>(item.channelId||item.channel)===creator).length>=2)continue
   ids.add(v.id);result.push(v);recent.push(v)
   if(recent.length>24)recent.shift()
 }
 return result
}

// Explore the graph of creators and subjects already found instead of replaying
// the same first search pages after all continuations have been consumed.
export function expandRecommendationPlan(data:Library,surface:Surface,seed:number,items:Video[],searched:ReadonlySet<string>){
 const plan=recommendationPlan(data,surface,seed)
 for(const video of items){
   const topic=video.category??categoryFor(video)??'Explore'
   if(video.channel&&video.channel!=='Creator')plan.push({topic,query:Array.from(video.channel+' videos').slice(0,256).join(''),filter:'latest'})
   const subject=Array.from(relatedQuery(video)).slice(0,256).join('')
   if(subject.split(' ').length>=2)plan.push({topic,query:subject,filter:'all'})
 }
 const fresh=plan.filter(source=>!searched.has(source.filter+':'+source.query))
 const seen=new Set<string>()
 return fresh.filter(source=>{const key=source.filter+':'+source.query;if(seen.has(key))return false;seen.add(key);return true}).slice(0,8)
}
