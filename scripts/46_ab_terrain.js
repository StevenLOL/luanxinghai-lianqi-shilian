/* 逐层关闭绘制，定位"片状色块"的真实来源：地形填充 / 花朵 / 云。 */
const http = require('http');
const fs = require('fs');
const WS = globalThis.WebSocket;
function get(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path: p, agent: false, headers: { Connection: 'close' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(JSON.parse(d))); });
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
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception)); return r.result.result.value; };
  const shot = async (name, clip) => {
    const s = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync('C:/src/flight/docs/screenshots/' + name, Buffer.from(s.result.data, 'base64'));
    console.log('saved', name);
  };
  for (let i = 0; i < 30; i++) { if (await ev('typeof enemies!=="undefined"&&game.started')) break; await sleep(300); }
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;enemies.length=0;particles.length=0;
    player.pos.x=0;player.pos.z=40;player.pos.y=visualH(0,40)+14;player.heading=0;
    player.dir=facingVec(0);player.targetAlt=14;cam.yaw=0;cam.pitchIdx=1;cam.dist=26;snapCamera();
    game.time=14;
    window.__oc=window.drawClouds;window.__of=window.drawCellFlowers;true`);
  await sleep(800);
  const clip = { x: 420, y: 300, width: 380, height: 240, scale: 3 };
  await shot('_ab_base.png', clip);
  await ev(`drawClouds=()=>{};true`); await sleep(500);
  await shot('_ab_nocloud.png', clip);
  await ev(`drawCellFlowers=()=>{};true`); await sleep(500);
  await shot('_ab_noflower_nocloud.png', clip);
  await ev(`drawClouds=window.__oc;drawCellFlowers=window.__of;true`);
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
