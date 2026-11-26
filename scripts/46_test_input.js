/* v2.29 输入回归：桌面端按键 / 手机端自动前进（W 常开）+ 摇杆调速转向
   用法：node scripts/46_test_input.js （需 9223 调试端口 + 8000 静态服务） */
const http=require('http'),WS=globalThis.WebSocket;
const get=p=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9223,path:p,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(JSON.parse(d)))});r.on('error',rej);r.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,d)=>{ if(c){pass++;console.log('PASS',n,d===undefined?'':('— '+d));}
                   else{fail++;console.log('FAIL',n,d===undefined?'':('— '+d));} };

(async()=>{
 const list=await get('/json/list');const pg=list.find(t=>t.type==='page');
 const ws=new WS(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
 const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
 const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>r.result.result.value);

 const boot=async(touch)=>{
   await send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});
   await send('Emulation.setDeviceMetricsOverride',touch
     ?{width:390,height:844,deviceScaleFactor:2,mobile:true}
     :{width:1440,height:810,deviceScaleFactor:1,mobile:false});
   await send('Page.navigate',{url:'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'});
   await sleep(5000);
   await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
     player.pos.x=0;player.pos.z=20;player.heading=0;player.dir=facingVec(0);game.time=16;return 1})()`);
   await sleep(400);
 };
 const moved=async()=>{
   const a=JSON.parse(await ev('JSON.stringify([player.pos.x,player.pos.z])'));
   await sleep(900);
   const b=JSON.parse(await ev('JSON.stringify([player.pos.x,player.pos.z])'));
   return Math.hypot(b[0]-a[0],b[1]-a[1]);
 };

 /* ---------- 手机 ---------- */
 await boot(true);
 ok('触摸设备被识别（IS_TOUCH）', await ev('IS_TOUCH') === true);
 ok('触摸 UI 挂上 body.touch', (await ev('document.body.className')).indexOf('touch') >= 0);
 const auto=await moved();
 ok('手机端无操作时自动前进（W 常开）', auto > 1, 'd=' + auto.toFixed(2));
 /* v2.30：油门映射单独断言。位移比较在软件渲染（20fps）下会被地形阻挡吃掉，
    只能证明"没有倒退"，不能证明 1.30 倍。 */
 const thr=await ev('[touchThrottle(0),touchThrottle(1),touchThrottle(-1),touchThrottle(0.5)]');
 ok('油门映射：静止 = 1.00', Math.abs(thr[0]-1) < 1e-9, String(thr[0]));
 ok('油门映射：上推 = 1.30', Math.abs(thr[1]-1.30) < 1e-9, String(thr[1]));
 ok('油门映射：下拉 = 0（刹车悬停）', Math.abs(thr[2]) < 1e-9, String(thr[2]));
 ok('油门映射：半推 = 1.15', Math.abs(thr[3]-1.15) < 1e-9, String(thr[3]));
 await ev('touch.axisY=-1;1');
 const up=await moved();
 /* 位移比只做"还在飞"的粗检：软件渲染 + 地形阻挡让 900ms 位移波动很大
    （实测同一份代码 up 可能在 4.6~9.4 之间），1.3 倍映射已由上面四项精确断言覆盖。 */
 ok('摇杆上推仍在前进', up > 1, `up=${up.toFixed(2)} auto=${auto.toFixed(2)}`);
 await ev('touch.axisY=1;1');
 const down=await moved();
 ok('摇杆下拉刹车（可原地悬停）', down < 0.6, 'd=' + down.toFixed(2));
 await ev('touch.axisY=0;1');
 const h0=await ev('player.heading');
 await ev('touch.axisX=1;1'); await sleep(700); await ev('touch.axisX=0;1');
 const h1=await ev('player.heading');
 ok('摇杆横轴转向', Math.abs(h1 - h0) > 0.05, `${h0.toFixed(2)} -> ${h1.toFixed(2)}`);

 /* ---------- 桌面 ---------- */
 await boot(false);
 ok('桌面端不被识别为触摸', await ev('IS_TOUCH') === false);
 ok('桌面端无输入时静止', (await moved()) < 0.6);
 await ev(`keys['w']=true;1`);
 ok('桌面端 W 前进', (await moved()) > 1);
 await ev(`keys['w']=false;keys['s']=true;1`);
 ok('桌面端 S 后撤', (await moved()) > 0.3);
 await ev(`keys['s']=false;1`);

 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.clearDeviceMetricsOverride');
 console.log(`\n=== v2.29 输入：${pass} 项通过，${fail} 项失败 ===`);
 ws.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
