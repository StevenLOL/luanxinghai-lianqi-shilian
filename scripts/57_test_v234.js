/* v2.36 回归：山势进高度场 / 精简 HUD / 技能自动开关
   用法：node scripts/57_test_v234.js （需 9223 调试端口 + 8000 静态服务） */
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
 const boot=async(w,h,touch)=>{
   await send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:touch?5:1});
   await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:touch});
   for(let k=0;k<24;k++){
     /* 新标签页一开始是 about:blank，取不到游戏变量，用原生 window 尺寸即可 */
     const cur=await ev('({w:window.innerWidth,h:window.innerHeight})').catch(()=>null);
     if(cur&&cur.w===w&&cur.h===h)break;
     await sleep(150);
   }
   await send('Page.navigate',{url:URL});await sleep(6200);
   await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
     player.pos.x=84;player.pos.z=-300;player.pos.y=50;player.heading=0;player.dir=facingVec(0);
     cam.yaw=0;game.time=16;snapCamera();return 1})()`);
   await sleep(700);
 };
 await send('Page.enable');await send('Runtime.enable');
 await boot(1440,810,false);

 const ver=await ev(`(function(){let f='';const o=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)f=t;return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;return f;})()`);
 ok('渲染标题版本号 v2.39',/v2\.39$/.test(ver||''),ver);

 const grass=await ev(`(()=>{const src=drawCellGrass.toString();
   return {fn:typeof drawCellGrass==='function',
           blades:['GRASS_COLORS','tipx','swayX','moveTo(p.x+spread'].some(k=>src.includes(k)),
           pebbles:src.includes('碎石'),
           shrub:typeof drawCellShrubs==='function',tree:typeof drawCellTrees==='function'};})()`);
 ok('地面草叶已移除，树/灌木/碎石保留',grass.fn&&!grass.blades&&grass.pebbles&&grass.shrub&&grass.tree,JSON.stringify(grass));

 const mtn=await ev(`(()=>{
   const peak=nfMountainField(84,-616),base=nfWorldH(84,-616),total=terrainH(84,-616);
   let rise=0;
   for(let z=0;z>=-800;z-=25)if(terrainH(84,z)-nfWorldH(84,z)>rise)rise=terrainH(84,z)-nfWorldH(84,z);
   return {peak:+peak.toFixed(1),base:+base.toFixed(1),total:+total.toFixed(1),rise:+rise.toFixed(1),
           waterTotal:+terrainH(0,-148).toFixed(1),waterBase:+nfWorldH(0,-148).toFixed(1),
           sample:!!MT_SAMPLE,visualSame:visualH(84,-616)===terrainH(84,-616)};})()`);
 ok('山峰高度 > 100',mtn.peak>100,'peak='+mtn.peak);
 ok('近景地形随山势抬升',mtn.rise>25,`最大抬升=${mtn.rise}（峰值处 ${mtn.base}→${mtn.total}）`);
 ok('渲染高度与碰撞高度一致',mtn.visualSame,'visualH===terrainH');
 ok('粗网格采样器已建立',mtn.sample,'MT_SAMPLE');
 ok('湖面不被山填掉',Math.abs(mtn.waterTotal-mtn.waterBase)<0.01,`${mtn.waterBase}→${mtn.waterTotal}`);

 const fly=await ev(`(()=>{player.pos.x=84;player.pos.z=-616;player.targetAlt=26;
   player.pos.y=Math.max(terrainH(84,-616),0)+26;return {g:+terrainH(84,-616).toFixed(1),y:+player.pos.y.toFixed(1)};})()`);
 await sleep(900);
 const flown=await ev(`({y:+player.pos.y.toFixed(1),g:+terrainH(player.pos.x,player.pos.z).toFixed(1),
                        above:+(player.pos.y-terrainH(player.pos.x,player.pos.z)).toFixed(1)})`);
 ok('玩家飞到山顶不会被压进山体',flown.above>4&&flown.y>100,
    `地面 ${flown.g} 玩家 ${flown.y} 离地 ${flown.above}`);

 const hud=await ev(`(()=>{const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;
   return {n:lines.length,lines};})()`);
 ok('桌面 HUD 文本行数 ≤ 14',hud.n<=14,`${hud.n} 行：${hud.lines.slice(0,4).join(' / ')}`);
 ok('状态条已短化（不含旧长标签文字）',!hud.lines.some(t=>/练气\s*\d+\s*层\s*·\s*经验/.test(t)),'无长经验标签');

 const bar=await ev(`(()=>{const bs=[...document.querySelectorAll('#spellBar button')];
   return {n:bs.length,keys:bs.map(b=>b.dataset.spell),off:bs.filter(b=>b.classList.contains('off')).length,
     text:bs.map(b=>b.textContent)};})()`);
 ok('技能面板 4 项且默认全开',bar.n===4&&bar.off===0&&bar.keys.join(',')==='sword,fire,ice,lightning',
    JSON.stringify(bar));

 const toggle=await ev(`(()=>{const b=document.querySelector('#spellBar button[data-spell="fire"]');
   const before=player.autoSpells.fire; b.click();
   const after=player.autoSpells.fire,cls=b.classList.contains('off');
   b.click();return {before,after,cls,back:player.autoSpells.fire};})()`);
 ok('点击可关闭/恢复单个技能自动使用',toggle.before===true&&toggle.after===false&&toggle.cls&&toggle.back===true,JSON.stringify(toggle));

 const ai=await ev(`(()=>{
   const cds={sword:0,fire:0,ice:0,lightning:0,roll:0};
   const caster={x:0,y:30,z:0},f=facingVec(0);
   const t={dummy:true,pos:{x:0,y:10,z:-25}};
   const all=evaluateAutoSpell('player',caster,f,[t],200,cds);
   player.autoSpells.sword=false;player.autoSpells.fire=false;
   player.autoSpells.ice=false;player.autoSpells.lightning=false;
   const none=evaluateAutoSpell('player',caster,f,[t],200,cds);
   player.autoSpells.fire=true;
   const onlyFire=evaluateAutoSpell('player',caster,f,[t],200,cds);
   for(const k of SPELL_ORDER)player.autoSpells[k]=true;
   return {all:all&&all.key,none:none&&none.key,onlyFire:onlyFire&&onlyFire.key};})()`);
 ok('自动攻击原本能选到技能',!!ai.all,'选 '+ai.all);
 ok('全部关闭后自动攻击停手',ai.none===undefined||ai.none===null,'返回值='+ai.none);
 ok('只开火球时自动攻击只选火球',ai.onlyFire==='fire','选 '+ai.onlyFire);

 const manual=await ev(`(()=>{const src=castManual.toString()+castLightning.toString();
   player.autoSpells.sword=false;player.qi=100;player.cds.sword=0;
   const t={dummy:true,hp:1e9,pos:{x:player.pos.x,y:terrainH(player.pos.x,player.pos.z)+10,z:player.pos.z-20}};
   const fired=castSpellFor('player','sword',t,player);
   const after=player.cds.sword;player.autoSpells.sword=true;player.cds.sword=0;
   return {clean:!src.includes('autoSpells'),fired,after};})()`);
 ok('关闭自动不影响手动施法',manual.clean&&manual.fired&&manual.after>0,JSON.stringify(manual));

 /* ---------- 手机：面板不遮摇杆/按钮，触摸能切换 ---------- */
 await boot(844,390,true);
 const layout=await ev(`(()=>{const sb=document.getElementById('spellBar').getBoundingClientRect();
   const hit=(r,b)=>Math.max(r.left,Math.min(b.left,r.right))<Math.min(r.right,Math.max(b.left,b.right))&&
                     Math.max(r.top,Math.min(b.top,r.bottom))<Math.min(r.bottom,Math.max(b.top,b.bottom));
   const jy=document.getElementById('joy').getBoundingClientRect();
   const tb=document.getElementById('tb').getBoundingClientRect();
   const rd=radarAnchor();
   return {sb:[sb.left|0,sb.top|0,sb.right|0,sb.bottom|0],
     joy:hit(sb,jy),tb:hit(sb,tb),
     radar:rd.cx-rd.R<sb.right&&rd.cx+rd.R>sb.left&&rd.cy-rd.R<sb.bottom&&rd.cy+rd.R>sb.top};})()`);
 ok('横屏技能面板不遮摇杆/按钮/雷达',!layout.joy&&!layout.tb&&!layout.radar,JSON.stringify(layout));

 const touchBtn=await ev(`(()=>{const b=document.querySelector('#spellBar button[data-spell="ice"]');
   const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBtn.x,y:touchBtn.y,id:9}]});
 await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await sleep(220);
 const touched=await ev(`({ice:player.autoSpells.ice,off:document.querySelector('#spellBar button[data-spell="ice"]').classList.contains('off')})`);
 ok('手机触摸可切换技能自动开关',touched.ice===false&&touched.off,JSON.stringify(touched));

 await boot(390,844,true);
 const port=await ev(`(()=>{const sb=document.getElementById('spellBar').getBoundingClientRect();
   const jy=document.getElementById('joy').getBoundingClientRect();
   const tb=document.getElementById('tb').getBoundingClientRect();
   return {sb:[sb.left|0,sb.top|0,sb.right|0,sb.bottom|0],
     joy:sb.bottom>jy.top&&sb.right>jy.left,tb:sb.bottom>tb.top&&sb.right>tb.left};})()`);
 ok('竖屏技能面板在顶部空档',!port.joy&&!port.tb&&port.sb[1]<200,JSON.stringify(port));

 ok('运行期无 JS 错误',errs.length===0,errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.36 回归：${pass} 项通过，${fail} 项失败 ===`);
 await get('/json/close/'+page.id).catch(()=>{});
 process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2)});
