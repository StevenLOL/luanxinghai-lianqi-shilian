/* v2.23 花海融合：截图验证脚本。
   新开专属页 → 等就绪 → 开始 → 低空贴花田高速飞行 → 截多帧看花海/花瓣。 */
const http=require('http');
const WS=globalThis.WebSocket;
const CDP='http://127.0.0.1:9223';
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';

function req(path,method='GET'){
  return new Promise((res,rej)=>{
    const r=http.request(CDP+path,{method,agent:false,headers:{Connection:'close'}},x=>{
      let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))}});
    });
    r.setTimeout(5000,()=>r.destroy(new Error('timeout')));
    r.on('error',rej);r.end();
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const page=await req('/json/new?'+encodeURIComponent(URL),'PUT');
  const ws=new WS(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map();const events=[];
  ws.addEventListener('message',e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
    else if(m.method==='Runtime.exceptionThrown')events.push(m.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise(res=>{const n=++id;pending.set(n,res);ws.send(JSON.stringify({id:n,method,params}));});
  await send('Runtime.enable');await send('Page.enable');
  const ev=async expr=>{
    const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text+' :: '+JSON.stringify(r.result.exceptionDetails.exception));
    return r.result.result.value;
  };
  // 等待游戏就绪
  for(let i=0;i<60;i++){if(await ev('typeof game!=="undefined"&&spritesReady'))break;await sleep(200);}
  console.log('ready:',await ev('({ver:(L("title")+" "+document.title),sprites:spritesReady})'));
  // 开始游戏，设低空高速，锁定草地花田区域
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    player.pos.x=0;player.pos.z=0;player.targetAlt=12;player.pos.y=terrainH(0,0)+12;
    player.heading=0;player.dir=facingVec(0);`);
  // 按住前进，让花瓣尾流持续产生（模拟 keydown）
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  const fs=require('fs');
  const outDir='C:/src/flight/docs/screenshots';
  if(!fs.existsSync(outDir))fs.mkdirSync(outDir,{recursive:true});
  for(let k=0;k<3;k++){
    await sleep(1200);
    const st=await ev('({alt:(player.pos.y-terrainH(player.pos.x,player.pos.z)).toFixed(1),spd:Math.hypot(player.vel.x,player.vel.z).toFixed(1),petals:particles.filter(p=>p.kind==="petal").length})');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    const f=outDir+'/_v223_meadow_'+(k+1)+'.png';
    fs.writeFileSync(f,Buffer.from(shot.result.data,'base64'));
    console.log('frame',k+1,st,'->',f);
  }
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  console.log('exceptions:',events);
  ws.close();
  await req('/json/close/'+page.id);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
