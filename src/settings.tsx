import {useEffect,useState} from 'react'
import {AccountSettings} from './account-settings'
import type {ViddyAccount} from './use-account'
import {copyPlaybackDiagnostics} from './playback-diagnostics'
import {isMac} from './platform'
import {invoke} from '@tauri-apps/api/core'
import {Palette,Shield,Monitor,Download,Upload,Trash2,PlaySquare,RefreshCw} from 'lucide-react'
import {errorText} from './domain'
import {ContentFilters} from './content-filters'
import {decode,empty,type Library,type Settings} from './library'
import type {AppUpdates} from './updates'
import {accents,palettes,paletteStyle} from './palettes'
import {resetRecommendationMemory} from './use-recommendations'
type SetSetting=<K extends keyof Settings>(key:K,value:Settings[K])=>void
function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}) {return <label className="toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/></label>}
export function Preferences({data,setting,change,updates,account}:{data:Library;setting:SetSetting;change:(fn:(d:Library)=>Library)=>void;updates:AppUpdates;account:ViddyAccount}) {
 const s=data.settings,[message,setMessage]=useState(''),[autostart,setAutostart]=useState(false),[busy,setBusy]=useState(false)
 useEffect(()=>{invoke<boolean>('startup',{enabled:null}).then(setAutostart).catch(e=>setMessage(errorText(e)))},[])
 async function action(fn:()=>Promise<void>) {setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(errorText(e))}finally{setBusy(false)}}
 const toggle=(k:'collapsed'|'history'|'progress'|'showTime'|'tray'|'closeToTray'|'autoplay'|'videoPreviews'|'intro'|'themedCursor',label:string)=><Toggle label={label} value={s[k]} onChange={v=>setting(k,v)}/>
 return <div className="settings">
 {message&&<p className="notice sticky" role="status">{message}</p>}
 <AccountSettings account={account}/>
 <section><h2><Palette/> Appearance</h2><label>Theme <select value={s.theme} onChange={e=>setting('theme',e.target.value as Settings['theme'])}><option value="dark">Dark</option><option value="light">Light</option></select></label>
 <div className="palette-options" role="group" aria-label="Color palette">{accents.map(accent=><button key={accent} type="button" className="palette-option" data-theme={s.theme} data-accent={accent} style={paletteStyle(s.theme,accent)} aria-pressed={s.accent===accent} onClick={()=>setting('accent',accent)}><span className="palette-preview" aria-hidden="true"><i/><i/><i/></span>{palettes[s.theme][accent]}</button>)}</div>
 <label>Interface size <select aria-label="Interface size" value={s.interfaceSize} onChange={e=>setting('interfaceSize',e.target.value as Settings['interfaceSize'])}><option value="standard">Standard · 100%</option><option value="large">Large · 125%</option><option value="extra-large">Extra large · 150%</option></select></label><p>Make text and controls easier to see. Saved on this device.</p>
 <label>Thumbnail density <select value={s.density} onChange={e=>setting('density',e.target.value as Settings['density'])}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>{toggle('collapsed','Collapse sidebar')}{toggle('themedCursor','Use Viddy’s themed cursor')}{toggle('intro','Play the Viddy intro on launch')}<button className="button" disabled={!s.intro} onClick={()=>window.dispatchEvent(new Event('viddy-intro'))}>Preview intro</button></section>
 <ContentFilters settings={s} onKeywords={values=>setting('keywords',values)} onBlocked={values=>setting('blocked',values)}/>
 <section><h2><PlaySquare/> Playback</h2><p>Videos start when selected. Use the player’s controls for playback or fullscreen. YouTube may show ads and related videos inside its player.</p>
 {isMac&&<button className="button" disabled={busy} onClick={()=>void action(async()=>{await copyPlaybackDiagnostics();setMessage('Playback diagnostics copied. This report contains no account or library data.')})}>Copy playback diagnostics</button>}
 {toggle('videoPreviews','Play muted video previews on hover')}{isMac&&<p>Video previews have their own control. Reduce Motion still limits interface animations.</p>}
 {toggle('autoplay','Autoplay recommendations after a video ends')}{toggle('progress','Track playback progress')}{toggle('showTime','Show viewing time this session')}
 <label>Daily viewing reminder (minutes; 0 disables) <input type="number" min="0" max="1440" value={s.reminder} onChange={e=>setting('reminder',Math.min(1440,Math.max(0,Math.floor(Number(e.target.value)||0))))}/></label>
 </section>
 <section><h2><Shield/> Privacy and library</h2>{toggle('history','Track watch history')}<p>Viddy saves your library and preferences on this device. Signing in also saves the supported library items to your Viddy account. An independent library backup in Documents/Viddy restores your follows, playlists, history and preferences after reinstalling on this PC. Export a backup to keep a copy elsewhere. Google receives requests for public search, feeds, thumbnails, and playback.</p>
 <div className="row wrap">{([['terms','YouTube Terms of Service'],['privacy','Google Privacy Policy']] as const).map(([page,label])=><button className="button" key={page} onClick={()=>void action(()=>invoke('open_info',{page}))}>{label}</button>)}</div>
 <div className="row wrap"><button className="button" disabled={busy} onClick={()=>void action(async()=>{if(await invoke('export_library',{data}))setMessage('Library backup saved.')})}><Download size={16}/> Export backup</button>
 <button className="button" disabled={busy} onClick={()=>void action(async()=>{const imported=await invoke<unknown>('import_library');if(!imported)return;const decoded=decode(imported);if(!confirm('Replace your current Viddy library and preferences with this backup?'))return;change(()=>decoded);setMessage('Library imported.')})}><Upload size={16}/> Import backup</button>
 <button className="button" onClick={()=>{if(confirm('Clear all watch history and category preferences?')){resetRecommendationMemory();change(d=>({...d,history:{},interests:{},viewing:{},savedVideos:Object.fromEntries(Object.entries(d.savedVideos).filter(([id])=>d.later.includes(id)||d.favorites.includes(id)||d.collections.some(c=>c.ids.includes(id))))}))}}}><Trash2 size={16}/> Clear history</button>
 <button className="button" onClick={()=>{resetRecommendationMemory();change(d=>({...d,interests:{},viewing:{},tasteResetAt:Date.now(),dismissed:[]}));setMessage('Recommendation preferences reset.')}}>Reset recommendations</button>
 <button className="button" onClick={()=>{if(confirm('Clear all saved playback positions?'))change(d=>({...d,progress:{}}))}}>Clear progress</button>
 <button className="button danger" onClick={()=>{if(confirm('Reset the local library and all preferences? If this library is linked to an account, the next sync will apply these removals on your other devices.')){resetRecommendationMemory();change(()=>empty())}}}>Reset local data</button></div></section>
 <section><h2><Monitor/> Desktop</h2><Toggle label={isMac?"Launch at login":"Launch on Windows startup"} value={autostart} onChange={v=>void action(async()=>setAutostart(await invoke<boolean>('startup',{enabled:v})))}/>{toggle('tray',isMac?'Minimize to the menu bar':'Minimize to the system tray')}{toggle('closeToTray','Keep Viddy running in the background when closed')}<p>Viddy remembers the window's position and size. {isMac?'Keep it in the Dock from its Dock menu.':'Pin it from the Start Menu or taskbar.'} Install a newer trusted release to update.</p></section>
 <section id="app-updates"><h2><RefreshCw/> App updates</h2>
 {updates.version&&<p className="meta">Viddy {updates.version}{updates.lastChecked?' · Checked '+new Date(updates.lastChecked).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):''}</p>}
 <p role="status">{updates.message|| (updates.configured===false?'Updates are unavailable in this test build.':updates.busy==='installing'?updates.progress?.event==='installing'?'Installing the update. Viddy will restart automatically.':updates.progress?.event==='verifying'?'Verifying the update signature...':updates.progress?.event==='downloading'&&updates.progress.total?'Downloading update · '+Math.min(100,Math.round(updates.progress.downloaded/updates.progress.total*100))+'%':'Downloading the signed update...':updates.busy==='checking'?'Checking for updates...':updates.release?'Viddy '+updates.release.version+' is ready to install.':updates.release===null?'You’re up to date.':'Viddy checks for updates automatically.')}</p>
 {updates.busy==='installing'&&<progress className="update-progress" aria-label="Update download progress" max={updates.progress?.event==='downloading'?updates.progress.total??undefined:undefined} value={updates.progress?.event==='downloading'&&updates.progress.total?updates.progress.downloaded:undefined}/>}
 {updates.release?.notes&&<details><summary>Release notes</summary><p className="description">{updates.release.notes}</p></details>}
 {!!updates.configured&&<div className="row wrap"><button className="button" disabled={!!updates.busy} onClick={()=>void updates.check()}>Check for updates</button>
 {updates.release&&<button className="button accent" disabled={!!updates.busy} onClick={()=>{if(confirm('Update to Viddy '+updates.release?.version+' and restart? Your follows, library, and preferences will be kept.'))void updates.install()}}>Update and restart</button>}</div>}</section>
 </div>
}
