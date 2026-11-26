/* v2.39 回归：青云宗试炼剧情 / 目标 / 返宗通关 / 炼气榜通关标记
   用法：node scripts/59_test_v237.js （需 9223 调试端口 + 8000 静态服务） */
const http=require('http'),WS=globalThis.WebSocket;
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
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
 const boot=async()=>{
   await send('Page.navigate',{url:URL});
   for(let i=0;i<100;i++){if(await ev('typeof game!=="undefined"&&!!game&&!!player'))break;await sleep(100);}
   await sleep(600);
 };
 await send('Page.enable');await send('Runtime.enable');
 await boot();
 await ev(`(()=>{localStorage.removeItem('lxh_lianqi_shop_v1');
   localStorage.removeItem('lxh_lianqi_lb_v1');return 1})()`);
 await boot();
 await ev(`(()=>{game.started=true;game.over=false;game.ending=null;
   player.pos.x=0;player.pos.z=40;player.pos.y=30;player.heading=0;player.dir=facingVec(0);
   cam.yaw=0;game.time=16;snapCamera();return 1})()`);

 /* ---------- ① 版本 / 剧情 ---------- */
 const ver=await ev(`(()=>{let f='';const o=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)f=t;return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;return f;})()`);
 ok('HUD 版本号升级到 v2.39',/v2\.39$/.test(ver||''),ver);
 const story=await ev(`(()=>{const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   const old=game.started;game.started=false;try{drawOverlay()}catch(e){}game.started=old;ctx.fillText=o;
   return lines;})()`);
 ok('开场演绎青云宗弟子设定',story.some(t=>t.indexOf('青云宗')>=0&&t.indexOf('秘境')>=0),story.slice(0,4));
 ok('师尊在开场说明返宗目标',story.some(t=>t.indexOf('炼气圆满')>=0)&&story.some(t=>t.indexOf('一万')>=0),story.slice(0,6));

 /* ---------- ② 目标常量与 HUD ---------- */
 const goalConst=await ev(`({stones:GOAL_STONES,lv:LEVEL_MAX,ready:isGoalReady()})`);
 ok('返宗门槛为炼气圆满+10000灵石',goalConst.stones===10000&&goalConst.lv===12&&!goalConst.ready,JSON.stringify(goalConst));
 const hudGoal=await ev(`(()=>{player.level=3;shopSave.stones=2500;
   const lines=[];const o=ctx.fillText;ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;
   return lines.filter(t=>t.indexOf('试炼')>=0);})()`);
 ok('HUD 常驻目标进度',hudGoal.some(t=>/练气 3\/12/.test(t)&&/灵石 2500\/10000/.test(t),JSON.stringify(hudGoal)));

 /* ---------- ③ 未达成不能返宗 ---------- */
 await ev(`(()=>{player.level=3;shopSave.stones=2500;game.goalReady=false;game.goalPrompt=false;return 1})()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'t',code:'KeyT',windowsVirtualKeyCode:84,nativeVirtualKeyCode:84});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'t',code:'KeyT',windowsVirtualKeyCode:84,nativeVirtualKeyCode:84});
 const locked=await ev(`({over:game.over,ending:game.ending,tip:player.lastCast})`);
 ok('未达成按 T 不会返宗',!locked.over&&locked.ending===null,JSON.stringify(locked));

 /* ---------- ④ 达成后师尊传音面板 ---------- */
 const ready=await ev(`(()=>{player.level=LEVEL_MAX;shopSave.stones=10000;
   const changed=checkGoal();syncGoalPanel();
   const p=document.getElementById('goalPanel');
   return {changed,ready:isGoalReady(),show:p.classList.contains('show'),
           badge:p.classList.contains('badge'),prompt:game.goalPrompt,
           btn:document.getElementById('returnBtn').textContent};})()`);
 ok('达成条件后触发师尊传音',ready.changed&&ready.ready&&ready.show&&ready.prompt&&!ready.badge,JSON.stringify(ready));
 ok('返宗按钮文案正确',/返回宗门/.test(ready.btn),ready.btn);

 /* ---------- ⑤ 继续历练 / 徽标 ---------- */
 const cont=await ev(`(()=>{document.getElementById('continueBtn').click();
   const p=document.getElementById('goalPanel');
   return {over:game.over,prompt:game.goalPrompt,badge:p.classList.contains('badge'),tip:player.lastCast};})()`);
 ok('继续历练不结束本局且收起为徽标',!cont.over&&!cont.prompt&&cont.badge,JSON.stringify(cont));
 const badge=await ev(`(()=>{document.getElementById('goalBadge').click();
   return {over:game.over,ending:game.ending,boardOpen:boardOpen};})()`);
 ok('v2.39 点徽标一步返宗并进入榜单',badge.over&&badge.ending==='return'&&badge.boardOpen,JSON.stringify(badge));

 /* ---------- ⑥ 面板布局不遮挡核心 UI ---------- */
 const layout=await ev(`(()=>{const hit=(a,b)=>Math.max(a.left,b.left)<Math.min(a.right,b.right)&&
     Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom);
   const g=document.getElementById('goalPanel').getBoundingClientRect();
   const hud={left:8,top:0,right:8+138,bottom:190};
   const tb=document.getElementById('topBar').getBoundingClientRect();
   const rd=radarAnchor();
   return {rect:[g.left|0,g.top|0,g.right|0,g.bottom|0],hud:hit(g,hud),top:hit(g,tb),
           radar:rd.cx-rd.R<g.right&&rd.cx+rd.R>g.left&&rd.cy-rd.R<g.bottom&&rd.cy+rd.R>g.top};})()`);
 ok('目标面板不遮挡 HUD / 顶栏 / 雷达',!layout.hud&&!layout.top&&!layout.radar,JSON.stringify(layout));

 /* ---------- ⑦ T 键返宗通关（v2.39：T 也直接进入榜单） ---------- */
 await ev(`(()=>{   reset();game.started=true;game.time=16;player.level=LEVEL_MAX;shopSave.stones=10000;
   game.goalReady=false;checkGoal();return 1})()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'t',code:'KeyT',windowsVirtualKeyCode:84,nativeVirtualKeyCode:84});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'t',code:'KeyT',windowsVirtualKeyCode:84,nativeVirtualKeyCode:84});
 const cleared=await ev(`({over:game.over,ending:game.ending,clearTime:game.clearTime,boardOpen:boardOpen,
   entry:game.rankEntry?game.rankEntry.entry:null,rank:game.rankEntry?game.rankEntry.rank:0})`);
 ok('v2.39 T 键返宗直接进入榜单',cleared.boardOpen===true,JSON.stringify({boardOpen:cleared.boardOpen}));
 ok('按 T 返宗结算通关',cleared.over&&cleared.ending==='return'&&cleared.clearTime>0,JSON.stringify(cleared));
 ok('通关记录写入青云宗炼气榜',!!cleared.entry&&cleared.entry.cleared===true&&cleared.entry.clearTime>0,JSON.stringify(cleared.entry));
 const returnUi=await ev(`(()=>{const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawOverlay()}catch(e){}ctx.fillText=o;return lines;})()`);
 ok('返宗结算显示通关界面',returnUi.some(t=>t.indexOf('返宗门')>=0)&&returnUi.some(t=>t.indexOf('试炼通关')>=0),returnUi.slice(0,4));

 /* ---------- ⑧ 榜单通关标记与排序 ---------- */
 const title=await ev(`L('lbTitle')`);
 ok('排行榜改名为青云宗炼气榜',/青云宗炼气榜/.test(title||''),title);
 const sorted=await ev(`(()=>{const base={kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:12,ts:1};
   const rows=[Object.assign({name:'未通关高分',score:99999,cleared:false,clearTime:0},base),
               Object.assign({name:'返宗通关',score:1,cleared:true,clearTime:88},base)];
   return boardSort(rows).map(x=>x.name);})()`);
 ok('通关记录在排行榜中优先',sorted[0]==='返宗通关',JSON.stringify(sorted));
 const oldRow=await ev(`(()=>{const r=sanitizeBoardRow({name:'旧记录',score:10,kills:1,dmgDealt:0,
   dmgTaken:0,bossKills:0,time:1,realm:1,ts:2});
   return {ok:!!r,cleared:r&&r.cleared,ct:r&&r.clearTime};})()`);
 ok('旧榜单存档兼容为未通关',oldRow.ok&&oldRow.cleared===false&&oldRow.ct===0,JSON.stringify(oldRow));

 /* ---------- ⑨ 死亡仍是独立结局 ---------- */
 const death=await ev(`(()=>{reset();game.started=true;
   hurtPlayer(99999,{ignoreInv:true,noInv:true,noFlash:true});
   return {over:game.over,ending:game.ending,entry:game.rankEntry?game.rankEntry.entry:null};})()`);
 ok('战死结局标记为 death',death.over&&death.ending==='death',JSON.stringify({over:death.over,ending:death.ending}));
 ok('战死记录不标记通关',!!death.entry&&death.entry.cleared===false,JSON.stringify(death.entry));
 const deathUi=await ev(`(()=>{const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawOverlay()}catch(e){}ctx.fillText=o;return lines;})()`);
 ok('死亡界面仍显示道消',deathUi.some(t=>t==='道消'),deathUi.slice(0,3));

 ok('运行期无 JS 错误',errs.length===0,errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.39 回归：${pass} 项通过，${fail} 项失败 ===`);
 ws.close();
 process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
