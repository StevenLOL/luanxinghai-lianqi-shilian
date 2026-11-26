/* v2.31 远景回归：山峦 / 近景-远景空隙 / 手机横屏 UI 重叠
   用法：node scripts/52_test_v231.js （需 9223 调试端口 + 8000 静态服务）
   覆盖的三个反馈：
     ① 当前没有山峦
     ② 近距离和远景之间地图上有留空白
     ③ 手机横屏时雷达和上下重叠 */
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
 const boot=async(w,h,touch)=>{
   await send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:touch?5:1});
   await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:touch?2:1,mobile:touch});
   await send('Page.navigate',{url:'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'});
   await sleep(6000);
   await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
     player.pos.x=0;player.pos.z=60;player.pos.y=30;player.heading=0;player.dir=facingVec(0);cam.yaw=0;game.time=16;snapCamera();return 1})()`);
   await sleep(900);
 };

 /* ---------- 桌面：版本 / 视角 / 远山 ---------- */
 await boot(1440,810,false);
 errs.length=0;
 const ver=await ev(`(function(){let found='';const orig=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)found=t;return orig.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=orig;return found;})()`);
 ok('渲染标题版本号 v2.39', /v2\.39$/.test(ver || ''), ver);

 const pit=await ev(`({idx:cam.pitchIdx,deg:+(Math.asin(-cam.f.y)*180/Math.PI).toFixed(1),hz:camHorizonY()})`);
 ok('默认视角降到低视角档（idx=0）', pit.idx === 0, JSON.stringify(pit));
 ok('默认俯角 < 30°（山看得见）', pit.deg < 30, pit.deg + '°');
 ok('地平线落在画面内（hz>0）', pit.hz > 0, 'hz=' + (pit.hz|0));

 const mt=await ev(`(()=>{const peak=nfMountainField(84,-616);
   let min=1e9,at=0;
   for(let k=0;k<8;k++){const a=k*Math.PI/4;const h=nfMountainField(Math.sin(a)*760,Math.cos(a)*760);
     if(h<min){min=h;at=k*45;}}
   return {peak:+peak.toFixed(1),min:+min.toFixed(1),at,cells:(drawMountains._L||[]).length};})()`);
 ok('主峰高度 > 150', mt.peak > 150, 'peak=' + mt.peak);
 ok('八个方位都有远景丘陵（不留空）', mt.min > 8, `min=${mt.min} @${mt.at}°`);
 ok('远山网格有可见格子', mt.cells > 200, 'cells=' + mt.cells);

 /* 近景-远景空隙：地平线以下 60~160px 这一段不该再是天空的暖粉色 */
 const gap=await ev(`(()=>{const c=document.getElementById('game'),g=c.getContext('2d');
   const hz=Math.max(4,camHorizonY());
   const y=Math.min(H-4,hz+90);
   const im=g.getImageData(0,y,1,1).data;
   /* 老的天空底色是 rgb(228,192,180)，新铺的远景地面是灰紫/橄榄 */
   const isOldSky=Math.abs(im[0]-228)<14&&Math.abs(im[1]-192)<16&&Math.abs(im[2]-180)<16;
   return {y:y|0,rgb:[im[0],im[1],im[2]],isOldSky};})()`);
 ok('地平线下方不再是天空暖粉（露出远景地面）', !gap.isOldSky, JSON.stringify(gap));

 /* ---------- 手机横屏：雷达 vs 升降/翻滚按钮 ---------- */
 await boot(844,390,true);
 const land=await ev(`(()=>{const r=radarAnchor();
   const b=document.getElementById('tb').getBoundingClientRect();
   const cx=r.cx,cy=r.cy,R=r.R;
   const nx=Math.max(b.left,Math.min(cx,b.right)),ny=Math.max(b.top,Math.min(cy,b.bottom));
   const d=Math.hypot(cx-nx,cy-ny);
   return {cx:cx|0,cy:cy|0,R,btn:[b.left|0,b.top|0,b.right|0,b.bottom|0],gap:+(d-R).toFixed(1)};})()`);
 ok('横屏雷达与按钮组不重叠', land.gap > 6, `gap=${land.gap}px radar=(${land.cx},${land.cy}) btn=${JSON.stringify(land.btn)}`);
 ok('横屏雷达在右上角', land.cy < 160 && land.cx > 844 * 0.7, `(${land.cx},${land.cy})`);

 /* 竖屏：同一套锚点函数 */
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
 await sleep(700);
 const port=await ev(`(()=>{const r=radarAnchor();
   const b=document.getElementById('tb').getBoundingClientRect();
   const nx=Math.max(b.left,Math.min(r.cx,b.right)),ny=Math.max(b.top,Math.min(r.cy,b.bottom));
   return {gap:+(Math.hypot(r.cx-nx,r.cy-ny)-r.R).toFixed(1),cy:r.cy|0};})()`);
 ok('竖屏雷达与按钮组不重叠', port.gap > 6, `gap=${port.gap}px cy=${port.cy}`);

 ok('运行期无 JS 错误', errs.length === 0, errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.31 远景/UI 回归：${pass} 项通过，${fail} 项失败 ===`);
 process.exit(fail?1:0);
})();
