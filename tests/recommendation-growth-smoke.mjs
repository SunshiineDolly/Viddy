import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {resolve,join,extname,sep} from 'node:path'
import http from 'node:http'
import {setTimeout as wait} from 'node:timers/promises'
import net from 'node:net'

// Deterministic frontend stress test in a fresh browser profile. No user data or public requests.
const root=mkdtempSync(join(process.env.TEMP,'puretube-features-'))
const web=http.createServer(async(req,res)=>{
 const path=resolve('dist','.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(resolve('dist')+sep)){res.writeHead(404).end();return}
 try{const {readFile}=await import('node:fs/promises');const data=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream');res.end(data)}catch{res.writeHead(404).end()}
}).listen(0,'127.0.0.1');await new Promise(ok=>web.once('listening',ok));
const server=net.createServer().listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));const port=server.address().port;await new Promise(ok=>server.close(ok))
const edge=process.env.EDGE_EXE??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const child=spawn(edge,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port='+port,'--user-data-dir='+root,'about:blank'],{stdio:'ignore'})
let ws,seq=0
async function eventually(task,ms=40000){let last;const until=Date.now()+ms;while(Date.now()<until){try{const answer=await task();if(answer)return answer}catch(e){last=e}await wait(200)}throw Error('Feature check timed out'+(last?': '+last.message:''))}
async function pages(){return (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)})).json()}
async function connect(target){const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true})});return socket}
function call(method,params={},socket=ws){const id=++seq;return new Promise((ok,no)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',receive);no(Error('CDP timed out: '+method))},25000);function receive(e){const m=JSON.parse(e.data);if(m.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',receive);m.error?no(Error(m.error.message)):ok(m.result)}socket.addEventListener('message',receive);socket.send(JSON.stringify({id,method,params}))})}
async function value(expression,socket=ws){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},socket);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.exception?.value??expression);return r.result.value}
const navigate=name=>value(`document.querySelector('.sidebar [aria-label=${JSON.stringify(name)}]').click()`)


try {
 ws=await connect(await eventually(async()=>(await pages()).find(p=>p.type==='page')))
 await call('Page.enable')
 const fixture=`(()=>{
   const original=async(cmd,args)=>{
   if(cmd==='load')return {version:1,settings:{intro:false,tray:false,themedCursor:false}};
   if(cmd==='account_configured'||cmd==='update_configured')return false;
   if(cmd==='plugin:app|version')return '0.26.0';
   if(cmd==='plugin:event|listen')return 1;
   if(cmd==='plugin:window|is_maximized')return false;
   if(cmd==='account_restore'||cmd==='update_check')return null;
   if(cmd==='feed')return [];
   return null;
  }
  window.__TAURI_INTERNALS__={invoke:original,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,unregisterCallback:()=>{}};
`+
 `

  window.fixture={hold:true,pending:[],original,epoch:Date.now(),sources:new Map(),queries:new Set(),calls:0,fail:false,statuses:{},videos:new Map()}
  const f=window.fixture,pixel='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  function batch(key,filter,cursor){
   if(f.fail)throw Error('Fixture temporarily unavailable')
   f.queries.add(key);f.calls++
   if(!f.sources.has(key))f.sources.set(key,f.sources.size+1)
   const source=f.sources.get(key),page=cursor?Number(cursor.token.split(':').at(-1)):0
   const prefix=filter==='live'?'L':filter==='scheduled'?'S':'D'
   const items=Array.from({length:24},(_,i)=>{
    const n=source*10000+page*100+i,id=prefix+String(n).padStart(10,'0')
    const v={id,title:'Explore fixture '+n,description:'Public fixture metadata',metadataComplete:true,channelId:'UC'+String(n%96).padStart(22,'0'),channel:'Fixture creator '+(n%96),image:pixel,channelImage:pixel,date:'2026-11-20',duration:filter==='all'||filter==='latest'?120:0,shorts:false,paid:false,embeddable:true,live:filter==='live',upcoming:filter==='scheduled',scheduledAt:filter==='scheduled'?f.epoch+((n%48)+1)*60000:undefined}
    f.videos.set(id,v);return v
   })
   return {items,next:page<2?{token:source+':'+(page+1),version:'2.20261120.00.00'}:null}
  }
  window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
   if(cmd==='save'){f.saved=args.data;return null}
   if(cmd==='search_youtube'){if(f.hold)return new Promise(resolve=>f.pending.push(()=>resolve(batch(args.query+':'+args.filter,args.filter,args.cursor))));return batch(args.query+':'+args.filter,args.filter,args.cursor)}
   if(cmd==='scheduled_channel')return batch(args.channel,'scheduled',null).items.slice(0,4)
   if(cmd==='creator_photo'||cmd==='channel_live')return null
   if(cmd==='live_status'){const video=f.videos.get(args.id);return {status:f.statuses[args.id]??(video?.upcoming?'waiting':'live'),start:video?.scheduledAt?new Date(video.scheduledAt).toISOString():undefined}}
   return original(cmd,args)
  }
 })()`
 await call('Page.addScriptToEvaluateOnNewDocument',{source:fixture})
 await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port})
 const selector='.content > div:not([hidden]) .recommendations .card'
 const count=()=>value('document.querySelectorAll('+JSON.stringify(selector)+').length')
 const ids=()=>value('[...document.querySelectorAll('+JSON.stringify(selector)+')].map(e=>e.dataset.videoId)')
 await eventually(()=>value('window.fixture?.pending.length>=6'))
 await value('window.fixture.pending.shift()()')
 await eventually(async()=>await count()>0)
 assert(await value('window.fixture.pending.length>0'),'results must appear before all search sources finish')
 const first=await ids()
 await value('window.fixture.hold=false;window.fixture.pending.splice(0).forEach(resolve=>resolve())')
 await eventually(()=>value('document.querySelector(".new-mix-button")?.disabled===false'))
 assert.deepEqual((await ids()).slice(0,first.length),first,'late results must not rearrange visible cards')
 const save=selector+' [aria-label="Save to Watch Later"]'
 await value('document.querySelector('+JSON.stringify(save)+').click()')
 await eventually(()=>value('window.fixture.saved?.later.length===1'))
 await value('document.querySelector(".content").scrollTop=document.querySelector(".content").scrollHeight')
 await eventually(()=>value('[...window.fixture.queries].some(query=>query.startsWith("Fixture creator"))'))
 await eventually(()=>value('document.querySelector(".new-mix-button")?.disabled===false'))
 const baseline=await ids()
 for(let n=0;n<100&&await count()<650;n++){
  const before=await count()
  await value('document.querySelector(".content").scrollTop=document.querySelector(".content").scrollHeight')
  await eventually(async()=>await count()>before||await value('!!document.querySelector(".content > div:not([hidden]) .auto-more button")'),15000)
  if(await value('!!document.querySelector(".content > div:not([hidden]) .auto-more button")'))await value('document.querySelector(".content > div:not([hidden]) .auto-more button").click()')
 }
 assert(await count()>=650,'Home must continue growing beyond its initial mix')
 assert.deepEqual((await ids()).slice(0,baseline.length),baseline)
 const beforeFailure=await ids()
 await value('window.fixture.fail=true;document.querySelector(".content").scrollTop=document.querySelector(".content").scrollHeight')
 await eventually(()=>value('!!document.querySelector(".content > div:not([hidden]) .auto-more button")'),15000)
 assert.deepEqual(await ids(),beforeFailure,'failed loading must preserve every existing card')
 await value('window.fixture.fail=false;document.querySelector(".content > div:not([hidden]) .auto-more button").click()')
 await eventually(async()=>await count()>beforeFailure.length,15000)
 const all=await ids();assert.equal(all.length,new Set(all).size)
 const report={platform:await value('navigator.platform'),cards:all.length,firstResultsBeforeSlowSources:true,bookmarkChangesFuturePagesWithoutRefresh:true,scrollPreservesExistingCards:true,failedPaginationPreservesResults:true,retryRecovers:true,noDuplicateVideos:true,syntheticLibraryOnly:true}
 mkdirSync('artifacts',{recursive:true})
 writeFileSync('artifacts/recommendation-growth-'+report.platform+'.json',JSON.stringify(report,null,2));console.log(report)
} finally {
 try{await call('Browser.close')}catch{child.kill()}
 ws?.close();await new Promise(ok=>web.close(ok));await wait(500)
 assert(root.startsWith(join(process.env.TEMP,'puretube-features-')))
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:300})
}
