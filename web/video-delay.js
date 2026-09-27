// Bounded captured-frame buffer. Audio uses the same delay in Web Audio.
window.createWebVideoDelay = function(video, canvas, delayMs) {
  const frames=[], pool=[];
  let timer=null, stopped=false;
  const width=Math.floor(640*Math.sqrt(6000/Math.max(6000,delayMs))/2)*2;
  const maxFrames=Math.ceil(delayMs/1000*15)+3;
  const context=canvas.getContext('2d',{alpha:false});
  canvas.hidden=false;video.hidden=true;
  function paint() {
    if(stopped || video.readyState<2 || !video.videoWidth) return;
    const now=performance.now();
    const ratio=Math.min(width/video.videoWidth,(width*9/16)/video.videoHeight,1);
    const drawWidth=Math.max(2,Math.round(video.videoWidth*ratio));
    const height=Math.max(2,Math.round(video.videoHeight*ratio));
    if(canvas.width!==drawWidth || canvas.height!==height) {canvas.width=drawWidth;canvas.height=height;}
    const frame=pool.pop() || document.createElement('canvas');
    if(frame.width!==drawWidth || frame.height!==height) {frame.width=drawWidth;frame.height=height;}
    frame.getContext('2d',{alpha:false}).drawImage(video,0,0,drawWidth,height);
    frames.push({at:now,frame});
    while(frames.length>maxFrames) pool.push(frames.shift().frame);
    let selected=null;
    while(frames.length && frames[0].at<=now-delayMs) {
      if(selected) pool.push(selected.frame);
      selected=frames.shift();
    }
    if(selected) {context.drawImage(selected.frame,0,0,drawWidth,height);pool.push(selected.frame);}
  }
  timer=setInterval(()=>{try {paint();} catch {stop();platform.runtime.sendMessage({type:'stop'}).catch(()=>{});}},1000/15);
  function stop() {
    if(stopped) return;stopped=true;clearInterval(timer);
    for(const item of frames) {item.frame.width=0;item.frame.height=0;}
    for(const frame of pool) {frame.width=0;frame.height=0;}
    frames.length=0;pool.length=0;canvas.width=0;canvas.height=0;
    canvas.hidden=true;video.hidden=false;
  }
  return {stop};
};
