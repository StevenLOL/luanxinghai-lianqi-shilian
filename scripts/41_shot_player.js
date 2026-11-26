/* 主角特写：确认角色素材实际绘制，而不是 fallback 剑形。 */
const http=require('http');const WS=globalThis.WebSocket;const CDP='http://127.0.0.1:9223';
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function req(p,m='GET'){return new Promise((res,rej)=>{const r=http.request(CDP+p,{method:m,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,120)))}})});r.setTimeout(6000,()=>r.destroy(new Error('timeout')));r.on('error',rej);r.end()})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const page=await req('/json/new?'+encodeURIComponent(URL),'PUT');
  const ws=new WS(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  const send=(method,params={})=>new Promise(res=>{const n=++id;pend.set(n,res);ws.send(JSON.stringify({id:n,method,params}))});
  await send('Runtime.enable');await send('Page.enable');
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});if(r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);return r.result.result.value};
  for(let i=0;i<60;i++){if(await ev('typeof game!=="undefined"&&spritesReady'))break;await sleep(200)}
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;player.pos.x=0;player.pos.z=0;player.heading=0;player.dir=facingVec(0);
    player.targetAlt=20;player.pos.y=visualH(0,0)+20;cam.yaw=0;cam.pitchIdx=1;cam.dist=26;snapCamera();game.time=8;`);
  await sleep(500);
  const info=await ev(`(()=>{const p=project(player.pos);return{p,canvas:[W,H],ok:spriteOK('playerBack'),key:spriteOK('playerBack')?'playerBack':'player'}})()`);
  console.log('player screen:',JSON.stringify(info));
  const cw=Math.min(260,info.canvas[0]),ch=Math.min(320,info.canvas[1]);
  const clip={x:Math.max(0,Math.round(info.p.x-cw/2)),y:Math.max(0,Math.round(info.p.y-ch+40)),width:cw,height:ch,scale:4};
  const shot=await send('Page.captureScreenshot',{format:'png',clip});
  require('fs').writeFileSync('C:/src/flight/docs/screenshots/_player_zoom.png',Buffer.from(shot.result.data,'base64'));
  console.log('saved _player_zoom.png clip',JSON.stringify(clip));
  ws.close();try{await req('/json/close/'+page.id)}catch(e){}
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
