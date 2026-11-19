/**
 * 15_test_killcam.js — v2.15 被击败来源 + 击杀回放 CDP 实测
 * 前置：Chrome --remote-debugging-port=9223 打开游戏页
 * 用法：node scripts/15_test_killcam.js [cdpHttp]
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
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const ok = (name, pass, detail) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(1800);

  // 构造一次「敌修·火球」的致命命中：注入带完整 path 的来源，把 hp 打到 1 再致命一击
  await ev(`(() => {
    game.started=true; game.over=false; player.hp=1; player.inv=0;
    const path=[];
    for(let i=0;i<40;i++)path.push({x:120-i*3,y:30+Math.sin(i/8)*4,z:-100+i*2.5});
    const src={ident:{owner:'enemy',skill:'fire',caster:'archer',from:{x:120,y:30,z:-100},born:game.time},
               path, casterPos:path[0]};
    hurtPlayer(999,{from:src});
    return true;
  })()`);
  await sleep(60);

  ok('死亡状态置位', await ev('game.over===true'), 'game.over=' + await ev('game.over'));
  const killer = await ev('game.killer&&({skill:game.killer.skill,caster:game.killer.caster})');
  ok('凶手身份被记录', killer && killer.skill === 'fire' && killer.caster === 'archer', JSON.stringify(killer));
  const rp0 = await ev('game.replay&&({len:game.replay.path.length,t:game.replay.t,prog:game.replay.prog})');
  ok('回放数据含完整轨迹', !!rp0 && rp0.len === 40, JSON.stringify(rp0));

  // 回放在推进：t 增大、ghost 存在
  await sleep(180);
  const rp1 = await ev('game.replay&&({t:game.replay.t,prog:game.replay.prog,ghost:!!game.replay.ghost})');
  ok('回放时钟推进', rp1 && rp1.t > rp0.t, `t ${rp0.t.toFixed(3)} → ${rp1 && rp1.t.toFixed(3)}`);
  ok('幽灵法术存在', rp1 && rp1.ghost, 'ghost=' + (rp1 && rp1.ghost));

  // 相机跟随：相机位置应随回放变化，且不与玩家相机重合
  const camA = await ev('({x:cam.pos.x,y:cam.pos.y,z:cam.pos.z})');
  await sleep(220);
  const camB = await ev('({x:cam.pos.x,y:cam.pos.y,z:cam.pos.z})');
  const camMoved = Math.hypot(camB.x - camA.x, camB.y - camA.y, camB.z - camA.z);
  ok('摄像头跟随法术移动', camMoved > 1, `相机位移 ${camMoved.toFixed(2)}`);

  // 跳过回放：点击
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1 });
  await sleep(80);
  ok('点击可跳过回放', await ev('game.replay===null'), 'replay=' + await ev('game.replay'));

  // 死亡界面保留凶手与 lastReplay（可重看）
  ok('死亡界面保留凶手', await ev('game.killer&&game.killer.skill==="fire"'), 'killer.skill=' + await ev('game.killer&&game.killer.skill'));
  ok('重看数据已保存', await ev('!!game.lastReplay'), 'lastReplay=' + await ev('!!game.lastReplay'));

  // 空格重看：重建回放
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(80);
  ok('空格重看击杀回放', await ev('!!game.replay'), 'replay=' + await ev('!!game.replay'));

  // 非弹丸来源（Boss 光柱）：不回放但仍记录凶手
  await ev(`(() => {game.replay=null;game.over=false;player.hp=1;player.inv=0;
    hurtPlayer(999,{from:{ident:{skill:'beam',caster:'boss'}}});return true;})()`);
  await sleep(60);
  const kb = await ev('game.killer&&game.killer.skill');
  ok('非弹丸致命伤仍记录凶手', kb === 'beam', 'killer.skill=' + kb);
  ok('非弹丸不触发回放', await ev('game.replay===null'), 'replay=' + await ev('game.replay'));

  ok('运行期零异常', errors.length === 0, errors.length ? errors[0].slice(0, 120) : '0 exceptions');
  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`);
  ws.close();
  if (results.some(x => !x)) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
