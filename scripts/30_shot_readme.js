/* README 展示用截图：v2.21 真实游戏画面（本地页，非测试标注图）
 * 输出：docs/screenshots/*.png
 * 注意：others/*.png 被 .gitignore 忽略，README 图片必须放在可跟踪路径下。
 */
const http = require('http');
const fs = require('fs');
const { waitReady } = require('./_testlib');

const URL = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
const OUT = 'C:/src/flight/docs/screenshots/';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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

/* 造一片敌阵：玩家前方扇形分布，高血量保证截图期间不会被打死 */
const SCENE = `(()=>{
  game.started=true; game.over=false; game.replay=null;
  game.time=88.4; game.score=2680; game.kills=42;
  game.dmgDealt=18420; game.dmgTaken=2310; game.bossKills=1;
  player.hp=player.maxHp=100; player.qi=player.maxQi=100; player.inv=999;
  player.level=7; player.heading=0; player.auto=true;
  player.autoChoice='飞剑'; player.lastCast='飞剑';
  enemies.length=0; bolts.length=0; particles.length=0; dmgNums.length=0;
  const n=10;
  for(let i=0;i<n;i++){
    spawnEnemy(false,{forward:true});
    const e=enemies[i];
    const a=(i-(n-1)/2)*0.19;
    const r=48+(i%3)*13;
    e.x=player.pos.x+Math.sin(a)*r;
    e.z=player.pos.z-Math.cos(a)*r;
    e.y=terrainH(e.x,e.z);
    e.hp=e.maxHp=5000;
    e.cds.sword=99; e.cds.fire=99; e.cds.ice=99; e.cds.beam=99; e.cds.melee=99;
  }
  return enemies.length;
})()`;

const BOSS_SCENE = `(()=>{
  enemies.length=0; bolts.length=0;
  spawnEnemy(true,{forward:true});
  const b=enemies[0];
  b.x=player.pos.x; b.z=player.pos.z-62; b.y=terrainH(b.x,b.z);
  b.hp=b.maxHp=360;
  b.cds.sword=99; b.cds.fire=99; b.cds.ice=99; b.cds.beam=99; b.cds.melee=99;
  for(let i=0;i<4;i++){
    spawnEnemy(false,{forward:true});
    const e=enemies[enemies.length-1];
    const a=(i-1.5)*0.42, r=80;
    e.x=player.pos.x+Math.sin(a)*r; e.z=player.pos.z-Math.cos(a)*r;
    e.y=terrainH(e.x,e.z); e.hp=e.maxHp=5000;
    e.cds.sword=99; e.cds.fire=99; e.cds.ice=99; e.cds.beam=99; e.cds.melee=99;
  }
  player.hp=player.maxHp; player.qi=player.maxQi; player.inv=999;
  game.kills=25; game.score=1980;
  return enemies.length;
})()`;

const BOARD_SEED = `(()=>{
  const names=['寒霜散人 77ad','青云剑修 3f21','赤霄道人 9c0e','玄机子 14b8','太虚散修 d302',
    '云中君 88fa','碧游真人 6b19','紫阳道长 4e77','清虚散人 a91c','灵霄剑客 2d05',
    '无尘子 f7b3','沧澜道人 0a6d','孤云散修 5e28','玄霜剑修 c140','玉虚真人 93be',
    '风雷散人 71af','丹霞道长 8c02','归墟剑客 b63d','明霄散修 e459','太乙真人 27fa'];
  const arr=names.map((name,i)=>({
    name, score:9860-i*317, kills:120-i*4,
    dmgDealt:42800-i*1380, dmgTaken:6210-i*178,
    bossKills:Math.max(0,8-Math.floor(i/3)), time:412+i*23,
    realm:1+Math.floor((19-i)/4), ts:1763000000000+i
  }));
  localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
  game.started=true; game.over=false; boardOpen=true; boardPage=0;
  return arr.length;
})()`;

(async () => {
  const page = await get('/json/new?' + encodeURIComponent(URL), 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name, Buffer.from(s.result.data, 'base64'));
    console.log('saved', OUT + name);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await wait(1500);
  await waitReady(ev, wait);

  /* 1. 游戏主画面 */
  console.log('敌阵数量:', await ev(SCENE));
  await wait(1400);           // 让自动攻击放出弹丸与特效
  await ev('player.hp=player.maxHp; player.qi=player.maxQi; game.over=false; true');
  await shot('01-gameplay.png');

  /* 2. Boss 战 */
  console.log('Boss 场景实体:', await ev(BOSS_SCENE));
  await wait(1200);
  await ev('player.hp=player.maxHp; game.over=false; true');
  await shot('02-boss.png');

  /* 3. 排行榜 */
  console.log('榜单条数:', await ev(BOARD_SEED));
  await wait(500);
  await shot('03-leaderboard.png');

  /* 4~6. Kill Cam 三法术（复用线上实拍，避免重复造场景） */
  ws.close(); process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
