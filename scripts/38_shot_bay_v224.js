/* v2.24 海湾截图：找一片浅海/沙滩区，验证原作 bay 构造（沙滩/浅海/沙洲）。 */
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
  // 找海陆交界处：continent 在 -0.02..0.02 附近（海岸线），且 h 接近 0
  const spot=await ev(`(function(){
    let best=null,bestd=9;
    for(let gx=-500;gx<=500;gx+=25)for(let gz=-500;gz<=500;gz+=25){
      const c=continent(gx,gz),d=Math.abs(c-0.0);
      if(c>-0.06&&c<0.02&&d<bestd){bestd=d;best={x:gx,z:gz,c:c,h:terrainH(gx,gz),vh:visualH(gx,gz)};}
    }
    return best||{x:0,z:0,c:continent(0,0),h:terrainH(0,0),vh:visualH(0,0)};
  })()`);
  console.log('coast spot:',spot);
  await ev(`game.started=true;document.getElementById('intro')?.style.setProperty('display','none');
    player.pos.x=${spot.x};player.pos.z=${spot.z};player.targetAlt=14;player.pos.y=visualH(${spot.x},${spot.z})+14;
    player.heading=Math.PI;player.dir=facingVec(Math.PI);game.over=false;player.inv=9999;
    cam.pitchIdx=Math.min(cam.pitches.length-1,cam.pitchIdx+1);snapCamera();`);
  await sleep(1500);
  const fs=require('fs');const out='C:/src/flight/docs/screenshots/_v224_bay.png';
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(out,Buffer.from(shot.result.data,'base64'));
  console.log('bay shot ->',out,'exceptions:',events);
  ws.close();try{await req('/json/close/'+page.id)}catch(e){}
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
