/* v2.24b 海湾回归：确认原作 bayH 真正接入视觉层、海面可见、花朵不覆盖海。 */
const http = require('http');
const URL = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function get(p, m = 'GET') {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path: p, method: m, agent: false, headers: { Connection: 'close' } }, (x) => {
      let d = ''; x.setEncoding('utf8'); x.on('data', (c) => d += c);
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 120))); } });
    });
    r.on('error', rej); r.setTimeout(8000, () => r.destroy(new Error('timeout'))); r.end();
  });
}
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('PASS ' + n + (d ? ' — ' + d : '')); } else { fail++; console.log('FAIL ' + n + (d ? ' — ' + d : '')); } };
(async () => {
  const page = await get('/json/new?' + encodeURIComponent(URL), 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const ex = [];
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    else if (o.method === 'Runtime.exceptionThrown') ex.push(o.params.exceptionDetails.text);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.text || 'Uncaught') + ' :: ' + ((d.exception && d.exception.description) || ''));
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: URL });
  for (let i = 0; i < 60; i++) { try { if (await ev('typeof game!=="undefined"&&typeof drawBayWater==="function"')) break; } catch (e) {} await wait(200); }

  /* 1. 海湾高度真正进入 visualH */
  const h = await ev(`(()=>{
    const inland=visualH(0,200), beach=visualH(0,-90), sea=visualH(0,-200);
    let calls=0;const orig=nfBayH;nfBayH=function(x,z){calls++;return orig(x,z)};
    visualH(0,-200);visualH(0,-300);nfBayH=orig;
    return {inland,beach,sea,calls,baySea:nfBayH(0,-200)};
  })()`);
  console.log('heights:', JSON.stringify(h));
  ok('内陆 visualH 仍为正（花海保留）', h.inland > 0);
  ok('海湾 visualH 为负（海回来了）', h.sea < 0, 'sea=' + h.sea.toFixed(2));
  ok('visualH 内部确实调用 nfBayH', h.calls >= 2, 'calls=' + h.calls);
  ok('visualH 海面与原作 bayH 一致', Math.abs(h.sea - h.baySea) < 0.01);

  /* 2. vegFlower 门控：海/滩不撒花 */
  const veg = await ev(`(()=>({land:nfVegFlower(0,200),beach:nfVegFlower(0,-96),sea:nfVegFlower(0,-200)}))()`);
  ok('内陆允许花（vegFlower≈1）', veg.land > 0.9, JSON.stringify(veg));
  ok('远海禁止花（vegFlower=0）', veg.sea < 0.12);

  /* 3. 碰撞 terrainH 完全未改 */
  const unchanged = await ev(`(()=>[[0,0],[50,-30],[-80,120],[200,90]].map(([x,z])=>{
    const c=continent(x,z);let v;
    if(c<0)v=-1+c*10;else if(c<0.035)v=0.8+c*20;
    else if(c<0.42)v=2+Math.floor(c/0.05)*1.6;
    else if(c<0.60)v=16+Math.floor((c-0.42)/0.045)*2.2;
    else v=25+Math.floor((c-0.60)/0.08)*2.5;
    return Math.abs(terrainH(x,z)-v)<1e-9;
  }).every(Boolean))()`);
  ok('terrainH 碰撞高度场未变', unchanged === true);

  /* 4. 实际渲染 A/B：把水面绘制关掉，比较下半屏像素 */
  const shot = await ev(`(()=>{
    game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;
    player.pos.x=0;player.pos.z=-92;player.heading=0;player.dir=facingVec(0);
    player.targetAlt=16;player.pos.y=visualH(0,-92)+16;
    cam.yaw=0;cam.pitchIdx=1;snapCamera();game.time=12.3;
    const cv=document.querySelector('canvas'),g=cv.getContext('2d');
    const y0=(cv.height*0.55)|0,h=cv.height-y0;
    const grab=()=>g.getImageData(0,y0,cv.width,h).data;
    let calls=0;const orig=drawBayWater;
    drawBayWater=function(c){calls++;return orig(c)};
    render();const withW=grab();
    drawBayWater=function(){};
    render();const noW=grab();
    drawBayWater=orig;render();
    let diff=0,teal=0;
    for(let i=0;i<withW.length;i+=4){
      if(Math.abs(withW[i]-noW[i])+Math.abs(withW[i+1]-noW[i+1])+Math.abs(withW[i+2]-noW[i+2])>24)diff++;
      const r=withW[i],gg=withW[i+1],b=withW[i+2];
      if(gg>130&&b>100&&Math.abs(gg-b)<45&&r<gg*0.8)teal++;
    }
    return {calls,diff,teal,total:cv.width*h};
  })()`);
  console.log('render:', JSON.stringify(shot));
  ok('海面格子被实际绘制', shot.calls > 0, 'cells=' + shot.calls);
  ok('海面改变画面像素', shot.diff > 300, 'diff=' + shot.diff + '/' + shot.total);
  ok('画面出现绿松石浅海', shot.teal > 200, 'teal=' + shot.teal);

  /* 5. 无 JS 异常 */
  const rendered = await ev(`(()=>{try{for(let i=0;i<6;i++){update(1/60);render();}return true}catch(e){return String(e)}})()`);
  ok('update/render 无异常', rendered === true, String(rendered));
  ok('运行期无 JS 异常', ex.length === 0, ex.join(' | '));

  console.log(`\n=== 海湾构造回归：${pass} 项通过，${fail} 项失败 ===`);
  ws.close(); try { await get('/json/close/' + page.id); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
