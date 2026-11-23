import type {PlaylistQueue} from './playlist-queue'
// Opening a video selects it without discarding the rest of the listening session.
// A new video is inserted after the current one; saved playlists stay unchanged.
export function selectQueueVideo(queue:PlaylistQueue|undefined,id:string):PlaylistQueue|undefined{
 if(!queue)return queue
 const index=queue.ids.indexOf(id)
 if(index>=0)return index===queue.index?queue:{...queue,index}
 const ids=[...queue.ids],at=Math.min(queue.index+1,ids.length)
 ids.splice(at,0,id)
 return {...queue,name:'Queue',ids,index:at}
}
export function moveQueue(queue:PlaylistQueue,from:number,to:number):PlaylistQueue{
 if(from<0||to<0||from>=queue.ids.length||to>=queue.ids.length)return queue
 const current=queue.ids[queue.index],ids=[...queue.ids];ids.splice(to,0,ids.splice(from,1)[0])
 return {...queue,ids,index:ids.indexOf(current)}
}
export function removeQueue(queue:PlaylistQueue,index:number):PlaylistQueue|undefined{
 if(index<0||index>=queue.ids.length)return queue
 const current=queue.ids[queue.index],ids=queue.ids.filter((_,i)=>i!==index)
 if(!ids.length)return
 return {...queue,ids,index:ids.includes(current)?ids.indexOf(current):Math.min(index,ids.length-1)}
}
