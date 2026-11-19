/* v2.20 排行榜分页截图：大视口（20 条一页）+ 小视口（第 2 页） */
const http = require('http');
const fs = require('fs');
const { waitReady } = require('./_testlib');
const URL = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';

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

const SEED = `(()=>{
  localStorage.removeItem('lxh_lianqi_lb_v1');
  const arr=[];
  for(let i=0;i<20;i++){
    const n=String(i+1).padStart(2,'0');
    arr.push({name:'无名散修 '+n,score:2000-i*37,kills:50-i,dmgDealt:9000-i*211,dmgTaken:820-i*13,
              bossKills:i%4,time:120-i,realm:1+(i%6),ts:1000+i});
  }
  localStorage.setItem('lxh_lianqi_lb_v1',JSON.stringify(arr));
  game.started=true; game.over=false;
  return arr.length;
})()`;

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
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(s.result.data, 'base64'));
    console.log('saved', path);
  };

  await send('Page.enable'); await send('Runtime.enable');

  /* 大视口：20 条一页全显示 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await wait(1500);
  await waitReady(ev, wait);
  await ev(SEED);
  await ev('boardOpen=true; boardPage=0; true');
  await wait(700);
  await shot('C:/src/flight/others/mvp_v220_board_full.png');
  const v1 = await ev('(()=>{const v=boardView();return{per:v.perPage,pages:v.totalPages,rows:v.rows}})()');
  console.log('大视口:', JSON.stringify(v1));

  /* 小视口：分页，第 2 页 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 470, deviceScaleFactor: 1, mobile: false });
  await wait(500);
  await ev('boardOpen=true; boardPage=1; true');
  await wait(700);
  await shot('C:/src/flight/others/mvp_v220_board_page2.png');
  const v2 = await ev('(()=>{const v=boardView();return{per:v.perPage,pages:v.totalPages,rows:v.rows,start:v.start}})()');
  console.log('小视口:', JSON.stringify(v2));

  ws.close(); process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
