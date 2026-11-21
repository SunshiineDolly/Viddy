import {useEffect,useRef,useState} from 'react'
import {Channel,invoke} from '@tauri-apps/api/core'
import {getVersion} from '@tauri-apps/api/app'
import {errorText} from './domain'

type Update={version:string;notes?:string|null}
type Progress={event:'downloading';downloaded:number;total?:number|null}|{event:'verifying'|'installing'}
export function useUpdates(enabled:boolean) {
 const [configured,setConfigured]=useState<boolean>(),[release,setRelease]=useState<Update|null>(),[busy,setBusy]=useState<'checking'|'installing'|''>('')
 const [message,setMessage]=useState('')
 const [version,setVersion]=useState(''),[progress,setProgress]=useState<Progress>(),[lastChecked,setLastChecked]=useState<number>()
 const active=useRef(false)
 async function perform(phase:'checking'|'installing',task:()=>Promise<void>,silent=false) {
   if(active.current)return
   active.current=true;setBusy(phase)
   if(!silent)setMessage('')
   try{await task()}
   catch(e){if(!silent)setMessage(errorText(e))}
   finally{active.current=false;setBusy('')}
 }
 async function check(silent=false) {
   await perform('checking',async()=>{setRelease(await invoke<Update|null>('update_check'));setLastChecked(Date.now());if(!silent)setMessage('')},silent)
 }
 useEffect(()=>{
   if(!enabled)return
   void getVersion().then(setVersion).catch(()=>{})
   let mounted=true
   invoke<boolean>('update_configured').then(value=>{
     if(!mounted)return
     setConfigured(value)
     if(value)void check(true)
   }).catch(e=>{if(mounted){setConfigured(false);setMessage(errorText(e))}})
   return()=>{mounted=false}
 },[enabled])
 useEffect(()=>{
   if(!configured||!enabled)return
   const refresh=()=>{if(!document.hidden)void check(true)}
   const timer=setInterval(refresh,30_000)
   window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh)
   return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[configured,enabled])
 return {configured,release,busy,message,check,version,progress,lastChecked,
   install:()=>release?perform('installing',async()=>{setProgress(undefined);const channel=new Channel<Progress>();channel.onmessage=setProgress;await invoke('update_install',{version:release.version,progress:channel})}):Promise.resolve()
 }
}
export type AppUpdates=ReturnType<typeof useUpdates>
