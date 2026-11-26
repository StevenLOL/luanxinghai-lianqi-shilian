/* v2.24b 海湾截图：① 出生点朝 -z 看海湾 ② 海滩低空看浅海/沙洲。 */
const http=require('http');const WS=globalThis.WebSocket;const CDP='http://127.0.0.1:9223';
const URL='http://127.0.0.1:8000/scripts/mvp_air_to_ground.html';
function req(p,m='GET'){return new Promise((res,rej)=>{const r=http.request(CDP+p,{method:m,agent:false,headers:{Connection:'close'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,150)))}})});r.setTimeout(5000,()=>r.destroy(new Error('timeout')));r.on('error',rej);r.end()})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const page=await req('/json/new?'+encodeURIComponent(URL),'PUT');
  const ws=new WS(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pend=new Map();const events=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')events.push(m.params.exceptionDetails.text)});
  const send=(method,params={})=>new Promise(res=>{const n=++id;pend.set(n,res);ws.send(JSON.stringify({id:n,method,params}))});
  await send('Runtime.enable');await send('Page.enable');
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});if(r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);return r.result.result.value};
  for(let i=0;i<60;i++){if(await ev('typeof game!=="undefined"&&spritesReady'))break;await sleep(200)}
  const fs=require('fs');
  const setup=async(x,z,alt)=>{
    await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
      game.over=false;player.inv=9999;player.pos.x=${x};player.pos.z=${z};player.heading=0;player.dir=facingVec(0);
      player.targetAlt=${alt};player.pos.y=visualH(${x},${z})+${alt};cam.yaw=0;cam.pitchIdx=1;snapCamera();`);
    await sleep(600);
    await ev(`player.pos.y=visualH(${x},${z})+${alt};snapCamera();render();`);
  };
  // ① 出生点朝 -z：海湾在 shoreZ≈-96 处
  await setup(0,0,20);
  const info=await ev(`({shore:nfShoreZ(0),vh0:visualH(0,0),vhSea:visualH(0,-200),hSea:terrainH(0,-200)})`);
  console.log('site:',JSON.stringify(info));
  let shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/docs/screenshots/_v224_meadow_sea.png',Buffer.from(shot.result.data,'base64'));
  // ② 海滩低空
  const spot=await ev(`(function(){let b=null,bd=9;for(let gx=-300;gx<=300;gx+=20)for(let gz=-180;gz<=-40;gz+=20){
    const s=nfShoreZ(gx)-gz,d=Math.abs(s+8);if(d<bd){bd=d;b={x:gx,z:gz,s:s,vh:visualH(gx,gz),h:terrainH(gx,gz)};}}return b})()`);
  console.log('beach spot:',JSON.stringify(spot));
  await setup(spot.x,spot.z,14);
  shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/docs/screenshots/_v224_bay.png',Buffer.from(shot.result.data,'base64'));
  console.log('shots -> docs/screenshots/_v224_meadow_sea.png, _v224_bay.png','exceptions:',events);
  ws.close();try{await req('/json/close/'+page.id)}catch(e){}
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
