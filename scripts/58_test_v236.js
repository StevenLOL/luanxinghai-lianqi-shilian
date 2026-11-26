/* v2.36 回归：经验条 / 技能条压缩 / 高度显示 / 灵石 + 宗门坊市
   用法：node scripts/58_test_v236.js （需 9223 调试端口 + 8000 静态服务） */
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
     const cur=await ev('({w:window.innerWidth,h:window.innerHeight})').catch(()=>null);
     if(cur&&cur.w===w&&cur.h===h)break;
     await sleep(150);
   }
   await send('Page.navigate',{url:URL});await sleep(6200);
   await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
     player.pos.x=0;player.pos.z=40;player.pos.y=30;player.heading=0;player.dir=facingVec(0);
     cam.yaw=0;game.time=16;snapCamera();return 1})()`);
   await sleep(600);
 };
 await send('Page.enable');await send('Runtime.enable');
 await boot(1440,810,false);
 /* 清空坊市存档并重载，保证从零开始 */
 await ev(`(()=>{localStorage.removeItem('lxh_lianqi_shop_v1');loadShop();return 1})()`);
 await boot(1440,810,false);

 const ver=await ev(`(function(){let f='';const o=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)f=t;return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;return f;})()`);
 ok('渲染标题版本号 v2.39',/v2\.39$/.test(ver||''),ver);

 /* ---------- ① 经验条 ---------- */
 const exp=await ev(`(()=>{player.level=1;player.exp=10;
   const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;
   return {need:expToNext(1),lines,has:lines.includes('10/'+expToNext(1)),
           bad:lines.includes('0/1')||lines.includes('1/1')};})()`);
 ok('经验条右侧显示真实经验/需求',exp.has&&!exp.bad,
    `need=${exp.need} has=${exp.has} bad=${exp.bad}`);
 const expMax=await ev(`(()=>{player.level=LEVEL_MAX;player.exp=0;
   const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;
   return {full:lines.some(t=>t.includes('圆满')),bad:lines.includes('1/1')};})()`);
 ok('满级经验条显示圆满而非 1/1',expMax.full&&!expMax.bad,JSON.stringify(expMax));

 /* ---------- ② 高度独立显示 ---------- */
 const hud=await ev(`(()=>{player.level=1;player.exp=0;player.pos.y=56;
   const lines=[];const o=ctx.fillText;
   ctx.fillText=function(t){lines.push(String(t));return o.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=o;
   return {lines,alt:lines.filter(t=>t.indexOf('高度')===0),
           stone:lines.filter(t=>t.indexOf('灵石')===0)};})()`);
 ok('HUD 有独立高度行',hud.alt.length===1&&/\d+\/\d+ 丈/.test(hud.alt[0]),JSON.stringify(hud.alt));
 ok('得分已改为灵石显示',hud.lines.some(t=>/灵石 \d+/.test(t))&&!hud.lines.some(t=>t.indexOf('得分')>=0),
    JSON.stringify(hud.lines.filter(t=>/灵石|击杀/.test(t))));

 /* ---------- ③ 技能条压缩 ---------- */
 const bar=await ev(`(()=>{const b=document.getElementById('spellBar').getBoundingClientRect();
   const s=document.getElementById('shopBtn').getBoundingClientRect();
   return {w:Math.round(b.width),h:Math.round(b.height),shopW:Math.round(s.width),
           texts:[...document.querySelectorAll('#spellBar button')].map(x=>x.textContent)};})()`);
 ok('技能条压缩到 150px 内',bar.w<=150&&bar.h<=26,JSON.stringify(bar));
 ok('技能按钮图标化',bar.texts.every(t=>t.length<=2),JSON.stringify(bar.texts));

 /* ---------- ④ 灵石入账 ---------- */
 const stone=await ev(`(()=>{const before=shopSave.stones;
   earnStones(35);
   return {before,after:shopSave.stones,
           dom:document.getElementById('stoneNum').textContent};})()`);
 ok('击杀灵石入账到本局余额',stone.after===stone.before+35&&stone.dom==='35',JSON.stringify(stone));

 /* ---------- ⑤ 商店开关与面板 ---------- */
 const openShop=await ev(`(()=>{document.getElementById('shopBtn').click();
   drawShop();return {open:shopOpen,rects:shopRects.length,
     board:boardOpen,locked:typeof shopClick==='function'};})()`);
 ok('点坊市按钮打开商店',openShop.open&&!openShop.board,JSON.stringify(openShop));
 ok('商店面板 6 件物品 + 返回键',openShop.rects===7,'rects='+openShop.rects);
 const pause=await ev(`({t:game.time})`);
 await sleep(500);
 const pause2=await ev(`({t:game.time})`);
 ok('商店打开时游戏暂停',Math.abs(pause2.t-pause.t)<0.01,`${pause.t}→${pause2.t}`);
 const closeShop=await ev(`(()=>{shopClick(9999,9999);const outside=shopOpen;
   const r=shopRects.find(x=>x.id==='__close__');shopClick(r.x+2,r.y+2);
   return {outside,closed:!shopOpen};})()`);
 ok('点返回键关闭商店',closeShop.outside&&closeShop.closed,JSON.stringify(closeShop));

 /* ---------- ⑥ 六件物品属性生效 ---------- */
 /* 八荒剑单独买一次，才能把它的 +12 与炼神诀的 +5 分开验证 */
 const swordOnly=await ev(`(()=>{shopSave.stones=100000;player.hp=player.maxHp;player.qi=player.maxQi;player.inv=0;
   const r0=spellRange('sword','player'),ok=buyShopItem('sword');
   return {ok,r0,r1:spellRange('sword','player'),dmg:shopBonus().swordDmg};})()`);
 ok('八荒剑增加飞剑射程与威力',
    swordOnly.ok&&swordOnly.r1-swordOnly.r0===12&&swordOnly.dmg===6,
    `射程 ${swordOnly.r0}→${swordOnly.r1} 威力+${swordOnly.dmg}`);
 const before=await ev(`(()=>{return {maxHp:player.maxHp,maxQi:player.maxQi,hpR:pRegenHp(),qiR:pRegenQi(false),
     sword:spellRange('sword','player'),fire:spellRange('fire','player'),
     ice:spellRange('ice','player'),light:spellRange('lightning','player'),
     dmg:shopBonus().swordDmg,armor:shopBonus().armor};})()`);
 const buys=await ev(`(()=>{const got=['robe','body','spirit','breath','fruit'].map(id=>buyShopItem(id));
   return {got,stones:shopSave.stones,levels:{...shopSave.up},
     maxHp:player.maxHp,maxQi:player.maxQi,hpR:pRegenHp(),qiR:pRegenQi(false),
     sword:spellRange('sword','player'),fire:spellRange('fire','player'),
     ice:spellRange('ice','player'),light:spellRange('lightning','player'),
     dmg:shopBonus().swordDmg,armor:shopBonus().armor};})()`);
 ok('六件物品均可购买',swordOnly.ok&&buys.got.every(Boolean),JSON.stringify(buys.got));
 ok('太乙道袍减少受到的伤害',
    Math.abs(buys.armor-before.armor-0.06)<1e-6,`减伤 ${(buys.armor*100).toFixed(0)}%`);
 const armorTest=await ev(`(()=>{player.hp=player.maxHp;player.inv=0;
   const h0=player.hp;hurtPlayer(100,{ignoreInv:true,noInv:true,noFlash:true});
   return {lost:+(h0-player.hp).toFixed(2)};})()`);
 ok('减伤在受伤入口真实生效',Math.abs(armorTest.lost-94)<0.01,`100伤害实际扣 ${armorTest.lost}`);
 ok('锻体诀增加气血上限与回复',
    buys.maxHp-before.maxHp===45&&Math.abs(buys.hpR-before.hpR-1.5)<1e-6,
    `上限+${buys.maxHp-before.maxHp} 回复+${(buys.hpR-before.hpR).toFixed(1)}`);
 ok('炼神诀增加全部技能射程',
    [buys.fire-before.fire,buys.ice-before.ice,buys.light-before.light].every(x=>x===5),
    `火+${buys.fire-before.fire} 冰+${buys.ice-before.ice} 雷+${buys.light-before.light}`);
 ok('炼气诀增加灵力上限与回复',
    buys.maxQi-before.maxQi===40&&Math.abs(buys.qiR-before.qiR-2)<1e-6,
    `上限+${buys.maxQi-before.maxQi} 回复+${(buys.qiR-before.qiR).toFixed(1)}`);
 ok('朱果同时增加气血/灵力上限',
    buys.maxHp-before.maxHp===45&&buys.maxQi-before.maxQi===40,'含在两项合计内');

 /* ---------- ⑦ 本局状态：重开全部归零（v2.39） ---------- */
 const persist=await ev(`(()=>{const raw=localStorage.getItem('lxh_lianqi_shop_v1');
   const before={lv:{...shopSave.up},bonus:shopBonus().hp,stones:shopSave.stones};
   reset();
   return {raw:!!raw,before,after:{lv:{...shopSave.up},bonus:shopBonus().hp,stones:shopSave.stones,
                                  maxHp:player.maxHp,maxQi:player.maxQi,
                                  sword:spellRange('sword','player')}};})()`);
 ok('购买不写入跨局存档',!persist.raw&&persist.before.lv.sword===1&&persist.before.bonus===45,JSON.stringify(persist.before));
 ok('重开后灵石/功法/属性全部归零',
    persist.after.stones===0&&Object.values(persist.after.lv).every(v=>v===0)&&
    persist.after.bonus===0&&persist.after.maxHp===100&&persist.after.maxQi===100,
    JSON.stringify(persist.after));
 const limited=await ev(`(()=>{shopSave.stones=0;const r=buyShopItem('sword');
   const lv=shopLv('sword');return {r,lv};})()`);
 ok('灵石不足时不能购买',limited.r===false&&limited.lv===0,JSON.stringify(limited));

 /* ---------- ⑧ 三端布局 ---------- */
 const layout=()=>ev(`(()=>{const hit=(a,b)=>Math.max(a.left,b.left)<Math.min(a.right,b.right)&&
     Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom);
   const tb=document.getElementById('topBar').getBoundingClientRect();
   const jy=document.getElementById('joy').getBoundingClientRect();
   const bt=document.getElementById('tb').getBoundingClientRect();
   const rd=radarAnchor();
   return {tb:[tb.left|0,tb.top|0,tb.right|0,tb.bottom|0],
     joy:hit(tb,jy),btn:hit(tb,bt),
     radar:rd.cx-rd.R<tb.right&&rd.cx+rd.R>tb.left&&rd.cy-rd.R<tb.bottom&&rd.cy+rd.R>tb.top};})()`);
 const land=await layout();
 ok('横屏顶栏不遮摇杆/按钮/雷达',!land.joy&&!land.btn&&!land.radar,JSON.stringify(land));
 await boot(844,390,true);
 const land2=await layout();
 ok('手机横屏顶栏不遮挡',!land2.joy&&!land2.btn&&!land2.radar,JSON.stringify(land2));
 const touchShop=await ev(`(()=>{const b=document.getElementById('shopBtn');
   const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchShop.x,y:touchShop.y,id:7}]});
 await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await sleep(220);
 ok('手机触摸可打开坊市',await ev('shopOpen')===true);
 await boot(390,844,true);
 const port=await layout();
 ok('竖屏顶栏不遮挡',!port.joy&&!port.btn&&!port.radar,JSON.stringify(port));

 ok('运行期无 JS 错误',errs.length===0,errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.36 回归：${pass} 项通过，${fail} 项失败 ===`);
 await ev("localStorage.removeItem('lxh_lianqi_shop_v1');loadShop();1").catch(()=>{});
 await get('/json/close/'+page.id).catch(()=>{});
 process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2)});
