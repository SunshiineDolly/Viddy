import {unique,visible,type Video} from './domain.ts'
import {categoryFor} from './topics.ts'
import {relatedQuery,recommendationTaste} from './recommendations.ts'
import type {Library} from './library.ts'
export function nextVideos(current:Video,candidates:Video[],data:Library,played:string[]=[],related:string[]=[],limit=24){
 const topic=categoryFor(current),seen=new Set([current.id,...played])
 const currentWords=new Set(relatedQuery(current).split(' ').filter(Boolean))
 const upstream=new Map(related.map((id,i)=>[id,Math.max(12,65-i)]))
 const taste=recommendationTaste(data),follows=new Set(data.follows),dismissed=new Set(data.dismissed)
 const score=(v:Video)=>{
  const category=categoryFor(v)??'',words=relatedQuery(v).split(' ')
  return (upstream.get(v.id)??0)+Number(follows.has(v.channelId))*22
   +Number(!!current.channelId&&v.channelId===current.channelId)*28+Number(!!topic&&category===topic)*29
   +Number(data.preferredTopics.includes(category))*16+Math.min(4,words.filter(w=>currentWords.has(w)).length)*21
   +Math.min(20,(taste.categories[category]??0)*4)+Math.min(18,words.reduce((sum,w)=>sum+(taste.terms[w]??0)*2,0))
   +Math.min(16,(taste.creators[v.channelId||v.channel.toLowerCase()]??0)*4)
 }

 const cap=limit===Infinity?Math.max(4,Math.ceil(candidates.length/20)):4
 const titles=new Set<string>(),buckets=new Map<string,Video[]>()
 const eligible=unique(candidates).filter(v=>!seen.has(v.id)&&!(data.settings.history&&data.history[v.id])&&!(data.settings.progress&&data.progress[v.id]?.at>0)&&!v.live&&!v.upcoming&&!v.scheduledAt&&v.embeddable&&!dismissed.has(v.id)&&visible(v,data.settings))
 const scores=new Map(eligible.map(v=>[v.id,score(v)]))
 for(const video of eligible.sort((a,b)=>scores.get(b.id)!-scores.get(a.id)!)){
  const title=video.title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()||video.id
  if(titles.has(title))continue;titles.add(title)
  const creator=video.channelId||video.channel;const group=buckets.get(creator)??[];if(group.length<cap)group.push(video);buckets.set(creator,group)
 }
 const result:Video[]=[]
 for(let round=0;round<cap;round++)for(const group of buckets.values())if(group[round]&&result.length<limit)result.push(group[round])
 return result
}
