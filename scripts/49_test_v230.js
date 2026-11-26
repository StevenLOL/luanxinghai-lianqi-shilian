/* v2.30 岸边露底回归：水线与水色覆盖
   用法：node scripts/49_test_v230.js （需 9223 调试端口 + 8000 静态服务）
   覆盖的 bug：「有时河底会露出水面，原来没露，移动了下就露出来了」 */
const http=require('http'),WS=globalThis.WebSocket;
const get=p=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9223,path:p,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(JSON.parse(d)))});r.on('error',rej);r.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,d)=>{ if(c){pass++;console.log('PASS',n,d===undefined?'':('— '+d));}
                   else{fail++;console.log('FAIL',n,d===undefined?'':('— '+d));} };

const ISLANDS=`(()=>{const c=document.getElementById('game');const g=c.getContext('2d');
  const w=c.width,h=c.height;const img=g.getImageData(0,0,w,h).data;
  const wat=i=>{const r=img[i],gg=img[i+1],b=img[i+2];return b>r-6&&b>105&&gg>98;};
  const sand=i=>{const r=img[i],gg=img[i+1],b=img[i+2];return r>135&&r-b>26&&r-b<100&&gg>=b-8;};
  let n=0;const xMax=Math.min(w-16,1300);
  for(let y=(h*0.62)|0;y<h-10;y+=4)for(let x=16;x<xMax;x+=4){
    const i=(y*w+x)*4;if(!sand(i))continue;
    let sur=true;
    for(let d=0;d<8&&sur;d++){const a=d*Math.PI/4,dx=Math.round(Math.cos(a)*15),dy=Math.round(Math.sin(a)*15);
      if(!wat(((y+dy)*w+(x+dx))*4))sur=false;}
    if(sur)n++;
  }
  return n;})()`;

(async()=>{
 const list=await get('/json/list');const pg=list.find(t=>t.type==='page');
 const ws=new WS(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend=new Map();const errs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);
   if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errs.push(m.params.entry.text);
   if(m.method==='Runtime.exceptionThrown')errs.push((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text);
   if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
 const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
 const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>{
   if(r.result&&r.result.exceptionDetails)return {__err:r.result.exceptionDetails.text};
   return r.result.result.value;});

 await send('Runtime.enable');await send('Log.enable');
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:810,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'});
 await sleep(5600);
 errs.length=0;

 /* ---------- ① 水线常量与权重函数 ---------- */
 const ver=await ev(`(function(){let found='';const orig=ctx.fillText;
   ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)found=t;return orig.apply(this,arguments)};
   try{drawHUD()}catch(e){}ctx.fillText=orig;return found;})()`);
 ok('渲染标题版本号 v2.39', /v2\.39$/.test(ver || ''), ver);
 ok('水线常量 NF_WATER_LV=0.45', await ev('NF_WATER_LV') === 0.45);
 ok('过渡带 NF_WATER_SOFT>0', (await ev('NF_WATER_SOFT')) > 0);
 const mix=await ev('[nfWaterMix(-10),nfWaterMix(NF_WATER_LV),nfWaterMix(NF_WATER_LV+NF_WATER_SOFT),nfWaterMix(NF_WATER_LV-NF_WATER_SOFT)]');
 ok('水下 10 单位：水色权重 = 1', Math.abs(mix[0]-1) < 1e-6, String(mix[0].toFixed(3)));
 ok('水线处：权重 ≈ 0.5', Math.abs(mix[1]-0.5) < 0.01, String(mix[1].toFixed(3)));
 ok('水线 + SOFT：权重 = 0', Math.abs(mix[2]) < 1e-6, String(mix[2].toFixed(3)));
 ok('水线 - SOFT：权重 = 1', Math.abs(mix[3]-1) < 1e-6, String(mix[3].toFixed(3)));

 /* ---------- ② 渲染后检查格子数据 ---------- */
 await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
   player.pos.x=80;player.pos.z=nfShoreZ(80)+11;player.pos.y=30;player.heading=0;player.dir=facingVec(0);game.time=16;return 1})()`);
 await sleep(800);
 const grid=await ev(`(()=>{const cs=drawTerrain._cells||[];
   let badMin=0,crossBank=0,wetNoDraw=0;
   for(const c of cs){
     if(Math.abs(c.minH-Math.min(c.cy[0],c.cy[1],c.cy[2],c.cy[3]))>1e-6)badMin++;
     if(c.minH<NF_WATER_LV&&c.vh>=0.08)crossBank++;   // 格心在岸上但格内有水 —— 老代码漏掉的格子
   }
   return {n:cs.length,badMin,crossBank,wet:cs.filter(c=>c.minH<NF_WATER_LV).length};})()`);
 ok('每个格子都带 minH', grid.badMin === 0, `bad=${grid.badMin}/${grid.n}`);
 ok('跨岸格子（格心在岸、格内有水）被识别', grid.crossBank > 0, `crossBank=${grid.crossBank}`);
 ok('存在需要画水的格子', grid.wet > 0, `wet=${grid.wet}`);

 /* v2.30 的核心：这些跨岸格子必须进入水面绘制。逐个调 drawBayWater 验证。 */
 const drawn=await ev(`(()=>{const cs=drawTerrain._cells||[];
   const cross=cs.filter(c=>c.minH<NF_WATER_LV&&c.vh>=0.08);
   let yes=0,no=0;
   const sv=ctx;   // 用一个离屏小画布承接，避免污染主画面
   const tmp=document.createElement('canvas');tmp.width=64;tmp.height=64;
   for(const c of cross){ctx=tmp.getContext('2d');
     let r=false;try{r=drawBayWater(c)===true;}catch(e){r=false;}
     if(r)yes++;else no++;}
   ctx=sv;return {yes,no,total:cross.length};})()`);
 ok('跨岸格子全部画出水面', drawn && drawn.no === 0, drawn ? `drawn=${drawn.yes}/${drawn.total}` : 'eval err');

 /* ---------- ③ 视觉：近处水面不得出现被水包围的沙色斑 ---------- */
 const spots=[[-238,-272],[330,-148],[76,-96],[-40,-118],[-80,70]];
 let worst=0,worstAt='';
 for(const [x,z] of spots){
   await ev(`(()=>{player.pos.x=${x};player.pos.z=${z};player.pos.y=30;player.heading=0;player.dir=facingVec(0);player.vel={x:0,y:0,z:0};game.time=16;return 1})()`);
   for(let k=1;k<=4;k++){
     await ev(`player.pos.z=${z-k*2.5};player.pos.x=${x+k*0.8};1`);
     await sleep(450);
     const n=await ev(ISLANDS);
     if(n>worst){worst=n;worstAt=`(${x},${z}) 微移 ${k}`;}
   }
 }
 ok('水面无被水包围的沙色斑（露底）', worst <= 8, `worst=${worst} @ ${worstAt}`);

 ok('运行期无 JS 错误', errs.length === 0, errs.slice(0,2).join(' | '));
 console.log(`\n=== v2.30 露底回归：${pass} 项通过，${fail} 项失败 ===`);
 process.exit(fail?1:0);
})();
