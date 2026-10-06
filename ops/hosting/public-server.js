#!/usr/bin/env node
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const cookieName='__Host-wine_ops';
// Safari 26.4 aborts in credential-saving both on submit and navigation.
// Use a CSS-masked text input and fetch; browsers lacking masking fall back to
// a native password field before enabling input. Credentials travel only by POST.
const loginScript=`'use strict';
const input=document.getElementById('access-key'),button=document.getElementById('sign-in'),status=document.getElementById('login-status');
// Never expose typed text on browsers without CSS masking.
if(!CSS.supports('-webkit-text-security','disc'))input.type='password';
input.disabled=false;
async function signIn(){
  if(button.disabled)return;
  if(!input.value){input.focus();return;}
  button.disabled=true;status.textContent='Signing in…';
  try{
    const response=await fetch('/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({password:input.value}),signal:AbortSignal.timeout(15000)});
    if(response.status===204){input.value='';location.replace('/');return;}
    status.textContent=response.status===401?'Incorrect password.':response.status===429?'Please retry in a minute.':'Sign-in failed. Please retry.';
  }catch{status.textContent='Could not connect. Please retry.';}
  button.disabled=false;
}
button.addEventListener('click',signIn);
input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();signIn();}});
`;

function createGateway(config,upstreamPort=8098){
  const origin=new URL(config.origin);
  if(origin.protocol!=='https:' || origin.origin!==config.origin || origin.username || origin.password || !/^[a-f0-9]{32}$/.test(config.salt) || !/^[a-f0-9]{64}$/.test(config.passwordHash) || !/^[a-f0-9]{64}$/.test(config.sessionKey))throw Error('Invalid HTTPS access configuration');
  if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535)throw Error('Invalid upstream port');
  const sign=value=>crypto.createHmac('sha256',Buffer.from(config.sessionKey,'hex')).update(value).digest('hex');
  const equal=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const validOrigin=req=>req.headers.host===origin.host && (!req.headers.origin || req.headers.origin===origin.origin);
  const authorized=req=>{
    const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const parts=value.split('.');
    return value.length<256 && parts.length===3 && /^\d+$/.test(parts[0]) && Number(parts[0])>Date.now() && equal(parts[2],sign(parts[0]+'.'+parts[1]));
  };
  // HTML form POSTs need their same-origin Origin header. no-referrer makes
  // browsers send Origin: null for this navigation; foreign origins stay denied.
  const baseHeaders={'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
  const login=message=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wine / Ops · Sign in</title><style>body{margin:0;background:#08120e;color:#dcebd7;font:18px monospace;display:grid;place-items:center;min-height:100dvh}main{max-width:24rem;padding:2rem;border:1px solid #365440;margin:1rem}h1{color:#b0ef65}label,input,button{display:block;box-sizing:border-box;width:100%;margin-top:1rem}input,button{padding:.8rem;font:inherit;border:1px solid #739c5f;background:#102217;color:inherit}button{background:#b0ef65;color:#08120e;cursor:pointer}#access-key{-webkit-text-security:disc}p{color:#a9b8ae;font-size:14px}</style><main><p>PRIVATE OPERATIONS CONSOLE</p><h1>WINE / OPS</h1><div id="login-controls"><label for="access-key">Access key</label><input id="access-key" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" disabled required autofocus maxlength="256"><button type="button" id="sign-in">Sign in →</button></div><p id="login-status" role="status">${message||'Use your dashboard password. Password saving is disabled on this page.'}</p><noscript>JavaScript is required to sign in.</noscript></main><script src="/login.js" defer></script></html>`;
  const send=(res,status,body,headers={})=>{res.writeHead(status,{...baseHeaders,...headers});res.end(body);};
  const cookie=(value,age)=>`${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
  let epoch=0,attempts=0,inFlight=0;
  const forwardHeaders=req=>{
    const headers={};
    for(const name of ['accept','accept-encoding','content-type','content-length','user-agent','range','if-range','upgrade','connection','sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions'])if(req.headers[name]!==undefined)headers[name]=req.headers[name];
    headers.host=`127.0.0.1:${upstreamPort}`;
    // Translate only the already validated public origin. Missing/foreign
    // browser origins never become a trusted local write or WebSocket request.
    if(req.headers.origin===origin.origin)headers.origin=`http://${headers.host}`;
    return headers;
  };
  const server=http.createServer(async(req,res)=>{
    try{
      if(!validOrigin(req))return send(res,403,'Unexpected host or origin');
      if(!['GET','HEAD'].includes(req.method) && req.headers.origin!==origin.origin)return send(res,403,'Same-origin request required');
      const url=new URL(req.url,origin);
      if(url.pathname==='/login.js' && req.method==='GET')return send(res,200,loginScript,{'Content-Type':'text/javascript; charset=utf-8'});
      if(url.pathname==='/login'){
        const pageHeaders={'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"};
        if(req.method==='GET')return send(res,200,login(),pageHeaders);
        if(req.method!=='POST')return send(res,405,'Method not supported');
        if(req.headers['content-type']!=='application/x-www-form-urlencoded')return send(res,415,'Form required');
        const now=Date.now();if(now-epoch>60000){epoch=now;attempts=0;}
        if(attempts++>=20||inFlight>=2)return send(res,429,'Please retry in a minute',{'Retry-After':'60'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return send(res,413,'Form too large');}
        const password=new URLSearchParams(body).get('password')||'';if(password.length>256)return send(res,400,'Password too long');
        inFlight++;let derived;try{derived=await scrypt(password,config.salt,32);}finally{inFlight--;}
        if(!equal(derived.toString('hex'),config.passwordHash))return send(res,401,login('Incorrect password.'),pageHeaders);
        const value=(Date.now()+8*3600000)+'.'+crypto.randomBytes(16).toString('hex');
        return send(res,req.headers.accept==='application/json'?204:303,'',{'Location':'/','Set-Cookie':cookie(value+'.'+sign(value),8*3600)});
      }
      if(req.method==='POST'&&url.pathname==='/logout')return send(res,303,'',{'Location':'/login','Set-Cookie':cookie('',0)});
      if(!authorized(req))return url.pathname==='/'?send(res,303,'',{'Location':'/login'}):send(res,401,'Sign in required');
      const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:forwardHeaders(req)},reply=>{
        res.writeHead(reply.statusCode,{...reply.headers,...baseHeaders});reply.pipe(res);
      });
      upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)send(res,502,'Dashboard restarting; retry shortly');else res.destroy();});
      req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
    }catch{if(!res.headersSent)send(res,400,'Invalid request');else res.destroy();}
  });
  server.on('upgrade',(req,socket,head)=>{
    const reject=()=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    if(!validOrigin(req)||req.headers.origin!==origin.origin||!authorized(req)||!req.url.startsWith('/api/terminal?'))return reject();
    const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,headers:forwardHeaders(req)});
    upstream.setTimeout(10000,()=>upstream.destroy());
    upstream.on('upgrade',(reply,peer,peerHead)=>{
      upstream.setTimeout(0);socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`+Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
      if(peerHead.length)socket.write(peerHead);if(head.length)peer.write(head);
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());peer.on('close',()=>socket.destroy());socket.on('close',()=>peer.destroy());socket.pipe(peer).pipe(socket);
    });
    upstream.on('response',reply=>{reply.resume();reject();});upstream.on('error',reject);upstream.end();
  });
  return server;
}
if(require.main===module){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  createGateway(config).listen(8099,'0.0.0.0',()=>console.log('Password gateway ready: '+config.origin));
}
module.exports={createGateway};
