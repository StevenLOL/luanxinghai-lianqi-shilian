/* v2.21 视觉验证：kill cam 回放分别用飞剑 / 火球 / 冰剑的本体特效
 * 输出：others/mvp_v221_killcam_{sword,fire,ice}.png + 命中定格一张
 */
const http = require('http');
const fs = require('fs');
const { waitReady } = require('./_testlib');
const URL = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';

function get(p, m = 'GET') {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: 9223, path: p, method: m, agent: false, headers: { Connection: 'close' } }, (r) => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse')); } });
    });
    req.on('error', rej); req.setTimeout(8000, () => req.destroy(new Error('t'))); req.end();
  });
}

/* 造一枚真实弹丸打死玩家 → 触发 kill cam */
const KILL = (kind) => `(()=>{
  game.started=true; game.over=false; game.time=0;
  player.hp=5; player.inv=0; enemies.length=0; bolts.length=0;
  const from={x:player.pos.x+42,y:player.pos.y+10,z:player.pos.z+42};
  const b={kind:'${kind}',owner:'enemy',pos:{...from},v:{x:-1,y:0,z:-1},
    ident:{owner:'enemy',skill:'${kind}',from:{...from},caster:'archer',born:game.time},
    path:[{...from}],dmg:99,radius:0,color:SPELLS['${kind}'].color,
    homing:false,guided:false,powered:true,traveled:0,life:4,trail:[],
    phase:0,missile:false,missilePhase:'none',size:1};
  for(let i=1;i<=40;i++) b.path.push({x:from.x-i*1.05,y:from.y-i*0.12,z:from.z-i*1.05});
  bolts.length=0; bolts.push(b);
  hurtPlayer(999,{ignoreInv:true,noInv:true,noFlash:true,from:boltSource(b)});
  return game.replay?{kind:game.replay.kind,color:game.replay.color}:null;
})()`;

(async () => {
  const page = await get('/json/new?' + encodeURIComponent(URL), 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (p) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
    console.log('saved', p);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await wait(1500);
  await waitReady(ev, wait);

  for (const kind of ['sword', 'fire', 'ice']) {
    const info = await ev(KILL(kind));
    console.log(kind, '→', JSON.stringify(info));
    /* 让回放推进到弹丸飞行中段（prog≈0.45），此时法术在画面中央 */
    await wait(700);
    const prog = await ev('game.replay?game.replay.prog:null');
    console.log('   prog =', prog);
    await shot(`C:/src/flight/others/mvp_v221_killcam_${kind}.png`);
    /* 再等到命中定格 */
    await wait(2600);
    const ph = await ev('game.replay?game.replay.phase:null');
    console.log('   phase =', ph);
    if (kind === 'fire') await shot('C:/src/flight/others/mvp_v221_killcam_hit.png');
    await ev('game.replay=null; game.over=false; game.started=true; player.hp=100; true');
    await wait(200);
  }

  console.log('运行期异常:', exceptions.length);
  ws.close(); process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
