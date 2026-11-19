/* v2.18 专项回归：麒麟（Boss）击杀数触发重生
 *
 * v2.17 及之前的 bug：game.bossSpawned 是一次性开关，置 true 后永不复位，
 * 麒麟被杀后永不再现。
 * v2.18 修复：改为分段计数 —— 每累计 BOSS_SPAWN_EVERY(5) 次击杀刷一只，
 * 同屏最多 1 只。
 */
const { waitReady } = require('./_testlib');
const http = require('http');
const CDP_HTTP = process.argv[2] || 'http://127.0.0.1:9223';

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
  const targets = await get('/json/list');
  // 总是新建专属页面：避免多标签页时 find 选中别人的页面导致状态串扰
  const page = await get('/json/new?' + encodeURIComponent('http://127.0.0.1:8000/scripts/mvp_air_to_ground.html'), 'PUT');
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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + ((r.result.exceptionDetails.exception || {}).description || ''));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* update() 会推进完整游戏逻辑（敌人 AI 可能打死玩家导致 game.over=true），
     所以每帧前重置状态，保证刷怪逻辑一定被执行。 */
  const step = () => ev('(()=>{game.started=true;game.over=false;player.hp=player.maxHp;game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);return true})()');

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await waitReady(ev, wait);   // 可靠等待游戏就绪（见 _testlib.js）

  /* 注意：这里刻意「不」开持续清场器 —— 清场会把刚刷出的麒麟一起删掉，
     导致测不到刷出逻辑。改为在每个用例内部自行构造 enemies 状态。 */
  await ev(`(()=>{ game.started=true; game.over=false; player.auto=false; return true })()`);

  /* ---------- 1. 常量与辅助函数 ---------- */
  const consts = await ev(`({every:BOSS_SPAWN_EVERY, hasFn:typeof hasBossAlive})`);
  ok('BOSS_SPAWN_EVERY 常量就位', consts.every === 5, `every=${consts.every}`);
  ok('hasBossAlive 函数就位', consts.hasFn === 'function');

  /* ---------- 2. 旧的一次性开关已移除 ---------- */
  const legacy = await ev(`({has:('bossSpawned' in game), wave:game.bossWave, at:game.killsAtBoss})`);
  ok('旧的一次性开关 bossSpawned 已移除', legacy.has === false,
     `game.bossSpawned 不存在；bossWave=${legacy.wave}`);
  ok('分段计数字段已初始化', legacy.wave === 0 && legacy.at === 0);

  /* ---------- 3. 首个麒麟在 kills>=5 时出现（与旧行为一致） ---------- */
  /* 注意：update() 里 while(enemies.length<10)spawnEnemy(false) 会补普通敌人，
     所以断言只看 boss 数量，不看敌人总数。 */
  const first = await ev(`(()=>{
    enemies.length=0;
    game.kills=4; game.bossWave=0;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    const before=enemies.filter(e=>e.type==='boss').length;
    game.kills=5;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    const after=enemies.filter(e=>e.type==='boss').length;
    return {before, after, wave:game.bossWave};
  })()`);
  ok('kills=4 时不出麒麟', first.before === 0, `boss count=${first.before}`);
  ok('kills=5 时刷出麒麟', first.after === 1, `boss count=${first.after}`);
  ok('bossWave 递增到 1', first.wave === 1, `wave=${first.wave}`);

  /* ---------- 4. 核心：杀死麒麟后能再刷 ---------- */
  const reborn = await ev(`(()=>{
    // 场上有 1 只麒麟（kills=5 时刷的）
    const boss=enemies.find(e=>e.type==='boss');
    if(!boss)return {err:'no boss'};
    // 杀掉它
    hurtEnemy(boss,99999);
    const afterKill=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    // 把击杀数推到下一个门槛（10）
    game.kills=10;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    const afterSpawn=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    return {afterKill, afterSpawn, wave:game.bossWave, bossKills:game.bossKills};
  })()`);
  ok('麒麟死亡后场上无麒麟', reborn.afterKill === 0, `count=${reborn.afterKill}`);
  ok('击杀数达 10 后麒麟重生', reborn.afterSpawn === 1,
     `count=${reborn.afterSpawn} wave=${reborn.wave}`);
  ok('bossWave 递增到 2', reborn.wave === 2, `wave=${reborn.wave}`);
  ok('BOSS 击杀被计数', reborn.bossKills === 1, `bossKills=${reborn.bossKills}`);

  /* ---------- 5. 同屏最多 1 只 ---------- */
  const multi = await ev(`(()=>{
    enemies.length=0;
    game.kills=50; game.bossWave=0;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    const n=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    return {n, wave:game.bossWave};
  })()`);
  ok('同屏最多 1 只麒麟', multi.n === 1, `count=${multi.n}`);
  ok('未达下一门槛不重复刷', multi.wave === 1, `wave=${multi.wave}`);

  /* ---------- 6. 麒麟活着时不会提前刷下一只 ---------- */
  const guard = await ev(`(()=>{
    enemies.length=0;
    game.kills=5; game.bossWave=0;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);                    // 刷出第 1 只
    game.kills=30;                   // 击杀数远超下一门槛
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016); game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);    // 多帧
    const n=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    return {n, wave:game.bossWave};
  })()`);
  ok('麒麟存活时不刷下一只', guard.n === 1 && guard.wave === 1,
     `count=${guard.n} wave=${guard.wave}`);

  /* ---------- 7. 连续多轮：每只麒麟都能被击杀并重生 ---------- */
  const loop = await ev(`(()=>{
    enemies.length=0;
    game.kills=0; game.bossWave=0; game.bossKills=0; game.kills=0;
    const log=[];
    for(let w=0;w<4;w++){
      game.kills=(w+1)*5;
      game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
      const b=enemies.find(e=>e.type==='boss'&&e.hp>0);
      if(!b){ log.push('wave'+(w+1)+':nospawn'); continue; }
      hurtEnemy(b,99999);
      log.push('wave'+(w+1)+':ok');
    }
    return {log, bossKills:game.bossKills, wave:game.bossWave};
  })()`);
  ok('连续 4 只麒麟均可击杀并重生', loop.log.every(x=>x.endsWith(':ok')),
     `log=${loop.log.join(',')}`);
  ok('4 只麒麟均计入 bossKills', loop.bossKills === 4, `bossKills=${loop.bossKills}`);

  /* ---------- 8. 掉队回收不会破坏 Boss（满血拉回而非删除） ---------- */
  const recycle = await ev(`(()=>{
    enemies.length=0;
    game.kills=5; game.bossWave=0;
    game.started=true;game.over=false;player.hp=player.maxHp;update(0.016);
    const b=enemies.find(e=>e.type==='boss');
    if(!b)return {err:'no boss'};
    // 把 Boss 挪到极远处（超过 MAX_CHASE）
    b.x=99999; b.z=99999; b.hp=10;   // 残血，验证回收是满血复位而非删除
    const n=recycleStragglers();
    const after=enemies.filter(e=>e.type==='boss').length;
    const b2=enemies.find(e=>e.type==='boss');
    return {n, after, hp:b2?b2.hp:0, maxHp:b2?b2.maxHp:0};
  })()`);
  ok('掉队的麒麟被回收（未被删除）', recycle.after === 1, `boss count=${recycle.after}`);
  ok('回收后麒麟满血复位', recycle.hp === recycle.maxHp,
     `hp=${recycle.hp}/${recycle.maxHp}`);

  /* ---------- 9. 排行榜的斩 BOSS 维度能持续刷高 ---------- */
  const lb = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    game.bossKills=7;
    game.score=700; game.kills=35; game.dmgDealt=6000; game.dmgTaken=900; game.time=200;
    const r=submitToBoard();
    return {boss:r.entry.bossKills, score:r.entry.score, rank:r.rank};
  })()`);
  ok('排行榜记录多次斩 BOSS', lb.boss === 7, `bossKills=${lb.boss}`);

  /* ---------- 10. 版本与回归 ---------- */
  const ver = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');return s.includes('v2.18')})()`);
  ok('版本号已更新到 v2.18', ver === true);

  const perf = await ev(`(()=>{
    // Boss 存在时 hasBossAlive 每帧扫一遍 enemies（≤11），开销可忽略
    const t0=performance.now();
    for(let i=0;i<10000;i++) hasBossAlive();
    return (performance.now()-t0)/10000;
  })()`);
  ok('hasBossAlive 性能可忽略', perf < 0.01, `${perf.toFixed(5)}ms/次`);

  ok('运行期零异常', exceptions.length === 0, `${exceptions.length} exceptions`);

  console.log(`\n${pass}/${pass + fail} 项通过`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
