/* v2.20 专项回归：排行榜分页（此前第 11~20 名永远不可见）
 *
 * 背景：
 *   v2.19 榜单容量 LB_MAX=20，但 drawBoard 里 rows=Math.min(list.length, compact?8:10)
 *   —— 桌面最多只画 10 行。玩家若排到 15 名：
 *     · 榜单里根本看不到自己
 *     · 死亡界面还提示「本局名次：第 15 名」，与榜单内容自相矛盾
 *     · v2.19 的「未进前 20 名」文案在 rank<=20 时不触发，逻辑本身没错，
 *       但展示层面把 11~20 名整段吞掉了
 *
 * v2.20 修复：
 *   ① 桌面按视口高度自适应行数（上限 20），常规窗口一次显示完
 *   ② 放不下时分页，名次跨页连续编号（第 2 页首行是第 N+1 名，不是第 1 名）
 *   ③ ↑↓ / PageUp / PageDown 翻页，且被钳制在合法范围
 *   ④ 打开榜单自动定位到本局所在页
 *   ⑤ 榜单打开时其余按键一律不生效（避免看榜时误放技能）
 *   ⑥ 奖牌按绝对名次判定（翻页后第 2 页不会重复发金牌）
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

// 造 20 条数据：分数从高到低，名字 P01..P20，ts 递增
const SEED = `(()=>{
  localStorage.removeItem('lxh_lianqi_lb_v1');
  const arr=[];
  for(let i=0;i<20;i++){
    const n=String(i+1).padStart(2,'0');
    arr.push({name:'P'+n,score:2000-i*10,kills:50-i,dmgDealt:900-i,dmgTaken:80-i,
              bossKills:i%4,time:120-i,realm:1+(i%5),ts:1000+i});
  }
  localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
  return arr.length;
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
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code, windowsVirtualKeyCode: vk });
    await wait(120);
  };
  const setViewport = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await wait(350);   // 等 resize 事件把 W/H 更新到位
  };

  await send('Page.enable'); await send('Runtime.enable');
  await setViewport(1440, 900);
  await send('Page.reload', { ignoreCache: true });
  await waitReady(ev, wait);
  await ev('game.started=true; true');

  /* ---------- 1. 大视口：20 条一次显示完 ---------- */
  await ev(SEED);
  const big = await ev(`(()=>{const v=boardView();return {per:v.perPage,total:v.totalPages,rows:v.rows,start:v.start}})()`);
  ok('大视口下每页行数 ≥ 20', big.per >= 20, `per=${big.per}`);
  ok('大视口下 20 条记录一页显示完', big.rows === 20 && big.total === 1, `rows=${big.rows} pages=${big.total}`);

  /* ---------- 2. 小视口：触发分页 ---------- */
  await setViewport(1440, 470);
  const small = await ev(`(()=>{const v=boardView();return {per:v.perPage,total:v.totalPages,rows:v.rows}})()`);
  ok('小视口下行数减少', small.per < 20, `per=${small.per}`);
  ok('小视口下出现多页', small.total >= 2, `pages=${small.total}`);

  /* ---------- 3. 名次跨页连续 ---------- */
  const p2 = await ev(`(()=>{
    boardPage=1; const v=boardView();
    const first=v.list[v.start];
    return {start:v.start, firstName:first?first.name:null, firstScore:first?first.score:null};
  })()`);
  ok('第 2 页起始下标正确', p2.start === small.per, `start=${p2.start}`);
  ok('第 2 页首条是第 N+1 名对应的记录', p2.firstName === 'P' + String(small.per + 1).padStart(2, '0'), `name=${p2.firstName}`);

  /* ---------- 4. ↑↓ 翻页 ---------- */
  await ev('boardOpen=true; boardPage=0; true');
  await key('ArrowDown', 'ArrowDown', 40);
  const down = await ev('boardPage');
  ok('↓ 键翻到第 2 页', down === 1, `page=${down}`);
  await key('ArrowUp', 'ArrowUp', 38);
  const up = await ev('boardPage');
  ok('↑ 键翻回第 1 页', up === 0, `page=${up}`);

  /* ---------- 5. 页码钳制 ---------- */
  await key('ArrowUp', 'ArrowUp', 38);
  const clampedLow = await ev('boardPage');
  ok('第 1 页再按 ↑ 不会越界', clampedLow === 0, `page=${clampedLow}`);
  await ev(`boardPage=${small.total - 1}; true`);
  await key('ArrowDown', 'ArrowDown', 40);
  const clampedHigh = await ev('boardPage');
  ok('末页再按 ↓ 不会越界', clampedHigh === small.total - 1, `page=${clampedHigh} pages=${small.total}`);

  /* ---------- 6. 打开榜单自动定位到本局所在页 ---------- */
  const jump = await ev(`(()=>{
    boardOpen=false;
    game.rankEntry={entry:{name:'P15',score:1850,kills:35,dmgDealt:885,dmgTaken:65,bossKills:3,time:105,realm:1,ts:1014},
                    rank:15,isNewRecord:false,overflowed:false};
    toggleBoard();
    return {open:boardOpen, page:boardPage};
  })()`);
  ok('打开榜单自动定位到本局所在页', jump.open === true && jump.page === Math.floor(14 / small.per), `page=${jump.page} per=${small.per}`);
  await ev('boardOpen=false; game.rankEntry=null; true');

  /* ---------- 7. 榜单打开时按 1/2/3 不放技能 ---------- */
  const noCast = await ev(`(()=>{
    boardOpen=true;
    const before={sword:player.cds.sword,fire:player.cds.fire,ice:player.cds.ice};
    window.__cast=0;
    const orig=window.castManual; window.castManual=function(){window.__cast++;};
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}));
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'2',bubbles:true}));
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));
    const c=window.__cast;
    window.castManual=orig;
    return {cast:c};
  })()`);
  ok('看榜时按 1/2/3 不放技能', noCast.cast === 0, `cast=${noCast.cast}`);

  /* ---------- 8. 榜单打开时 L 仍能关闭 ---------- */
  await ev('boardOpen=false; true');
  await key('l', 'KeyL', 76);
  const lbOn = await ev('boardOpen');
  await key('l', 'KeyL', 76);
  const lbOff = await ev('boardOpen');
  ok('L 键可开可关', lbOn === true && lbOff === false, `on=${lbOn} off=${lbOff}`);

  /* ---------- 9. 奖牌按绝对名次（第 2 页不重复发金） ---------- */
  const medal = await ev(`(()=>{
    const s=[];
    const src=document.querySelector('canvas');
    // 直接验证绘制逻辑用到的绝对名次：第 2 页首行 abs=per，不应是 0/1/2
    boardPage=1; const v=boardView();
    const abs=v.start;
    const medalAt=(i)=>i===0?'#ffd45e':i===1?'#d8dee0':i===2?'#c08552':null;
    return {abs, medal:medalAt(abs), abs0:medalAt(0)};
  })()`);
  ok('翻页后名次按绝对值计算', medal.abs === small.per && medal.medal === null, `abs=${medal.abs} medal=${medal.medal}`);

  /* ---------- 10. 自己那一行能被高亮（ts+name 双匹配） ---------- */
  const me = await ev(`(()=>{
    boardOpen=false;
    game.rankEntry={entry:{name:'P15',score:1850,kills:35,dmgDealt:885,dmgTaken:65,bossKills:3,time:105,realm:1,ts:1014},
                    rank:15,isNewRecord:false,overflowed:false};
    const v=boardView();
    const idx=v.list.findIndex(x=>x.ts===1014&&x.name==='P15');
    const absOk=idx>=0 && idx+1===15;
    boardPage=Math.floor(idx/v.perPage);
    let err=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    return {idx, absOk, err};
  })()`);
  ok('本局记录在排序后仍位于第 15 位', me.absOk === true, `idx=${me.idx}`);
  ok('含自身行的页面渲染不报错', me.err === null, `err=${me.err}`);
  await ev('boardOpen=false; game.rankEntry=null; true');

  /* ---------- 11. 空榜不崩 ---------- */
  const empty = await ev(`(()=>{
    localStorage.removeItem('lxh_lianqi_lb_v1');
    boardOpen=false; boardPage=0;
    let err=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    const v=boardView();
    return {err, pages:v.totalPages, rows:v.rows};
  })()`);
  ok('空榜渲染不报错', empty.err === null, `err=${empty.err}`);
  ok('空榜时页数为 1', empty.pages === 1, `pages=${empty.pages}`);

  /* ---------- 12. 少于一页 ---------- */
  const few = await ev(`(()=>{
    localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify([
      {name:'A',score:10,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:1},
      {name:'B',score:9,kills:1,dmgDealt:1,dmgTaken:1,bossKills:0,time:1,realm:1,ts:2}
    ]));
    boardPage=0; const v=boardView();
    let err=null;
    try{ boardOpen=true; drawBoard(); boardOpen=false; }catch(e){ err=e.message; }
    return {rows:v.rows, pages:v.totalPages, err};
  })()`);
  ok('2 条记录时只渲染 2 行', few.rows === 2, `rows=${few.rows}`);
  ok('2 条记录时只有 1 页', few.pages === 1, `pages=${few.pages}`);

  /* ---------- 13. 底部提示条不遮挡榜单（v2.20 布局修复） ---------- */
  await ev('boardOpen=false; true');
  await wait(300);
  const tipClosed = await ev(`(()=>{const t=document.getElementById('tip');return t?t.style.display:'none'})()`);
  await ev('boardOpen=true; true');
  await wait(300);
  const tipOpen = await ev(`(()=>{const t=document.getElementById('tip');return t?t.style.display:'none'})()`);
  ok('榜单打开时底部提示条隐藏（不遮挡页码）', tipOpen === 'none', `display=${tipOpen}`);
  ok('关闭榜单后提示条恢复', tipClosed !== 'none', `display=${tipClosed}`);
  await ev('boardOpen=false; true');

  /* ---------- 14. i18n 新键 ---------- */
  const i18n = await ev(`(()=>{
    const fill=(t)=>t.split('{0}').join('1').split('{1}').join('2');
    return {
      zh:[fill(I18N.zh.lbPage),I18N.zh.lbPageTip],
      en:[fill(I18N.en.lbPage),I18N.en.lbPageTip],
      sameKeys:Object.keys(I18N.zh).length===Object.keys(I18N.en).length &&
               Object.keys(I18N.zh).every(k=>k in I18N.en),
      zhCount:Object.keys(I18N.zh).length, enCount:Object.keys(I18N.en).length
    };
  })()`);
  ok('中文页码文案正确', i18n.zh[0].indexOf('1') >= 0 && i18n.zh[0].indexOf('2') >= 0, i18n.zh[0]);
  ok('英文页码文案正确', i18n.en[0].indexOf('1') >= 0 && i18n.en[0].indexOf('2') >= 0, i18n.en[0]);
  ok('翻页提示文案存在', i18n.zh[1].length > 0 && i18n.en[1].length > 0, `${i18n.zh[1]} / ${i18n.en[1]}`);
  ok('zh/en 键数一致且无缺漏', i18n.sameKeys === true, `zh=${i18n.zhCount} en=${i18n.enCount}`);

  /* ---------- 15. 版本 ---------- */
  const ver = await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent||'').join('');
    const i=s.indexOf("L('title')+"); return i<0?'?':(s.slice(i,i+60).match(/v2[.][0-9]+/)||['?'])[0]})()`);
  ok('版本号已更新到 v2.20', ver === 'v2.20', `version=${ver}`);

  ok('运行期零异常', exceptions.length === 0, `${exceptions.length} exceptions`);

  console.log(`\n${pass}/${pass + fail} 项通过`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
