/* 拆分 drawTerrain 各层耗时（中位数，减少 GC 抖动） */
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
  const expr = `(() => {
    QUALITY.adaptive = 0; QUALITY.terrPx = 26; QUALITY.terrMax = 3;
    const med = a => a.sort((x, y) => x - y)[1];
    const once = () => { const t0 = performance.now(); for (let i = 0; i < 15; i++) drawTerrain(); return (performance.now() - t0) / 15; };
    const run = () => med([once(), once(), once()]);
    const f1 = drawCellFlowers, f2 = drawCellGrass, f3 = drawCellTrees;
    run(); const full = run();
    drawCellFlowers = () => {}; run(); const noF = run(); drawCellFlowers = f1;
    drawCellGrass = () => {}; run(); const noG = run(); drawCellGrass = f2;
    drawCellTrees = () => {}; run(); const noT = run(); drawCellTrees = f3;
    drawCellFlowers = () => {}; drawCellGrass = () => {}; drawCellTrees = () => {}; run(); const bare = run();
    drawCellFlowers = f1; drawCellGrass = f2; drawCellTrees = f3;
    const f = d => +d.toFixed(2);
    return JSON.stringify({ full: f(full), noFlowers: f(noF), noGrass: f(noG), noTrees: f(noT), bare: f(bare),
      costFlowers: f(full - noF), costGrass: f(full - noG), costTrees: f(full - noT) });
  })()`;
  const r = await ev(expr);
  console.log(r.result.result.value || JSON.stringify(r.result));
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
