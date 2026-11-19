/**
 * 11_profile_mvp.js — 通过 CDP 对 MVP 逐阶段计时（性能剖析 / 回归用）
 *
 * 前置：Chrome 以 --remote-debugging-port=9223 打开游戏页面
 * 用法：node scripts/11_profile_mvp.js [cdpHttp] [sampleMs]
 */
const CDP_HTTP = process.argv[2] || 'http://127.0.0.1:9223';
const SAMPLE_MS = Number(process.argv[3] || 6000);

async function main() {
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('mvp_air_to_ground'));
  if (!page) throw new Error('未找到游戏页 target: ' + targets.map(t => t.url).join(', '));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
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

  const names = ['update', 'render', 'drawSky', 'drawTerrain', 'drawVision', 'drawAim',
    'drawBeams', 'drawLightning', 'drawEnemy', 'drawPlayer', 'drawClouds',
    'drawProjectiles', 'drawHUD', 'drawOverlay'];

  // 可选 argv[7]=mobile：模拟 iPhone 视口/DPR/触摸，验证手机档位
  const trySend = (m, p) => send(m, p).catch(() => {});   // 不同 Chrome 版本 CDP 方法名有差异
  if (process.argv[7] === 'mobile') {
    await trySend('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await trySend('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await trySend('Emulation.clearDeviceMetricsOverride');
    await trySend('Emulation.setUserAgentOverride', { userAgent: '' });
    await trySend('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  // 重新加载，确保测到最新文件（传 noreload 可在同一页面连续采样，排除 JIT 预热差异）
  if (process.argv[5] !== 'noreload') {
    await send('Page.enable');
    await send('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, 1800));
  }

  // 可选：用外部文件里的函数体替换 drawTerrain（A/B 对照用）
  if (process.argv[6]) {
    const fs = require('fs');
    const body = JSON.parse(fs.readFileSync(process.argv[6], 'utf8'));
    await ev('window.drawTerrain = new Function(' + JSON.stringify(body) + '); true');
  }

  // 可选：注入探针前执行一段表达式（A/B 对照用）
  if (process.argv[4]) await ev(process.argv[4]);

  // 自动开始游戏，避免一直停在开场遮罩导致场景不更新
  await ev('window.game && (game.started = true); true');

  await ev(`(() => {
    window.__prof = {};
    window.__frames = [];
    window.__lastT = 0;
    const names = ${JSON.stringify(names)};
    for (const n of names) {
      const orig = window[n];
      if (typeof orig !== 'function') continue;
      window.__prof[n] = { sum: 0, max: 0, calls: 0 };
      window[n] = function () {
        const t0 = performance.now();
        const r = orig.apply(this, arguments);
        const d = performance.now() - t0;
        const s = window.__prof[n];
        s.sum += d; s.calls++; if (d > s.max) s.max = d;
        return r;
      };
    }
    // 帧间隔采样
    const origRender = window.render;
    window.render = function () {
      const t = performance.now();
      if (window.__lastT) window.__frames.push(t - window.__lastT);
      window.__lastT = t;
      return origRender.apply(this, arguments);
    };
    return true;
  })()`);

  await new Promise(r => setTimeout(r, SAMPLE_MS));

  const data = await ev(`(() => {
    const frames = window.__frames.slice().sort((a,b)=>a-b);
    const med = frames.length ? frames[frames.length>>1] : 0;
    const p95 = frames.length ? frames[Math.floor(frames.length*0.95)] : 0;
    return { prof: window.__prof, frames: frames.length, med, p95,
             dpr: window.devicePixelRatio, size: [window.innerWidth, window.innerHeight],
             canvas: [document.getElementById('game').width, document.getElementById('game').height],
             quality: window.__QUALITY || null, extra: window.__extra || null };
  })()`);

  const f = data.frames || 1;
  console.log(`\n采样 ${SAMPLE_MS}ms | 视口 ${data.size.join('x')} CSS px | canvas ${data.canvas.join('x')} | DPR ${data.dpr}`);
  console.log(`帧数 ${data.frames} | 帧间隔 中位数 ${data.med.toFixed(2)}ms (~${(1000/data.med).toFixed(1)}fps) | P95 ${data.p95.toFixed(2)}ms`);
  console.log('质量档:', data.quality || '(未启用)');
  if (data.extra) console.log('额外计数:', JSON.stringify(data.extra));
  console.log('\n阶段                 每帧均耗ms   调用/帧   峰值ms');
  console.log('--------------------------------------------------------');
  const rows = names.filter(n => data.prof[n]).map(n => {
    const s = data.prof[n];
    return [n, s.sum / f, s.calls / f, s.max];
  }).sort((a, b) => b[1] - a[1]);
  for (const [n, avg, cpf, max] of rows) {
    console.log(n.padEnd(20) + avg.toFixed(3).padStart(9) + cpf.toFixed(2).padStart(11) + max.toFixed(2).padStart(10));
  }
  const total = data.prof.render ? data.prof.render.sum / f : 0;
  console.log('--------------------------------------------------------');
  console.log('render 合计/帧: ' + total.toFixed(3) + 'ms');
  ws.close();
}

main().catch(e => { console.error(e); process.exit(1); });
