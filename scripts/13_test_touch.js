/**
 * 13_test_touch.js — 手机端触摸控制回归测试（通过 CDP 派发真实 touch 事件）
 * 用法：node scripts/13_test_touch.js [cdpHttp]
 */
const CDP_HTTP = process.argv[2] || 'http://127.0.0.1:9223';

async function main() {
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!page) throw new Error('未找到游戏页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const trySend = (m, p) => send(m, p).catch(() => {});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts });

  await send('Page.enable');
  await trySend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await trySend('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile Safari/604.1' });
  await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.reload', { ignoreCache: true });
  await sleep(1800);

  const results = [];
  const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); };

  ok('手机档位启用', await ev('IS_TOUCH && QUALITY.range===12'), 'IS_TOUCH=' + await ev('IS_TOUCH'));
  await ev('game.started=true; player.auto=false; true');
  await sleep(200);

  // 摇杆上推：中心 (88,744) → 上移到 (88,670)
  const p0 = await ev('({x:player.pos.x,z:player.pos.z})');
  await touch('touchStart', [{ x: 88, y: 744, id: 1 }]);
  await touch('touchMove', [{ x: 88, y: 670, id: 1 }]);
  await sleep(700);
  await touch('touchEnd', []);
  const p1 = await ev('({x:player.pos.x,z:player.pos.z})');
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  ok('摇杆驱动前进', moved > 4, `位移 ${moved.toFixed(1)} 丈`);

  // 摇杆回中验证
  const axis = await ev('({x:touch.axisX,y:touch.axisY})');
  ok('摇杆松手回中', Math.abs(axis.x) < 0.01 && Math.abs(axis.y) < 0.01, JSON.stringify(axis));

  // 技能按钮：1 飞剑 (215,676)。手动施法需要目标，故 hook castManual 验证事件确实触发
  await ev('window.__castCalls=0; const _cm=window.castManual; window.castManual=function(k){window.__castCalls++;return _cm(k)}; true');
  await touch('touchStart', [{ x: 215, y: 676, id: 2 }]);
  await touch('touchEnd', []);
  await sleep(150);
  const casts = await ev('window.__castCalls');
  ok('技能按钮触发飞剑术', casts > 0, `castManual 调用 ${casts} 次`);

  // 高度按钮：升 (281,736) 按住 0.6 秒
  const alt0 = await ev('player.targetAlt');
  await touch('touchStart', [{ x: 281, y: 736, id: 3 }]);
  await sleep(600);
  await touch('touchEnd', []);
  const alt1 = await ev('player.targetAlt');
  ok('升降按钮改变设定高度', alt1 > alt0 + 1, `${alt0.toFixed(1)} → ${alt1.toFixed(1)} 丈`);

  // 自动斗法开关
  const auto0 = await ev('player.auto');
  await touch('touchStart', [{ x: 215, y: 796, id: 4 }]);   // 自动 (第一列第三行)
  await touch('touchEnd', []);
  await sleep(120);
  const auto1 = await ev('player.auto');
  ok('自动斗法开关', auto0 !== auto1, `${auto0} → ${auto1}`);

  const errs = await ev('window.__testErrors||[]');
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} 项通过`);
  ws.close();
  if (results.some(r => !r.pass)) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
