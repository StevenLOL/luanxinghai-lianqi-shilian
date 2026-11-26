/* 在现有调试页面内强制重载（忽略缓存），避免反复开关标签页导致浏览器退出。 */
const http = require('http');
const WS = globalThis.WebSocket;
function get(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path: p, agent: false, headers: { Connection: 'close' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d ? JSON.parse(d) : null)); });
    r.on('error', rej); r.end();
  });
}
(async () => {
  const list = await get('/json/list');
  const pg = list.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!pg) throw new Error('no page');
  const ws = new WS(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
  await new Promise(r => setTimeout(r, 2500));
  ws.close();
  console.log('reloaded', pg.id);
})();
