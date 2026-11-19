/* 线上最终验证：v2.19 全特性真实浏览器实测 */
const http = require('http');
const fs = require('fs');
const CDP = 9223;
const SHARE = 'https://xianjian-kongduodi.app.workbuddy.host/?sharecode=ASJWDZ6E6D';

function get(p, m = 'GET') {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: CDP, path: p, method: m, agent: false, headers: { Connection: 'close' } }, (r) => {
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
    if (r.result && r.result.exceptionDetails) return 'EXC:' + ((r.result.exceptionDetails.exception || {}).description || '');
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: SHARE });
  await wait(6000);
  for (let i = 0; i < 50; i++) {
    if (await ev('typeof game!=="undefined"&&!!game&&!!player').catch(() => false)) break;
    await wait(200);
  }

  const R = {};
  // 注意：不能用 /v2\.\d+/ 全局首个匹配 —— 源码注释里也有 v2.16 等字样。
  // 必须精确匹配标题绘制语句 L('title')+' v2.XX'。
  R.version = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');
    const i=s.indexOf("L('title')+"); if(i<0) return '?';
    const m=s.slice(i,i+60).match(/v2[.][0-9]+/); return m?m[0]:'?'})()`);
  console.log('版本:', R.version);

  R.sprites = await ev(`(()=>{const o={};for(const k in sprites)o[k]=sprites[k].naturalWidth;return o})()`);
  console.log('精灵解码宽度:', JSON.stringify(R.sprites));

  await ev(`(()=>{game.started=true;game.over=false;player.hp=50;player.lastHit=game.time;window.__c=setInterval(()=>{enemies.length=0;bolts.length=0;},30);return true})()`);
  const h1 = await ev('player.hp'); await wait(800); const h2 = await ev('player.hp');
  R.regen = h2 > h1;
  console.log('受击期间回血:', h1.toFixed(2), '->', h2.toFixed(2), R.regen);

  R.boss = await ev(`(()=>{
    enemies.length=0; game.kills=5; game.bossWave=0;
    if(!hasBossAlive()&&game.kills>=(game.bossWave+1)*BOSS_SPAWN_EVERY){spawnEnemy(true,{forward:true});game.bossWave++;}
    const b1=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    const boss=enemies.find(e=>e.type==='boss');
    if(boss) hurtEnemy(boss,99999);
    const b2=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    game.kills=10;
    if(!hasBossAlive()&&game.kills>=(game.bossWave+1)*BOSS_SPAWN_EVERY){spawnEnemy(true,{forward:true});game.bossWave++;}
    const b3=enemies.filter(e=>e.type==='boss'&&e.hp>0).length;
    return {first:b1,afterKill:b2,reborn:b3,wave:game.bossWave};
  })()`);
  console.log('Boss 重生:', JSON.stringify(R.boss));

  await ev('clearInterval(window.__c); localStorage.removeItem("lxh_lianqi_lb_v1"); true');
  R.lb = await ev(`(()=>{
    game.score=880;game.kills=42;game.dmgDealt=9100;game.dmgTaken=2100;game.bossKills=3;game.time=150;
    const r=submitToBoard();
    return {rank:r.rank, name:r.entry.name, len:loadBoard().length, isNew:r.isNewRecord};
  })()`);
  console.log('排行榜入榜:', JSON.stringify(R.lb));

  R.rankFull = await ev(`(()=>{
    const arr=[];for(let i=0;i<20;i++)arr.push({name:'H'+i,score:5000-i,kills:99,dmgDealt:1,dmgTaken:1,bossKills:0,time:99,realm:1,ts:i+1});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    game.score=1;game.kills=1;game.dmgDealt=1;game.dmgTaken=1;game.bossKills=0;game.time=1;
    const r=submitToBoard();
    return {rank:r.rank, overflowed:r.overflowed};
  })()`);
  console.log('满榜名次:', JSON.stringify(R.rankFull));

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
  await wait(600);
  R.lbOpen = await ev('boardOpen');
  console.log('L 键开榜:', R.lbOpen);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/src/flight/others/mvp_v220_live_final.png', Buffer.from(s.result.data, 'base64'));

  R.guard = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'<img src=x onerror=alert(1)>',score:NaN,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1}
    ]));
    window.__pwned=0; const oa=window.alert; window.alert=()=>{window.__pwned++;};
    let err=null; try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    window.alert=oa;
    return {loaded:loadBoard().length, pwned:window.__pwned, err};
  })()`);
  console.log('恶意数据拦截:', JSON.stringify(R.guard));

  /* ---------- v2.20：分页 ---------- */
  R.page = await ev(`(()=>{
    const arr=[];
    for(let i=0;i<20;i++)arr.push({name:'P'+String(i+1).padStart(2,'0'),score:2000-i*37,kills:50-i,
      dmgDealt:9000-i*211,dmgTaken:820-i*13,bossKills:i%4,time:120-i,realm:1+(i%6),ts:1000+i});
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
    boardPage=0; const v=boardView();
    return {per:v.perPage, pages:v.totalPages, rows:v.rows, start:v.start,
            allOnOnePage:v.rows===20 && v.totalPages===1};
  })()`);
  console.log('分页（v2.20）:', JSON.stringify(R.page));

  await ev('boardOpen=true; boardPage=0; true');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await wait(400);
  R.pageKey = await ev('boardPage');
  console.log('↓ 翻页:', R.pageKey);
  await ev('boardOpen=false; true');
  await wait(400);   // 等下一帧 render() 把提示条恢复
  R.tip = await ev(`(()=>{const t=document.getElementById('tip');return t?t.style.display:'none'})()`);
  console.log('提示条状态（关闭榜单后）:', JSON.stringify(R.tip));

  /* 榜单打开时提示条应隐藏，否则会压住底部的页码与翻页提示 */
  await ev('boardOpen=true; true');
  await wait(400);
  R.tipOpen = await ev(`(()=>{const t=document.getElementById('tip');return t?t.style.display:'none'})()`);
  console.log('提示条状态（榜单打开时）:', JSON.stringify(R.tipOpen));
  await ev('boardOpen=false; true');

  R.exceptions = exc.length;
  console.log('运行期异常:', exc.length);
  console.log('\n结论:', JSON.stringify(R));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
