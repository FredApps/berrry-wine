'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),crypto=require('node:crypto');
const {once}=require('node:events');
const {WebSocket,WebSocketServer}=require('../node_modules/ws');
const {createGateway}=require('./public-server');
test('public gate protects HTTP, writes and WebSockets; forwards only the exact HTTPS origin',async t=>{
  const config={origin:'https://ops.example.test',salt:'a'.repeat(32),sessionKey:'b'.repeat(64)};
  config.passwordHash=crypto.scryptSync('test-password',config.salt,32).toString('hex');
  const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host:req.headers.host,origin:req.headers.origin,cookie:req.headers.cookie}));});
  const wss=new WebSocketServer({noServer:true});
  upstream.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>{ws.send('connected');ws.on('message',m=>ws.send(m));}));
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const gate=createGateway(config,upstream.address().port);gate.listen(0,'127.0.0.1');await once(gate,'listening');
  t.after(()=>{wss.clients.forEach(s=>s.terminate());wss.close();gate.closeAllConnections();gate.close();upstream.closeAllConnections();upstream.close();});
  const request=(url='/',{method='GET',headers={},body=''}={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:gate.address().port,path:url,method,headers:{host:'ops.example.test',...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);
  });
  assert.equal((await request('/')).status,303);
  for(const url of ['/api/state','/artifact?key=x','/source?path=TODOS.md','/app.js'])assert.equal((await request(url)).status,401);
  assert.equal((await request('/',{headers:{host:'evil.example'}})).status,403);
  assert.equal((await request('/',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/login',{method:'POST'})).status,403);
  const headers={origin:config.origin,'content-type':'application/x-www-form-urlencoded'};
  const login=await request('/login');
  assert.doesNotMatch(login.text,/<form\b/i);
  assert.doesNotMatch(login.text,/type="password"/);
  assert.match(login.text,/-webkit-text-security:disc/);
  assert.match(login.text,/<input id="access-key"[^>]+disabled/);
  assert.match(login.text,/src="\/login.js"/);
  assert.match(login.headers['content-security-policy'],/form-action 'none'/);
  const script=await request('/login.js');assert.equal(script.status,200);
  assert.match(script.text,/fetch\('\/login'/);
  assert.equal((await request('/login',{method:'POST',headers:{...headers,origin:'null',accept:'application/json'},body:'password=test-password'})).status,403);
  const ajax=await request('/login',{method:'POST',headers:{...headers,accept:'application/json'},body:'password=test-password'});
  assert.equal(ajax.status,204);assert.match(ajax.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await request('/login',{method:'POST',headers,body:'password=wrong'})).status,401);
  const signed=await request('/login',{method:'POST',headers,body:'password=test-password'});
  assert.equal(signed.status,303);assert.match(signed.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Strict/);
  const cookie=signed.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('/api/state',{headers:{cookie}})).status,200);
  assert.equal((await request('/api/tasks',{method:'POST',headers:{cookie}})).status,403);
  const write=await request('/api/tasks',{method:'POST',headers:{cookie,origin:config.origin}});
  assert.equal(write.status,200);assert.deepEqual(JSON.parse(write.text),{host:`127.0.0.1:${upstream.address().port}`,origin:`http://127.0.0.1:${upstream.address().port}`});
  assert.equal((await request('/api/state',{headers:{cookie:cookie+'x'}})).status,401);
  const wsURL=`ws://127.0.0.1:${gate.address().port}/api/terminal?ticket=test`;
  for(const wsHeaders of [{host:'ops.example.test',origin:config.origin},{host:'ops.example.test',origin:'https://evil.example',cookie}]){
    await new Promise((resolve,reject)=>{const ws=new WebSocket(wsURL,{headers:wsHeaders});ws.on('open',()=>{ws.close();reject(Error('Unauthorized WebSocket opened'));});ws.on('error',e=>{assert.match(e.message,/403/);resolve();});});
  }
  const ws=new WebSocket(wsURL,{headers:{host:'ops.example.test',origin:config.origin,cookie}});
  const first=await once(ws,'message');assert.equal(first[0].toString(),'connected');ws.close();await once(ws,'close');
  const logout=await request('/logout',{method:'POST',headers:{cookie,origin:config.origin}});assert.match(logout.headers['set-cookie'][0],/Max-Age=0/);
});
test('public access requires explicit HTTPS configuration',()=>{
  assert.throws(()=>createGateway({origin:'http://ops.example.test'}),/Invalid HTTPS/);
});
