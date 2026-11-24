/* v2.24 花海重制：截图验证脚本。
   新开专属页 → 等就绪 → 开始 → 锁定草地花田区域低空飞行 → 截多视角看花海。 */
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
  for(let i=0;i<60;i++){if(await ev('typeof game!=="undefined"&&spritesReady'))break;await sleep(200);}
  console.log('ready:',await ev('({ver:(L("title")+" "+document.title),sprites:spritesReady})'));

  // 找一片草地花田（h 在 3..8 之间）作为拍摄点，避开海与雪顶
  const spot=await ev(`(function(){
    for(let gx=-400;gx<=400;gx+=40)for(let gz=-400;gz<=400;gz+=40){
      const h=terrainH(gx,gz);
      if(h>3&&h<8&&flowerMix(gx,gz)>0.45)return {x:gx,z:gz,h:h,f:flowerMix(gx,gz)};
    }
    return {x:0,z:0,h:terrainH(0,0),f:flowerMix(0,0)};
  })()`);
  console.log('flower spot:',spot);

  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    player.pos.x=${spot.x};player.pos.z=${spot.z};player.targetAlt=10;player.pos.y=terrainH(${spot.x},${spot.z})+10;
    player.heading=0;player.dir=facingVec(0);game.over=false;player.inv=9999;`);

  const fs=require('fs');
  const outDir='C:/src/flight/docs/screenshots';
  if(!fs.existsSync(outDir))fs.mkdirSync(outDir,{recursive:true});

  // 视角1：低空贴花海，前进产生尾流
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  await sleep(2000);
  const st1=await ev('({alt:(player.pos.y-terrainH(player.pos.x,player.pos.z)).toFixed(1),spd:Math.hypot(player.vel.x,player.vel.z).toFixed(1),petals:particles.filter(p=>p.kind==="petal").length})');
  let shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(outDir+'/_v224_low.png',Buffer.from(shot.result.data,'base64'));
  console.log('low view',st1);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});

  // 视角2：中高度俯瞰花海全景（相机俯角更大）
  await ev(`player.pos.y=terrainH(player.pos.x,player.pos.z)+18;player.targetAlt=18;
    cam.pitchIdx=Math.min(cam.pitches.length-1,cam.pitchIdx+1);snapCamera();`);
  await sleep(1200);
  shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(outDir+'/_v224_high.png',Buffer.from(shot.result.data,'base64'));
  console.log('high view done');

  console.log('exceptions:',events);
  ws.close();
  try{await req('/json/close/'+page.id);}catch(e){}
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
