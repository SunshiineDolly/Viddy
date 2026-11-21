import {useEffect,useRef,useState} from 'react'
import type {AppUpdates} from './updates'

export function UpdateNotice({updates}:{updates:AppUpdates}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [dismissed,setDismissed]=useState('')
 const version=updates.release?.version,installing=updates.busy==='installing'
 const visible=!!version&&version!==dismissed
 useEffect(()=>{const node=dialog.current!;if(visible&&!node.open)node.showModal();else if(!visible&&node.open)node.close()},[visible])
 const dismiss=()=>{if(version&&!installing)setDismissed(version)}
 const progress=updates.progress,stage=progress?.event
 const status=updates.message||(!installing?'':stage==='installing'?'Installing. Viddy will restart automatically.':stage==='verifying'?'Verifying the signed update…':progress?.event==='downloading'&&progress.total?'Downloading · '+Math.min(100,Math.round(100*progress.downloaded/progress.total))+'%':'Downloading the signed update…')
 return <dialog ref={dialog} className="update-notice" aria-labelledby="update-notice-title" onCancel={event=>{event.preventDefault();dismiss()}}>
  <span className="eyebrow">Viddy update</span><h2 id="update-notice-title">Viddy {version} is ready</h2>
  <p>Install the update and restart Viddy. Your account, follows and library will be kept.</p>
  {status&&<p role="status">{status}</p>}
  <div className="row"><button className="button" disabled={installing} onClick={dismiss}>Later</button><button className="button accent" disabled={!!updates.busy} onClick={()=>void updates.install()}>{installing?'Updating…':'Update and restart'}</button></div>
 </dialog>
}
