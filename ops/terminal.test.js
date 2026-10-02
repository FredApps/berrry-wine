'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {WebSocket}=require('ws');
const {createServer}=require('./server');

async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ops-terminal-'));
  const socket='ops-test-'+process.pid+'-'+Date.now();
  const tmux=(...args)=>execFileSync('tmux',['-L',socket,...args],{encoding:'utf8'}).trim();
  tmux('-f','/dev/null','new-session','-d','-s','fixture','-x','100','-y','30','/bin/sh');
  const [pane,pid]=tmux('list-panes','-t','=fixture','-F','#{pane_id} #{pane_pid}').split(' ');
  await fs.mkdir(path.join(root,'ops'));
  await fs.writeFile(path.join(root,'TODOS.md'),'- [~] Terminal fixture task\n  id: TERM-1\n  owner: codex:test\n  Next: Verify terminal navigation\n');
  await fs.writeFile(path.join(root,'ops/terminals.json'),JSON.stringify({terminals:[{id:'fixture',agentId:'codex:test',session:'fixture',pane,panePid:+pid}]}));
  const server=createServer({root,codexRoot:false,claudeRoot:false,tmuxArgs:['-L',socket]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {root,tmux,server,base,async close(){server.closeTerminals();await new Promise(resolve=>server.close(resolve));try{tmux('kill-server');}catch{}await fs.rm(root,{recursive:true,force:true});}};
}
function track(ws) {
  const events=[];ws.on('message',raw=>events.push(JSON.parse(raw)));
  return async predicate=>{
    const end=Date.now()+7000;
    while(Date.now()<end){const found=events.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,25));}
    throw Error('Timed out waiting for terminal event: '+JSON.stringify(events).slice(-1000));
  };
}
test('tmux bridge authenticates, enforces view mode, controls fixture only, and detaches without stopping it', {timeout:30000},async t=>{
  const f=await fixture();t.after(()=>f.close());
  const post=(id,origin=f.base)=>fetch(f.base+'/api/terminal-ticket',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({id})});
  assert.equal((await post('fixture',null)).status,403);
  assert.equal((await post('fixture','http://evil.invalid')).status,403);
  assert.equal((await post('unregistered')).status,404);
  const state=await(await fetch(f.base+'/api/state')).json();assert.equal(state.terminals[0].available,true);
  async function open() {
    const r=await post('fixture');assert.equal(r.status,201);const {token}=await r.json();
    const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/terminal?ticket='+token,{origin:f.base});
    const wait=track(ws);await wait(e=>e.type==='mode'&&e.mode==='view');return {ws,wait,token};
  }
  const a=await open();t.after(()=>a.ws.terminate());
  await a.wait(e=>e.type==='output');
  assert.match(f.tmux('list-clients','-F','#{client_flags}'),/read-only/);
  const size=f.tmux('display-message','-p','-t','=fixture','#{pane_width}x#{pane_height}');
  const marker=path.join(f.root,'should-not-exist');
  a.ws.send(JSON.stringify({type:'input',data:`touch ${marker}\r`}));
  a.ws.send(JSON.stringify({type:'resize',cols:40,rows:10}));
  await new Promise(r=>setTimeout(r,200));
  await assert.rejects(fs.access(marker));
  assert.equal(f.tmux('display-message','-p','-t','=fixture','#{pane_width}x#{pane_height}'),size);
  const replay=new WebSocket(f.base.replace('http:','ws:')+'/api/terminal?ticket='+a.token,{origin:f.base});
  replay.on('error',()=>{});
  await new Promise(resolve=>replay.on('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,403);res.resume();replay.terminate();resolve();}));
  a.ws.send(JSON.stringify({type:'mode',mode:'control'}));await a.wait(e=>e.type==='mode'&&e.mode==='control');
  a.ws.send(JSON.stringify({type:'input',data:`touch ${marker}; printf 'OPS_CONTROL_OK\\n'\r`}));
  await a.wait(e=>e.type==='output'&&Buffer.from(e.data,'base64').toString().includes('OPS_CONTROL_OK'));
  await new Promise(r=>setTimeout(r,100));await fs.access(marker);
  const b=await open();t.after(()=>b.ws.terminate());
  b.ws.send(JSON.stringify({type:'mode',mode:'control'}));await b.wait(e=>e.type==='error'&&e.message.includes('Another browser'));
  a.ws.close();await new Promise(resolve=>a.ws.once('close',resolve));
  await new Promise(r=>setTimeout(r,150));
  f.tmux('has-session','-t','=fixture');
  b.ws.send(JSON.stringify({type:'mode',mode:'control'}));await b.wait(e=>e.type==='mode'&&e.mode==='control');
  b.ws.close();await new Promise(resolve=>b.ws.once('close',resolve));
  await new Promise(r=>setTimeout(r,150));
  assert.equal(f.tmux('list-clients'), '');
  f.tmux('has-session','-t','=fixture');
});

module.exports={fixture};

test('browser terminal renders, controls a disposable pane, and reconnects in View', {timeout:30000},async t=>{
  const f=await fixture();t.after(()=>f.close());
  const browser=await require('puppeteer').launch({executablePath:process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1280,height:900});await page.goto(f.base);
  await page.click('a[data-view="tasks"]');
  await page.waitForSelector('.task-owner [data-terminal="fixture"]');
  await page.click('.task-details');
  assert.match(await page.$eval('#detail-body',el=>el.textContent),/codex:test/);
  await page.click('#detail-body [data-terminal="fixture"]');
  await page.waitForFunction(()=>document.querySelector('#terminal-status').textContent.includes('View only'));
  await page.waitForSelector('.xterm-screen');
  await page.click('#terminal-mode');
  await page.waitForFunction(()=>document.querySelector('#terminal-status').textContent.includes('Control enabled'));
  const marker=path.join(f.root,'browser-controlled');
  await page.keyboard.type(`touch ${marker}`);await page.keyboard.press('Enter');
  for(let n=0;n<50;n++){try{await fs.access(marker);break;}catch{await new Promise(r=>setTimeout(r,50));}}
  await fs.access(marker);
  await page.click('#terminal-reconnect');
  await page.waitForFunction(()=>document.querySelector('#terminal-status').textContent.includes('View only'));
  await page.setViewport({width:390,height:844});
  await fs.mkdir(path.join(__dirname,'../scratch/ops-terminal'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'../scratch/ops-terminal/mobile.png')});
  await page.setViewport({width:1280,height:900});
  await page.screenshot({path:path.join(__dirname,'../scratch/ops-terminal/desktop.png')});
  await page.click('#terminal-close');
  assert.equal(await page.$eval('#detail',el=>el.open),true);
  f.tmux('has-session','-t','=fixture');
  assert.deepEqual(errors,[]);
});
