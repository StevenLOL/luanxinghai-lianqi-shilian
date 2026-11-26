/* v2.24c 尾流截图：低空高速掠过花海，看花朵压弯与花瓣拖尾。 */
const http=require('http');const WS=globalThis.WebSocket;const CDP='http://127.0.0.1:9223';
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function req(p,m='GET'){return new Promise((res,rej)=>{const r=http.request(CDP+p,{method:m,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,120)))}})});r.setTimeout(6000,()=>r.destroy(new Error('timeout')));r.on('error',rej);r.end()})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const page=await req('/json/new?'+encodeURIComponent(URL),'PUT');
  const ws=new WS(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pend=new Map();const ex=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')ex.push(m.params.exceptionDetails.text)});
  const send=(method,params={})=>new Promise(res=>{const n=++id;pend.set(n,res);ws.send(JSON.stringify({id:n,method,params}))});
  await send('Runtime.enable');await send('Page.enable');
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});if(r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);return r.result.result.value};
  for(let i=0;i<60;i++){if(await ev('typeof game!=="undefined"&&spritesReady'))break;await sleep(200)}
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;player.auto=false;enemies.length=0;bolts.length=0;beams.length=0;particles.length=0;petalAcc=0;
    player.pos.x=0;player.pos.z=40;player.pos.y=visualH(0,40)+8;
    player.heading=0;player.dir=facingVec(0);player.targetAlt=8;
    cam.yaw=0;cam.pitchIdx=2;cam.dist=26;snapCamera();game.time=14;`);
  await ev(`window.__clear=setInterval(()=>{enemies.length=0;bolts.length=0;beams.length=0;},40);keys['w']=true;true`);
  await sleep(1400);
  // 清场 interval 保持运行到截图完成，避免截图瞬间又刷出敌人
  // 保持按下 w：松开后速度立刻归零，花朵压弯会消失
  const st=await ev(`(()=>({petals:particles.filter(p=>p.kind==='petal').length,spd:Math.hypot(player.vel.x,player.vel.z),alt:player.pos.y-visualH(player.pos.x,player.pos.z),wakeLines:drawWakeTrail._n||0}))()`);
  console.log('state:',JSON.stringify(st),'exceptions:',ex);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  require('fs').writeFileSync('C:/src/flight/docs/screenshots/_wake_v224c.png',Buffer.from(shot.result.data,'base64'));
  const pp=await ev('project(player.pos)');
  const clip={x:Math.max(0,Math.round(pp.x-220)),y:Math.max(0,Math.round(pp.y+10)),width:440,height:300,scale:2};
  const zoom=await send('Page.captureScreenshot',{format:'png',clip});
  require('fs').writeFileSync('C:/src/flight/docs/screenshots/_wake_zoom.png',Buffer.from(zoom.result.data,'base64'));
  console.log('saved _wake_v224c.png + _wake_zoom.png');
  ws.close();try{await req('/json/close/'+page.id)}catch(e){}
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
