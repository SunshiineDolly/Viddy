import {invoke} from '@tauri-apps/api/core'
import {PreviewQueue} from './preview-queue'
let preparing:Promise<void>|undefined
export function prepareMacPreviews(){
 preparing??=invoke<void>('preview_prepare').catch(error=>{preparing=undefined;throw error})
 return preparing
}
const refresh=new Set<string>()
const queue=new PreviewQueue(async id=>{
 await prepareMacPreviews()
 const raw=await invoke<string>('preview_stream',{id,fresh:refresh.delete(id)}),url=new URL(raw)
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid preview source')
 if(url.username||url.password||url.hash)throw Error('Invalid preview source')
 return url.href
})
export function macPreviewSource(id:string,signal:AbortSignal){
 if(!/^[\w-]{11}$/.test(id))return Promise.reject(Error('Invalid preview video'))
 return queue.request(id,signal)
}

export function forgetMacPreview(id:string){queue.invalidate(id);refresh.add(id);if(refresh.size>128)refresh.delete(refresh.values().next().value!)}
