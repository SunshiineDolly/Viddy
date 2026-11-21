import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

function player(mode='preview',autoplay='1',blocked=false){
 const messages:any[]=[],calls:string[]=[],nodes:any[]=[],timers=new Map<number,()=>void>();let sequence=0,receive:any,muted=false
 const parent={postMessage:(data:any)=>messages.push(data)},window:any={}
 const incoming=(event:string,info?:any,source:any=target,origin='https://www.youtube.com')=>receive({source,origin,data:JSON.stringify({event,info,id:1})})
 const target={postMessage(raw:string){const data=JSON.parse(raw);if(data.event!=='command')return;const name=data.func;if(name==='addEventListener')return;calls.push(name);if(name==='mute')muted=true;if(name==='playVideo'){if(blocked)incoming('onAutoplayBlocked');else{incoming('infoDelivery',{muted,currentTime:1,duration:120});incoming('onStateChange',1)}}}}
 const context=vm.createContext({window,parent,location:{origin:'https://sunshiinedolly.github.io',hash:'#'+new URLSearchParams({id:'M7lc1UVf-VE',mode,autoplay,nonce:'test'})},URLSearchParams,document:{createElement:()=>({contentWindow:target,addEventListener:()=>{}}),body:{appendChild:(node:any)=>nodes.push(node)}},addEventListener:(name:string,fn:any)=>{if(name==='message')receive=fn},setInterval:()=>0,clearInterval:()=>{},setTimeout:(fn:()=>void)=>{const id=++sequence;timers.set(id,fn);return id},clearTimeout:(id:number)=>timers.delete(id)})
 const source=readFileSync(new URL('../docs/player.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
 vm.runInContext(source,context)
 const flush=()=>{for(let i=0;timers.size&&i<20;i++){const [id,fn]=timers.entries().next().value!;timers.delete(id);fn()}}
 return {messages,calls,nodes,incoming,target,flush,window}
}
test('selected videos start through the embedded player connection without an external controller',()=>{
 const p=player('watch');assert.equal(p.nodes.length,1);assert.equal(new URL(p.nodes[0].src).searchParams.get('autoplay'),'0')
 p.incoming('onReady');assert.deepEqual(p.calls,['playVideo']);p.flush();assert.deepEqual(p.calls,['playVideo']);assert(p.messages.some(m=>m.event==='state'&&m.value===1))
})
test('paused watch-together sessions do not auto-start',()=>{
 const p=player('watch','0');p.incoming('onReady');p.flush();assert.deepEqual(p.calls,[])
})
test('an early blocked event does not discard a preview before its muted start',()=>{
 const p=player();p.incoming('onAutoplayBlocked');assert.equal(p.messages.length,0)
 p.incoming('onReady');assert.deepEqual(p.calls,['mute','playVideo']);assert(p.messages.some(m=>m.state==='playing'));assert(!p.messages.some(m=>m.state==='blocked'))
})
test('blocked preview retries remain muted and stop after three attempts',()=>{
 const p=player('preview','1',true);p.incoming('onReady');p.flush()
 assert.deepEqual(p.calls,['mute','playVideo','mute','playVideo','mute','playVideo']);assert.equal(p.messages.filter(m=>m.state==='blocked').length,1)
})
test('a YouTube playback error cancels retries without bypassing the refusal',()=>{
 const p=player('preview','1',true);p.incoming('onReady');p.incoming('onError',150);p.flush();assert.equal(p.calls.filter(c=>c==='playVideo').length,1)
})
test('untrusted messages cannot start playback and a failed handshake terminates',()=>{
 const p=player();p.incoming('onReady',null,{});p.incoming('onReady',null,p.target,'https://example.com');assert.deepEqual(p.calls,[])
 p.flush();assert.equal(p.window.viddyPlayerDiagnostic.lastEvent,'handshake-timeout');assert(p.messages.some(m=>m.state==='error'))
})
