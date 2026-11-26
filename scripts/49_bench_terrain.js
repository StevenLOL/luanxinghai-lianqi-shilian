/* 细分档位 A/B：同一视角下测 drawTerrain 耗时与整体帧率 */
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
  const ws = new WS(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const ev = x => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } })); });
  const run = async (px, max) => {
    const out = await ev(`(async()=>{
      QUALITY.adaptive=0;QUALITY.terrPx=${px};QUALITY.terrMax=${max};
      await new Promise(r=>requestAnimationFrame(r));
      const t0=performance.now();
      for(let i=0;i<25;i++)drawTerrain();
      const ms=+((performance.now()-t0)/25).toFixed(2);
      let n=0;const f0=performance.now();
      await new Promise(res=>{const loop=()=>{n++;if(performance.now()-f0<1500)requestAnimationFrame(loop);else res();};requestAnimationFrame(loop);});
      return {ms, fps:+(n/((performance.now()-f0)/1000)).toFixed(1)};
    })()`);
    return out.result.result.value;
  };
  for (const [px, max] of [[26, 3], [18, 4], [14, 5], [11, 6]]) {
    const r = await run(px, max);
    console.log(`terrPx=${px} max=${max} -> drawTerrain ${r.ms}ms, fps ${r.fps}`);
  }
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
