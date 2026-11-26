/* v2.23 专项回归：花海地形与特效移植（News Flight → Canvas 2D）
 *
 * 视觉取自 Huixin Dong / MIT Petalwake 的 News Flight 花海飞行彩蛋，
 * 用 Canvas 2D 在既有高度场上重绘，不改 terrainH 与任何战斗逻辑。
 *
 * 验证重点：
 *   ① 版本号 v2.23
 *   ② 花海配色常量 MEADOW_MAT / PETAL_COLORS 存在
 *   ③ 花瓣尾流：高速低空产生 petal 粒子，静止/高空不产生，且继承主角速度
 *   ④ 英文术语 Lianqi / m，中文显示单位 米，无残留 Qi Refining / zhang
 *   ⑤ 高度场 terrainH 采样点未变（视觉改动不触碰碰撞）
 *   ⑥ update/render 无异常
 */
const http = require('http');
const { waitReady } = require('./_testlib');
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
  // 本测试不依赖游戏已 start（后面会手动 game.started=true）；只要脚本加载即可
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = await ev('typeof game!=="undefined" && !!player && typeof petalWake==="function"'); } catch (e) { ready = false; }
    if (ready) break;
    await wait(200);
  }
  ok('游戏页就绪', ready);

  /* ---------- 1. 版本号（用渲染出的标题精确断言，避免命中源码注释）---------- */
  const ver = await ev(`(function(){
    let found='';
    const orig=ctx.fillText;
    ctx.fillText=function(t){ if(typeof t==='string'&&t.indexOf(' v2.')>=0)found=t; return orig.apply(this,arguments); };
    drawHUD();
    ctx.fillText=orig;
    return found;
  })()`);
  ok('渲染标题版本号 v2.25', /v2\.25$/.test(ver || ''), ver);

  /* ---------- 2. 花海常量 ---------- */
  const consts = await ev(`(()=>({
    meadow:typeof MEADOW_MAT!=='undefined'&&MEADOW_MAT.length,
    petals:typeof PETAL_COLORS!=='undefined'&&PETAL_COLORS.length,
    rate:PETAL_RATE, wake:typeof petalWake
  }))()`);
  ok('MEADOW_MAT 花田色板存在(>=6色)', consts.meadow >= 6, JSON.stringify(consts));
  ok('PETAL_COLORS 花瓣色板存在', consts.petals >= 4);
  ok('PETAL_RATE 合理', consts.rate > 0 && consts.rate <= 70, 'rate=' + consts.rate);
  ok('petalWake 函数存在', consts.wake === 'function');

  /* ---------- 3. 花瓣尾流：静止不产生 ---------- */
  const still = await ev(`(()=>{
    game.started=true;game.over=false;game.replay=null;
    keys['w']=keys['a']=keys['d']=keys['s']=false;
    touch.axisX=0;touch.axisY=0;
    particles.length=0;petalAcc=0;
    player.pos.x=0;player.pos.z=0;player.pos.y=terrainH(0,0)+12;
    for(let i=0;i<20;i++)update(1/60);
    return particles.filter(p=>p.kind==='petal').length;
  })()`);
  ok('静止时不扬花瓣', still === 0, 'petals=' + still);

  /* ---------- 4. 花瓣尾流：高速低空产生 + 继承速度 ---------- */
  const flying = await ev(`(()=>{
    particles.length=0;petalAcc=0;
    player.pos.x=0;player.pos.z=0;player.pos.y=terrainH(0,0)+10;
    player.heading=0;player.dir=facingVec(0);player.targetAlt=10;
    keys['w']=true;
    for(let i=0;i<40;i++)update(1/60);
    keys['w']=false;
    const ps=particles.filter(p=>p.kind==='petal');
    const spd=Math.hypot(player.vel.x,player.vel.z);
    return {n:ps.length,spd,
      inherit:ps.length?ps.some(p=>Math.abs(p.v.x)>0.1||Math.abs(p.v.z)>0.1):false,
      colored:ps.length?ps.every(p=>/^#/.test(p.color)):false,
      rot:ps.length?ps.some(p=>p.vr!==0):false};
  })()`);
  ok('高速低空产生花瓣', flying.n > 0, 'n=' + flying.n + ' spd=' + flying.spd.toFixed(1));
  ok('花瓣带继承速度', flying.inherit);
  ok('花瓣使用花瓣色板', flying.colored);
  ok('花瓣随风自转', flying.rot);

  /* ---------- 5. 高空不产生花瓣 ---------- */
  const high = await ev(`(()=>{
    particles.length=0;petalAcc=0;
    player.pos.x=0;player.pos.z=0;player.pos.y=terrainH(0,0)+80;
    player.targetAlt=80;                 // 同步抬高设定高度，避免高度保持把玩家拉回低空
    player.heading=0;player.dir=facingVec(0);
    keys['w']=true;
    for(let i=0;i<30;i++)update(1/60);
    keys['w']=false;
    const n=particles.filter(p=>p.kind==='petal').length;
    player.targetAlt=12;player.pos.y=terrainH(0,0)+12;
    return n;
  })()`);
  ok('高空不扬花瓣', high === 0, 'n=' + high);

  /* ---------- 6. 术语：英文 Lianqi / m ---------- */
  const en = await ev(`(()=>({
    title:I18N.en.title, realm:I18N.en.realmFull, alt:I18N.en.altitude,
    nearest:I18N.en.nearest, lb:I18N.en.lbTitle, lv:I18N.en.lbLv,
    rawQi:JSON.stringify(I18N.en).includes('Qi Refining'),
    rawZhang:JSON.stringify(I18N.en).includes('zhang')
  }))()`);
  ok('英文标题用 Lianqi', /Lianqi/.test(en.title), en.title);
  ok('英文境界用 Lianqi', /Lianqi/.test(en.realm) && /Lianqi/.test(en.lv));
  ok('英文距离单位 m', / m/.test(en.alt) && / m/.test(en.nearest), en.alt);
  ok('英文无 Qi Refining 残留', !en.rawQi);
  ok('英文无 zhang 残留', !en.rawZhang);

  /* ---------- 7. 术语：中文显示单位 米 ---------- */
  const zh = await ev(`(()=>({alt:I18N.zh.altitude,nearest:I18N.zh.nearest}))()`);
  ok('中文高度单位米', /米/.test(zh.alt) && !/丈/.test(zh.alt), zh.alt);
  ok('中文敌距单位米', /米/.test(zh.nearest) && !/丈/.test(zh.nearest), zh.nearest);

  /* ---------- 8. i18n 键值对齐 ---------- */
  const keys = await ev(`(()=>{
    const a=Object.keys(I18N.zh).sort().join(','),b=Object.keys(I18N.en).sort().join(',');
    return {same:a===b,za:Object.keys(I18N.zh).length,ea:Object.keys(I18N.en).length};
  })()`);
  ok('中英 i18n 键对齐', keys.same, `zh=${keys.za} en=${keys.ea}`);

  /* ---------- 9. 高度场未改动（视觉不动碰撞）---------- */
  const hs = await ev(`(()=>[[0,0],[50,-30],[-80,120],[200,90]].map(([x,z])=>terrainH(x,z).toFixed(3)).join('|'))()`);
  const expect = await ev(`(()=>[[0,0],[50,-30],[-80,120],[200,90]].map(([x,z])=>{
    const c=continent(x,z);
    if(c<0)return -1+c*10;
    if(c<0.035)return 0.8+c*20;
    if(c<0.42)return 2+Math.floor(c/0.05)*1.6;
    if(c<0.60)return 16+Math.floor((c-0.42)/0.045)*2.2;
    return 25+Math.floor((c-0.60)/0.08)*2.5;
  }).map(v=>v.toFixed(3)).join('|'))()`);
  ok('terrainH 高度场未被视觉改动', hs === expect, hs);

  /* ---------- 10. 渲染无异常 ---------- */
  await ev(`(()=>{game.started=true;for(let i=0;i<3;i++){update(1/60);render();}return render.length;})()`);
  ok('update/render 无异常', exceptions.length === 0, exceptions.join('; '));

  console.log(`\n=== v2.23 花海融合：${pass} 项通过，${fail} 项失败 ===`);
  try { await send('Page.close'); } catch (e) {}
  await get('/json/close/' + page.id).catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
