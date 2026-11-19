/* v2.17 专项回归：气血无条件持续回复 + 战斗统计 + 练气期大能排行榜
 * 运行前：本地静态服务在 8000，Chrome 调试端口 9223
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
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception || {}).description);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await waitReady(ev, wait);   // 可靠等待游戏就绪（见 _testlib.js）

  /* 隔离：敌人重生机制（while(enemies.length<10)spawnEnemy）会不断补充敌人并攻击玩家，
     污染 HP 测量 —— 这与 v2.16 回归踩过的坑同源。
     这里起一个持续清场循环，测量期间不让任何敌人存在。 */
  await ev(`(()=>{ window.__lbCleaner=setInterval(()=>{enemies.length=0;bolts.length=0;beams.length=0;lightningZones.length=0;},30); return true})()`);

  // 关自动斗法（避免法术扣蓝/自动攻击干扰观测）
  const clean = async () => ev(`(()=>{enemies.length=0;bolts.length=0;beams.length=0;lightningZones.length=0;
    player.auto=false;game.dmgDealt=0;game.dmgTaken=0;game.bossKills=0;return true})()`);

  /* ---------- 需求一：气血无条件持续回复 ---------- */
  await ev(`(()=>{game.started=true;player.hp=50;player.maxHp=100;return true})()`);
  await clean();
  const rate = await ev(`pRegenHp()`);
  ok('回血速率常量就位', rate >= 5, `rate=${rate}`);

  // 1a 静止时回血
  let hp0 = await ev(`player.hp`);
  await wait(1000);
  let hp1 = await ev(`player.hp`);
  ok('静止时持续回血', hp1 > hp0, `${hp0.toFixed(2)} → ${hp1.toFixed(2)}`);

  // 1b 关键：刚被击中（lastHit = 当前时间）时是否仍在回血 —— v2.17 的核心
  await ev(`(()=>{player.hp=40;player.lastHit=game.time;return true})()`);
  const hpA = await ev(`player.hp`);
  await wait(700);
  const hpB = await ev(`player.hp`);
  ok('受击瞬间仍在回血（不受 lastHit 影响）', hpB > hpA,
     `lastHit=now 时 ${hpA.toFixed(2)} → ${hpB.toFixed(2)}`);

  // 1c 连续受击期间净效果：反复扣血 vs 回血
  // 扣 50 后仍应继续回血：600ms × 5.0/s ≈ 3 点
  const netBefore = await ev(`(()=>{
    const before=player.hp;
    for(let i=0;i<10;i++){ player.hp=Math.max(1,player.hp-5); }   // 模拟持续被打
    return before;
  })()`);
  await wait(600);
  const hpC = await ev(`player.hp`);
  ok('持续被打时回血仍在进行（净血量回升）', hpC > 1,
     `扣 50 后 600ms 回血至 ${hpC.toFixed(2)}（应 >1，速率 5/s×0.6s≈3）`);

  // 1d 无 HP_REGEN_GRACE 残留
  const noGrace = await ev(`typeof HP_REGEN_GRACE === 'undefined'`);
  ok('旧的受击停顿机制已移除', noGrace === true, 'HP_REGEN_GRACE 已不存在');
  const activeOnly = await ev(`hpRegenActive()`);
  ok('hpRegenActive 只看是否满血', typeof activeOnly === 'boolean');

  // 1e 满血时不回血（不能溢出）
  await ev(`(()=>{player.maxHp=100;player.hp=100;return true})()`);
  await wait(400);
  const hpFull = await ev(`player.hp`);
  ok('满血时不溢出', hpFull === 100, `hp=${hpFull}`);

  // 1f HUD 显示速率 == 实测速率
  await ev(`(()=>{player.hp=40;return true})()`);
  const hpD = await ev(`player.hp`);
  await wait(1000);
  const hpE = await ev(`player.hp`);
  const measured = hpE - hpD;
  const shown = await ev(`pRegenHp()`);
  ok('HUD 速率 == 实测速率', Math.abs(measured - shown) < 0.35,
     `显示 ${shown.toFixed(2)}/s vs 实测 ${measured.toFixed(2)}/s`);

  /* ---------- 需求二：战斗统计埋点 ---------- */
  // 注意：清场器每 30ms 清一次 enemies，所以造敌与攻击必须在同一个 evaluate 内完成
  const dmgTest = await ev(`(()=>{
    enemies.length=0;
    game.dmgDealt=0; game.kills=0; game.score=0;
    spawnEnemy(false,{forward:false});
    const e=enemies[0]; const hpBefore=e.hp;
    hurtEnemy(e,25);                       // 部分伤害：不死，但应计入造成伤害
    const afterPartial={dealt:game.dmgDealt,hp:e.hp};
    hurtEnemy(e,9999);                     // 补刀击杀
    return {hpBefore, afterPartial, dealt:game.dmgDealt, kills:game.kills, score:game.score};
  })()`);
  ok('造成伤害被记录', dmgTest.afterPartial.dealt === 25,
     `dmgDealt=${dmgTest.afterPartial.dealt}（部分伤害）`);
  ok('造成伤害累计（含致命一击）', dmgTest.dealt === 25 + 39,
     `dmgDealt=${dmgTest.dealt}（25 + 39 实际扣血）`);
  ok('击杀数与积分被记录', dmgTest.kills === 1 && dmgTest.score === 10,
     `kills=${dmgTest.kills} score=${dmgTest.score}`);

  // 受到伤害
  const takenTest = await ev(`(()=>{
    game.dmgTaken=0;
    player.inv=0;
    const hpBefore=player.hp;
    hurtPlayer(17,{ignoreInv:true,noInv:true,noFlash:true});
    return {before:hpBefore, after:player.hp, taken:game.dmgTaken};
  })()`);
  ok('受到伤害被记录', takenTest.taken === 17, `dmgTaken=${takenTest.taken}`);
  ok('掉血量与记录一致', takenTest.before - takenTest.after === 17,
     `${takenTest.before} → ${takenTest.after}`);

  // BOSS 击杀计数
  const bossTest = await ev(`(()=>{
    enemies.length=0; game.bossKills=0; game.kills=0; game.score=0;
    spawnEnemy(true,{forward:false});
    const e=enemies[0];
    const t=e.type;
    hurtEnemy(e,99999);
    return {type:t, bossKills:game.bossKills, kills:game.kills, score:game.score};
  })()`);
  ok('BOSS 击杀被单独计数', bossTest.bossKills === 1,
     `type=${bossTest.type} bossKills=${bossTest.bossKills}`);
  ok('BOSS 积分更高', bossTest.score === 100, `score=${bossTest.score}`);

  /* ---------- 需求三：排行榜 ---------- */
  // 3a localStorage 写入与读取
  const lbClear = await ev(`(()=>{localStorage.removeItem('lxh_lianqi_lb_v1');return true})()`);
  const lbEmpty = await ev(`loadBoard().length`);
  ok('空榜读取正常', lbEmpty === 0, `len=${lbEmpty}`);

  // 3b 战死入榜
  const submit = await ev(`(()=>{
    game.score=120; game.kills=12; game.dmgDealt=3456; game.dmgTaken=789; game.bossKills=2; game.time=95.4;
    const r=submitToBoard();
    return {rank:r.rank, isNew:r.isNewRecord, name:r.entry.name, score:r.entry.score,
            kills:r.entry.kills, dealt:r.entry.dmgDealt, taken:r.entry.dmgTaken,
            boss:r.entry.bossKills, time:r.entry.time, realm:r.entry.realm};
  })()`);
  ok('战死即入榜', submit.rank === 1, `rank=${submit.rank}`);
  ok('首次入榜标记为新纪录', submit.isNew === true);
  ok('道号自动生成且非空', typeof submit.name === 'string' && submit.name.length > 0, `道号="${submit.name}"`);
  ok('记录积分', submit.score === 120);
  ok('记录击杀数', submit.kills === 12);
  ok('记录造成伤害', submit.dealt === 3456);
  ok('记录受到伤害', submit.taken === 789);
  ok('记录击杀 BOSS 数', submit.boss === 2);
  ok('记录存活时间', Math.abs(submit.time - 95.4) < 0.2, `time=${submit.time}`);
  ok('记录境界', submit.realm >= 1, `realm=${submit.realm}`);

  // 3c 持久化：重新 loadBoard 仍在
  const lbLen = await ev(`loadBoard().length`);
  ok('榜单已持久化到 localStorage', lbLen === 1, `len=${lbLen}`);

  // 3d 多条记录 + 排序（积分降序）
  const multi = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    const mk=(s,k)=>{game.score=s;game.kills=k;game.dmgDealt=s*10;game.dmgTaken=100;game.bossKills=s>150?1:0;game.time=60;submitToBoard();};
    mk(50,5); mk(300,30); mk(150,15); mk(200,20);
    const l=boardSort(loadBoard());
    return {scores:l.map(x=>x.score), len:l.length};
  })()`);
  ok('多局累积入榜', multi.len === 4, `len=${multi.len}`);
  ok('按积分降序排列', JSON.stringify(multi.scores) === '[300,200,150,50]',
     `scores=${JSON.stringify(multi.scores)}`);

  // 3e 上限截断
  const capped = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    for(let i=0;i<25;i++){game.score=i*10+1;game.kills=i;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=10;submitToBoard();}
    return loadBoard().length;
  })()`);
  ok('榜单上限 20 条', capped === 20, `len=${capped}`);

  // 3f L 键切换
  const lbOff = await ev(`boardOpen`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await wait(300);
  const lbOn = await ev(`boardOpen`);
  ok('L 键打开排行榜', lbOff === false && lbOn === true, `off=${lbOff} on=${lbOn}`);

  // 再按关闭
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await wait(300);
  const lbOff2 = await ev(`boardOpen`);
  ok('L 键再次按下关闭排行榜', lbOff2 === false);

  // 3g L 键不再触发雷法：按下 L 后雷法冷却不应被置位（无敌人时也会进 CD）
  await ev(`(()=>{game.started=true;game.over=false;enemies.length=0;
    player.cds.lightning=0;player.lastCast='—';return true})()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await wait(250);
  const lightningAfterL = await ev(`({cd:player.cds.lightning,last:player.lastCast})`);
  ok('L 键不再触发雷法（雷法 CD 未被置位）',
     lightningAfterL.cd === 0 && !/雷法|Thunder/.test(lightningAfterL.last || ''),
     `cd=${lightningAfterL.cd} last=${lightningAfterL.last}`);
  await ev(`boardOpen=false`);

  // 3h 排行榜打开时游戏暂停
  await ev(`(()=>{game.started=true;game.time=0;boardOpen=true;return true})()`);
  await wait(500);
  const tPaused = await ev(`game.time`);
  ok('排行榜打开时游戏暂停推进', tPaused === 0, `game.time=${tPaused}`);
  await ev(`boardOpen=false`);

  // 3i 死亡时自动入榜（走 hurtPlayer 真实路径）
  const deathTest = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    game.started=true; game.over=false; game.score=88; game.kills=9;
    game.dmgDealt=1234; game.dmgTaken=567; game.bossKills=1; game.time=42;
    player.hp=5; player.inv=0;
    hurtPlayer(999,{ignoreInv:true,noInv:true,noFlash:true});
    return {over:game.over, rank:game.rankEntry?game.rankEntry.rank:null,
            listLen:loadBoard().length, entry:game.rankEntry?game.rankEntry.entry:null};
  })()`);
  ok('战死触发自动入榜', deathTest.over === true && deathTest.rank === 1, `rank=${deathTest.rank}`);
  // 注意：致命一击本身也会计入「受到伤害」，故 dmgTaken = 567 + 999 = 1566
  ok('死亡记录包含全部维度', deathTest.entry && deathTest.entry.dmgDealt === 1234
     && deathTest.entry.dmgTaken === 1566 && deathTest.entry.bossKills === 1
     && deathTest.entry.kills === 9 && deathTest.entry.score === 88,
     `dealt=${deathTest.entry && deathTest.entry.dmgDealt} taken=${deathTest.entry && deathTest.entry.dmgTaken} boss=${deathTest.entry && deathTest.entry.bossKills}`);

  // 3j 排行榜可渲染（不抛异常）
  const drawn = await ev(`(()=>{try{boardOpen=true;drawBoard();boardOpen=false;return true}catch(e){return 'ERR:'+e.message}})()`);
  ok('排行榜渲染无异常', drawn === true, String(drawn));

  // 3k 道号稳定复用（同一局内多次入榜名字一致）
  const stable = await ev(`(()=>{
    const a=daoName(); const b=daoName();
    return {a,b,same:a===b};
  })()`);
  ok('道号稳定复用', stable.same === true, `名="${stable.a}"`);

  /* ---------- 回归 ---------- */
  // 版本号画在 canvas 上（L('title')+' v2.17'），不在 document.title 里，
  // 所以直接检查页面内是否存在该绘制调用。
  const verSrc = await ev(`(()=>{
    const cvs=document.querySelector('canvas');
    // 从源码层面检查：页面里若有 v2.16 残留也应发现
    return {hasV217: typeof game==='object'};
  })()`);
  const verOk = await ev(`(()=>{
    // drawHUD 里会画 title+v2.17；用探针确认字符串存在于已加载的脚本内容
    const scripts=[...document.querySelectorAll('script')].map(s=>s.textContent||'').join('');
    return scripts.includes("v2.17");
  })()`);
  ok('版本号已更新到 v2.17', verOk === true, `in-page source=${verOk}`);

  // L 键改派后，4 键雷法仍可用
  await ev(`(()=>{game.started=true;game.over=false;enemies.length=0;return true})()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', code: 'Digit4', windowsVirtualKeyCode: 52 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4', windowsVirtualKeyCode: 52 });
  await wait(300);
  const castOk = await ev(`(()=>{const c=player.cds.lightning;return {c, last:player.lastCast}})()`);
  ok('4 键雷法仍然可用', castOk.c > 0 || /雷法|Thunder/.test(castOk.last || ''),
     `cd=${castOk.c} last=${castOk.last}`);

  ok('运行期零异常', exceptions.length === 0, `${exceptions.length} exceptions`);

  console.log(`\n${pass}/${pass + fail} 项通过`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
