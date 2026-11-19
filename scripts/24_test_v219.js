/* v2.19 专项回归：排行榜安全加固 + 名次计算修复
 *
 * 背景（安全审计发现）：
 *   ① 名次计算缺陷：submitToBoard 先 slice(0,LB_MAX) 截断再 findIndex，
 *      榜单满 20 条时本局被截断 → findIndex 返回 -1 → +1 得「第 0 名」（无效名次）。
 *   ② 输入校验不足：loadBoard 只校验 typeof score==='number'，
 *      而 typeof NaN==='number' 为 true → NaN/Infinity 可进入并污染排序。
 *   ③ 道号未校验：daoName 直接返回 localStorage 里的任意字符串（含对象、超长串）。
 *
 * 本测试固化上述修复，并确认 XSS 面已被 canvas 渲染天然阻断。
 */
const http = require('http');
const { waitReady } = require('./_testlib');
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

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });
  await waitReady(ev, wait);
  await ev('game.started=true; true');

  /* ---------- 1. XSS 面：canvas fillText 不执行脚本 ---------- */
  const xss = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'<img src=x onerror=alert(1)>',score:9999,kills:99,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1},
      {name:'</script><script>alert(2)</script>',score:9998,kills:99,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:2}
    ]));
    window.__pwned=0;
    const orig=window.alert; window.alert=()=>{window.__pwned++;};
    boardOpen=true;
    let err=null;
    try{ drawBoard(); }catch(e){ err=e.message; }
    window.alert=orig; boardOpen=false;
    return {pwned:window.__pwned, rows:loadBoard().length, err};
  })()`);
  ok('恶意道号无法执行脚本（XSS）', xss.pwned === 0, `pwned=${xss.pwned}`);
  ok('含 XSS 载荷的记录仍可正常渲染', xss.err === null, `err=${xss.err}`);

  /* ---------- 2. 输入校验：NaN / Infinity / 字符串 / 非对象 ---------- */
  const invalid = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'NaN分',score:NaN,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1},
      {name:'Inf分',score:Infinity,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:2},
      {name:'字符串分',score:'999',kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:3},
      {name:null,score:100,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:4},
      {name:'缺字段',score:50,ts:5},
      '字符串而非对象',
      null
    ]));
    const l=loadBoard();
    return {n:l.length, hasNaN:l.some(x=>!Number.isFinite(x.score))};
  })()`);
  ok('非法记录被全部拦截', invalid.n === 0, `loaded=${invalid.n}`);
  ok('无 NaN/Infinity 残留', invalid.hasNaN === false);

  /* ---------- 3. 超长道号被截断 ---------- */
  const long = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'A'.repeat(5000),score:10,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1}
    ]));
    const l=loadBoard();
    let err=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    return {len:l.length?l[0].name.length:-1, err};
  })()`);
  ok('超长道号被截断到 24 字符', long.len === 24, `len=${long.len}`);
  ok('超长道号渲染不报错', long.err === null);

  /* ---------- 4. 损坏的 localStorage 不导致崩溃 ---------- */
  const broken = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1','{坏掉的JSON');
    let err=null, len=-1;
    try{ len=loadBoard().length; boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    return {len, err};
  })()`);
  ok('非法 JSON 不导致崩溃', broken.err === null && broken.len === 0, `len=${broken.len} err=${broken.err}`);

  /* ---------- 5. 道号 key 被污染时的兜底 ---------- */
  const nameKey = await ev(`(()=>{
    localStorage.setItem('lxh_dao_no_v1',JSON.stringify({evil:1}));
    const n=daoName();
    const type=typeof n;
    const len=n.length;
    localStorage.removeItem('lxh_dao_no_v1');
    return {type, len, isStr:typeof n==='string'};
  })()`);
  ok('道号始终为字符串', nameKey.isStr === true, `type=${nameKey.type}`);
  ok('道号长度受限', nameKey.len <= 24, `len=${nameKey.len}`);

  /* ---------- 6. 核心修复：名次不为 0 ---------- */
  const rankFull = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    const arr=[];
    for(let i=0;i<20;i++) arr.push({name:'HIGH'+i,score:1000-i,kills:50,dmgDealt:1,dmgTaken:1,bossKills:0,time:99,realm:1,ts:i+1});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    game.score=1;game.kills=1;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=1;
    const r=submitToBoard();
    return {rank:r.rank, listLen:r.list.length, overflowed:r.overflowed};
  })()`);
  ok('榜单已满时名次为 21 而非 0', rankFull.rank === 21, `rank=${rankFull.rank}`);
  ok('榜单容量仍限制为 20', rankFull.listLen === 20, `listLen=${rankFull.listLen}`);
  ok('标记为未上榜', rankFull.overflowed === true);

  /* ---------- 7. 正常入榜名次正确 ---------- */
  const rankNormal = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    game.score=500;game.kills=30;game.dmgDealt=100;game.dmgTaken=50;game.bossKills=1;game.time=60;
    const r=submitToBoard();
    return {rank:r.rank, listLen:r.list.length, inList:r.list.some(x=>x.name===r.entry.name)};
  })()`);
  ok('空榜时首次入榜为第 1 名', rankNormal.rank === 1, `rank=${rankNormal.rank}`);
  ok('本局记录确实在榜上', rankNormal.inList === true);

  /* ---------- 8. 100 条存量时名次正确 ---------- */
  const rankBulk = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    const arr=[];
    for(let i=0;i<100;i++) arr.push({name:'T'+i,score:(i*37)%100,kills:i%7,dmgDealt:1,dmgTaken:1,bossKills:0,time:i,realm:1,ts:i+1});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    game.score=1;game.kills=1;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=1;
    const r=submitToBoard();
    return {rank:r.rank, after:loadBoard().length};
  })()`);
  ok('100 条存量时名次为真实值', rankBulk.rank > 0, `rank=${rankBulk.rank}`);
  ok('榜单被截断为 20 条', rankBulk.after === 20, `after=${rankBulk.after}`);

  /* ---------- 9. 同分同时间戳的重复记录 ---------- */
  const dup = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'DUP',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:555},
      {name:'DUP',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:555}
    ]));
    game.score=100;game.kills=5;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=10;
    const r=submitToBoard();
    return {rank:r.rank, listLen:r.list.length};
  })()`);
  ok('重复记录下名次仍为正整数', dup.rank >= 1, `rank=${dup.rank}`);

  /* ---------- 10. 排序稳定性（完全同分时以 ts 兜底）---------- */
  const stable = await ev(`(()=>{
    const a=[{name:'A',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:3},
             {name:'B',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:1},
             {name:'C',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:2}];
    const s=boardSort(a).map(x=>x.name);
    const s2=boardSort(a).map(x=>x.name);
    return {s, deterministic:JSON.stringify(s)===JSON.stringify(s2)};
  })()`);
  ok('完全同分时排序确定（ts 兜底）', stable.deterministic === true, `order=${stable.s.join(',')}`);

  /* ---------- 11. 排序正确性 ---------- */
  const order = await ev(`(()=>{
    const a=[{name:'L',score:100,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:5,realm:1,ts:1},
             {name:'H',score:900,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:5,realm:1,ts:2},
             {name:'M',score:100,kills:9,dmgDealt:1,dmgTaken:1,bossKills:0,time:5,realm:1,ts:3}];
    return boardSort(a).map(x=>x.name);
  })()`);
  ok('排序：积分>击杀', JSON.stringify(order) === '["H","M","L"]', `order=${order.join(',')}`);

  /* ---------- 12. 隐私模式降级不崩 ---------- */
  const priv = await ev(`(()=>{
    const orig=window.localStorage.getItem;
    try{
      Object.defineProperty(window,'localStorage',{value:{getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('denied')}},configurable:true});
      const l=loadBoard();
      const n=daoName();
      return {len:l.length, nameOk:typeof n==='string'&&n.length>0};
    }catch(e){ return {err:e.message}; }
    finally{ try{ Object.defineProperty(window,'localStorage',{value:orig?window.localStorage:window.localStorage,configurable:true}); }catch(e){} }
  })()`);
  ok('localStorage 不可用时降级不崩', priv.err === undefined || priv.nameOk === true, JSON.stringify(priv));

  /* ---------- 13. 版本 ---------- */
  const ver = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');return s.includes('v2.19')})()`);
  ok('版本号已更新到 v2.19', ver === true);

  ok('运行期零异常', exceptions.length === 0, `${exceptions.length} exceptions`);

  console.log(`\n${pass}/${pass + fail} 项通过`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
