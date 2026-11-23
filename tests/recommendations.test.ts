import {test} from 'node:test'
import assert from 'node:assert/strict'
import {appendRecommendations,expandRecommendationPlan,rankRecommendations,recommendationPlan,viewingTaste,recommendationTaste,followedCandidates} from '../src/recommendations.ts'
import {decode,empty,recordViewing} from '../src/library.ts'
import {visible,type Video} from '../src/domain.ts'

const video=(n:number,creator='creator-'+n):Video=>({
 id:String(n).padStart(11,'0'),title:'Video '+n,description:'',channelId:creator,channel:creator,date:'',image:'',duration:120,category:n%2?'Gaming':'Food',shorts:false,paid:false,embeddable:true,
})
test('Discover query choices and ranking ignore interests, preferences and followed creators',()=>{
 const neutral=empty(),personal=empty();personal.interests={Gaming:500,Food:1};personal.preferredTopics=['Gaming'];personal.follows=['creator-1']
 assert.deepEqual(recommendationPlan(personal,'discover',42),recommendationPlan(neutral,'discover',42))
 const items=Array.from({length:12},(_,n)=>video(n))
 assert.deepEqual(rankRecommendations(items,personal,{},42,new Set(),48,'discover'),rankRecommendations(items,neutral,{},42,new Set(),48,'discover'))
 assert.notDeepEqual(recommendationPlan(personal,'home',42),recommendationPlan(neutral,'home',42))
})
test('recommendations suppress watched, dismissed, Shorts, live, and the other page’s picks',()=>{
 const data=empty(),items=Array.from({length:9},(_,n)=>video(n))
 data.history[items[0].id]=Date.now();data.dismissed=[items[1].id]
 items[2].shorts=true;items[3].live=true;items[4].scheduledAt=Date.now()+10000
 const result=rankRecommendations(items,data,{},1,new Set([items[5].id]))
 assert.deepEqual(new Set(result.map(v=>v.id)),new Set(items.slice(6).map(v=>v.id)))
})
test('new candidates outrank recently displayed candidates and repeated creators are capped',()=>{
 const items=[video(1),video(2),video(3,'repeat'),video(4,'repeat'),video(5,'repeat')]
 const seen={[items[0].id]:Date.now()}
 const result=rankRecommendations(items,empty(),seen,1,new Set())
 assert.equal(result.at(-1)?.id,items[0].id)
 assert.equal(result.filter(v=>v.channelId==='repeat').length,2)
 const appended=appendRecommendations(result,[video(6,'repeat'),{...video(7),title:items[1].title}])
 assert.equal(appended.filter(v=>v.channelId==='repeat').length,2)
 assert.equal(appended.filter(v=>v.title===items[1].title).length,1)
})
test('a new mix rotates query sources while retaining a learned interest',()=>{
 const data=empty();data.interests.Gaming=12
 const first=recommendationPlan(data,'home',104)
 const second=recommendationPlan(data,'home',105)
 assert.equal(new Set(first.map(s=>s.topic)).size,6)
 assert.ok(first.some(s=>s.topic==='Gaming'))
 assert.notDeepEqual(first.map(s=>s.query),second.map(s=>s.query))
 assert.notDeepEqual(first.map(s=>s.query),recommendationPlan(data,'discover',104).map(s=>s.query))
})
test('discovery appends beyond the former 150-video ceiling without duplicates',()=>{
 const first=Array.from({length:150},(_,i)=>video(i))
 const next=Array.from({length:110},(_,i)=>video(150+i))
 const combined=appendRecommendations(first,[...first.slice(0,5),...next])
 assert.equal(combined.length,260)
 assert.equal(new Set(combined.map(v=>v.id)).size,260)
})

test('long discovery sessions keep all results and allow creators back after other videos',()=>{
 const first=[video(1,'returning'),video(2,'returning'),...Array.from({length:10_000},(_,i)=>video(100+i))]
 const result=appendRecommendations(first,[video(20_001,'returning'),video(20_002,'returning'),video(20_003,'returning'),first[0]])
 assert.equal(result.length,10_004)
 assert.deepEqual(result.slice(-2).map(v=>v.id),[video(20_001).id,video(20_002).id])
 assert.equal(new Set(result.map(v=>v.id)).size,result.length)
 assert.deepEqual(result.slice(0,first.length),first)
})

test('exhausted discovery searches expand into new creators and subjects without replaying queries',()=>{
 const data=empty(),searched=new Set(recommendationPlan(data,'discover',1).map(s=>s.filter+':'+s.query))
 const items=Array.from({length:40},(_,n)=>({...video(n),title:'Painting watercolor landscape technique '+n}))
 for(let round=0;round<12;round++){
  const plan=expandRecommendationPlan(data,'discover',1,items,searched)
  assert.ok(plan.length>0)
  for(const source of plan){const key=source.filter+':'+source.query;assert(!searched.has(key));searched.add(key)}
  items.push(...Array.from({length:12},(_,n)=>({...video(1000+round*12+n),title:'Newly found creator subject '+round+' '+n})))
 }
 assert(searched.size>80)
})
test('turning off history also stops using retained interests to select query sources',()=>{
 const data=empty(),plain=empty();data.interests.Gaming=15;data.settings.history=false;plain.settings.history=false
 assert.deepEqual(recommendationPlan(data,'home',104),recommendationPlan(plain,'home',104))
})

test('Home combines learned topics and known followed creators with exploration',()=>{
 const data=empty();data.interests.Gaming=12;data.interests.Food=10;const saved=video(80,'followed');saved.channel='Creator I follow';data.follows=['followed'];data.savedVideos[saved.id]=saved;const plan=recommendationPlan(data,'home',104);assert.ok(plan.some(s=>s.query.includes(saved.channel)));assert.ok(plan.some(s=>s.topic==='Gaming'));assert.ok(plan.some(s=>s.topic==='Food'));assert.ok(plan.length>=5)
})

test('Home learns a specific subject from real watch time and keeps Discover independent',()=>{
 const data=empty(),now=Date.now()
 const watched={...video(91),title:'Stardew Valley greenhouse layouts'}
 const skipped={...video(92),title:'French pastry techniques'}
 data.settings.progress=false
 for(const v of [watched,skipped]){data.savedVideos[v.id]=v;data.history[v.id]=now}
 data.viewing=recordViewing(data,watched.id,70,now)
 data.viewing=recordViewing(data,skipped.id,4,now)
 const loaded=decode(data)
 assert.deepEqual(viewingTaste(loaded,now).examples.map(v=>v.id),[watched.id])
 assert.ok(recommendationPlan(loaded,'home',11).some(s=>s.query.includes('stardew valley')))
 const related={...video(93),title:'Stardew Valley greenhouse upgrades'}
 const unrelated={...video(95),title:'Minecraft survival challenge'}
 const items=[skipped,watched,unrelated,related]
 assert.equal(rankRecommendations(items,loaded,{},11,new Set())[0].id,related.id)
 assert.deepEqual(rankRecommendations(items,loaded,{},11,new Set(),48,'discover'),rankRecommendations(items,empty(),{},11,new Set(),48,'discover'))
 loaded.tasteResetAt=now
 assert.deepEqual(viewingTaste(loaded,now).examples,[])
})

test('phrase filters match titles and descriptions without hiding unrelated substrings',()=>{
 const f={keywords:['cat','rage bait','C++','広告'],blocked:['blocked']}
 const base=video(99)
 assert.equal(visible({...base,title:'Wildcat habitats'},f),true)
 assert.equal(visible({...base,title:'Cat-shaped candles'},f),false)
 assert.equal(visible({...base,description:'About RAGE\n BAIT.'},f),false)
 assert.equal(visible({...base,title:'C++ for beginners'},f),false)
 assert.equal(visible({...base,title:'広告なし動画'},f),false)
 assert.equal(visible({...base,creators:[{id:'blocked',name:'Guest'}]},f),false)
})

test('explicit saves guide Home and Up next without enabling watch-history collection',()=>{
 for(const list of ['later','favorites','playlist'] as const){
  const data=empty();data.settings.history=false
  const saved={...video(500),title:'Watercolor forest pigments',category:'Art & design'}
  data.savedVideos[saved.id]=saved
  if(list==='playlist')data.collections=[{name:'Painting',ids:[saved.id]}];else data[list]=[saved.id]
  const related={...video(501),title:'Watercolor forest layering',category:'Art & design'}
  const unrelated={...video(502),title:'Minecraft survival challenge',category:'Gaming'}
  assert.equal(rankRecommendations([unrelated,related],data,{},17,new Set())[0]?.id,related.id,list)
  assert(recommendationPlan(data,'home',17).some(s=>s.query.includes('watercolor')),list)
  assert.deepEqual(rankRecommendations([unrelated,related],data,{},17,new Set(),48,'discover'),rankRecommendations([unrelated,related],empty(),{},17,new Set(),48,'discover'))
 }
})

test('duplicate playlist membership counts once and one large creator playlist has bounded influence',()=>{
 const data=empty(),saved=video(600,'one-creator');data.savedVideos[saved.id]=saved;data.favorites=[saved.id]
 const single=recommendationTaste(data)
 data.later=[saved.id];data.collections=Array.from({length:200},(_,i)=>({name:'Playlist '+i,ids:Array(20).fill(saved.id)}))
 assert.deepEqual(recommendationTaste(data),single)
 for(let n=1;n<300;n++){const v=video(600+n,'one-creator');data.savedVideos[v.id]=v;data.favorites.push(v.id)}
 assert.equal(recommendationTaste(data).creators['one-creator'],6)
 assert.equal(recommendationTaste(data).examples.length,3)
})

test('growing follows rotate across known feed creators instead of always searching the first creator',()=>{
 const data=empty(),known=Array.from({length:120},(_,i)=>({...video(1000+i,'follow-'+i),channel:'Known creator '+i}))
 data.follows=known.map(v=>v.channelId)
 const selected=new Set<string>()
 for(let seed=0;seed<120;seed++)for(const source of recommendationPlan(data,'home',seed,known))if(source.query.startsWith('Known creator'))selected.add(source.query)
 assert.equal(selected.size,120)
 const pool=followedCandidates([...known,{...video(9999),channel:'Not followed'}],data,110)
 assert.equal(pool.length,48);assert(pool.some(v=>v.channel==='Known creator 119'));assert(pool.some(v=>v.channel==='Known creator 0'))
 assert(pool.every(v=>data.follows.includes(v.channelId)))
})

test('large histories and follow lists retain exclusions, variety and an exploration lane',()=>{
 const data=empty(),now=Date.now()
 data.follows=Array.from({length:5000},(_,i)=>'follow-'+i)
 for(let n=0;n<5000;n++)data.history[video(n).id]=now
 data.dismissed=Array.from({length:5000},(_,i)=>video(5000+i).id)
 const saved={...video(20000,'follow-1'),title:'Watercolor forest pigments',category:'Art & design'}
 data.savedVideos[saved.id]=saved;data.later=[saved.id]
 const candidates=Array.from({length:1200},(_,n)=>({...video(10000+n,'follow-'+n),title:n%3?'Watercolor forest technique '+n:'Cooking new recipe '+n,category:n%3?'Art & design':'Food'}))
 const result=rankRecommendations([...candidates,video(1),video(5001)],data,{},19,new Set(),96)
 assert.equal(result.length,96);assert(result.every(v=>!data.history[v.id]&&!data.dismissed.includes(v.id)))
 assert(new Set(result.slice(0,20).map(v=>v.channelId)).size>=10)
 assert(result.slice(0,20).some(v=>v.category==='Food'))
})
