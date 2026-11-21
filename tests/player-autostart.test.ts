import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

function player(mode='preview',autoplay='1',blocked=false){
 const messages:any[]=[],calls:string[]=[],nodes:any[]=[],timers=new Map<number,()=>void>();let sequence=0,events:any,state=-1,muted=false
 const parent={postMessage:(data:any)=>messages.push(data)},window:any={}
 const target={mute(){muted=true;calls.push('mute')},playVideo(){calls.push('play');if(blocked)events.onAutoplayBlocked();else{state=1;events.onStateChange({data:1})}},pauseVideo(){state=2;calls.push('pause');events.onStateChange({data:2})},getCurrentTime:()=>0,getDuration:()=>120,getPlayerState:()=>state,getVolume:()=>100,isMuted:()=>muted,getVideoUrl:()=>''}
 const context=vm.createContext({window,parent,location:{origin:'https://sunshiinedolly.github.io',hash:'#'+new URLSearchParams({id:'M7lc1UVf-VE',mode,autoplay,nonce:'test'})},URLSearchParams,document:{createElement:()=>({}),body:{appendChild:(node:any)=>nodes.push(node)}},addEventListener:()=>{},setInterval:()=>0,setTimeout:(fn:()=>void)=>{const id=++sequence;timers.set(id,fn);return id},clearTimeout:(id:number)=>timers.delete(id),YT:{Player:class{constructor(_frame:any,config:any){events=config.events;return target}}}})
 const source=readFileSync(new URL('../docs/player.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
 vm.runInContext(source,context);window.onYouTubeIframeAPIReady()
 const flush=()=>{for(let i=0;timers.size&&i<20;i++){const [id,fn]=timers.entries().next().value!;timers.delete(id);fn()}}
 return {messages,calls,nodes,events,target,flush}
}
test('selected videos explicitly start when ready, without a second player click',()=>{
 const p=player('watch');assert.equal(new URL(p.nodes[0].src).searchParams.get('autoplay'),'0')
 p.events.onReady({target:p.target});assert.deepEqual(p.calls,['play']);p.flush();assert.deepEqual(p.calls,['play'])
})
test('paused watch-together sessions do not auto-start',()=>{
 const p=player('watch','0');p.events.onReady({target:p.target});p.flush();assert.deepEqual(p.calls,[])
})
test('an early blocked event does not discard a preview before its muted start',()=>{
 const p=player();p.events.onAutoplayBlocked();assert.equal(p.messages.length,0)
 p.events.onReady({target:p.target});assert.deepEqual(p.calls,['mute','play']);assert(p.messages.some(m=>m.state==='playing'));assert(!p.messages.some(m=>m.state==='blocked'))
})
test('blocked preview retries remain muted and stop after three attempts',()=>{
 const p=player('preview','1',true);p.events.onReady({target:p.target});p.flush()
 assert.deepEqual(p.calls,['mute','play','mute','play','mute','play']);assert.equal(p.messages.filter(m=>m.state==='blocked').length,1)
})
test('a YouTube playback error cancels retries without bypassing the refusal',()=>{
 const p=player('preview','1',true);p.events.onReady({target:p.target});p.events.onError({data:150});p.flush();assert.equal(p.calls.filter(c=>c==='play').length,1)
})
