/* v2.24c 回归：云不再遮挡角色、花瓣尾流从身后花丛卷起、角色素材真实加载。 */
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
  for (let i = 0; i < 60; i++) { try { if (await ev('typeof game!=="undefined"&&spritesReady')) break; } catch (e) {} await wait(200); }

  /* 1. 角色素材全部真实加载（不是 fallback） */
  const sp = await ev(`(()=>{
    const rows=Object.entries(sprites).map(([k,im])=>({k,ok:!!(im&&im.complete&&im.naturalWidth>0),w:im&&im.naturalWidth,src:im&&im.src}));
    return {rows,okBack:spriteOK('playerBack'),key:spriteOK('playerBack')?'playerBack':'player'};
  })()`);
  console.log('sprites:', JSON.stringify(sp.rows));
  ok('五张角色素材全部加载成功', sp.rows.length === 5 && sp.rows.every(r => r.ok), JSON.stringify(sp.rows.map(r => r.k + ':' + r.w)));
  ok('主角优先使用背面立绘', sp.okBack === true && sp.key === 'playerBack');

  /* 2. 云改到角色之前绘制（否则近云会把主角盖成光斑） */
  const order = await ev(`(()=>{const s=render.toString();return{cloud:s.indexOf('drawClouds()'),player:s.indexOf('drawPlayer()')}})()`);
  ok('drawClouds 在 drawPlayer 之前', order.cloud >= 0 && order.player >= 0 && order.cloud < order.player,
     'cloud@' + order.cloud + ' player@' + order.player);

  /* 3. 花瓣尾流加密、从身后花丛卷起 */
  const wake = await ev(`(()=>{
    game.started=true;game.over=false;game.replay=null;
    particles.length=0;petalAcc=0;
    player.pos.x=0;player.pos.z=0;player.pos.y=terrainH(0,0)+10;
    player.heading=0;player.dir=facingVec(0);player.targetAlt=10;
    keys['w']=true;
    for(let i=0;i<45;i++)update(1/60);
    keys['w']=false;
    const ps=particles.filter(p=>p.kind==='petal');
    let behind=0;
    for(const p of ps) if(p.p.z>player.pos.z-0.5) behind++;
    return {n:ps.length,rate:PETAL_RATE,behind,max:ps.length?Math.max(...ps.map(p=>p.max)):0,
            size:ps.length?Math.max(...ps.map(p=>p.size)):0,
            sorted:ps.length?ps.every(p=>p.p.y>visualH(p.p.x,p.p.z)-1):false};
  })()`);
  console.log('wake:', JSON.stringify(wake));
  ok('花瓣发射率提升(>=50)', wake.rate >= 50, 'rate=' + wake.rate);
  ok('高速低空产生足量花瓣', wake.n >= 8, 'n=' + wake.n);
  ok('花瓣从身后花丛卷起(>=70%)', wake.n > 0 && wake.behind / wake.n >= 0.7, wake.behind + '/' + wake.n);
  ok('花瓣寿命/尺寸增强', wake.max >= 2.4 && wake.size >= 3);
  ok('花瓣不低于地表', wake.sorted === true);

  /* 4. 云序改动后，角色像素不再被大面积米黄覆盖：截取主角上方区域统计暖云色 */
  const cover = await ev(`(()=>{
    game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;player.pos.x=0;player.pos.z=0;player.pos.y=visualH(0,0)+20;
    player.heading=0;player.dir=facingVec(0);cam.yaw=0;cam.pitchIdx=1;cam.dist=26;snapCamera();game.time=8;
    render();
    const cv=document.querySelector('canvas'),g=cv.getContext('2d');
    const p=project(player.pos);
    const x=Math.max(0,(p.x-40)|0),y=Math.max(0,(p.y-90)|0),w=80,h=110;
    const d=g.getImageData(x,y,w,h).data;
    let cream=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],gg=d[i+1],b=d[i+2];
      if(r>225&&gg>205&&b>150&&b<225)cream++;
    }
    return {cream,total:w*h,p};
  })()`);
  console.log('cover:', JSON.stringify(cover));
  ok('主角上半身未被米黄云大面积覆盖', cover.cream / cover.total < 0.55, (cover.cream / cover.total * 100).toFixed(1) + '%');

  ok('运行期无 JS 异常', ex.length === 0, ex.join(' | '));
  console.log(`\n=== v2.24c 角色/尾流回归：${pass} 项通过，${fail} 项失败 ===`);
  ws.close(); try { await get('/json/close/' + page.id); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
