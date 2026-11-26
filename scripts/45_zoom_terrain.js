/* 局部放大截图：把地面放大 3 倍，检查是否还有格子/色块拼接。 */
const http = require('http');
const fs = require('fs');
const WS = globalThis.WebSocket;

function get(path) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9223, path, agent: false, headers: { Connection: 'close' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(JSON.parse(d))); });
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
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception));
    return r.result.result.value;
  };

  for (let i = 0; i < 30; i++) { if (await ev('typeof enemies!=="undefined"&&game.started')) break; await sleep(300); }
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;enemies.length=0;particles.length=0;
    player.pos.x=0;player.pos.z=40;player.pos.y=visualH(0,40)+14;player.heading=0;
    player.dir=facingVec(0);player.targetAlt=14;cam.yaw=0;cam.pitchIdx=1;cam.dist=26;snapCamera();
    game.time=14;true`);
  await sleep(900);
  const clip = { x: 420, y: 300, width: 380, height: 240, scale: 3 };
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync('C:/src/flight/docs/screenshots/_terrain_zoom.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved _terrain_zoom.png');
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
