/* 诊断：v2.24b 引入海湾后，敌人是否落在"视觉海面"里。
   判定标准：visualH(x,z) < 0（画面上是水）但 isSea() 仍为 false（terrainH 认为陆地）。
   同时统计击杀后能否重生（清空后 3 秒看数量）。 */
const http = require('http');
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
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };

  for (let i = 0; i < 30; i++) { if (await ev('typeof enemies!=="undefined"&&game.started')) break; await sleep(300); }
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    game.over=false;player.inv=9999;enemies.length=0;true`);

  // 连刷 40 只，看有多少落在视觉水面上
  const stat = await ev(`(()=>{
    let bad=0,total=0,list=[];
    for(let i=0;i<40;i++){
      spawnEnemy(Math.random()<0.25);
      const e=enemies[enemies.length-1];
      total++;
      const vh=visualH(e.x,e.z), th=terrainH(e.x,e.z);
      if(vh<0){bad++;list.push({x:+e.x.toFixed(1),z:+e.z.toFixed(1),vh:+vh.toFixed(2),th:+th.toFixed(2)});}
    }
    const sample=JSON.parse(JSON.stringify(list.slice(0,5)));
    enemies.length=0;
    return {total,bad,sample};
  })()`);
  console.log('spawn on visual sea:', JSON.stringify(stat, null, 2));

  // 重生：清空后等 3 秒看是否补满
  await ev(`enemies.length=0;true`);
  await sleep(2500);
  const after = await ev(`({n:enemies.length,boss:enemies.filter(e=>e.type==='boss').length})`);
  console.log('respawn after clear:', JSON.stringify(after));

  // 现有敌人站位：视觉高度与实体 y 的落差
  const gap = await ev(`(()=>enemies.slice(0,6).map(e=>({type:e.type,y:+e.y.toFixed(2),vh:+visualH(e.x,e.z).toFixed(2)})))()`);
  console.log('enemy y vs visualH:', JSON.stringify(gap));
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
