/* v2.24 专项回归：News Flight 地形/地貌构造一比一移植
 *
 * 视觉层完整移植原作 world.js 的构造信号（meadowH 三段缓波、bayH 海湾、
 * nf 噪声花斑、法线光照、golden 调色板），但 terrainH 碰撞高度场保持不动。
 *
 * 验证重点：
 *   ① 版本号 v2.24
 *   ② 原作信号函数存在且形态正确（nfMeadowH/nfBayH/nfVegFlower/nfNoise）
 *   ③ visualH 抹平阶梯（连续）+ 叠加缓波；terrainH 碰撞采样点未变
 *   ④ 地形网格用视觉高度（drawTerrain._VH 与 visualH 一致）
 *   ⑤ 原作 golden 调色板常量存在
 *   ⑥ 密集花海 drawCellFlowers 存在、花瓣尾流仍在、render 无异常
 */
const http = require('http');
const URL = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';

function get(p, m = 'GET') {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: 9223, path: p, method: m, agent: false, headers: { Connection: 'close' } }, (r) => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 120))); } });
    });
    req.on('error', rej); req.setTimeout(8000, () => req.destroy(new Error('timeout'))); req.end();
  });
}
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  const page = await get('/json/new?' + encodeURIComponent(URL), 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      const desc = d.exception && (d.exception.description || d.exception.value) || '';
      throw new Error((d.text || 'Uncaught') + ' :: ' + desc);
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await wait(1800);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = await ev('typeof game!=="undefined" && !!player && typeof visualH==="function"'); } catch (e) { ready = false; }
    if (ready) break;
    await wait(200);
  }
  ok('游戏页就绪（visualH 已加载）', ready);

  /* ---------- 1. 版本号 ---------- */
  const ver = await ev(`(function(){
    let found='';const orig=ctx.fillText;
    ctx.fillText=function(t){if(typeof t==='string'&&t.indexOf('v2.')>=0)found=t;return orig.apply(this,arguments)};
    try{drawHUD()}catch(e){}ctx.fillText=orig;return found;
  })()`);
  ok('渲染标题版本号 v2.39', /v2\.39$/.test(ver || ''), ver);

  /* ---------- 2. 原作信号函数存在 ---------- */
  const sig = await ev(`(()=>({
    lake:typeof nfLakeCenter, lakeW:typeof nfLakeHalfW, veg:typeof nfVegFlower,
    noise:typeof nfNoise, fbm:typeof nfFbm, visual:typeof visualH,
    flower:typeof flowerMix, base:typeof terrainBaseColor
  }))()`);
  ok('湖区中心线 nfLakeCenter 存在', sig.lake === 'function', JSON.stringify(sig));
  ok('湖区半宽 nfLakeHalfW 存在', sig.lakeW === 'function');
  ok('原作 vegFlower 植被范围存在', sig.veg === 'function');
  ok('原作噪声 nfNoise/nfFbm 存在', sig.noise === 'function' && sig.fbm === 'function');
  ok('视觉高度 visualH 存在', sig.visual === 'function');
  ok('花斑 flowerMix 存在', sig.flower === 'function');

  /* ---------- 3. 湖区形态（v2.26 起替换原作 meadow/bay）---------- */
  const lake = await ev(`(()=>{let mn=9e9,mx=-9e9;
    for(let x=-600;x<=600;x+=23){const c=nfLakeCenter(x),w=nfLakeHalfW(x);
      mn=Math.min(mn,c-w);mx=Math.max(mx,c+w);}
    return{mx,mn}})()`);
  ok('湖岸曲折（半宽恒为正、中心线在合理范围）', lake.mx < 120 && lake.mn > -320,
     `range=${lake.mn.toFixed(0)}..${lake.mx.toFixed(0)}`);

  /* ---------- 4. 水陆关系：湖心在水中、出生点在陆上 ---------- */
  const wet = await ev(`(()=>{
    const zc=nfLakeCenter(0), half=nfLakeHalfW(0);
    return {center:visualH(0,zc), shore:visualH(0,20), land:visualH(0,140)};
  })()`);
  ok('湖心低于水面', wet.center < -0.5, 'h=' + wet.center.toFixed(2));
  ok('出生点在水面之上', wet.shore > -0.5, 'h=' + wet.shore.toFixed(2));

  /* ---------- 5. terrainH 仍然可用且有界（玩法层的落地/碰撞都靠它）---------- */
  const hs = await ev(`(()=>{
    const pts=[[0,0],[50,-30],[-80,120],[200,90]];
    const v=pts.map(([x,z])=>terrainH(x,z));
    return {bad:v.filter(n=>!isFinite(n)).length, mn:Math.min(...v), mx:Math.max(...v)};
  })()`);
  ok('terrainH 数值有效且落在历史量级内', hs.bad === 0 && hs.mn > -30 && hs.mx < 60,
     `min=${hs.mn.toFixed(1)} max=${hs.mx.toFixed(1)}`);

  /* ---------- 6. visualH 抹平阶梯：相邻小位移高度连续 ---------- */
  const smooth = await ev(`(()=>{
    // 在一处 should-be 阶梯边界采样：visualH 相邻 0.1 位移的差应很小
    let maxd=0;
    for(let x=0;x<80;x+=0.5){const d=Math.abs(visualH(x,0)-visualH(x+0.1,0));maxd=Math.max(maxd,d);}
    return maxd;
  })()`);
  ok('visualH 连续无阶梯跳变', smooth < 0.6, 'maxΔ=' + smooth.toFixed(3));

  /* ---------- 7. 地形网格用视觉高度 _VH ---------- */
  const vh = await ev(`(()=>{
    game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    player.pos.x=0;player.pos.z=0;player.pos.y=visualH(0,0)+12;
    drawTerrain();
    const VH=drawTerrain._VH;
    if(!VH)return {ok:false};
    /* VH[0] 应等于左上角格点 visualH；v2.25 起海岸附近按 seaK 平滑压到水面
       以下（清除海面里的沙洲碎块），所以期望值要带上同样的混合。 */
    const step=QUALITY.step,range=Math.max(8,QUALITY.range);
    const cx=Math.round(player.pos.x/step),cz=Math.round(player.pos.z/step);
    const wx=(cx-range)*step,wz=(cz-range)*step;
    /* v2.26 起地形网格顶点直接取 visualH，不再有 seaK 混合 */
    return {ok:true,diff:Math.abs(VH[0]-visualH(wx,wz))};
  })()`);
  ok('地形网格顶点直接取 visualH', vh.ok && vh.diff < 0.01, JSON.stringify(vh));

  /* ---------- 8. 原作 golden 调色板常量 ---------- */
  const pal = await ev(`(()=>({
    tones:typeof NF_TONES!=='undefined'&&NF_TONES.length,
    bands:typeof NF_WATER_BANDS!=='undefined'&&NF_WATER_BANDS.length,
    shadow:typeof NF_SHADOW!=='undefined'&&NF_SHADOW.length,
    sun:typeof NF_SUN!=='undefined'&&typeof NF_SUN.x
  }))()`);
  ok('v2.26 调色板（NF_TONES / 水色分带 / 背光紫灰）存在',
     pal.tones === 18 && pal.bands === 6 && pal.shadow === 3, JSON.stringify(pal));
  ok('日照方向 NF_SUN 存在', pal.sun === 'number');

  /* ---------- 9. 密集花海与花瓣尾流仍在 ---------- */
  const fx = await ev(`(()=>({
    shrub:typeof drawCellShrubs, grass:typeof drawCellGrass, tree:typeof drawCellTrees,
    petal:typeof petalWake, rate:PETAL_RATE,
    colors:typeof FLOWER_COLORS!=='undefined'&&FLOWER_COLORS.length
  }))()`);
  ok('植被三层（灌木/草/树）齐备', fx.shrub === 'function' && fx.grass === 'function' && fx.tree === 'function',
     JSON.stringify(fx));
  ok('花瓣尾流仍在且不超上限', fx.petal === 'function' && fx.rate > 0 && fx.rate <= 70);
  ok('原作 7 色花板存在', fx.colors === 7);

  /* ---------- 10. render 无异常 ---------- */
  const rendered = await ev(`(()=>{try{for(let i=0;i<8;i++){update(1/60);render();}return true}catch(e){return String(e)}})()`);
  ok('update/render 无异常', rendered === true, String(rendered));
  ok('运行期无 JS 异常', exceptions.length === 0, exceptions.join(' | '));

  console.log(`\n=== v2.24 地形一比一复刻：${pass} 项通过，${fail} 项失败 ===`);
  ws.close();
  try { await get('/json/close/' + page.id); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
