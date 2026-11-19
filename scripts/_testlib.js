/* 测试公共辅助：可靠地等待游戏页就绪
 *
 * 为什么需要：新建页面首次导航要下载 120KB HTML + 9.3MB 素材，
 * 固定 sleep(1800) 在慢机器/冷缓存下不够 —— 此时 game 尚未定义或主循环还没跑，
 * 后续所有按键与读取都落空，表现为「偶发失败」且失败项飘忽不定。
 *
 * 用法：const { waitReady } = require('./_testlib');
 *        await waitReady(ev, sleep);
 */
const http = require('http');

/** CDP HTTP GET（JSON）。agent:false + Connection:close 避免 Node 连接池挂起。 */
function cdpGet(port, p, method = 'GET') {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { Connection: 'close' } }, (r) => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 120))); } });
    });
    req.on('error', rej); req.setTimeout(8000, () => req.destroy(new Error('timeout'))); req.end();
  });
}

/**
 * 等待游戏页就绪。
 * @param {Function} ev  Runtime.evaluate 包装（async，返回值）
 * @param {Function} sleep  延时函数
 * @param {object} opt  {port, maxTry, intervalMs, needRunning}
 * @returns {boolean} 是否就绪
 */
async function waitReady(ev, sleep, opt = {}) {
  const port = opt.port || 9223;
  const maxTry = opt.maxTry || 120;
  const interval = opt.intervalMs || 200;
  for (let i = 0; i < maxTry; i++) {
    let ok = false;
    try {
      // 最小判据：game / player 对象已定义（页面 JS 已加载并执行）
      ok = await ev('typeof game!=="undefined" && !!game && !!player');
    } catch (e) { ok = false; }
    if (ok) {
      if (opt.requireStarted === false) return true;   // 只等对象存在（如手机端开场未开始）
      try {
        // 等待 started 已置位
        const started = await ev('game.started===true');
        if (started) {
          if (opt.needRunning === false) return true;
          // 再等主循环推进过，确保 rAF 已跑起来
          try { if (await ev('game.time>0')) return true; } catch (e) { /* 继续等 */ }
        }
      } catch (e) { /* 继续等 */ }
    }
    await sleep(interval);
  }
  return false;
}

/** 新建一个专属游戏页（避免多标签页时状态串扰）。 */
async function newGamePage(port = 9223, url = 'http://127.0.0.1:8000/scripts/mvp_air_to_ground.html') {
  return cdpGet(port, '/json/new?' + encodeURIComponent(url), 'PUT');
}

module.exports = { cdpGet, waitReady, newGamePage };
