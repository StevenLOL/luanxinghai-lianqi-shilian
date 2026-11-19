/* 排行榜安全审计：构造恶意 localStorage 数据，实测防御是否有效 */
const http = require('http');
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
(async () => {
  const t = await get('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map(); const exc = [];
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && p.has(j.id)) { p.get(j.id)(j); p.delete(j.id); }
    else if (j.method === 'Runtime.exceptionThrown') exc.push(j.params.exceptionDetails);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'EXC:' + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html' });
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 50; i++) {
    if (await ev('typeof game!=="undefined"&&!!game&&!!player').catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await ev('game.started=true;true');

  console.log('===== A. 恶意道号能否注入 HTML/JS =====');
  const A = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'<img src=x onerror=alert(1)>',score:9999,kills:99,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1},
      {name:'</script><script>alert(2)</script>',score:9998,kills:99,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:2}
    ]));
    let pwned=0; window.__pwned=0;
    const origAlert=window.alert; window.alert=()=>{window.__pwned++;};
    boardOpen=true;
    let err=null;
    try{ drawBoard(); }catch(e){ err=e.message; }
    window.alert=origAlert; boardOpen=false;
    return {pwned:window.__pwned, rows:loadBoard().length, err};
  })()`);
  console.log('  结果:', JSON.stringify(A), ' (pwned=0 表示无脚本执行)');

  console.log('\n===== B. 异常类型数据（null/NaN/Infinity/字符串/缺字段）=====');
  const B = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:null,score:100,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1},
      {name:'NaN测试',score:NaN,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:2},
      {name:'Inf测试',score:Infinity,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:3},
      {name:'字符串分数',score:'999',kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:4},
      {name:'缺字段',score:50,ts:5}
    ]));
    const raw=loadBoard();
    let drawErr=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ drawErr=e.message; }
    return {loaded:raw.length, names:raw.map(x=>x.name), drawErr};
  })()`);
  console.log('  结果:', JSON.stringify(B));

  console.log('\n===== C. 超大数值 / 超长字符串 =====');
  const C = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'A'.repeat(5000),score:1e308,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1}
    ]));
    let err=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    const l=loadBoard()[0]||{};
    return {err, nameLen:(l.name||'').length, score:l.score};
  })()`);
  console.log('  结果:', JSON.stringify(C));

  console.log('\n===== D. localStorage 损坏（非法 JSON）=====');
  const D = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1','{坏掉的JSON');
    let err=null, len=-1;
    try{ len=loadBoard().length; boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    return {len, err};
  })()`);
  console.log('  结果:', JSON.stringify(D));

  console.log('\n===== E. 道号 key 被污染 =====');
  const E = await ev(`(()=>{
    localStorage.setItem('lxh_dao_no_v1','<b>x</b>');
    const n=daoName();
    localStorage.setItem('lxh_dao_no_v1',JSON.stringify({evil:1}));
    const n2=daoName();
    localStorage.removeItem('lxh_dao_no_v1');
    return {n, n2, n2Type:typeof n2};
  })()`);
  console.log('  结果:', JSON.stringify(E));

  console.log('\n===== F. 榜单容量截断 =====');
  const F = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    const arr=[];
    for(let i=0;i<100;i++) arr.push({name:'T'+i,score:(i*37)%100,kills:i%7,dmgDealt:1,dmgTaken:1,bossKills:0,time:i,realm:1,ts:i+1});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    const before=loadBoard().length;
    game.score=1;game.kills=1;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=1;
    const r=submitToBoard();
    return {before, after:loadBoard().length, rank:r.rank};
  })()`);
  console.log('  结果:', JSON.stringify(F), ' (after 应<=20)');

  console.log('\n===== G. 排名第 21 名（被截断）时的 rank =====');
  const G = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    const arr=[];
    for(let i=0;i<20;i++) arr.push({name:'HIGH'+i,score:1000-i,kills:50,dmgDealt:1,dmgTaken:1,bossKills:0,time:99,realm:1,ts:i+1});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    game.score=1;game.kills=1;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=1;
    const r=submitToBoard();
    return {rank:r.rank, listLen:r.list.length, inList:r.list.some(x=>x.name===r.entry.name)};
  })()`);
  console.log('  结果:', JSON.stringify(G), ' (rank 应为合法正整数)');

  console.log('\n===== H. 同分同时间戳的名次判定 =====');
  const H = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'DUP',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:555},
      {name:'DUP',score:100,kills:5,dmgDealt:1,dmgTaken:1,bossKills:0,time:10,realm:1,ts:555}
    ]));
    game.score=100;game.kills=5;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=10;
    const r=submitToBoard();
    return {rank:r.rank, listLen:r.list.length};
  })()`);
  console.log('  结果:', JSON.stringify(H));

  console.log('\n===== I. 运行期异常总数 =====');
  console.log('  异常:', exc.length, exc.length ? JSON.stringify(exc).slice(0, 300) : '');
  ws.close(); process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
