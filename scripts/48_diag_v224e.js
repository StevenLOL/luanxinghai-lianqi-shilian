/* v2.24e 诊断：页面加载是否有 JS 异常、细胞/树木/花朵数量、帧率 */
const http = require('http');
const WS = globalThis.WebSocket;

function get(p, m = 'GET') {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path: p, method: m, agent: false, headers: { Connection: 'close' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d ? JSON.parse(d) : null)); });
    r.on('error', rej); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await get('/json/list');
  const pg = list.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!pg) throw new Error('no page');
  const ws = new WS(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + JSON.stringify(m.params.args.map(a => a.value || a.description)));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails) };
    return r.result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(3500);
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  const st = await ev(`(()=>{
    if(typeof drawTerrain!=='function') return {boot:'no drawTerrain'};
    const cs=drawTerrain._cells||null;
    const trees=cs?cs.filter(c=>c.tree).length:-1;
    const treeSum=cs?cs.reduce((a,c)=>a+(c.tree|0),0):-1;
    return {boot:'ok',cells:cs?cs.length:-1,treeCells:trees,treeSum,treesFlag:QUALITY.trees,
      step:QUALITY.step,adaptive:QUALITY.adaptive,qualityKeys:Object.keys(QUALITY)};
  })()`);
  console.log('state:', JSON.stringify(st));
  const fps = await ev(`new Promise(res=>{let n=0;const t0=performance.now();const loop=()=>{n++;if(performance.now()-t0<2000)requestAnimationFrame(loop);else res(+(n/((performance.now()-t0)/1000)).toFixed(1));};requestAnimationFrame(loop);})`);
  console.log('fps:', fps);
  ws.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
