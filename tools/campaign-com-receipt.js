'use strict';
// Import boundaries only; reserved throw lane is independent of API traffic.
function installCampaignComReceipt(host, getContext, emit, faultOnly = false) {
  const originals = new Map(), wrappers = new Map(), frames = [], names = new Map();
  let apiActive = true, active = true, closed = false, deadline = Date.now() + 600000;
  const lanes = {api:{bytes:0,rows:0,ms:0},fault:{bytes:0,rows:0,ms:0}};
  const limits = {api:{bytes:32768,rows:96,ms:150},fault:{bytes:8192,rows:2,ms:50}};
  const errors=[];
  function observe(lane, fn) {
    const u=lanes[lane], l=limits[lane];
    if(!active || Date.now()>=deadline || u.rows>=l.rows || u.bytes>=l.bytes || u.ms>=l.ms)return;
    const start=performance.now();
    function read(c,p,n,guest=true){
      if(n>1024 || u.bytes+n>l.bytes || performance.now()-start+u.ms>=l.ms)throw Error('read budget');
      const w=guest?c.exports.guest_to_wasm(p)>>>0:p>>>0;
      if(w<256 || w+n>c.memory.buffer.byteLength)throw Error('bounds');
      u.bytes+=n;return Array.from(new Uint8Array(c.memory.buffer,w,n));
    }
    function words(c,p,n){const b=Uint8Array.from(read(c,p,n*4)),v=new DataView(b.buffer);return Array.from({length:n},(_,i)=>v.getUint32(i*4,true));}
    try{fn(getContext(),read,words,r=>{u.rows++;emit({kind:'campaign-com',lane,at:Date.now(),...r});});}
    catch(e){if(errors.length<64)errors.push({lane,error:String(e)});if(String(e).includes('read budget'))u.bytes=l.bytes;}finally{u.ms+=performance.now()-start;}
  }
  function identity(c,words){const e=c.exports;const esp=e.get_esp()>>>0;return {slot:c.slot,tid:e.get_current_thread_id()>>>0,eip:e.get_eip()>>>0,esp,ebp:e.get_ebp()>>>0,eax:e.get_eax()>>>0,stack:words(c,esp,64)};}
  function wrap(n,before,after){const original=host[n];if(typeof original!=='function')throw Error('missing import '+n);originals.set(n,original);const wrapper=function(...args){try{before?.(args);}catch(e){if(errors.length<64)errors.push({name:n,error:String(e)});}let result;try{result=Reflect.apply(original,this,args);}catch(e){try{emit({kind:'campaign-com-import-throw',name:n,error:String(e),lanes});}catch{}throw e;}try{after?.(args,result);}catch(e){if(errors.length<64)errors.push({name:n,error:String(e)});}return result;};host[n]=wrapper;wrappers.set(n,wrapper);}
  if(!faultOnly){wrap('log',args=>{
    if(!active || !apiActive || Date.now()>=deadline)return;
    let name=names.get(args[0]);
    if(name===undefined && names.size<4096){const c=getContext();const n=Math.min(args[1]>>>0,96);if(args[0]>=256&&args[0]+n<=c.memory.buffer.byteLength){name=String.fromCharCode(...new Uint8Array(c.memory.buffer,args[0],n)).split('\0')[0];names.set(args[0],name);}}
    if(frames.length>=256){apiActive=false;errors.push({error:'frame cap'});return;}
    const f={name};frames.push(f);
    if(/CoCreate|CoGet|QueryInterface|DllGetClassObject|Stream|Persist|OleLoad|ReadClass|GetErrorInfo|RaiseException/.test(name||''))observe('api',(c,read,words)=>{f.identity=identity(c,words);f.args=f.identity.stack.slice(0,8);f.code=read(c,f.args[0]-16,64);for(const p of f.args.slice(1,6))if(p>=0x400000&&p<0x7400000){try{(f.pointed||(f.pointed=[])).push({p,bytes:read(c,p,32)});}catch{}}});
  });
  wrap('log_api_exit',null,()=>{if(!apiActive)return;const f=frames.pop();if(f?.identity)observe('api',(c,read,words,row)=>row({name:f.name,entry:f.identity,args:f.args,code:f.code,pointed:f.pointed,result:c.exports.get_eax()>>>0,exitEsp:c.exports.get_esp()>>>0}));});
  }
  wrap('cxx_throw',args=>observe('fault',(c,read,words,row)=>{const payload=words(c,args[0],3),object=words(c,payload[1],8),id=identity(c,words);const candidates=[...new Set(id.stack.filter(p=>p>=0x400020&&p<0x700000))].slice(0,40);row({name:'cxx_throw',payload,object,identity:id,callerSpans:candidates.map(p=>({return:p,start:p-24,bytes:read(c,p-24,48)})),throwInfo:read(c,payload[2],32)});}));
  return {arm(){return {armed:true,deadline,limits};},close(){if(!closed){for(const[n,o]of originals){if(host[n]!==wrappers.get(n))errors.push({error:'replacement '+n});else host[n]=o;}closed=true;active=false;}const receipt={closed,lanes,limits,errors,pending:frames.length};try{emit({kind:'campaign-com-final',receipt});}catch{}return receipt;}};
}
if(typeof module!=='undefined')module.exports={installCampaignComReceipt};
