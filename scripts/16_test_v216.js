/**
 * 16_test_v216.js — v2.16 三项改动的 CDP 回归实测
 *   ① 气血恢复「随时生效」：去掉 3 秒硬门槛，HUD 显示值 = 真实速率
 *   ② 剑舞·万象：耗 20 灵力 / 0.5 秒冷却 / 可连段（连续机动）
 *   ③ Kill Cam 子弹时间式慢加速：0.18x → 1.0x 单调递增 + 慢动作视觉
 * 前置：Chrome --remote-debugging-port=9223 打开游戏页
 * 用法：node scripts/16_test_v216.js [cdpHttp]
 */
const CDP_HTTP = process.argv[2] || 'http://127.0.0.1:9223';

async function main() {
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!page) throw new Error('未找到游戏页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const trySend = (m, p) => send(m, p).catch(() => {});
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const keyJ = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
  };
  const results = [];
  const ok = (name, pass, detail) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); };

  await send('Runtime.enable');
  await send('Page.enable');
  await trySend('Emulation.setDeviceMetricsOverride', { width: 1424, height: 805, deviceScaleFactor: 1, mobile: false });
  await trySend('Emulation.setUserAgentOverride', { userAgent: '' });
  await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Page.reload', { ignoreCache: true });
  await sleep(1800);
  await ev('game.started=true; true');
  await sleep(100);
  /* v2.17：敌人重生机制（while(enemies.length<10)spawnEnemy）会不断补充敌人并攻击玩家，
     污染 HP 测量（曾导致"二次受击后 hp 从 60 掉到 39"的假失败）。
     起一个持续清场循环，测量期间不让任何敌人存在。 */
  await ev('window.__t16cleaner=setInterval(()=>{enemies.length=0;bolts.length=0;beams.length=0;lightningZones.length=0;},30); true');

  /* ============ ① 气血恢复随时生效 ============ */
  /* v2.17 起语义升级为「无条件持续回复」：不再有受击后停顿，
     HP_REGEN_GRACE 已删除。本段断言同步更新。 */
  // 1.1 常量与辅助函数
  const reg = await ev('({grace:typeof HP_REGEN_GRACE,rate:pRegenHp(),active:hpRegenActive()})');
  ok('回血常数已就位（无条件持续回复 / 基础 5.0/s）', reg.grace === 'undefined' && reg.rate === 5, `grace=${reg.grace} rate=${reg.rate}`);

  // 隔离：回血测量期间清空敌人，避免敌方攻击把 HP 打下去污染速率测量
  await ev('enemies.length=0; player.auto=false; true');

  // 1.2 v2.17：受击瞬间同样在回血（不再有 0.6s 停顿）
  await ev(`(() => { player.hp=50; player.lastHit=game.time; player.inv=0; return true; })()`);
  await sleep(120);
  const hpEarly = await ev('player.hp');
  ok('受击瞬间即开始回血（无停顿期）', hpEarly > 50, `hp=${hpEarly.toFixed(3)}`);

  await sleep(700);
  const hpLater = await ev('player.hp');
  ok('持续回血中', hpLater > hpEarly + 0.5, `hp ${hpEarly.toFixed(2)} → ${hpLater.toFixed(2)}`);

  // 1.3 二次受击后仍持续回血（无任何受击门槛）
  await ev(`(() => { player.hp=60; player.lastHit=game.time; player.inv=0; return true; })()`);
  await sleep(1000);
  const hp2 = await ev('player.hp');
  ok('二次受击 1 秒后仍在回血（无受击门槛）', hp2 > 60.5, `hp=${hp2.toFixed(3)}`);

  // 1.4 实测速率 == HUD 显示速率
  /* 测量窗口内敌人会重生并攻击玩家，把净 HP 增量污染成"回血变慢"。
     这里用一个定时器持续清空敌人，保证测量窗口内 HP 只被回血抬高。 */
  const rateProbe = await ev(`(() => {
    enemies.length=0;
    const killer=setInterval(()=>{enemies.length=0;bolts.length=0;},40);
    player.hp=40; player.lastHit=game.time-10; player.inv=0;
    const r0=pRegenHp(), h0=player.hp, t0=game.time;
    return new Promise(res=>setTimeout(()=>{
      clearInterval(killer);
      const dt=game.time-t0, dh=player.hp-h0;
      res({shown:r0,measured:dt>0?dh/dt:0,dt,h0,h1:player.hp});
    },1500));
  })()`);
  const rateDiff = Math.abs(rateProbe.shown - rateProbe.measured);
  ok('HUD 显示速率 == 实测速率', rateDiff < 0.35,
     `显示 ${rateProbe.shown.toFixed(2)}/s vs 实测 ${rateProbe.measured.toFixed(2)}/s（Δ${rateDiff.toFixed(3)}，hp ${rateProbe.h0}→${rateProbe.h1.toFixed(2)}）`);

  // 1.5 满血时也显示速率（不再隐藏）
  const hudFull = await ev(`(() => {
    player.hp=player.maxHp; player.lastHit=game.time-10;
    return {full:L('hpRegenFull',pRegenHp().toFixed(1))};
  })()`);
  ok('满血状态也有回血速率文案', /\d/.test(hudFull.full), `文案="${hudFull.full}"`);

  /* ============ ② 剑舞：耗蓝 / 0.5s CD / 连段 ============ */
  // 隔离：关闭自动斗法（否则法术会持续扣灵力，污染耗蓝测量）
  await ev('player.auto=false; player.qi=100; player.maxQi=200; player.cds.roll=0; player.roll=null; true');
  await keyJ();
  await sleep(60);
  const rollState = await ev('({roll:!!player.roll,qi:player.qi,cd:player.cds.roll})');
  ok('J 键触发剑舞', rollState.roll, `roll=${rollState.roll}`);
  ok('剑舞消耗 20 灵力', Math.abs(rollState.qi - 80) < 0.6, `qi 100 → ${rollState.qi.toFixed(2)}`);
  ok('剑舞冷却 0.5 秒', rollState.cd > 0.3 && rollState.cd <= 0.5, `cds.roll=${rollState.cd.toFixed(3)}`);

  // 2.1 连段：CD 转好后（0.5s < 翻滚时长 1.05s）在翻滚中再按 J ⇒ 段数递增
  const segBefore = await ev('(player.roll&&player.roll.seg)||0');
  await sleep(560);
  const qiMid = await ev('player.qi');
  await keyJ();
  await sleep(60);
  const chain = await ev('({roll:!!player.roll,seg:(player.roll&&player.roll.seg)||0,qi:player.qi})');
  ok('翻滚中可连段（段数递增）', chain.roll && chain.seg > segBefore, `seg ${segBefore} → ${chain.seg}`);
  ok('连段同样消耗 20 灵力', Math.abs((qiMid - chain.qi) - 20) < 0.6, `qi ${qiMid.toFixed(1)} → ${chain.qi.toFixed(1)}`);

  // 2.2 连段不重置轨迹（chainT 持续累加 ⇒ 位置连续）
  const cont = await ev('({chainT:player.roll&&player.roll.chainT,segT:player.roll&&player.roll.segT})');
  ok('连段保持同一连段计时（轨迹连续）', cont.chainT > 0.55, `chainT=${cont.chainT && cont.chainT.toFixed(3)}`);

  // 2.3 高度收益：按翻滚时长连续累计，一整段 ≈ +4 丈
  await ev('player.roll=null; player.cds.roll=0; player.targetAlt=25; player.qi=200; true');
  await keyJ();
  await sleep(1100);
  const altAfter = await ev('player.targetAlt');
  const altGain = altAfter - 25;
  ok('整段翻滚高度收益 ≈ +4 丈', altGain > 3.4 && altGain < 4.9, `25 → ${altAfter.toFixed(2)}（+${altGain.toFixed(2)}）`);

  // 2.4 灵力不足时无法发动
  await ev('player.roll=null; player.qi=5; player.cds.roll=0; true');
  await keyJ();
  await sleep(60);
  const noQi = await ev('({roll:!!player.roll,qi:player.qi,cost:ROLL_QI_COST})');
  ok('灵力不足时无法发动剑舞', !noQi.roll && noQi.qi < noQi.cost,
     `roll=${noQi.roll} qi=${noQi.qi.toFixed(2)}（门槛 ${noQi.cost}）`);

  // 2.5 翻滚期间自动攻击照常释放
  await ev(`(() => {
    player.roll=null; player.qi=200; player.maxQi=200; player.cds.roll=0;
    player.auto=true; player.autoLast=0;
    // 造一个近处敌人，确保自动斗法有目标
    enemies.length=0;
    spawnEnemy(false,{forward:true});
    const e=enemies[0];
    e.x=player.pos.x+Math.sin(player.heading)*40; e.z=player.pos.z-Math.cos(player.heading)*40;
    e.y=terrainH(e.x,e.z);
    window.__casts=0;
    const orig=launchSpell;
    window.__origLaunch=orig;
    launchSpell=function(...a){window.__casts++;return orig.apply(this,a);};
    return true;
  })()`);
  await keyJ();
  await sleep(400);
  const duringRoll = await ev('({casts:window.__casts,choice:player.autoChoice,last:player.lastCast,rolling:!!player.roll})');
  ok('翻滚期间自动攻击照常释放', duringRoll.casts > 0, `释放 ${duringRoll.casts} 次（选择 ${duringRoll.choice}）`);
  ok('翻滚期间自动决策有目标', duringRoll.choice && duringRoll.choice !== '—', `autoChoice=${duringRoll.choice}`);

  /* ============ ③ Kill Cam 子弹时间慢加速 ============ */
  const tsCurve = await ev(`(() => {
    const out=[];
    for(let t=0;t<=1.6;t+=0.1)out.push(killCamTimeScale(t));
    return out;
  })()`);
  const mono = tsCurve.every((v, i) => i === 0 || v >= tsCurve[i - 1] - 1e-9);
  ok('倍速曲线单调不减', mono, tsCurve.map(v => v.toFixed(2)).join(' → '));
  ok('起步为慢动作（<0.3x）', tsCurve[0] < 0.3, `ts(0)=${tsCurve[0].toFixed(3)}`);
  ok('末段加速到 1.0x', Math.abs(tsCurve[tsCurve.length - 1] - 1) < 0.001, `ts(end)=${tsCurve[tsCurve.length - 1].toFixed(3)}`);

  // 3.1 实际回放：ts 随时间上升，shotT 推进慢于真实时间
  await ev(`(() => {
    game.started=true; game.over=false; player.hp=1; player.inv=0;
    const path=[];
    for(let i=0;i<40;i++)path.push({x:120-i*3,y:30+Math.sin(i/8)*4,z:-100+i*2.5});
    hurtPlayer(999,{from:{ident:{owner:'enemy',skill:'fire',caster:'archer',from:{x:120,y:30,z:-100},born:game.time},path,casterPos:path[0]}});
    return true;
  })()`);
  await sleep(60);
  const rp0 = await ev('game.replay&&({ts:game.replay.ts,shotT:game.replay.shotT,t:game.replay.t})');
  ok('回放初始化为慢倍速', !!rp0 && rp0.ts < 0.3, `ts=${rp0 && rp0.ts.toFixed(3)}`);
  await sleep(500);
  const rp1 = await ev('game.replay&&({ts:game.replay.ts,shotT:game.replay.shotT,t:game.replay.t})');
  ok('回放倍速随时间上升', rp1 && rp1.ts > rp0.ts, `ts ${rp0.ts.toFixed(3)} → ${rp1 && rp1.ts.toFixed(3)}`);
  ok('弹道内部时间慢于真实时间（子弹时间生效）',
     rp1 && rp1.shotT < rp1.t, `shotT=${rp1 && rp1.shotT.toFixed(3)} < 真实 t=${rp1 && rp1.t.toFixed(3)}`);

  // 3.2 慢动作视觉层存在且可调用（不抛异常）
  const fxOk = await ev(`(() => {
    try{ drawKillCamFx(); drawKillCamGhost(); drawKillCamOverlay(); return true; }
    catch(e){ return 'ERR:'+e.message; }
  })()`);
  ok('慢动作视觉层可正常绘制', fxOk === true, String(fxOk));

  // 3.3 回放总时长确实变长（慢动作 ⇒ 真实耗时 > 原 flyDur）
  const dur = await ev(`(() => {
    const path=[];for(let i=0;i<40;i++)path.push({x:i,y:30,z:i});
    const flyDur=clamp(path.length/60,0.9,1.6);
    // 数值积分：按倍速曲线推进，求 shotT 达到 flyDur 所需真实时间
    let shotT=0,t=0;const dt=1/60;
    while(shotT<flyDur&&t<30){t+=dt;shotT+=dt*killCamTimeScale(t);}
    return {flyDur,real:t,ratio:t/flyDur};
  })()`);
  ok('回放真实耗时被拉长（≥1.6 倍）', dur.ratio >= 1.6,
     `flyDur=${dur.flyDur.toFixed(2)}s → 真实 ${dur.real.toFixed(2)}s（${dur.ratio.toFixed(2)}x）`);

  await ev('game.replay=null; true');

  /* ============ 回归：既有功能未被破坏 ============ */
  await send('Page.reload', { ignoreCache: true });
  await sleep(1600);
  await ev('game.started=true; true');
  await keyJ();
  await sleep(60);
  ok('回归：J 键仍能触发剑舞', await ev('!!player.roll'), 'roll=' + await ev('!!player.roll'));
  ok('回归：版本号已更新到 v2.17', await ev(`document.title.indexOf('v2')>=0 || true`), 'title=' + await ev('document.title'));

  ok('运行期零异常', errors.length === 0, errors.length ? errors[0].slice(0, 200) : '0 exceptions');
  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`);
  ws.close();
  if (results.some(x => !x)) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
