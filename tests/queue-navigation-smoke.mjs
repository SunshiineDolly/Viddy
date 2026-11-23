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
 const path=resolve('dist','.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
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
 ws=await connect(await eventually(async()=>(await pages()).find(p=>p.type==='page')));
 await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://www.youtube.com/*','https://s.ytimg.com/*','https://i.ytimg.com/*']});
 const fixture=()=>{
  Object.defineProperty(navigator,'platform',{value:localStorage.getItem('queue-platform')??'Win32'});
  const ids=['jNQXAC9IVRw','M7lc1UVf-VE','aqz-KE-bpKQ'];
  const sample=id=>({id,title:'Video '+id,channel:'Creator',channelId:'UC1234567890123456789012',description:'',image:'',date:'2026-11-21',duration:100,shorts:false,paid:false,embeddable:true});
  const data={version:1,settings:{intro:false,tray:false,themedCursor:false,videoPreviews:false},collections:[{name:'Keep these videos',ids}],savedVideos:Object.fromEntries(ids.map(id=>[id,sample(id)]))};
  const callbacks=new Map(),listeners=new Map();let sequence=0;
  window.queueFixture={data,emit:(event,payload)=>{for(const fn of listeners.get(event)??[])fn({event,id:1,payload})},mini:{video:sample(ids[0]),start:0,theme:'dark',accent:'rose',autoplay:false,playlist:{name:'Queue',ids,index:0,repeat:false}}};
  window.YT={Player:class{destroy(){}mute(){}playVideo(){}getCurrentTime(){return 0}getDuration(){return 100}}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:location.search?'player':'main'},currentWebview:{label:'main'}},transformCallback:fn=>{callbacks.set(++sequence,fn);return sequence},unregisterCallback:()=>{},invoke:async(cmd,args={})=>{
   if(cmd==='plugin:event|listen'){const f=listeners.get(args.event)??[];f.push(callbacks.get(args.handler));listeners.set(args.event,f);return 1}
   if(cmd==='load')return data;
   if(cmd==='save'){Object.assign(data,args.data);return null}
   if(cmd==='watch_creator')return {id:'UC1234567890123456789012',name:'Creator',title:'Video',date:'2026-11-21',embeddable:true};
   if(cmd==='player_state')return window.queueFixture.mini;
   if(cmd==='player_video'){window.queueFixture.lastVideo=args.video;return null}
   if(cmd==='player_queue'){window.queueFixture.lastQueue=args.queue;return null}
   if(cmd==='related_videos'||cmd==='scheduled_channel')return [];
   if(cmd==='search_youtube'||cmd==='channel_videos')return {items:[],next:null};
   if(cmd==='public_feed')return '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>';
   if(cmd==='account_configured'||cmd==='update_configured'||cmd==='plugin:window|is_maximized')return false;
   if(cmd==='plugin:app|version')return '0.26.11';
   return null;
  }};
 };
 await call('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')()'});
 const ids=['jNQXAC9IVRw','M7lc1UVf-VE','aqz-KE-bpKQ'],other='dQw4w9WgXcQ';
 const queue=()=>value('[...document.querySelectorAll(".queue-entry img")].map(e=>e.src.split("/vi/")[1].split("/")[0])');
 const click=label=>value('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+').click()');
 const submit=async text=>{await value('(()=>{const e=document.querySelector(".searchbar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await value('document.querySelector(".searchbar").requestSubmit()')};
 const report={fixtureOnly:true,realLibraryTouched:false,platforms:[]};
 for(const platform of ['Win32','MacIntel']){
  await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port});await value('localStorage.setItem("queue-platform",'+JSON.stringify(platform)+')');await call('Page.reload');
  await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Library]:not(:disabled)")'));
  await navigate('Library');await eventually(()=>value('!!document.querySelector(".playlist-tile")'));
  await value('[...document.querySelectorAll(".playlist-tile")].find(e=>e.textContent.includes("Keep these videos")).click()');
  await value('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Play all").click()');
  await eventually(async()=>JSON.stringify(await queue())===JSON.stringify(ids));
  for(const page of ['Home','Discover','Settings']){await navigate(page);assert.deepEqual(await queue(),ids);assert(await value('!!document.querySelector(".watch-docked.dock-queue-open")'))}
  await eventually(()=>value('!!document.querySelector(".watch-docked.dock-queue-open")'));
  await click('Next playlist video');await eventually(()=>value('document.querySelector(".queue-entry [aria-current=true] img")?.src.includes("M7lc1UVf-VE")'));
  assert(await value('!!document.querySelector(".watch-docked.dock-queue-open")'));assert.deepEqual(await queue(),ids);
  await submit('cozy videos');assert.deepEqual(await queue(),ids);
  await submit('https://www.youtube.com/watch?v='+other);await eventually(async()=>(await queue()).length===4);
  const expected=[ids[0],ids[1],other,ids[2]];assert.deepEqual(await queue(),expected);
  assert.deepEqual(await value('window.queueFixture.data.collections[0].ids'),ids);
  await value('document.querySelector(".back").click()');assert.deepEqual(await queue(),expected);
  await click('Close mini player');await submit('https://www.youtube.com/watch?v='+ids[2]);await eventually(async()=>(await queue()).length===4);assert.deepEqual(await queue(),expected);
  await click('Close playlist queue');await eventually(()=>value('!document.querySelector(".playlist-player")'));
  // A separate pop-out renderer receives an existing queue and retains it on changes.
  await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port+'/?mini'});await eventually(()=>value('document.querySelectorAll(".queue-entry").length===3'));
  await value('window.queueFixture.emit("embedded-video",'+JSON.stringify(other)+')');await eventually(async()=>(await queue()).length===4);
  assert.deepEqual(await queue(),[ids[0],other,ids[1],ids[2]]);
  await value('window.queueFixture.emit("player-queue",{name:"Queue",ids:["jNQXAC9IVRw","dQw4w9WgXcQ"],index:1,repeat:true})');await eventually(async()=>(await queue()).length===2);
  await click('Next playlist video');await eventually(()=>value('window.queueFixture.lastVideo?.id==="jNQXAC9IVRw"'));
  assert.deepEqual(await queue(),[ids[0],other]);report.platforms.push(platform);
 }
 report.navigationPreservesQueue=true;report.videoChangesPreserveQueue=true;report.dockedPanelStaysOpen=true;report.searchAndBackPreserveQueue=true;report.savedPlaylistUnchanged=true;report.explicitClearWorks=true;report.popoutReceivesQueueChanges=true;
 mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/queue-navigation-verification.json',JSON.stringify(report,null,2));console.log(report);

} finally {
 try{await call('Browser.close')}catch{child.kill()}
 ws?.close()
 await new Promise(ok=>web.close(ok))
 await wait(500)
 assert(root.startsWith(join(process.env.TEMP,'puretube-features-')))
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:300})
}
