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
   if(cmd==='load')return JSON.parse(localStorage.getItem('readability-library')??'null')??data;
   if(cmd==='save'){Object.assign(data,args.data);localStorage.setItem('readability-library',JSON.stringify(data));return null}
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
 const report={fixtureOnly:true,realLibraryTouched:false,platforms:[]};
 for(const platform of ['Win32','MacIntel']){
  await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port});await eventually(()=>value('!!window.queueFixture'));await value('localStorage.clear();localStorage.setItem("queue-platform",'+JSON.stringify(platform)+')');await call('Page.reload');
  await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'));await navigate('Settings');
  await eventually(()=>value('document.querySelector("select[aria-label]")?.value==="large"'));
  const choose=async size=>{await value('(()=>{const e=document.querySelector("select[aria-label]");e.value='+JSON.stringify(size)+';e.dispatchEvent(new Event("change",{bubbles:true}))})()');await eventually(()=>value('document.documentElement.dataset.interfaceSize==='+JSON.stringify(size)))};
  const metrics=()=>value('(()=>{const e=document.querySelector("select[aria-label]");return {body:parseFloat(getComputedStyle(document.documentElement).fontSize),control:e.getBoundingClientRect().height,width:document.documentElement.scrollWidth,viewport:innerWidth,settings:document.querySelector(".settings").scrollWidth,settingsWidth:document.querySelector(".settings").clientWidth}})()');
  for(const size of ['standard','large','extra-large']){
   await choose(size);
   for(const [width,height] of [[1600,900],[1024,720],[820,560]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(150);
    const m=await metrics();assert(m.width<=m.viewport+1,JSON.stringify({platform,size,...m}));assert(m.settings<=m.settingsWidth+1,JSON.stringify({platform,size,...m}));
    assert(m.body>=(size==='standard'?14:size==='large'?17.5:21));assert(m.control>=(size==='standard'?34:size==='large'?42.5:51));
    assert(await value('(()=>{const e=document.querySelector(".sidebar [aria-label=Settings]");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect(),s=e.closest(".sidebar").getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1})()'));
   }
  }
  await call('Page.reload');await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'));await navigate('Settings');await eventually(()=>value('document.querySelector("select[aria-label]")?.value==="extra-large"'));
  assert.equal(await value('document.documentElement.dataset.interfaceSize'),'extra-large');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await value('document.querySelector(".settings").scrollIntoView({block:"start"})');
  mkdirSync('artifacts',{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('artifacts/readability-'+platform+'.png',Buffer.from(shot.data,'base64'));
  await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port+'/?mini'});await eventually(()=>value('!!document.querySelector(".mini-player")'));assert.equal(await value('document.documentElement.dataset.interfaceSize'),'extra-large');
  report.platforms.push(platform);
 }
 report.largerByDefault=true;report.threeSizesFitWindows=true;report.settingSurvivesReload=true;report.popoutUsesSameSize=true;
 writeFileSync('artifacts/readability-verification.json',JSON.stringify(report,null,2));console.log(report);

} finally {
 try{await call('Browser.close')}catch{child.kill()}
 ws?.close()
 await new Promise(ok=>web.close(ok))
 if(child.exitCode===null)await Promise.race([new Promise(ok=>child.once('exit',ok)),wait(10000)])
 if(child.exitCode===null)child.kill()
 await wait(500)
 assert(root.startsWith(join(process.env.TEMP,'puretube-features-')))
 rmSync(root,{recursive:true,force:true,maxRetries:30,retryDelay:300})
}
