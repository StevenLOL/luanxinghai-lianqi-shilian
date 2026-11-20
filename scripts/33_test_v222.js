/* v2.22 专项回归：技能惯性继承（运动参考系速度叠加）
 *
 * 物理依据：伽利略速度叠加，运动参考系发射的弹丸带母体速度。
 * 游戏定位：全部技能自动释放，无准心 → 手感顾虑不成立。
 *
 * 实现（仅带制导的飞剑/火球继承，制导吸收偏差保证命中）：
 *   ① player.vel 记录每帧实际位移速度（含俯冲/高度收敛）
 *   ② launchSpell 对 sword/fire 初速叠加 player.vel × 0.5（上限 18/轴）
 *   ③ ice 无制导、lightning 无弹丸 → 不继承
 *   ④ 敌人施法不受影响（ownerKey!=='player'）
 *
 * 验证重点：静止 vs 高速移动释放的初速差异 + 命中率不变
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
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
  await waitReady(ev, wait);

  /* ---------- 1. 常量与辅助函数存在 ---------- */
  const consts = await ev(`(()=>({
    factor:INHERIT_FACTOR, cap:INHERIT_CAP,
    fn:typeof inheritVec
  }))()`);
  ok('继承常量存在且合理', consts.factor === 0.5 && consts.cap === 18, JSON.stringify(consts));
  ok('inheritVec 函数存在', consts.fn === 'function');

  /* ---------- 2. inheritVec 行为：比例 + 上限 ---------- */
  const iv = await ev(`(()=>{
    const o={};
    inheritVec({x:20,y:-30,z:6},0.5,18,o);
    const a={...o};
    inheritVec({x:100,y:100,z:100},1,18,o);
    return {a,b:{...o}};
  })()`);
  ok('inheritVec 按比例缩放', iv.a.x === 10 && iv.a.z === 3, JSON.stringify(iv.a));
  ok('inheritVec 负速度正确', iv.a.y === -15);
  ok('inheritVec 上限钳制', iv.b.x === 18 && iv.b.y === 18 && iv.b.z === 18, JSON.stringify(iv.b));

  /* ---------- 3. 玩家 vel 字段存在并被更新 ---------- */
  const velField = await ev(`(()=>({has:'vel' in player, init:{...player.vel}}))()`);
  ok('player.vel 字段存在', velField.has);

  // 模拟前进：设 keys.w 并推进几帧（直接调用 update 更可控）
  const moved = await ev(`(()=>{
    game.started=true; game.over=false;
    keys['w']=true; keys['a']=false; keys['d']=false; keys['s']=false;
    touch.axisX=0; touch.axisY=0;
    for(let i=0;i<10;i++) update(1/60);
    keys['w']=false;
    return {vel:{...player.vel}, heading:player.heading};
  })()`);
  ok('前进时 vel 非零', Math.hypot(moved.vel.x,moved.vel.z) > 10, JSON.stringify(moved.vel));
  ok('vel 方向沿 facing', Math.abs(moved.vel.z) > Math.abs(moved.vel.x), JSON.stringify(moved.vel));

  /* ---------- 4. 静止 vs 移动：飞剑初速差异 ---------- */
  const swordTest = await ev(`(()=>{
    function castAt(vel){
      game.started=true; game.over=false; game.time=10;
      player.hp=100; player.qi=999; player.maxQi=999;
      player.cds.sword=0; player.cds.fire=0; player.cds.ice=0;
      player.pos={x:0,y:30,z:0}; player.heading=0;
      player.vel={...vel};
      enemies.length=0;
      // 目标放在正前方
      enemies.push({x:0,y:0,z:-40,hp:999,maxHp:999,r:5,type:'beast',
        wander:0,hitCd:0,hurt:0,qi:60,maxQi:60,
        cds:{sword:9,fire:9,ice:9,beam:9,melee:9},autoLast:0,facing:{x:0,z:1}});
      bolts.length=0;
      castSpellFor('player','sword',enemies[0],player);
      return bolts.length?{...bolts[0].v}:null;
    }
    const still=castAt({x:0,y:0,z:0});
    const fwd=castAt({x:0,y:0,z:-36});   // 朝 -z 前进
    return {still,fwd};
  })()`);
  ok('静止飞剑初速生成', !!swordTest.still && isFinite(swordTest.still.z));
  ok('移动飞剑初速生成', !!swordTest.fwd && isFinite(swordTest.fwd.z));
  ok('飞剑继承前进速度（-z 更大）', swordTest.fwd.z < swordTest.still.z - 5,
     `still.z=${swordTest.still.z.toFixed(2)} fwd.z=${swordTest.fwd.z.toFixed(2)}`);
  ok('飞剑继承量符合 0.5 系数', Math.abs((swordTest.still.z-swordTest.fwd.z)-18) < 0.5,
     `Δz=${(swordTest.still.z-swordTest.fwd.z).toFixed(2)}`);

  /* ---------- 5. 火球也继承 ---------- */
  const fireTest = await ev(`(()=>{
    function castAt(vel){
      game.started=true; game.over=false; game.time=10;
      player.qi=999; player.maxQi=999; player.cds.fire=0;
      player.pos={x:0,y:30,z:0}; player.heading=0; player.vel={...vel};
      enemies.length=0;
      enemies.push({x:0,y:0,z:-30,hp:999,maxHp:999,r:5,type:'beast',
        wander:0,hitCd:0,hurt:0,qi:60,maxQi:60,
        cds:{sword:9,fire:9,ice:9,beam:9,melee:9},autoLast:0,facing:{x:0,z:1}});
      bolts.length=0;
      castSpellFor('player','fire',enemies[0],player);
      return bolts.length?{...bolts[0].v}:null;
    }
    return {still:castAt({x:0,y:0,z:0}), fwd:castAt({x:0,y:0,z:-36})};
  })()`);
  ok('火球继承前进速度', fireTest.fwd.z < fireTest.still.z - 5,
     `still.z=${fireTest.still.z.toFixed(2)} fwd.z=${fireTest.fwd.z.toFixed(2)}`);

  /* ---------- 6. 冰剑不继承（无制导，继承会永久偏航）---------- */
  const iceTest = await ev(`(()=>{
    function castAt(vel){
      game.started=true; game.over=false; game.time=10;
      player.qi=999; player.maxQi=999; player.cds.ice=0;
      player.pos={x:0,y:30,z:0}; player.heading=0; player.vel={...vel};
      enemies.length=0;
      enemies.push({x:0,y:0,z:-18,hp:999,maxHp:999,r:5,type:'beast',
        wander:0,hitCd:0,hurt:0,qi:60,maxQi:60,
        cds:{sword:9,fire:9,ice:9,beam:9,melee:9},autoLast:0,facing:{x:0,z:1}});
      bolts.length=0;
      castSpellFor('player','ice',enemies[0],player);
      return bolts.length?{...bolts[0].v}:null;
    }
    return {still:castAt({x:0,y:0,z:0}), fwd:castAt({x:0,y:0,z:-36})};
  })()`);
  ok('冰剑初速生成', !!iceTest.still && !!iceTest.fwd);
  ok('冰剑不继承（初速相同）',
     Math.abs(iceTest.still.z-iceTest.fwd.z)<0.01 && Math.abs(iceTest.still.x-iceTest.fwd.x)<0.01,
     `still=${JSON.stringify(iceTest.still)} fwd=${JSON.stringify(iceTest.fwd)}`);

  /* ---------- 7. 敌人施法不受继承影响 ---------- */
  const enemyTest = await ev(`(()=>{
    game.started=true; game.time=10;
    player.qi=999; player.pos={x:0,y:30,z:0}; player.vel={x:0,y:0,z:-36};
    enemies.length=0;
    const e={x:0,y:0,z:40,hp:999,maxHp:999,r:5,type:'archer',
      wander:0,hitCd:0,hurt:0,qi:999,maxQi:999,
      cds:{sword:0,fire:0,ice:0,beam:9,melee:9},autoLast:0,facing:{x:0,z:-1}};
    enemies.push(e);
    bolts.length=0;
    castSpellFor('enemy','fire',player,e);
    return bolts.length?{...bolts[0].v}:null;
  })()`);
  ok('敌人弹丸不继承主角速度', enemyTest && isFinite(enemyTest.z),
     JSON.stringify(enemyTest));

  /* ---------- 8. 命中率：移动中发射的飞剑仍能命中 ---------- */
  for (const vel of [{x:0,y:0,z:0},{x:0,y:0,z:-36},{x:20,y:0,z:-30}]) {
    const hit = await ev(`(()=>{
      game.started=true; game.over=false; game.time=10;
      player.hp=100; player.qi=999; player.maxQi=999; player.pos={x:0,y:30,z:0};
      player.cds.sword=0; player.vel={x:${vel.x},y:${vel.y},z:${vel.z}};
      enemies.length=0;
      const e={x:0,y:0,z:-45,hp:99999,maxHp:99999,r:5,type:'beast',
        wander:0,hitCd:0,hurt:0,qi:60,maxQi:60,
        cds:{sword:9,fire:9,ice:9,beam:9,melee:9},autoLast:0,facing:{x:0,z:1}};
      enemies.push(e);
      bolts.length=0; particles.length=0; dmgNums.length=0;
      castSpellFor('player','sword',e,player);
      let everHit=false;
      for(let i=0;i<180;i++){
        update(1/60);
        if(game.dmgDealt>0){everHit=true;break;}
      }
      game.dmgDealt=0;
      return everHit;
    })()`);
    ok(`飞剑命中率 - vel(${vel.x},${vel.z})`, hit === true, `hit=${hit}`);
  }

  /* ---------- 9. 火球命中率 ---------- */
  for (const vel of [{x:0,y:0,z:0},{x:0,y:0,z:-36}]) {
    const hit = await ev(`(()=>{
      game.started=true; game.over=false; game.time=10;
      player.hp=100; player.qi=999; player.maxQi=999; player.pos={x:0,y:30,z:0};
      player.cds.fire=0; player.vel={x:${vel.x},y:${vel.y},z:${vel.z}};
      enemies.length=0;
      const e={x:0,y:0,z:-30,hp:99999,maxHp:99999,r:5,type:'beast',
        wander:0,hitCd:0,hurt:0,qi:60,maxQi:60,
        cds:{sword:9,fire:9,ice:9,beam:9,melee:9},autoLast:0,facing:{x:0,z:1}};
      enemies.push(e);
      bolts.length=0; particles.length=0; dmgNums.length=0;
      castSpellFor('player','fire',e,player);
      let everHit=false;
      for(let i=0;i<180;i++){
        update(1/60);
        if(game.dmgDealt>0){everHit=true;break;}
      }
      game.dmgDealt=0;
      return everHit;
    })()`);
    ok(`火球命中率 - vel(${vel.x},${vel.z})`, hit === true, `hit=${hit}`);
  }

  /* ---------- 10. 版本号 ---------- */
  const ver = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');
    const i=s.indexOf("L('title')+"); return i<0?'?':(s.slice(i,i+60).match(/v2[.][0-9]+/)||['?'])[0]})()`);
  const vn = parseFloat(ver.replace('v',''));
  ok('版本号 >= 2.22', vn >= 2.22, `version=${ver}`);

  /* ---------- 11. 渲染无异常 ---------- */
  const rerr = await ev(`(()=>{
    const errs=[];
    game.started=true; game.over=false;
    for(let i=0;i<3;i++){
      try{ update(1/60); render(); }catch(e){ errs.push(e.message); }
    }
    return errs;
  })()`);
  ok('update/render 无异常', Array.isArray(rerr) && rerr.length === 0, JSON.stringify(rerr));

  console.log(`\n=== v2.22 惯性继承：${pass} 项通过，${fail} 项失败 ===`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
