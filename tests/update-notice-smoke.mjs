import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {resolve,join,extname,sep} from 'node:path'
import http from 'node:http'
import {setTimeout as wait} from 'node:timers/promises'
import net from 'node:net'

// Isolated preview integration check. Synthetic library; real public YouTube playback.
const root=mkdtempSync(join(process.env.TEMP,'puretube-features-'))
const web=http.createServer(async(req,res)=>{
 if(req.url.split('?')[0]==='/player.html'){res.setHeader('Content-Type','text/html');res.end(readFileSync('docs/player.html'));return}
 if(req.url.startsWith('/preview?')||req.url.startsWith('/player?')){
  const id=new URL(req.url,'http://localhost').searchParams.get('id');if(!/^[\w-]{11}$/.test(id??'')){res.writeHead(404).end();return}
  res.setHeader('Content-Type','text/html');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; style-src 'unsafe-inline'");res.end(readFileSync(req.url.startsWith('/player?')?'src-tauri/src/player-frame.html':'src-tauri/src/preview-player.html','utf8').replaceAll('{{ID}}',id).replaceAll('{{PORT}}',String(web.address().port)));return
 }
 const path=resolve('dist','.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
 if(!path.startsWith(resolve('dist')+sep)){res.writeHead(404).end();return}
 try{const {readFile}=await import('node:fs/promises');const data=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream');res.end(data)}catch{res.writeHead(404).end()}
}).listen(0,'127.0.0.1');await new Promise(ok=>web.once('listening',ok));
const server=net.createServer().listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));const port=server.address().port;await new Promise(ok=>server.close(ok))
const edge=process.env.EDGE_EXE??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const child=spawn(edge,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port='+port,'--user-data-dir='+root,'about:blank'],{stdio:'ignore'})
let ws,seq=0
async function eventually(task,ms=40000){let last;const until=Date.now()+ms;while(Date.now()<until){try{const answer=await task();if(answer)return answer}catch(e){last=e}await wait(200)}console.log(await value('({messages:window.previewMessages,cards:document.querySelectorAll(".card").length,frame:document.querySelector(".thumbnail-preview iframe")?.src,preview:document.querySelector(".thumbnail-preview iframe")?.contentDocument?.documentElement.outerHTML.slice(-1500),text:document.querySelector(".content")?.textContent.slice(0,500)})').catch(()=>null));throw Error('Feature check timed out'+(last?': '+last.message:''))}
async function pages(){return (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)})).json()}
async function connect(target){const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true})});return socket}
function call(method,params={},socket=ws){const id=++seq;return new Promise((ok,no)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',receive);no(Error('CDP timed out: '+method))},25000);function receive(e){const m=JSON.parse(e.data);if(m.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',receive);m.error?no(Error(m.error.message)):ok(m.result)}socket.addEventListener('message',receive);socket.send(JSON.stringify({id,method,params}))})}
async function value(expression,socket=ws){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},socket);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.exception?.value??expression);return r.result.value}
const navigate=name=>value(`document.querySelector('.sidebar [aria-label=${JSON.stringify(name)}]').click()`)

try {
 ws=await connect(await eventually(async()=>(await pages()).find(p=>p.type==='page')))

 await call('Page.enable')
 const fixture=`(()=>{
 Object.defineProperty(navigator,'platform',{value:localStorage.getItem('preview-platform')??'MacIntel'});
 const media=window.matchMedia.bind(window);window.matchMedia=q=>{const result=media(q);if(q==='(hover:hover)'||q==='(prefers-reduced-motion:reduce)')Object.defineProperty(result,'matches',{value:q==='(hover:hover)'||localStorage.getItem('preview-reduced')==='yes'});return result};
 window.YT={Player:class{constructor(frame,{events}){this.events=events;queueMicrotask(()=>events.onReady({target:this}))}destroy(){}mute(){this.muted=true}playVideo(){this.events.onStateChange({data:1})}}};
 const nativeInterval=window.setInterval;window.setInterval=(callback,delay,...args)=>{if(delay===30000)window.updatePoll=callback;return nativeInterval(callback,delay,...args)};
 const signedOut=localStorage.getItem('fixture-guest')==='yes';
 const id='discord:1234567890123456',video='jNQXAC9IVRw',creator='UC1234567890123456789012';
 const personal={version:1,profileName:'Private viewer',profileBio:'Private biography',follows:[creator],favorites:[video],later:[video],history:{[video]:123},collections:[{name:'Private playlist',ids:[video]}],progress:{[video]:{at:10,duration:100,updated:123}},interests:{private:100},viewing:{[video]:{seconds:20,at:123}},liveReminders:{[video]:{title:'Private event',at:Date.now()+600000}},settings:{intro:false,tray:false,themedCursor:false,keywords:['private filter']},savedVideos:{[video]:{id:video,title:'Private saved video',channel:'Private creator',channelId:creator,image:'',description:'',date:'',duration:100}}};
 const guest={version:1,settings:{intro:false,tray:false,themedCursor:false}};
 window.fixture={data:signedOut?guest:personal,personal};window.fixture.data.history={};window.fixture.data.progress={};window.fixture.data.viewing={};window.fixture.data.savedVideos={};window.fixture.data.liveReminders={};window.fixture.data.favorites=[];window.fixture.data.later=[];
 const sample={id:'jNQXAC9IVRw',title:'Preview sample',description:'Preview test',metadataComplete:true,channelId:'UC0000000000000000000002',channel:'Example creator',image:'',date:'2026-11-21',duration:120,shorts:false,paid:false,embeddable:true};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,unregisterCallback:()=>{},invoke:async(cmd,args={})=>{
  if(cmd==='save'){window.fixture.data=args.data;return null}
  if(cmd==='original_player'){window.fixture.originalWindows=(window.fixture.originalWindows??0)+1;return null}
  if(cmd==='youtube_embed_port')return PREVIEW_PORT;
  if(cmd==='youtube_player_url')return 'http://127.0.0.1:'+PREVIEW_PORT+'/player.html#'+new URLSearchParams({id:args.id,mode:args.mode});
  if(cmd==='load')return window.fixture.data;
  if(cmd==='library_profile')return signedOut?null:id;
  if(cmd==='account_configured')return true;
  if(cmd==='account_restore')return signedOut?null:{identity:{id,display_name:'Private viewer'},base:personal};
  if(cmd==='account_read')return {revision:1,data:personal};
  if(cmd==='account_write')return true;
  if(cmd==='account_sign_out'){localStorage.setItem('fixture-guest','yes');return null}
  if(cmd==='plugin:app|version')return '0.26.1';
  if(cmd==='plugin:event|listen')return 1;
  if(cmd==='public_feed')return '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Private creator</title></feed>';
  if(cmd==='search_youtube'||cmd==='channel_videos')return {items:[sample],next:null};
  if(cmd==='scheduled_channel')return [];
  if(cmd==='update_configured')return true;
  if(cmd==='update_check'){window.fixture.checkCount=(window.fixture.checkCount??0)+1;return window.fixture.release??null}
  if(cmd==='update_install'){window.fixture.installRequested=args.version;return new Promise(()=>{})}
  if(cmd==='plugin:window|is_maximized')return false;
  return null;
 }};
 })()`
 await call('Page.addScriptToEvaluateOnNewDocument',{source:fixture.replaceAll('PREVIEW_PORT',String(web.address().port))})
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port})
 await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'))
 await eventually(()=>value('typeof window.updatePoll==="function"'));
 assert.equal(await value('!!document.querySelector(".update-notice[open]")'),false);
 await value('window.fixture.release={version:"9.0.0"};window.updatePoll()');
 await eventually(()=>value('!!document.querySelector(".update-notice[open]")'));
 assert((await value('document.querySelector(".update-notice").textContent')).includes('9.0.0'));
 await value('[...document.querySelectorAll(".update-notice button")].find(b=>b.textContent==="Later").click()');
 await eventually(()=>value('!document.querySelector(".update-notice[open]")'));
 await value('window.updatePoll()');await wait(300);assert.equal(await value('!!document.querySelector(".update-notice[open]")'),false);
 await value('window.fixture.release={version:"9.0.1"};window.dispatchEvent(new Event("focus"))');
 await eventually(()=>value('!!document.querySelector(".update-notice[open]")'));
 await value('[...document.querySelectorAll(".update-notice button")].find(b=>b.textContent==="Update and restart").click()');
 await eventually(()=>value('window.fixture.installRequested==="9.0.1"'));
 assert.equal(await value('[...document.querySelectorAll(".update-notice button")].find(b=>b.textContent==="Updating…").disabled'),true);
 const report={runningAppDetectsRelease:true,pollIntervalSeconds:30,immediateDialogOnDetection:true,dismissedVersionDoesNotRepeat:true,newVersionPromptsAgain:true,focusRefreshWorks:true,updateButtonRequestsInstallation:true,realLibraryTouched:false};writeFileSync('artifacts/update-popup-verification.json',JSON.stringify(report,null,2));console.log(report);
} finally {
 try{await call('Browser.close')}catch{child.kill()}
 ws?.close()
 await new Promise(ok=>web.close(ok))
 await wait(500)
 assert(root.startsWith(join(process.env.TEMP,'puretube-features-')))
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:300})
}
