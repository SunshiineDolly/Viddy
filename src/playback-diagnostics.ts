import {isMac} from './platform'
import {invoke} from '@tauri-apps/api/core'

type PlayerDiagnostic={mode:string;ready:boolean;lastEvent:string;attempts:number;state:number;error:number|null;build:string}
const recent:PlayerDiagnostic[]=[]
if(isMac)window.addEventListener('message',event=>{
 const data=event.data
 if(data?.type!=='viddy-player-diagnostic')return
 const frame=[...document.querySelectorAll('iframe')].find(frame=>frame.contentWindow===event.source)
 if(!frame)return
 let url:URL;try{url=new URL(frame.src)}catch{return}
 if(event.origin!==url.origin||!url.pathname.endsWith('/player.html'))return
 if(typeof data.ready!=='boolean'||typeof data.lastEvent!=='string'||!Number.isFinite(data.attempts)||!Number.isFinite(data.state))return
 recent.push({mode:data.mode==='preview'?'preview':'watch',ready:data.ready,lastEvent:data.lastEvent.slice(0,50),attempts:data.attempts,state:data.state,error:Number.isFinite(data.error)?data.error:null,build:typeof data.build==='string'?data.build.slice(0,20):'unknown'})
 if(recent.length>12)recent.shift()
})
export function copyPlaybackDiagnostics(){
 const contents=invoke<Record<string,unknown>>('playback_diagnostics').then(native=>JSON.stringify({...native,engine:navigator.userAgent,players:recent},null,2))
 // WebKit requires starting the clipboard write inside the click gesture.
 // Resolve the asynchronous native metadata through ClipboardItem instead.
 return navigator.clipboard.write([new ClipboardItem({'text/plain':contents.then(text=>new Blob([text],{type:'text/plain'}))})])
}
