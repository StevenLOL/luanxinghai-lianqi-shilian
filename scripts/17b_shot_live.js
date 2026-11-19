/* 线上分享链接真实渲染截图
 * 注意：CDP 的 HTTP 请求必须 agent:false + Connection:close，否则 Node 连接池会挂起
 */
const http=require('http'),fs=require('fs');
const CDP=9223, SHARE='https://xianjian-kongduodi.app.workbuddy.host/?sharecode=ASJWDZ6E6D';
function get(p,m='GET'){return new Promise((res,rej)=>{
  const req=http.request({host:'127.0.0.1',port:CDP,path:p,method:m,agent:false,headers:{Connection:'close'}},r=>{
    let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error('parse:'+d.slice(0,120)))}});
  });
  req.on('error',rej);req.setTimeout(8000,()=>{req.destroy(new Error('timeout'))});req.end();
});}
(async()=>{
  const t=await get('/json/new?about:blank','PUT');
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const p=new Map();
  ws.onmessage=m=>{const j=JSON.parse(m.data); if(j.id&&p.has(j.id)){p.get(j.id)(j);p.delete(j.id);}};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(new Error('ws err'))});
  const send=(method,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:SHARE});
  await new Promise(r=>setTimeout(r,7000));
  const st=await send('Runtime.evaluate',{expression:`(()=>{game.started=true;return 'started-forced:'+game.started;})()`,returnByValue:true});
  console.log('启动:',st.result&&st.result.result&&st.result.result.value);
  await new Promise(r=>setTimeout(r,2500));
  for(const k of ['w','d']) await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:'Key'+k.toUpperCase(),windowsVirtualKeyCode:k==='w'?87:68});
  await new Promise(r=>setTimeout(r,2500));
  for(const k of ['w','d']) await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:'Key'+k.toUpperCase(),windowsVirtualKeyCode:k==='w'?87:68});
  await new Promise(r=>setTimeout(r,800));
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('C:/src/flight/others/mvp_live_deploy_desktop.png',Buffer.from(s.result.data,'base64'));
  const hp=await send('Runtime.evaluate',{expression:`JSON.stringify({started:game&&game.started,hp:player&&Math.round(player.hp),ready:spritesReady})`,returnByValue:true});
  console.log('状态:',hp.result&&hp.result.result&&hp.result.result.value);
  console.log('截图已保存');
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
