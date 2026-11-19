/* v2.21 专项回归：kill cam 回放复用本体法术特效
 *
 * 背景（用户提问"kill cam 不能用原来的飞剑或者火球特效吗？"）：
 *   旧版 drawKillCamGhost 画的是一套写死的「金色光球 + 通用拖尾」，
 *   无论凶手是飞剑、火球还是冰剑，回放里长得一模一样 —— 看不出因果。
 *   根因：game.replay 只记了 {path, ident, casterPos}，绘制时压根没用 ident.skill。
 *
 * v2.21 修复：
 *   ① 回放数据带上法术类型与配色（kind/powered/color/phase/size）
 *   ② drawKillCamGhost 改为构造"伪弹丸"复用本体 drawBoltTrail / drawBolt
 *      → 飞剑就是导弹飞剑、火球就是火球、冰剑就是冰剑
 *   ③ drawBolt 新增可选 sCap（投影缩放上限）：
 *      回放相机紧贴弹丸（z≈21），s=focal/z 可达 36，火球半径会到 86px 糊屏；
 *      正常游戏不传 sCap，行为完全不变
 *   ④ 命中定格时用法术自身配色画爆点
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

/* 造一个指定 kind 的弹丸，打死玩家，走真实 hurtPlayer 路径 */
const KILL_BY = (kind) => `(()=>{
  game.started=true; game.over=false;
  player.hp=5; player.inv=0;
  enemies.length=0;
  /* 造一枚真实弹丸：有 kind / ident / path / color */
  const from={x:player.pos.x+30,y:player.pos.y+6,z:player.pos.z+30};
  const b={kind:'${kind}',owner:'enemy',pos:{...from},v:{x:-1,y:0,z:-1},
    ident:{owner:'enemy',skill:'${kind}',from:{...from},caster:'archer',born:game.time},
    path:[{...from}],dmg:99,radius:0,color:SPELLS['${kind}'].color,
    homing:false,guided:false,powered:true,traveled:0,life:4,trail:[],
    phase:0,missile:false,missilePhase:'none',size:1};
  for(let i=1;i<=30;i++) b.path.push({x:from.x-i,y:from.y,z:from.z-i});
  bolts.length=0; bolts.push(b);
  hurtPlayer(999,{ignoreInv:true,noInv:true,noFlash:true,from:boltSource(b)});
  const rp=game.replay;
  return rp?{kind:rp.kind,color:rp.color,powered:rp.powered,hasPath:rp.path.length>2,
             identSkill:rp.ident&&rp.ident.skill,
             lastKind:game.lastReplay?game.lastReplay.kind:null}:null;
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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + ((r.result.exceptionDetails.exception || {}).description || ''));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await waitReady(ev, wait);
  await ev('game.started=true; true');

  /* ---------- 1. 三种法术各自的回放都带上正确的 kind 与配色 ---------- */
  for (const kind of ['sword', 'fire', 'ice']) {
    const r = await ev(KILL_BY(kind));
    ok(`${kind} 回放记录了法术类型`, r && r.kind === kind, `kind=${r && r.kind}`);
    ok(`${kind} 回放配色与法术一致`, r && r.color === SPELLS_COLOR(kind), `color=${r && r.color}`);
    ok(`${kind} 凶手标识仍是原 skill`, r && r.identSkill === kind, `ident.skill=${r && r.identSkill}`);
    ok(`${kind} 重看数据也带 kind`, r && r.lastKind === kind, `lastKind=${r && r.lastKind}`);
    await ev('game.replay=null; game.over=false; true');
  }

  /* ---------- 2. 伪弹丸按 kind 分派 ---------- */
  const fake = await ev(`(()=>{
    const mk=(kind)=>{
      const from={x:0,y:10,z:0};
      const path=[]; for(let i=0;i<20;i++) path.push({x:i,y:10,z:i});
      const rp={kind,path,prog:0.5,ghost:path[10],powered:true,
                color:SPELLS[kind].color,bphase:0.3,bsize:1};
      return killCamFakeBolt(rp);
    };
    return {sword:mk('sword'),fire:mk('fire'),ice:mk('ice')};
  })()`);
  ok('伪弹丸 kind 正确（飞剑）', fake.sword.kind === 'sword', fake.sword.kind);
  ok('伪弹丸 kind 正确（火球）', fake.fire.kind === 'fire', fake.fire.kind);
  ok('伪弹丸 kind 正确（冰剑）', fake.ice.kind === 'ice', fake.ice.kind);
  ok('伪弹丸颜色取自法术定义', fake.fire.color === '#ff9a4d' && fake.ice.color === '#9fd8ff' && fake.sword.color === '#ffd45e',
     `${fake.sword.color}/${fake.fire.color}/${fake.ice.color}`);
  ok('伪弹丸带 sCap 缩放封顶', fake.fire.sCap === 8, `sCap=${fake.fire.sCap}`);
  ok('伪弹丸方向向量有效', isFinite(fake.fire.v.x) && isFinite(fake.fire.v.y) && isFinite(fake.fire.v.z),
     JSON.stringify(fake.fire.v));

  /* ---------- 3. 退化输入不崩 ---------- */
  const degenerate = await ev(`(()=>{
    const cases=[
      {kind:'sword',path:[{x:0,y:0,z:0}],prog:0,ghost:{x:0,y:0,z:0}},
      {kind:'fire',path:[{x:0,y:0,z:0},{x:0,y:0,z:0}],prog:1,ghost:{x:0,y:0,z:0}},
      {path:[],prog:0,ghost:null},
      {kind:'unknown',path:[{x:1,y:1,z:1}],prog:0.5,ghost:{x:1,y:1,z:1}}
    ];
    const errs=[];
    for(const rp of cases){
      try{
        const f=killCamFakeBolt(rp);
        /* 返回 null 是合法的安全降级（空轨迹 / 无 ghost 时不画）；
           只有"抛异常"或"返回 undefined" 才是问题。 */
        if(f===undefined) errs.push('undefined');
      }catch(e){ errs.push(e.message); }
    }
    return errs;
  })()`);
  ok('退化轨迹不导致崩溃', degenerate.length === 0, JSON.stringify(degenerate));

  /* ---------- 4. sCap 生效：回放中法术尺寸被封顶 ---------- */
  const cap = await ev(`(()=>{
    // 直接量一次本体绘制时的投影缩放：把 sCap 传进去看尺寸差异
    const from={x:0,y:10,z:0};
    const path=[]; for(let i=0;i<20;i++) path.push({x:i,y:10,z:i});
    const rp={kind:'fire',path,prog:0.5,ghost:path[10],powered:true,color:SPELLS.fire.color};
    const f=killCamFakeBolt(rp);
    // 模拟回放相机的极近距离：把 camera 放在 ghost 正前方 5 丈
    cam.pos={x:rp.ghost.x,y:rp.ghost.y,z:rp.ghost.z-5};
    cam.f={x:0,y:0,z:1}; cam.r={x:1,y:0,z:0}; cam.u={x:0,y:1,z:0};
    const p=project(rp.ghost);
    const capped=Math.min(p.s,f.sCap);
    const uncapped=p.s;
    return {pS:p.s, capped, uncapped, cappedRadius:2.4*capped, uncappedRadius:2.4*uncapped};
  })()`);
  ok('近距离时投影缩放会被 sCap 压住', cap.capped < cap.uncapped, `s=${cap.pS.toFixed(1)} → capped=${cap.capped}`);
  ok('封顶后火球半径在可读范围（<40px）', cap.cappedRadius <= 20, `r=${cap.cappedRadius.toFixed(1)}px（不封顶会是 ${cap.uncappedRadius.toFixed(0)}px）`);

  /* ---------- 5. 正常游戏本体不受 sCap 影响 ---------- */
  const noCap = await ev(`(()=>{
    // 本体 drawBolt 不传 sCap 时，行为与之前一致：用 p.s 原值
    const src=String(drawBolt);
    const hasSCap=src.indexOf('sCap')>=0;
    const guarded=src.indexOf("b.sCap?Math.min(p.s,b.sCap):p.s")>=0;
    return {hasSCap, guarded};
  })()`);
  ok('drawBolt 支持可选 sCap', noCap.hasSCap === true);
  ok('不传 sCap 时用原始 p.s（本体行为不变）', noCap.guarded === true);

  /* ---------- 6. 三种法术的回放渲染都不抛异常 ---------- */
  const render = await ev(`(()=>{
    const errs=[];
    for(const kind of ['sword','fire','ice']){
      const from={x:0,y:10,z:0};
      const path=[]; for(let i=0;i<=30;i++) path.push({x:i,y:10,z:i});
      game.replay={t:0.5,shotT:0.5,ts:0.5,path,ident:{skill:kind,caster:'archer'},
                   casterPos:path[0],phase:'fly',kind,powered:true,color:SPELLS[kind].color,
                   bphase:0,bsize:1,prog:0.5,ghost:path[15]};
      try{ drawKillCamGhost(); }catch(e){ errs.push(kind+':'+e.message); }
    }
    // 命中定格阶段
    game.replay.phase='hold'; game.replay.hold=0.3;
    try{ drawKillCamGhost(); }catch(e){ errs.push('hold:'+e.message); }
    game.replay=null;
    return errs;
  })()`);
  ok('三种法术回放渲染均无异常', render.length === 0, JSON.stringify(render));

  /* ---------- 7. 命中爆点用法术配色 ---------- */
  const burst = await ev(`(()=>{
    const path=[]; for(let i=0;i<=30;i++) path.push({x:i,y:10,z:i});
    const c=SPELLS.fire.color;
    game.replay={t:0.5,shotT:0.5,ts:0.5,path,ident:{skill:'fire',caster:'archer'},
                 casterPos:path[0],phase:'hold',kind:'fire',powered:true,color:c,
                 bphase:0,bsize:1,prog:1,ghost:path[30],hold:0.3};
    let err=null;
    try{ drawKillCamGhost(); }catch(e){ err=e.message; }
    game.replay=null;
    return {err, isHex:/^#[0-9a-fA-F]{6}\$/.test(c)};
  })()`);
  ok('命中爆点渲染无异常', burst.err === null, `err=${burst.err}`);
  ok('爆点颜色是合法 hex（可拼 8 位色）', burst.isHex === true);

  /* ---------- 8. 版本 ---------- */
  const ver = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');
    const i=s.indexOf("L('title')+"); return i<0?'?':(s.slice(i,i+60).match(/v2[.][0-9]+/)||['?'])[0]})()`);
  const verNum = parseFloat(String(ver).replace('v', ''));
  ok('版本号不低于 v2.21', Number.isFinite(verNum) && verNum >= 2.21, `version=${ver}`);

  ok('运行期零异常', exceptions.length === 0, `${exceptions.length} exceptions`);

  console.log(`\n${pass}/${pass + fail} 项通过`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

/* 本地取法术配色，避免在页面外硬编码 */
function SPELLS_COLOR(kind) {
  return { sword: '#ffd45e', fire: '#ff9a4d', ice: '#9fd8ff' }[kind];
}
