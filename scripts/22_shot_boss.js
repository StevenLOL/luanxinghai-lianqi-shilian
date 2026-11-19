/* v2.18 验证：麒麟击杀后重生（截图取证） */
const http=require('http'),fs=require('fs');
const CDP=9223, PAGE='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function get(p,m='GET'){return new Promise((res,rej)=>{
  const req=http.request({host:'127.0.0.1',port:CDP,path:p,method:m,agent:false,headers:{Connection:'close'}},r=>{
    let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error('parse'))}});
  });req.on('error',rej);req.setTimeout(8000,()=>req.destroy(new Error('t')));req.end();});}
(async()=>{
  const t=await get('/json/new?about:blank','PUT');
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
  ws.onmessage=m=>{const j=JSON.parse(m.data); if(j.id&&p.has(j.id)){p.get(j.id)(j);p.delete(j.id);}};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(new Error('ws'))});
  const send=(m,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method:m,params}))});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result&&r.result.result?r.result.result.value:null};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:PAGE});
  await wait(4000);
  // 等就绪
  for(let i=0;i<50;i++){ if(await ev('typeof game!=="undefined"&&!!game&&!!player').catch(()=>false)) break; await wait(200); }

  // 场景1：kills=5 时麒麟出现
  const s1=await ev(`(()=>{
    game.started=true;game.over=false;enemies.length=0;
    game.kills=5;game.bossWave=0;
    // 手动触发一次刷怪帧（跳过 update 以免敌人 AI 干扰）
    if(!hasBossAlive()&&game.kills>=(game.bossWave+1)*BOSS_SPAWN_EVERY){spawnEnemy(true,{forward:true});game.bossWave++;}
    const b=enemies.find(e=>e.type==='boss');
    if(b){ // 把麒麟挪到镜头前方
      const a=player.heading, d=55;
      b.x=player.pos.x+Math.sin(a)*d; b.z=player.pos.z-Math.cos(a)*d;
      b.y=terrainH(b.x,b.z);
    }
    return {boss:!!b, wave:game.bossWave};
  })()`);
  await wait(1200);
  let s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_v218_boss_first.png',Buffer.from(s.result.data,'base64'));
  console.log('第一只麒麟 :',JSON.stringify(s1));

  // 场景2：杀死它，击杀数推到 10，等它重生
  const s2=await ev(`(()=>{
    const b=enemies.find(e=>e.type==='boss');
    if(b) hurtEnemy(b,99999);
    enemies=enemies.filter(e=>e.hp>0);
    const afterKill=enemies.filter(e=>e.type==='boss').length;
    game.kills=10;
    if(!hasBossAlive()&&game.kills>=(game.bossWave+1)*BOSS_SPAWN_EVERY){spawnEnemy(true,{forward:true});game.bossWave++;}
    const b2=enemies.find(e=>e.type==='boss');
    if(b2){ const a=player.heading,d=55; b2.x=player.pos.x+Math.sin(a)*d; b2.z=player.pos.z-Math.cos(a)*d; b2.y=terrainH(b2.x,b2.z); }
    return {afterKill, reborn:!!b2, wave:game.bossWave};
  })()`);
  await wait(1200);
  s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_v218_boss_reborn.png',Buffer.from(s.result.data,'base64'));
  console.log('击杀后重生 :',JSON.stringify(s2));
  ws.close();process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
