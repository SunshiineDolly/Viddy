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
 const report={usedIsolatedProfile:true,realLibraryTouched:false,fixtureOnly:false}
 await call('Page.enable')
 const fixture=`(()=>{
 Object.defineProperty(navigator,'platform',{value:localStorage.getItem('preview-platform')??'MacIntel'});
 const media=window.matchMedia.bind(window);window.matchMedia=q=>{const result=media(q);if(q==='(hover:hover)'||q==='(prefers-reduced-motion:reduce)')Object.defineProperty(result,'matches',{value:q==='(hover:hover)'||localStorage.getItem('preview-reduced')==='yes'});return result};
 window.YT={Player:class{constructor(frame,{events}){this.events=events;queueMicrotask(()=>events.onReady({target:this}))}destroy(){}mute(){this.muted=true}playVideo(){this.events.onStateChange({data:1})}}};
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
  if(cmd==='update_configured'||cmd==='plugin:window|is_maximized')return false;
  return null;
 }};
 })()`
 await call('Page.addScriptToEvaluateOnNewDocument',{source:fixture.replaceAll('PREVIEW_PORT',String(web.address().port))})
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:'+web.address().port})
 await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'))
 const hover=async()=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await eventually(()=>value('!!document.querySelector(".content > div:not([hidden]) .card .thumbnail")'));const p=await value('(()=>{const r=document.querySelector(".content > div:not([hidden]) .card .thumbnail").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p})};
 const leave=()=>call('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
 await value('window.previewMessages=[];window.addEventListener("message",e=>{if(e.data?.type==="viddy-video-preview")window.previewMessages.push(e.data)})');
 console.log('Testing platform',await value('navigator.platform'));
 await hover();await eventually(()=>value('window.previewMessages?.some(m=>m.state==="playing")'),60000);
 assert.equal(await value('document.querySelectorAll(".thumbnail-motion-preview").length'),0);
 console.log('Mac player is playing');
 const source=await value('document.querySelector(".thumbnail-preview-mac iframe").contentDocument.querySelector("iframe").src');assert(source.startsWith('https://www.youtube.com/embed/'));assert.equal(new URL(source).searchParams.get('origin'),'http://127.0.0.1:'+web.address().port);
 const time=await value('document.querySelector(".thumbnail-preview-mac iframe").contentWindow.viddyPreviewPlayer.getCurrentTime()');await wait(1300);const later=await value('document.querySelector(".thumbnail-preview-mac iframe").contentWindow.viddyPreviewPlayer.getCurrentTime()');assert(later>time);
 await value('window.dispatchEvent(new MessageEvent("message",{origin:"https://example.invalid",data:{type:"viddy-video-preview",id:"jNQXAC9IVRw",state:"error"}}))');assert(await value('!!document.querySelector(".thumbnail-preview-mac iframe")'));
 report.macUsesVideoPlayer=true;report.playerTimeAdvances=true;report.noImageSubstitute=true;report.matchingHttpOrigin=true;report.invalidMessagesIgnored=true;
 await leave();await eventually(()=>value('!document.querySelector(".thumbnail-preview iframe")'));report.stopsOnLeave=true;
 if(process.env.VIDDY_FULL_PLAYER){
  await value('window.playerSamples=[];window.addEventListener("message",e=>{if(e.data?.type==="viddy-player")window.playerSamples.push(e.data)})');
  const click=await value('(()=>{const r=document.querySelector(".content > div:not([hidden]) .card .thumbnail").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...click});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...click});
  await eventually(()=>value('document.querySelector(".player iframe")?.src.includes("/player.html")'));
  await eventually(()=>value('window.playerSamples.some(s=>s.event==="sample"&&s.sample.time>1&&s.sample.state===1)'),60000);
  await eventually(()=>value('!!window.fixture.data.history?.jNQXAC9IVRw'));
  assert.equal(await value('window.fixture.originalWindows??0'),0);
  await value('(()=>{const f=document.querySelector(".player iframe"),u=new URL(f.src);f.contentWindow.postMessage({type:"viddy-player-command",nonce:new URLSearchParams(u.hash.slice(1)).get("nonce"),method:"pauseVideo",args:[]},u.origin)})()');
  await eventually(()=>value('window.playerSamples.at(-1)?.sample?.state===2'));
  report.macFullVideoPlaysInsideApp=true;report.playbackHistoryRecorded=true;report.playerCommandsWork=true;report.noAutomaticSeparateWindow=true;
 }
 if(!process.env.VIDDY_REAL_PREVIEW){
  await value('localStorage.setItem("preview-platform","Win32")');await call('Page.reload');await eventually(()=>value('navigator.platform==="Win32"'));await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'));await hover();await eventually(()=>value('!!document.querySelector(".thumbnail-preview[data-playing=true] iframe")'));
  assert((await value('document.querySelector(".thumbnail-preview iframe").src')).startsWith('https://www.youtube.com/embed/'));assert.equal(await value('!!document.querySelector(".thumbnail-preview-mac")'),false);report.windowsPlayerUnchanged=true;
  await value('Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"))');await eventually(()=>value('!document.querySelector(".thumbnail-preview iframe")'));report.stopsWhenHidden=true;
  await leave();await value('localStorage.setItem("preview-platform","Win32");localStorage.setItem("preview-reduced","yes")');await call('Page.reload');await eventually(()=>value('!!document.querySelector(".sidebar [aria-label=Settings]:not(:disabled)")'));await hover();await wait(1100);assert.equal(await value('!!document.querySelector(".thumbnail-preview iframe")'),false);report.reducedMotionRespected=true;
 }
 report.realYouTubePlayback=true;
 writeFileSync(process.env.VIDDY_REAL_PREVIEW?'artifacts/video-preview-public-verification.json':'artifacts/video-preview-verification.json',JSON.stringify(report,null,2));console.log(report);
} finally {
 try{await call('Browser.close')}catch{child.kill()}
 ws?.close()
 await new Promise(ok=>web.close(ok))
 await wait(500)
 assert(root.startsWith(join(process.env.TEMP,'puretube-features-')))
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:300})
}
