import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PreviewQueue} from '../src/preview-queue.ts'

test('preview requests stay serial and leaving a queued card prevents its source request',async()=>{
 const calls:string[]=[],complete=new Map<string,(url:string)=>void>()
 const queue=new PreviewQueue(id=>{calls.push(id);return new Promise(resolve=>complete.set(id,resolve))})
 const a=new AbortController(),b=new AbortController(),c=new AbortController()
 const first=queue.request('a',a.signal),second=queue.request('b',b.signal),third=queue.request('c',c.signal)
 const canceled=assert.rejects(second,{name:'AbortError'});b.abort();await canceled
 assert.deepEqual(calls,['a']);complete.get('a')!('https://example.com/a');await first
 await Promise.resolve();assert.deepEqual(calls,['a','c']);complete.get('c')!('https://example.com/c');await third
})
test('resolved preview URLs stay in memory briefly and expired sources are resolved again',async()=>{
 let time=0,calls=0;const queue=new PreviewQueue(async()=>{calls++;return 'https://example.com/'+calls},()=>time)
 assert.equal(await queue.request('a',new AbortController().signal),'https://example.com/1')
 assert.equal(await queue.request('a',new AbortController().signal),'https://example.com/1');assert.equal(calls,1)
 time=300001;assert.equal(await queue.request('a',new AbortController().signal),'https://example.com/2')
})
test('a failed preview does not block the next hover or poison retry',async()=>{
 let fail=true;const queue=new PreviewQueue(async id=>{if(fail)throw Error('Source unavailable');return id})
 await assert.rejects(queue.request('a',new AbortController().signal),/Source unavailable/)
 fail=false;assert.equal(await queue.request('a',new AbortController().signal),'a')
})
