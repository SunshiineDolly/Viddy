(() => {
 // Standalone native test only: real production renderer, isolated synthetic library.
 if(window!==window.top)return;
 const native=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
 const report={engine:'native macOS WKWebView',transport:'native H264 video',videoTimeAdvanced:false,platform:navigator.platform,states:[],errors:[]};
 let done=false,checking=false,probe,first;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function finish(){if(done)return;done=true;native('preview_check_result',{report});}
 window.__TAURI_INTERNALS__.invoke=(command,args)=>native(command,args).then(value=>{
  if(command==='preview_stream'){report.sourceResolved=true;report.states.push({state:'ready'});report.sourceIsHTTPSGoogleVideo=typeof value==='string'&&new URL(value).protocol==='https:'&&new URL(value).hostname.endsWith('.googlevideo.com');}
  return value;
 }).catch(error=>{if(command==='preview_stream'||command==='preview_prepare'){report.errors.push(String(error));finish();}throw error;});
 function checkAutoplay(){if(probe)return;probe=document.createElement('iframe');probe.allow='autoplay *';probe.style='position:fixed;right:0;top:0;width:320px;height:180px;z-index:99999;border:0';probe.src='https://sunshiinedolly.github.io/Viddy/autoplay-check.html';document.body.appendChild(probe);}
 async function checkControls(video){
  if(checking)return;checking=true;
  const card=document.querySelector('.content > div:not([hidden]) .card .thumbnail');
  card.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));await wait(250);
  report.stopsOnLeave=!document.querySelector('.thumbnail-preview-native video')&&video.paused&&!video.getAttribute('src');
  document.querySelector('.sidebar [aria-label=Settings]').click();await wait(400);
  const label=[...document.querySelectorAll('label.toggle')].find(n=>n.textContent.includes('Play muted video previews on hover'));
  if(!label?.querySelector('input')?.checked){report.errors.push('Preview setting missing');finish();return;}
  label.querySelector('input').click();await wait(200);document.querySelector('.sidebar [aria-label=Home]').click();await wait(400);
  const next=document.querySelector('.content > div:not([hidden]) .card .thumbnail');next.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}));await wait(1000);
  report.previewsCanBeDisabled=!document.querySelector('.thumbnail-preview-native video');next.click();
 }
 addEventListener('error',event=>report.errors.push(event.message));
 addEventListener('securitypolicyviolation',event=>report.errors.push('CSP '+event.violatedDirective));
 addEventListener('message',event=>{
  if(event.source===probe?.contentWindow&&event.data?.type==='viddy-autoplay-probe'){report[event.data.phase==='muted'?'nativeMutedAutoplay':'nativeAudioAutoplay']=!!event.data.played;if(event.data.error)report.errors.push(event.data.error);if(event.data.phase==='audio')finish();}
  if(event.data?.type==='viddy-player'&&event.data.event==='ready'){report.mainPlayerReady=true;setTimeout(checkAutoplay,500);}
  if(event.data?.type==='viddy-player'&&event.data.event==='error')report.mainPlayerError=event.data.value;
 });
 const hover=setInterval(()=>{const card=document.querySelector('.content > div:not([hidden]) .card .thumbnail');if(card){clearInterval(hover);card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}));}},200);
 setInterval(()=>{
  const video=document.querySelector('.thumbnail-preview-native video');if(!video||video.readyState<2||!video.videoWidth)return;
  first??=video.currentTime;
  if(video.currentTime>first+1){report.videoTimeAdvanced=true;report.previewMuted=video.muted&&video.volume===0;report.decodedFrames=Math.max(video.getVideoPlaybackQuality?.().totalVideoFrames??0,video.webkitDecodedFrameCount??0);report.nativeThumbnailSize={width:video.clientWidth,height:video.clientHeight};void checkControls(video);}
 },250);
 setTimeout(finish,210000);
})();
