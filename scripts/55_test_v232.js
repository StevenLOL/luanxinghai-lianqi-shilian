/* v2.32 远景环带回归：近景网格尽头 → 远山网格起点之间的空白
   用法：node scripts/55_test_v232.js （需 9223 调试端口 + 8000 静态服务）

   用户反馈「还是有间隔空白」的根因：近景地形网格只铺 range*step（手机 11×25=275）
   单位，远山网格只画 d>320 且高度>1.5 的格子 —— 中间那条环带两边都没画，
   天空底色从里面露出来。v2.31 只换了底色颜色，环带照样是"没有任何几何"的一条带。
   v2.32 用 2 倍粗的格子（50 单位）把环带铺成远景地面 + 合批的远景树。
   本测试直接量三件事：
     ① 裙边几何真的覆盖了环带（世界距离采样）
     ② 画面上不再出现"浅色 + 几乎没有横向纹理"的连续横带（像素级）
     ③ 环带之外，远山网格在八个方位上都有高度，不会另开一个洞 */
const http=require('http'),WS=globalThis.WebSocket;
const get=p=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9223,path:p,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(JSON.parse(d)))});r.on('error',rej);r.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,d)=>{ if(c){pass++;console.log('PASS',n,d===undefined?'':('— '+d));}
                   else{fail++;console.log('FAIL',n,d===undefined?'':('— '+d));} };

/* 屏幕扫描：地平线下方找"浅暖灰 + 横向几乎没有纹理"的连续行 */
const SCAN=`(()=>{const im=ctx.getImageData(0,0,W,H).data;
 const hz=camHorizonY(); const y0=Math.max(0,(hz===null?0:hz)-4), y1=Math.min(H-1,(hz===null?H*0.5:hz)+Math.round(H*0.55));
 const bad=[];
 for(let y=y0;y<=y1;y+=2){
   let r=0,g=0,b=0,n=0,e=0;
   for(let x=24;x<W-24;x+=3){const i=(y*W+x)*4,j=(y*W+x+3)*4;
     r+=im[i];g+=im[i+1];b+=im[i+2];n++;
     e+=Math.abs(im[i]-im[j])+Math.abs(im[i+1]-im[j+1])+Math.abs(im[i+2]-im[j+2]);}
   r/=n;g/=n;b/=n;e/=(n-1);
   const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
   const pale=(r-mn)<26&&r>168&&g>150&&b>140;
   if(pale&&e<2.6)bad.push([y,Math.round(r),Math.round(g),Math.round(b),+e.toFixed(2)]);
 }
 let span=0,at=null;
 if(bad.length){let run=[bad[0]];
   for(let k=1;k<bad.length;k++){
     if(bad[k][0]-bad[k-1][0]<=2)run.push(bad[k]);else run=[bad[k]];
     if(run[run.length-1][0]-run[0][0]>span){span=run[run.length-1][0]-run[0][0];at=[run[0][0],run[run.length-1][0]];}
   }
 }
 return {hz:hz===null?null:Math.round(hz),badRows:bad.length,span,at};})()`;

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
 /* 手机横屏 + 停住油门（touchThrottle(-1)=0），机位可复现 */
 const place=(x,z,yaw,pitch)=>ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
   touch.axisY=-1;touch.axisX=0;
   player.pos.x=${x};player.pos.z=${z};player.pos.y=26;player.vel={x:0,y:0,z:0};
   player.heading=${yaw};player.dir=facingVec(${yaw});cam.yaw=${yaw};cam.pitchIdx=${pitch};
   game.time=16;snapCamera();return 1})()`);

 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await send('Emulation.setDeviceMetricsOverride',{width:980,height:400,deviceScaleFactor:2,mobile:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'});
 await sleep(6200);
 await place(120,-40,0,1);
 await sleep(800);

 const ver=await ev(`(function(){let found='';const orig=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)found=t;return orig.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=orig;return found;})()`);
 ok('渲染标题版本号 v2.39', /v2\.39$/.test(ver || ''), ver);

 /* ① 裙边几何 */
 const sk=await ev(`(()=>{const inner=QUALITY.range*QUALITY.step;
   const L=drawFarSkirt._L||[];
   let dmin=1e9,dmax=0;
   for(const q of L){if(q.dd<dmin)dmin=q.dd;if(q.dd>dmax)dmax=q.dd;}
   return {inner,count:L.length,trees:((drawFarSkirt._T||[]).length>>2),
           dmin:+dmin.toFixed(1),dmax:+dmax.toFixed(1)};})()`);
 ok('远景裙边有几何（> 30 格）', sk.count > 30, `cells=${sk.count}`);
 ok('裙边从近景尽头内侧开始（dmin < inner）', sk.dmin < sk.inner, `dmin=${sk.dmin} inner=${sk.inner}`);
 ok('裙边一直铺到远山脚下（dmax > inner+250）', sk.dmax > sk.inner + 250, `dmax=${sk.dmax}`);
 ok('裙边上有远景树（> 80 棵）', sk.trees > 80, 'trees=' + sk.trees);

 /* ② 环带里必须有地面颜色：沿视线在 275~600 单位采样，水体与陆地都不该是天空色 */
 const cover=await ev(`(()=>{const inner=QUALITY.range*QUALITY.step;
   const skyBand=[[228,192,180],[205,186,188]];
   let land=0,water=0,n=0,nearCnt=0;
   for(let k=0;k<24;k++){
     const a=k*Math.PI/12,dx=Math.sin(a),dz=Math.cos(a);
     for(let d=inner*0.98;d<=inner+300;d+=25){
       const x=cam.pos.x+dx*d,z=cam.pos.z+dz*d;
       const h=visualH(x,z);const c=terrainColor(x,z,h,0,0,d);
       n++;
       if(h<NF_WATER_LV)water++;else land++;
       /* 和天空色比：色相/明度都太接近就算"露底" */
       const near=skyBand.some(s=>Math.abs(c[0]-s[0])<10&&Math.abs(c[1]-s[1])<10&&Math.abs(c[2]-s[2])<10);
       if(near)nearCnt++;
     }
   }
   return {n,land,water,nearCnt};})()`);
 ok('环带采样点都有地形色（不等同天空底色）', cover.nearCnt === 0, JSON.stringify(cover));

 /* ③ 像素级：八个方位 × 两档视角都没有"浅色无纹理横带" */
 let worst=0,worstAt='';
 for(const pitch of [0,1]){
   for(let k=0;k<8;k++){
     const yaw=k*Math.PI/4;
     await place(120,-40,yaw,pitch);
     await sleep(340);
     const st=await ev(SCAN);
     if(st.span>worst){worst=st.span;worstAt=`pitch=${pitch} yaw=${k*45}° span=${st.span}px ${JSON.stringify(st.at)}`;}
   }
 }
 ok('没有横贯画面的空白带（span ≤ 14px）', worst <= 14, worstAt || 'span=0');

 /* ④ 环带之外：远山网格八方位都有高度，不会再开第二个洞 */
 const mt=await ev(`(()=>{let min=1e9,at=0;
   for(let k=0;k<8;k++){const a=k*Math.PI/4;
     for(const r of [380,460,560,700]){
       const h=nfMountainField(Math.sin(a)*r,Math.cos(a)*r);
       if(h<min){min=h;at=k*45+':'+r;}
     }}
   return {min:+min.toFixed(2),at};})()`);
 ok('远山网格在 380~700 单位八方位都有高度', mt.min > 1.5, `min=${mt.min} @${mt.at}`);

 ok('运行期无 JS 错误', errs.length === 0, errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.32 远景环带回归：${pass} 项通过，${fail} 项失败 ===`);
 process.exit(fail?1:0);
})();
