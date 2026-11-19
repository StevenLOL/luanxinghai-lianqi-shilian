/**
 * 14_test_roll.js — v2.14 机动翻滚 + 手机控件精简回归测试（CDP 实测）
 * 前置：Chrome --remote-debugging-port=9223 打开游戏页
 * 用法：node scripts/14_test_roll.js [cdpHttp]
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
  const keyJ = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
  };

  const results = [];
  const ok = (name, pass, detail) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); };

  await send('Page.enable');
  await trySend('Emulation.setDeviceMetricsOverride', { width: 1424, height: 805, deviceScaleFactor: 1, mobile: false });
  await trySend('Emulation.setUserAgentOverride', { userAgent: '' });
  await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Page.reload', { ignoreCache: true });
  await sleep(1800);
  await ev('game.started=true; player.auto=false; true');
  await sleep(100);

  // 1. 初始高度
  const alt0 = await ev('player.targetAlt');
  ok('初始设定高度 25 丈', alt0 === 25, `targetAlt=${alt0}`);

  // 2. J 键触发翻滚 + CD 置位
  await keyJ();
  await sleep(60);
  const rolling = await ev('!!player.roll');
  const cd = await ev('player.cds.roll');
  ok('J 键触发翻滚', rolling, `player.roll=${rolling}`);
  ok('翻滚冷却置为 5s', cd > 4.5 && cd <= 5, `cds.roll=${cd.toFixed(2)}`);

  // 3. 翻滚期间无敌
  const inv = await ev('player.inv');
  ok('翻滚期间无敌', inv > 0, `inv=${inv.toFixed(3)}`);

  // 4. 翻滚位移（记录起点，取翻滚中的位置）
  const p0 = await ev('({x:player.pos.x,z:player.pos.z,sy:player.pos.sy||player.pos.y})');
  await sleep(400);
  const p1 = await ev('({x:player.pos.x,z:player.pos.z})');
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  ok('翻滚桶滚突进位移', moved > 8, `位移 ${moved.toFixed(1)} 丈`);

  // 5. CD 期间再按 J 不重复触发
  await keyJ();
  await sleep(50);
  const stillOne = await ev('player.cds.roll');
  ok('CD 期间重复按 J 重置无效', stillOne < cd, `cds.roll=${stillOne.toFixed(2)}（应继续递减，未重置为5）`);

  // 6. 翻滚结束 + 高度收益 +4
  await sleep(800);
  const alt1 = await ev('player.targetAlt');
  const rollDone = await ev('!player.roll');
  ok('翻滚结束释放状态', rollDone, `roll=${!rollDone ? '仍在进行' : 'null'}`);
  ok('半筋斗高度收益 +4', alt1 === alt0 + 4, `${alt0} → ${alt1}`);

  // 7. 手机端控件精简
  await trySend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await trySend('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile Safari/604.1' });
  await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.reload', { ignoreCache: true });
  await sleep(1600);
  const tb = await ev(`({acts:[...document.querySelectorAll('#tb button')].map(b=>b.dataset.act),
                           tipHidden:getComputedStyle(document.getElementById('tip')).display==='none'})`);
  const acts = tb.acts.slice().sort().join(',');
  ok('手机只保留升降+翻滚三按钮', acts === 'altDown,altUp,roll', `acts=[${tb.acts.join(', ')}]`);
  ok('手机端隐藏键盘提示条', tb.tipHidden, `tip.display=${tb.tipHidden ? 'none' : 'visible'}`);

  // 8. 手机翻滚按钮真实触摸触发
  await ev('game.started=true; player.cds.roll=0; true');
  const rb = await ev(`(()=>{const b=document.getElementById('tbRoll');const r=b.getBoundingClientRect();
                             return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x, y: rb.y, id: 9 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(80);
  ok('手机翻滚按钮触发', await ev('!!player.roll'), 'roll=' + await ev('!!player.roll'));

  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`);
  ws.close();
  if (results.some(x => !x)) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
