/* 线上 v2.17 验证：条件回血 + 排行榜读写 + L 键 + 死亡入榜 */
const http=require('http'),fs=require('fs');
const CDP=9223, SHARE='https://xianjian-kongduodi.app.workbuddy.host/?sharecode=ASJWDZ6E6D';
function get(p,m='GET'){return new Promise((res,rej)=>{
  const req=http.request({host:'127.0.0.1',port:CDP,path:p,method:m,agent:false,headers:{Connection:'close'}},r=>{
    let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error('parse:'+d.slice(0,120)))}});
  });
  req.on('error',rej);req.setTimeout(8000,()=>{req.destroy(new Error('timeout'))});req.end();
});}
(async()=>{
  const t=await get('/json/new?about:blank','PUT');
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map(); const exc=[];
  ws.onmessage=m=>{const j=JSON.parse(m.data); if(j.id&&p.has(j.id)){p.get(j.id)(j);p.delete(j.id);}
    else if(j.method==='Runtime.exceptionThrown')exc.push(j.params.exceptionDetails);};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(new Error('ws'))});
  const send=(method,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
  const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});
    if(r.result&&r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);
    return r.result&&r.result.result?r.result.result.value:null};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:SHARE});
  await wait(6000);

  const r={};
  r.version=await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');return s.includes('v2.17')})()`);
  console.log('线上版本 v2.17 :',r.version);

  // 条件回血（线上真实环境）
  await ev(`(()=>{game.started=true;game.over=false;player.hp=50;player.lastHit=game.time;player.inv=0;
    window.__c=setInterval(()=>{enemies.length=0;bolts.length=0;},30);return true})()`);
  const hpA=await ev(`player.hp`);
  await wait(800);
  const hpB=await ev(`player.hp`);
  r.regen=hpB>hpA;
  console.log('受击期间仍回血 :',hpA.toFixed(2),'->',hpB.toFixed(2),r.regen);

  // 排行榜：L 键开关
  await ev(`localStorage.removeItem('lxh_lianqi_lb_v1');true`);
  await ev(`(()=>{game.score=500;game.kills=30;game.dmgDealt=5200;game.dmgTaken=1100;game.bossKills=1;game.time=88.2;
    game.rankEntry=submitToBoard();return true})()`);
  const lb1=await ev(`loadBoard().length`);
  console.log('排行榜写入 :',lb1,'条');

  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'l',code:'KeyL',windowsVirtualKeyCode:76});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'l',code:'KeyL',windowsVirtualKeyCode:76});
  await wait(500);
  r.lbOpen=await ev(`boardOpen`);
  console.log('L 键打开榜单 :',r.lbOpen);

  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_v217_live_board.png',Buffer.from(s.result.data,'base64'));

  // 持久化：刷新后仍在
  await send('Page.navigate',{url:SHARE});
  await wait(4500);
  const lb2=await ev(`loadBoard().length`);
  r.persist=lb2===lb1;
  console.log('刷新后仍保留 :',lb2,'条', r.persist);

  // 死亡入榜
  const death=await ev(`(()=>{game.started=true;game.over=false;player.hp=5;player.inv=0;
    game.score=700;game.kills=40;game.dmgDealt=6000;game.dmgTaken=900;game.bossKills=1;game.time=100;
    hurtPlayer(999,{ignoreInv:true,noInv:true,noFlash:true});
    return {over:game.over,rank:game.rankEntry&&game.rankEntry.rank,len:loadBoard().length}})()`);
  r.death=death.over&&death.rank===1&&death.len===2;  // 700分应排第1，榜单共2条
  console.log('战死入榜 :',JSON.stringify(death));
  r.exception=exc.length;
  console.log('运行期异常 :',exc.length);
  console.log('\n结论 :',JSON.stringify(r));
  ws.close();process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
