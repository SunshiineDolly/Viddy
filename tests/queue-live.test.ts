import {test} from 'node:test'
import assert from 'node:assert/strict'
import {moveQueue,removeQueue,selectQueueVideo} from '../src/queue-edit.ts'
import {mixLive} from '../src/live-mix.ts'
import {makeSources} from '../src/live-sources.ts'
import type {Video} from '../src/domain.ts'

test('opening queued or unrelated videos retains the queue, repeat and remaining order',()=>{
 const original={name:'Saved playlist',ids:['a','b','c'],index:0,repeat:true}
 const selected=selectQueueVideo(original,'b')!
 assert.deepEqual(selected,{...original,index:1})
 const inserted=selectQueueVideo(selected,'new')!
 assert.deepEqual(inserted,{name:'Queue',ids:['a','b','new','c'],index:2,repeat:true})
 assert.deepEqual(original.ids,['a','b','c'])
 assert.equal(selectQueueVideo(inserted,'new'),inserted)
 assert.equal(selectQueueVideo(undefined,'new'),undefined)
 assert.deepEqual(selectQueueVideo({...original,index:2},'new')?.ids,['a','b','c','new'])
})
test('queue edits retain the playing item and choose a neighbor when it is removed',()=>{
 const q={name:'Queue',ids:['a','b','c'],index:1,repeat:false}
 const moved=moveQueue(q,0,2);assert.deepEqual(moved.ids,['b','c','a']);assert.equal(moved.index,0)
 assert.equal(removeQueue(q,0)?.index,0)
 assert.deepEqual(removeQueue(q,1)?.ids,['a','c']);assert.equal(removeQueue(q,1)?.index,1)
 assert.equal(removeQueue({...q,ids:['a'],index:0},0),undefined)
 assert.deepEqual(q.ids,['a','b','c'])
})
test('All streams interleaves categories even when Gaming has many more creators',()=>{
 const v=(n:number,category:string):Video=>({id:String(n),category,channelId:'creator'+n,channel:'Creator',title:'Video',description:'',date:'',image:'',duration:0,shorts:false,paid:false,embeddable:true,live:true})
 const items=[...Array.from({length:20},(_,n)=>v(n,'Gaming')),v(21,'Music'),v(22,'Nature'),v(23,'News')]
 assert.deepEqual(mixLive(items,'live','').slice(0,4).map(v=>v.category),['Gaming','Music','Nature','News'])
 assert.ok(mixLive(items.filter(v=>v.category==='Gaming'),'live','Gaming').every(v=>v.category==='Gaming'))
})

test('scheduled streams show the earliest start first and unknown times last',()=>{
 const v=(id:string,category:string,at?:number):Video=>({id,category,channelId:id,channel:id,title:id,description:'',date:'',image:'',duration:0,shorts:false,paid:false,embeddable:true,upcoming:true,scheduledAt:at})
 const result=mixLive([v('late','Music',300),v('unknown','Gaming'),v('soon','Music',100),v('next','Sports',200),{...v('already-live','News',50),live:true}],'scheduled','')
 assert.deepEqual(result.map(v=>v.id),['soon','next','late','unknown'])
})

test('scheduled discovery includes every followed channel beyond the old first 30',()=>{
 const follows=Array.from({length:85},(_,i)=>'UC'+String(i).padStart(22,'0'))
 const sources=makeSources('scheduled','',follows)
 assert.deepEqual(new Set(sources.filter(s=>s.topic==='Following').map(s=>s.channel)),new Set(follows))
 assert(sources.some(s=>s.topic==='Music'&&s.channel))
 assert(sources.some(s=>s.query&&s.topic==='Nature'))
})
