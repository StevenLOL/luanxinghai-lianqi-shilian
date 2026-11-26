/* 高细分对比：把 terrPx/terrMax 拉到很细，看面片是否消失、代价多少 */
const http = require('http');
const WS = globalThis.WebSocket;
const fs = require('fs');
function get(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path: p, agent: false, headers: { Connection: 'close' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d ? JSON.parse(d) : null)); });
    r.on('error', rej); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await get('/json/list');
  const pg = list.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  const ws = new WS(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = x => send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }).then(r => r.result.result.value);

  const px = +(process.argv[2] || 10), mx = +(process.argv[3] || 8);
  console.log(await ev(`(()=>{QUALITY.terrPx=${px};QUALITY.terrMax=${mx};QUALITY.adaptive=0;return 'set '+QUALITY.terrPx+'/'+QUALITY.terrMax})()`));
  await ev(`(()=>{game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=99999;enemies.length=0;bolts.length=0;particles.length=0;
    player.pos.x=0;player.pos.z=40;player.pos.y=visualH(0,40)+12;player.dir=facingVec(0);player.heading=0;
    cam.yaw=0;cam.pitchIdx=2;cam.dist=30;snapCamera();game.time=13;true})()`);
  await sleep(400);
  const t = await ev(`(()=>{const t0=performance.now();for(let i=0;i<12;i++)drawTerrain();return +((performance.now()-t0)/12).toFixed(2)})()`);
  console.log('drawTerrain ms:', t);
  await sleep(200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/src/flight/docs/screenshots/_hi_${px}_${mx}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('saved _hi_' + px + '_' + mx + '.png');
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
