'use strict';
// Exact reviewed COMI bounded owning-resource teardown; no recorder is created.
async function closeResources(resources,{timeoutMs=2000}={}){
 const result={at:new Date().toISOString(),browserClosed:false,serverClosed:false,recorderClosed:!resources.recorder,errors:[]};
 async function bounded(name,action,limit=timeoutMs){
  let timer;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+' cleanup timeout')),limit);})]);}
  finally{clearTimeout(timer);}
 }
 if(resources.recorder)try{result.recorder=await bounded('recorder',()=>resources.recorder.stop(),Math.max(timeoutMs,4000));result.recorderClosed=result.recorder.closed;delete result.recorder.pcm;}catch(e){result.errors.push('recorder: '+String(e));}
 try{if(resources.browser)await bounded('browser',()=>resources.browser.close());result.browserClosed=true;}catch(e){
  result.errors.push('browser: '+String(e));
  try{const child=resources.browser?.process?.();if(child&&child.exitCode===null){child.kill('SIGKILL');result.forcedBrowserPid=child.pid;}}catch(killError){result.errors.push('browser kill: '+String(killError));}
 }
 try{if(resources.server){await bounded('server',()=>{resources.server.closeAllConnections();return new Promise((resolve,reject)=>resources.server.close(e=>e?reject(e):resolve()));});}result.serverClosed=true;}catch(e){result.errors.push('server: '+String(e));}
 result.complete=result.browserClosed&&result.serverClosed&&result.recorderClosed;
 return result;
}

module.exports={closeResources};
