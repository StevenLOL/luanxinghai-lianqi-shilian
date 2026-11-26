/* v2.39 回归：云/岸沫视线遮挡 / 重开状态重置 / badge 一步返宗榜单
   用法：node scripts/60_test_v238.js （需 9223 调试端口 + 8000 静态服务） */
const http=require('http'),WS=globalThis.WebSocket;
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html?v=238test'+Date.now();
const get=(p,m='GET')=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9223,path:p,method:m,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})});r.on('error',rej);r.setTimeout(10000,()=>r.destroy(new Error('timeout')));r.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,d)=>{if(c){pass++;console.log('PASS',n,d===undefined?'':('— '+d));}
                   else{fail++;console.log('FAIL',n,d===undefined?'':('— '+d));}};

(async()=>{
 const page=await get('/json/new?'+encodeURIComponent(URL),'PUT');
 const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pend=new Map(),errs=[];
 ws.onmessage=m=>{const q=JSON.parse(m.data);
   if(q.id&&pend.has(q.id)){pend.get(q.id)(q);pend.delete(q.id);}
   else if(q.method==='Runtime.exceptionThrown')errs.push((q.params.exceptionDetails.exception||{}).description||q.params.exceptionDetails.text);};
 await new Promise(r=>ws.onopen=r);
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
 const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
   if(r.result&&r.result.exceptionDetails){const d=r.result.exceptionDetails;
     throw new Error((d.text||'Uncaught')+' :: '+((d.exception&&d.exception.description)||''));}
   return r.result&&r.result.result?r.result.result.value:null;};
 await send('Runtime.enable');
 for(let i=0;i<100;i++){if(await ev('typeof game!=="undefined"&&!!game&&!!player'))break;await sleep(100);}
 await sleep(800);

 /* ---------- ① 版本号 ---------- */
 const ver=await ev(`(()=>{let f='';const o=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)f=t;return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;return f;})()`);
 ok('版本号升级到 v2.39',/v2\.39$/.test(ver||''),ver);

 /* ---------- ② 视线遮挡：真实山体挡住云层高度的视线 ---------- */
 const occ=await ev(`(()=>{
   game.started=true;player.inv=99999;
   player.pos.x=-392;player.pos.z=-180;player.pos.y=visualH(-392,-180)+40;
   player.heading=0;cam.yaw=0;snapCamera();
   const behind=sightBlocked(cam.pos.x,cam.pos.y,cam.pos.z,-392,42,-380,6,1);
   const open=sightBlocked(cam.pos.x,cam.pos.y,cam.pos.z,200,42,200,6,1);
   return {behind,open,terrainH:Math.round(terrainH(-392,-380))};})()`);
 ok('视线遮挡函数存在且正确',typeof occ.behind==='boolean'&&occ.behind&&occ.open===false,JSON.stringify(occ));

 /* ---------- ③ 遮挡接入云层与岸沫渲染路径 ---------- */
 const wired=await ev(`(()=>{
   const cloud=sightBlocked.toString(),foam='';
   const src=String(drawShoreFoam);
   return {fn:typeof sightBlocked==='function',
           cloud:cloud.length>0,
           foamUsed:src.indexOf('sightBlocked')>=0};})()`);
 ok('岸沫渲染接入遮挡测试',wired.foamUsed,JSON.stringify(wired));
 const cloudSrc=await ev(`String(drawClouds)`);
 ok('云层渲染接入遮挡测试',cloudSrc.indexOf('sightBlocked')>=0,'drawClouds 含 sightBlocked');

 /* ---------- ④ 重开：本局 UI 状态归零 ---------- */
 const resetState=await ev(`(()=>{
   player.level=LEVEL_MAX;shopSave.stones=10000;checkGoal();continueGoal();
   const before=document.getElementById('goalPanel').className;
   shopOpen=true;boardOpen=true;boardPage=3;
   reset();
   return {before,panel:document.getElementById('goalPanel').className,
           shopOpen,boardOpen,boardPage,goalReady:game.goalReady,goalPrompt:game.goalPrompt,
           level:player.level,stones:shopSave.stones};})()`);
 ok('重开清空返宗徽标与面板类名',resetState.before.indexOf('badge')>=0&&resetState.panel==='',JSON.stringify(resetState));
 ok('重开关闭坊市与榜单',!resetState.shopOpen&&!resetState.boardOpen&&resetState.boardPage===0,JSON.stringify(resetState));
 ok('重开重置本局目标状态',!resetState.goalReady&&!resetState.goalPrompt&&resetState.level===1,JSON.stringify(resetState));
 ok('重开后灵石归零（不跨局保留）',resetState.stones===0,String(resetState.stones));

 /* ---------- ⑤ badge 一步返宗 + 榜单 ---------- */
 const badge=await ev(`(()=>{
   reset();player.level=LEVEL_MAX;shopSave.stones=10000;checkGoal();continueGoal();
   const b=document.getElementById('goalBadge').textContent;
   document.getElementById('goalBadge').click();
   return {badgeText:b,over:game.over,ending:game.ending,boardOpen,
           entry:game.rankEntry?game.rankEntry.entry:null};})()`);
 ok('徽标文案改为返宗看榜单',/返宗/.test(badge.badgeText)&&/榜单/.test(badge.badgeText),badge.badgeText);
 ok('点徽标一步返宗结算',badge.over&&badge.ending==='return',JSON.stringify({over:badge.over,ending:badge.ending}));
 ok('点徽标直接进入青云宗炼气榜',badge.boardOpen===true,String(badge.boardOpen));
 ok('通关记录标记 cleared',!!badge.entry&&badge.entry.cleared===true,JSON.stringify(badge.entry));

 ok('运行期无 JS 错误',errs.length===0,errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.39 回归：${pass} 项通过，${fail} 项失败 ===`);
 ws.close();
 process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
