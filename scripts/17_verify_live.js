/* 线上部署验证：加载真实分享链接，检查精灵图是否真的渲染成功
 * 验证重点：分享链接的 sharecode 在 query 上，相对路径 assets/ 请求会丢 query → 403
 */
const { spawn } = require('child_process');
const http = require('http');

const SHARE = process.argv[2] || 'https://xianjian-kongduodi.app.workbuddy.host/?sharecode=ASJWDZ6E6D';
const CDP_PORT = 9223;

function httpJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const list = await httpJson(CDP_PORT, '/json/list');
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  await new Promise((r) => ws.onopen = r);
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');

  // 记录所有请求的响应状态
  const responses = {};
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Network.responseReceived') {
      responses[msg.params.response.url] = msg.params.response.status;
    }
  });

  await send('Page.navigate', { url: SHARE });
  await new Promise((r) => setTimeout(r, 6000));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };

  const report = await evalJs(`(() => {
    const out = { sprites: {}, ready: null, loadingHidden: null, title: null, errs: [] };
    out.title = document.title;
    try { out.ready = spritesReady; } catch(e) { out.ready = 'undefined'; }
    const l = document.getElementById('loading');
    out.loadingHidden = l ? (l.style.display === 'none') : 'no-el';
    for (const k in sprites) {
      const im = sprites[k];
      out.sprites[k] = { complete: im.complete, w: im.naturalWidth, h: im.naturalHeight, src: im.src };
    }
    return JSON.stringify(out);
  })()`);

  console.log('=== 页面报告 ===');
  console.log(report ? JSON.stringify(JSON.parse(report), null, 2) : report);

  console.log('\n=== 资源请求状态码 ===');
  Object.entries(responses).forEach(([u, s]) => {
    if (u.includes('assets/') || u.endsWith('.png')) console.log(`  ${s}  ${u.split('?')[0].split('/').pop()}`);
  });

  const bad = Object.entries(responses).filter(([u, s]) => s >= 400);
  console.log('\n=== 4xx/5xx 请求 ===');
  console.log(bad.length ? bad.map(([u, s]) => `  ${s} ${u}`).join('\n') : '  无');

  const ex = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  console.log('\n=== 运行期异常 ===');
  console.log(ex.length ? JSON.stringify(ex).slice(0, 600) : '  0 exceptions');

  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
