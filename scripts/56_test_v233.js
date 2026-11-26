/* v2.33 雷达避让回归
   用法：node scripts/56_test_v233.js （需 9223 调试端口 + 8000 静态服务）
   反馈：手机横屏时雷达被「升 / 降」按钮挡住。
   v2.31 的 (W-70, R+30) 在 844×390 够用，但真机横屏带地址栏时可视高度只有
   300~330，按钮组顶边升到 y≈70~120，正好顶到雷达底边（78+48=126）。
   本测试直接量 DOM 矩形，逐尺寸断言圆形雷达与按钮组/摇杆都不相交，
   并且完整落在屏内。 */
const http=require('http'),WS=globalThis.WebSocket;
const get=p=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9223,path:p,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(JSON.parse(d)))});r.on('error',rej);r.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,d)=>{ if(c){pass++;console.log('PASS',n,d===undefined?'':('— '+d));}
                   else{fail++;console.log('FAIL',n,d===undefined?'':('— '+d));} };

(async()=>{
 const list=await get('/json/list');const pg=list.find(t=>t.type==='page'&&t.url.includes('mvp_air'));
 const ws=new WS(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend=new Map();const errs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);
   if(m.method==='Runtime.exceptionThrown')errs.push((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
 const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
 const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>{
   if(r.result&&r.result.exceptionDetails)return {__err:r.result.exceptionDetails.text};
   return r.result.result.value;});
 const sizes=async(w,h,touch)=>{
   await send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:touch?5:1});
   await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:touch?2:1,mobile:touch});
   /* 连续调用 override 时视口有延迟，轮询到 window 尺寸真的等于目标为止，
      否则会拿上一档的矩形做断言（假失败/假通过都出现过）。 */
   for(let k=0;k<24;k++){
     const cur=await ev('({w:window.innerWidth,h:window.innerHeight})');
     if(cur&&cur.w===w&&cur.h===h)break;
     await sleep(150);
   }
   await ev('resize();1');
   await sleep(320);
 };
 const boot=async(w,h,touch)=>{
   await sizes(w,h,touch);
   await send('Network.setCacheDisabled',{cacheDisabled:true});
   await send('Page.navigate',{url:'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'});
   await sleep(6000);
   await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
     player.pos.x=0;player.pos.z=60;player.pos.y=30;player.heading=0;player.dir=facingVec(0);cam.yaw=0;game.time=16;snapCamera();return 1})()`);
   await sleep(900);
 };
 /* 量一次：雷达圆 vs #tb / #joy 矩形，按 canvas 设备像素 */
 const measure=()=>ev(`(()=>{const r=radarAnchor();
   const bd=el=>{const b=document.getElementById(el).getBoundingClientRect();
     return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};};
   const dg=b=>{const nx=Math.max(b.l,Math.min(r.cx,b.r)),ny=Math.max(b.t,Math.min(r.cy,b.b));
     return +(Math.hypot(r.cx-nx,r.cy-ny)-r.R).toFixed(1);};
   const tb=bd('tb'),jy=bd('joy');
   return {cx:r.cx|0,cy:r.cy|0,R:r.R,W,H,
     tbGap:dg(tb),joyGap:dg(jy),
     tbBox:[tb.l|0,tb.t|0,tb.r|0,tb.b|0],tbH:+(tb.h).toFixed(0),
     inScreen:(r.cx-r.R>=0&&r.cx+r.R<=W&&r.cy-r.R>=0&&r.cy+r.R<=H)};})()`);

 /* ---------- 版本 ---------- */
 await boot(844,390,true);
 const ver=await ev(`(function(){let found='';const orig=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)found=t;return orig.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=orig;return found;})()`);
 ok('渲染标题版本号 v2.39', /v2\.39$/.test(ver || ''), ver);

 /* ---------- 横屏：真机可能矮到 280 ---------- */
 const lands=[[844,390],[740,360],[667,375],[900,340],[780,300],[640,280]];
 let worst=1e9,worstAt='';
 for(const [w,h] of lands){
   if(w!==844||h!==390)await sizes(w,h,true);
   const m=await measure();
   if(m&&m.tbGap<worst){worst=m.tbGap;worstAt=`${w}x${h}`;}
   ok(`横屏 ${w}x${h}：雷达不压按钮组`, m && m.tbGap>4, m?`gap=${m.tbGap}px radar=(${m.cx},${m.cy},R${m.R}) btn=${JSON.stringify(m.tbBox)} tbH=${m.tbH}`:JSON.stringify(m));
   ok(`横屏 ${w}x${h}：雷达不压摇杆`, m && m.joyGap>4, m?`gap=${m.joyGap}px`:'');
   ok(`横屏 ${w}x${h}：雷达完整在屏内`, m && m.inScreen, m?`(${m.cx},${m.cy}) R${m.R} 屏 ${m.W}x${m.H}`:'');
   ok(`横屏 ${w}x${h}：雷达在画面上半部`, m && m.cy < m.H*0.55, m?`cy=${m.cy} H=${m.H}`:'');
 }
 ok('最窄间隙 > 4px', worst>4, `min=${worst}px @${worstAt}`);

 /* 矮屏时按钮组压缩到 ≤180px（原 138 是 64+10+64，压缩后 52+8+52=112） */
 const small=await measure();
 ok('矮横屏按钮组已压缩（高 ≤ 120）', small && small.tbH <= 120, 'tbH=' + (small?small.tbH:'?'));

 /* ---------- 竖屏 ---------- */
 for(const [w,h] of [[390,844],[360,640],[430,932]]){
   await sizes(w,h,true);
   const m=await measure();
   ok(`竖屏 ${w}x${h}：雷达不压按钮组/摇杆且在屏内`,
     m && m.tbGap>4 && m.joyGap>4 && m.inScreen,
     m?`tb=${m.tbGap} joy=${m.joyGap} (${m.cx},${m.cy}) R${m.R}`:'');
 }

 /* ---------- 桌面：位置不变 ---------- */
 await boot(1440,810,false);
 const desk=await ev(`(()=>{const r=radarAnchor();return {cx:r.cx,cy:r.cy,R:r.R,W,H};})()`);
 ok('桌面仍为右下角 R=78', desk && desk.R===78 && desk.cx===desk.W-96 && desk.cy===desk.H-96, JSON.stringify(desk));

 ok('运行期无 JS 错误', errs.length === 0, errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.33 雷达避让回归：${pass} 项通过，${fail} 项失败 ===`);
 process.exit(fail?1:0);
})();
