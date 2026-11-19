/**
 * 12_shot_mvp.js — 通过 CDP 截图（桌面 / 手机模拟），用于版本视觉回归
 * 用法：node scripts/12_shot_mvp.js [cdpHttp] [outPng] [desktop|mobile] [0=开场|1=开始]
 */
const fs = require('fs');
const [, , CDP_HTTP = 'http://127.0.0.1:9223', OUT = 'others/shot.png', MODE = 'desktop', START = '1'] = process.argv;

async function main() {
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!page) throw new Error('未找到游戏页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const trySend = (m, p) => send(m, p).catch(() => {});

  await send('Page.enable');
  if (MODE === 'mobile') {
    await trySend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await trySend('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await trySend('Emulation.clearDeviceMetricsOverride');
    await trySend('Emulation.setUserAgentOverride', { userAgent: '' });
    await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  await send('Page.reload', { ignoreCache: true });
  await new Promise(r => setTimeout(r, 1800));
  if (START === '1') {
    await ev('game.started=true; true');
    await new Promise(r => setTimeout(r, 900));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  const info = await ev('({w:innerWidth,h:innerHeight,touch:typeof QUALITY!=="undefined"&&IS_TOUCH,body:document.body.className})');
  console.log(`saved ${OUT} | ${info.w}x${info.h} | touch=${info.touch} | body.class="${info.body}"`);
  ws.close();
}
main().catch(e => { console.error(e); process.exit(1); });
