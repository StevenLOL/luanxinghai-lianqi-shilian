/* 海面局部放大：定位米黄色条块的来源。 */
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
  for (let i = 0; i < 30; i++) { if (await ev('typeof enemies!=="undefined"&&game.started')) break; await sleep(300); }
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;enemies.length=0;particles.length=0;
    player.pos.x=140;player.pos.z=-70;player.pos.y=visualH(140,-70)+16;player.heading=0;
    player.dir=facingVec(0);player.targetAlt=16;cam.yaw=0;cam.pitchIdx=1;cam.dist=30;snapCamera();
    game.time=20;true`);
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 560, y: 120, width: 440, height: 260, scale: 2.5 } });
  fs.writeFileSync('C:/src/flight/docs/screenshots/_sea_zoom.png', Buffer.from(shot.result.data, 'base64'));
  const info = await ev(`(()=>{const s=[];for(let sx=560;sx<1000;sx+=40){const st=[];for(let sz=150;sz<330;sz+=40)st.push(+visualH(sx,sz).toFixed(1));s.push(st);}return s;})()`);
  console.log('visualH grid', JSON.stringify(info));
  console.log('saved _sea_zoom.png');
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
