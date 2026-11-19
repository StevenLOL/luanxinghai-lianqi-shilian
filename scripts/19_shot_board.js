/* v2.17 排行榜界面截图：注入若干条记录后截图 + 死亡界面截图 */
const http=require('http'),fs=require('fs');
const CDP=9223;
const PAGE='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function get(p,m='GET'){return new Promise((res,rej)=>{
  const req=http.request({host:'127.0.0.1',port:CDP,path:p,method:m,agent:false,headers:{Connection:'close'}},r=>{
    let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error('parse:'+d.slice(0,120)))}});
  });
  req.on('error',rej);req.setTimeout(8000,()=>{req.destroy(new Error('timeout'))});req.end();
});}
(async()=>{
  const t=await get('/json/new?about:blank','PUT');
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
  ws.onmessage=m=>{const j=JSON.parse(m.data); if(j.id&&p.has(j.id)){p.get(j.id)(j);p.delete(j.id);}};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(new Error('ws'))});
  const send=(method,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
  const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result&&r.result.result?r.result.result.value:null};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:PAGE});
  await wait(3500);

  // 注入一批榜单记录（模拟多局累积）
  await ev(`(()=>{
    const names=['寒霜散人 77ad','青冥剑修 1f0e','踏雪无名 4b21','流光客 a93c','断岳散人 00ff','玄铁剑修 7c02','霜刃道人 3b8f'];
    const rows=[[980,63,8420,3110,3,142.5,8],[760,51,6510,2480,2,118.2,7],[540,37,4390,1890,1,96.4,6],
                [410,29,3180,1520,1,81.7,5],[280,21,2240,980,0,63.3,4],[150,12,1180,640,0,44.1,3],
                [90,7,760,410,0,28.5,2]];
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(rows.map((r,i)=>({
      name:names[i],score:r[0],kills:r[1],dmgDealt:r[2],dmgTaken:r[3],bossKills:r[4],time:r[5],realm:r[6],ts:Date.now()-i*1000
    }))));
    game.started=true; game.score=280; game.kills=21; game.dmgDealt=2240; game.dmgTaken=980;
    game.bossKills=0; game.time=63.3;
    return true;
  })()`);
  await wait(300);
  // 打开排行榜
  await ev(`boardOpen=true; true`);
  await wait(600);
  let s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_v217_board_desktop.png',Buffer.from(s.result.data,'base64'));
  console.log('排行榜截图已保存');

  // 死亡界面（带榜单名次）
  await ev(`(()=>{boardOpen=false; game.started=true; game.over=false; player.hp=5; player.inv=0;
    game.score=280; game.kills=21; game.dmgDealt=2240; game.dmgTaken=980; game.bossKills=0; game.time=63.3;
    hurtPlayer(999,{ignoreInv:true,noInv:true,noFlash:true}); return true})()`);
  await wait(700);
  s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_v217_dead_desktop.png',Buffer.from(s.result.data,'base64'));
  console.log('死亡界面截图已保存');
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
