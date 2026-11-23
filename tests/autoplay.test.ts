import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nextVideos} from '../src/autoplay.ts'
import {empty,decode} from '../src/library.ts'
import type {Video} from '../src/domain.ts'
import {fillCreator} from '../src/domain.ts'
const video=(id:string,channelId='creator',category='Gaming'):Video=>({id,title:id,channelId,channel:channelId,category,description:'',date:'',image:'',duration:60,embeddable:true,shorts:false,paid:false})
test('autoplay favors followed and related creators without replaying the current or queued history',()=>{
 const data=empty();data.follows=['followed'];const current=video('current0000')
 const followed=video('followed000','followed'),related=video('related0000','new-creator'),other=video('other000000','other','Food')
 const result=nextVideos(current,[other,related,followed,current,followed],data,['other000000'])
 assert.deepEqual(result.map(v=>v.id),[followed.id,related.id])
})
test('autoplay excludes Shorts, live, scheduled, unembeddable, blocked and dismissed videos',()=>{
 const data=empty(),items=Array.from({length:7},(_,i)=>video('candidate0'+i,'creator'+i))
 items[0].shorts=true;items[1].live=true;items[2].scheduledAt=Date.now()+10000;items[3].embeddable=false;data.settings.blocked=['creator4'];data.dismissed=[items[5].id]
 assert.deepEqual(nextVideos(video('current0000'),items,data).map(v=>v.id),[items[6].id])
})
test('autoplay preference survives library decoding and old profiles get the new setting',()=>{
 const data=empty();data.settings.autoplay=false
 assert.equal(decode(data).settings.autoplay,false)
 const old=JSON.parse(JSON.stringify(data));delete old.settings.autoplay
 assert.equal(decode(old).settings.autoplay,true)
})
test('older channel cards recover the known creator name without overwriting collaborator credits',()=>{
 const item=video('older000000','followed');item.channel='';item.creators=[{id:'followed',name:''},{id:'collaborator',name:'Guest creator'}]
 const result=fillCreator(item,'Followed creator','https://example.com/avatar.png')
 assert.equal(result.channel,'Followed creator')
 assert.equal(result.creators?.[0].name,'Followed creator')
 assert.equal(result.creators?.[1].name,'Guest creator')
})

test('recommendations deduplicate titles and interleave creators',()=>{
 const data=empty();data.follows=['followed']
 const a=video('a0000000000','followed'),b=video('b0000000000','followed'),duplicate={...a,id:'c0000000000',title:'A0000000000 🔴'},other=video('d0000000000','other')
 assert.deepEqual(nextVideos(video('current0000'),[a,b,duplicate,other],data).map(v=>v.id),[a.id,other.id,b.id])
})

test('explicit profile topics shape autoplay with history disabled',()=>{
 const data=empty();data.settings.history=false;data.preferredTopics=['Food']
 const a=video('a0000000000','a','Travel'),b=video('b0000000000','b','Food')
 assert.equal(nextVideos(video('current0000','c','Music'),[a,b],data)[0].id,b.id)
})

test('Up next never promotes watched or started videos even from followed creators',()=>{
 const data=empty();data.follows=['followed'];const watched=video('seen0000000','followed'),started=video('begun000000','followed'),fresh=video('fresh000000','other')
 data.history[watched.id]=Date.now();data.progress[started.id]={at:2,duration:60,updated:Date.now()}
 assert.deepEqual(nextVideos(video('current0000'),[watched,started,fresh],data).map(v=>v.id),[fresh.id])
})

test('public watch-page recommendations outrank generic matches while keeping watched videos excluded',()=>{
 const data=empty(),current=video('current0000','current','Music'),generic=video('generic0000','a','Travel'),related=video('related0000','b','Travel'),watched=video('watched0000','c','Music');data.history[watched.id]=Date.now()
 assert.deepEqual(nextVideos(current,[generic,related,watched],data,[],[related.id,watched.id]).map(v=>v.id),[related.id,generic.id])
})

test('scrolling recommendations can grow beyond 24 without repeating IDs',()=>{
 const items=Array.from({length:80},(_,i)=>video(String(i).padStart(11,'0'),'creator'+(i%20)));const result=nextVideos(video('current0000'),items,empty(),[],[],Infinity);assert.equal(result.length,80);assert.equal(new Set(result.map(v=>v.id)).size,80)
})

test('Up next uses saved playlist subjects and creators even with history disabled',()=>{
 const data=empty();data.settings.history=false
 const saved={...video('saved000001','saved-creator','Art & design'),title:'Watercolor forest pigments'}
 data.savedVideos[saved.id]=saved;data.collections=[{name:'Painting',ids:[saved.id]}]
 const related={...video('related0001','saved-creator','Art & design'),title:'Watercolor forest layers'}
 const unrelated={...video('unrelated01','other','Music'),title:'Acoustic guitar session'}
 assert.equal(nextVideos(video('current0001','current','Film'),[unrelated,related],data)[0]?.id,related.id)
})
