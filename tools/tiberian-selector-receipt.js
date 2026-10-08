'use strict';
// Import-boundary observations only; no guest writes, CPU setters or forced returns.
function installTiberianSelectorReceipt(host,getContext,emit){
 const targets=new Map([['GetWindowLongA',2],['SetWindowLongA',3],['CallWindowProcA',5],['CallWindowProcW',5],['DefDlgProcA',4],['EndDialog',2],['DestroyWindow',1],['DialogBoxIndirectParamA',5],['CreateDialogIndirectParamA',5]]),original=new Map(),hooks=new Map(),frames=[],names=new Map();let active=false,closed=false,deadline=0,count=0,readBytes=0,selector=0,lastSelector=null,stopReason=null;
 for(const n of ['log','log_api_exit','check_input'])if(typeof host[n]!=='function')throw Error('missing '+n);
 const alive=()=>active&&Date.now()<deadline&&count<128&&readBytes<65536;
 function guard(){if(!alive())throw Error('receipt limit');}
 function context(){guard();const ctx=getContext();guard();return ctx;}
 function get(ctx,n,...args){guard();const fn=ctx.exports[n];guard();if(typeof fn!=='function')throw Error('missing getter '+n);const value=fn(...args);guard();return value>>>0;}
 function read(ctx,p,n,guest=true){guard();if(n>256||readBytes+n>65536)throw Error('read cap');const wa=guest?get(ctx,'guest_to_wasm',p):p>>>0;guard();const buffer=ctx.memory.buffer;guard();if(wa<256||wa+n>buffer.byteLength)throw Error('bounds');guard();const src=new Uint8Array(buffer,wa,n),copy=new Uint8Array(n);for(let i=0;i<n;i++){guard();copy[i]=src[i];readBytes++;}guard();return copy;}
 function words(ctx,p,n){const b=read(ctx,p,n*4),v=new DataView(b.buffer);return Array.from({length:n},(_,i)=>v.getUint32(i*4,true));}
 function state(ctx){return{slot:ctx.slot,tid:get(ctx,'get_current_thread_id'),eip:get(ctx,'get_eip'),esp:get(ctx,'get_esp'),eax:get(ctx,'get_eax'),selector:selector?{pointer:selector,value:words(ctx,selector,1)[0]}:null};}
 function row(r){if(!alive())throw Error('row cap');r.at=Date.now();count++;emit(r);}
 function observe(fn){if(alive())try{fn()}catch(e){active=false;stopReason=String(e);frames.length=0;}}
 function sampleSelector(){if(!selector)return;const ctx=context(),value=words(ctx,selector,1)[0];if(value!==lastSelector){lastSelector=value;row({kind:'selector-change',state:state(ctx)});}}
 function wrap(n,before,after){const prev=host[n];if(typeof prev!=='function')throw Error('missing '+n);original.set(n,prev);function hook(...a){if(before)observe(()=>before(a));const r=prev.apply(this,a);if(after)observe(()=>after(a,r));return r;}host[n]=hook;hooks.set(n,hook);}
 wrap('log',a=>{const ctx=context();let name=names.get(a[0]);if(name===undefined){const b=read(ctx,a[0],Math.min(a[1]>>>0,64),false);name=String.fromCharCode(...b).split('\0')[0];names.set(a[0],name);}const n=targets.get(name);if(frames.length>=128)throw Error('frame cap');if(n===undefined){frames.push(null);return;}const esp=get(ctx,'get_esp'),stack=words(ctx,esp,n+1);let dialogArgs=null;if(name==='GetWindowLongA'){if(stack[0]!==0x4dea72||stack[2]!==8){frames.push(null);return;}dialogArgs=words(ctx,esp+0x50,4);if(dialogArgs[1]!==0x111){frames.push(null);return;}}if(name==='SetWindowLongA'){frames.push(null);return;}if(name.startsWith('CallWindowProc')&&stack[3]!==0x111){frames.push(null);return;}const frame={name,stack,dialogArgs};frames.push(frame);sampleSelector();row({kind:'api-entry',name,stack,dialogArgs,state:state(ctx),callerCode: Array.from(read(ctx,stack[0]-8,32))});},null);
 wrap('log_api_exit',()=>{const f=frames.pop();if(!f)return;const ctx=context();if(f.name==='GetWindowLongA'&&f.stack[0]===0x4dea72&&f.stack[2]===8){selector=get(ctx,'get_eax');if(selector){lastSelector=words(ctx,selector,1)[0];row({kind:'selector-pointer',name:f.name,stack:f.stack,dialogArgs:f.dialogArgs,state:state(ctx),dlgprocCode:Array.from(read(ctx,0x4dea40,96))});}}sampleSelector();row({kind:'api-handler-exit',...f,state:state(ctx),callbackReturn:'unmeasured'});},null);
 wrap('check_input',null,()=>sampleSelector());
 return{arm(){if(closed||active)throw Error('observer unavailable');active=true;deadline=Date.now()+8000;return{armed:true,deadline,maxRows:128,maxReadBytes:65536}},close(){active=false;closed=true;for(const[n,prev]of original)if(host[n]===hooks.get(n))host[n]=prev;frames.length=0;return{closed:true,count,readBytes,selector,lastSelector,deadline,stopReason}}};
}
if(typeof module!=='undefined')module.exports={installTiberianSelectorReceipt};
