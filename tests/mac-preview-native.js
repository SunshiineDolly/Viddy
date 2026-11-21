(() => {
  // Only the standalone test executable loads this script. No user account or library.
  if (window !== window.top) {
    addEventListener('securitypolicyviolation',e=>top.postMessage({type:'viddy-native-error',error:'CSP '+e.violatedDirective+' '+e.blockedURI},'*'));
    addEventListener('error',e=>top.postMessage({type:'viddy-native-error',error:e.message},'*'));
    if ((location.hostname === '127.0.0.1'||location.hostname==='sunshiinedolly.github.io')) setInterval(() => {
      const player = window.viddyPreviewPlayer;
      if (player?.getCurrentTime) parent.postMessage({type:'viddy-native-time',time:player.getCurrentTime()}, '*');
    }, 500);
    if(location.hostname==='www.youtube.com'&&location.pathname.startsWith('/embed/'))setInterval(()=>top.postMessage({type:'viddy-native-page',text:document.body?.innerText.slice(0,1200),status:window.ytInitialPlayerResponse?.playabilityStatus??window.ytplayer?.config?.args?.raw_player_response?.playabilityStatus},'*'),250);
    return;
  }
  const native = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  const report={engine:'native macOS WKWebView',videoTimeAdvanced:false,platform:navigator.platform,hover:matchMedia('(hover:hover)').matches,reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,states:[],errors:[]};
  let first,done=false,checkingToggle=false,probe;
  function checkAutoplay(){
    if(probe)return;probe=document.createElement('iframe');probe.allow='autoplay *';probe.style='position:fixed;right:0;top:0;width:320px;height:180px;z-index:99999;border:0';probe.src='https://sunshiinedolly.github.io/Viddy/autoplay-check.html';document.body.appendChild(probe);
  }
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function checkToggle(){
    if(checkingToggle)return;checkingToggle=true;
    document.querySelector(".sidebar [aria-label=Settings]").click();await wait(400);
    const label=[...document.querySelectorAll("label.toggle")].find(n=>n.textContent.includes("Play muted video previews on hover"));
    if(!label?.querySelector("input")?.checked){report.errors.push("Preview setting missing or disabled by default");finish();return}
    label.querySelector("input").click();await wait(200);
    document.querySelector(".sidebar [aria-label=Home]").click();await wait(400);
    const card=document.querySelector(".content > div:not([hidden]) .card .thumbnail");
    card.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,relatedTarget:null}));await wait(1000);
    report.previewsCanBeDisabled=!document.querySelector(".thumbnail-preview iframe");card.click();
  }
  function finish(){if(done)return;done=true;report.frames=[...document.querySelectorAll('.thumbnail-preview iframe')].map(f=>f.src);native('preview_check_result',{report});}
  addEventListener('error',e=>report.errors.push(e.message));
  addEventListener('securitypolicyviolation',e=>report.errors.push('CSP '+e.violatedDirective+' '+e.blockedURI));
  addEventListener('message',e=>{
    if(e.source===probe?.contentWindow&&e.data?.type==='viddy-autoplay-probe'){report[e.data.phase==='muted'?'nativeMutedAutoplay':'nativeAudioAutoplay']=!!e.data.played;if(e.data.error)report.errors.push(e.data.phase+': '+e.data.error);if(e.data.phase==='audio')finish()}
    if(e.data?.type==='viddy-player'&&e.data.event==='ready'){report.mainPlayerReady=true;report.mainPlayerFrame=document.querySelector('.player iframe')?.src;setTimeout(checkAutoplay,500)}
    if(e.data?.type==='viddy-player'&&e.data.event==='error')report.mainPlayerError=e.data.value;
    if(e.data?.type==='viddy-video-preview'){report.states.push({state:e.data.state,code:e.data.code});if(e.data.state==='error'||e.data.state==='blocked'){e.stopImmediatePropagation();report.playerRejected=true;setTimeout(()=>{if(report.playerText?.includes('Sign in to confirm')&&report.playerText?.includes('not a bot')){report.externalPlaybackBlockedByYouTube=true;void checkToggle()}else finish()},3500)}}
    if(e.data?.type==='viddy-native-page'){report.playerText=e.data.text;report.playerStatus=e.data.status};
    if(e.data?.type==='viddy-native-error')report.errors.push(e.data.error);
    if(e.data?.type==='viddy-native-time'){
      if(first===undefined)first=e.data.time;
      if(e.data.time>first+1){report.videoTimeAdvanced=true;void checkToggle();}
    }
  });
  const interval=setInterval(()=>{
    const card=document.querySelector('.content > div:not([hidden]) .card .thumbnail');
    if(card){clearInterval(interval);card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}));}
  },200);
  setTimeout(finish,65000);
})();
