export class PreviewQueue {
 private load:(id:string)=>Promise<string>
 private pending:{id:string;signal:AbortSignal;resolve:(value:string)=>void;reject:(error:unknown)=>void;cancel:()=>void}[]=[]
 private running=false
 private cache=new Map<string,{at:number;url:string}>()
 private now:()=>number
 constructor(load:(id:string)=>Promise<string>,now=Date.now){this.load=load;this.now=now}
 request(id:string,signal:AbortSignal):Promise<string>{
  if(signal.aborted)return Promise.reject(new DOMException('Preview stopped','AbortError'))
  const old=this.cache.get(id)
  if(old&&this.now()-old.at<300_000)return Promise.resolve(old.url)
  return new Promise((resolve,reject)=>{
   const cancel=()=>{const at=this.pending.findIndex(task=>task.signal===signal);if(at>=0)this.pending.splice(at,1);signal.removeEventListener('abort',cancel);reject(new DOMException('Preview stopped','AbortError'))}
   signal.addEventListener('abort',cancel,{once:true})
   this.pending.push({id,signal,resolve,reject,cancel});void this.drain()
  })
 }
 invalidate(id:string){this.cache.delete(id)}
 private async drain(){
  if(this.running)return
  this.running=true
  try{while(this.pending.length){
   const task=this.pending.shift()!
   if(task.signal.aborted){task.signal.removeEventListener('abort',task.cancel);continue}
   try{
    const old=this.cache.get(task.id)
    const url=old&&this.now()-old.at<300_000?old.url:await this.load(task.id)
    this.cache.delete(task.id);this.cache.set(task.id,{at:this.now(),url})
    if(this.cache.size>128)this.cache.delete(this.cache.keys().next().value!)
    if(!task.signal.aborted)task.resolve(url)
   }catch(error){if(!task.signal.aborted)task.reject(error)}
   finally{task.signal.removeEventListener('abort',task.cancel)}
  }}finally{this.running=false}
 }
}
