'use strict';

// Private diagnostic only. Observe existing owning-instance imports; never call
// guest_read* or guest_to_wasm (their miss paths can raise a guest exception).
function createWinampExceptionObserver({host, getExports, memory, translate, emit,
  now = Date.now, maxEvents = 512, maxMs = 20000}) {
  let active = false, started = 0, count = 0, dropped = 0, tid = null;
  let ring = [], pending = null, exceptionWords = 0, closed = false;
  const originals = {}, wrappers = {};
  const finish = reason => {
    if (closed) return {count,dropped,foreign:[]};
    closed=true; active=false;
    const foreign=[];
    for (const name of Object.keys(originals)) {
      if (host[name]===wrappers[name]) host[name]=originals[name]; else foreign.push(name);
    }
    if (tid !== null) emit({kind:reason==='cap'?'cap':'summary',tid,count,dropped,maxMs,maxEvents,remaining:ring,foreign});
    ring=[]; pending=null; exceptionWords=0;
    return {count,dropped,foreign};
  };
  const withinBounds = () => {
    if (!active || closed) return false;
    if (now()-started >= maxMs || count >= maxEvents) { finish('cap'); return false; }
    return true;
  };
  const read = (ga, size = 4) => {
    if (!withinBounds()) return null;
    const ex = getExports();
    const bytes = [];
    for (let i = 0; i < size; i++) {
      if (!withinBounds()) return null;
      const wa = translate((ga + i) >>> 0, ex.get_image_base() >>> 0, memory);
      if (wa === 0xf0 || wa < 0 || wa >= memory.buffer.byteLength) return null;
      bytes.push(new Uint8Array(memory.buffer)[wa]);
    }
    return size === 4 ? (bytes[0] | bytes[1]<<8 | bytes[2]<<16 | bytes[3]<<24) >>> 0 : bytes;
  };
  const state = () => {
    if (!withinBounds()) return null;
    const ex = getExports(), registers = {};
    for (const name of ['eip','dbg_prev_eip','esp','ebp','eax','ecx','edx','ebx','esi','edi','fs_base']) {
      if (!withinBounds()) return null;
      if (typeof ex['get_'+name] === 'function') registers[name] = ex['get_'+name]() >>> 0;
    }
    const chain = [], seen = new Set();
    let frame = read(registers.fs_base);
    while (frame && frame !== 0xffffffff && !seen.has(frame) && chain.length < 8) {
      seen.add(frame);
      const words = [0,4,8,12].map(off => read((frame+off)>>>0));
      chain.push({frame, words});
      if (words[0] === null) break;
      frame = words[0];
    }
    const plugin = read(0x458c78);
    return {registers, chain, instructionBytes:read(registers.eip,32),
      stackWords:Array.from({length:32},(_,i)=>read((registers.esp+i*4)>>>0)),
      plugin, callbacks:plugin ? [0x928,0x92c,0x930].map(off=>read((plugin+off)>>>0)) : null,
      scopeWords:Array.from({length:9},(_,i)=>read(0x446af8+i*4))};
  };
  const record = event => {
    if (!withinBounds()) return;
    count++;
    ring.push({seq:count,time:now(),tid,...event});
    if (ring.length > 128) ring.shift();
  };
  const observe = (name,args) => {
    if (!withinBounds()) return;
    if (name === 'log') {
      const bytes = new Uint8Array(memory.buffer,args[0],Math.min(args[1],256));
      let api=''; for (const b of bytes) {if (!b) break; api+=String.fromCharCode(b);}
      const ex=getExports(), esp=ex.get_esp()>>>0;
      pending=api;
      record({kind:'api',name:api,eip:ex.get_eip()>>>0,esp,
        returnAddress:read(esp),args:Array.from({length:8},(_,i)=>read((esp+4+i*4)>>>0))});
      if (api === 'MessageBoxA' || api === 'MessageBoxW' || api === 'RaiseException') {
        if (!withinBounds()) return;
        record({kind:'checkpoint',name:api,state:state()});
        for (const event of ring) { if (!withinBounds()) break; emit(event); }
        ring=[];
      }
    } else if (name === 'log_i32') {
      const value=args[0]>>>0;
      if (value === 0xcae8c000) {
        exceptionWords=2;
        record({kind:'exception-marker',value,state:state()});
        for (const event of ring) { if (!withinBounds()) break; emit(event); }
        ring=[];
      } else if (exceptionWords) {
        record({kind:exceptionWords===2?'exception-code':'exception-eip',value});
        exceptionWords--;
        for (const event of ring) { if (!withinBounds()) break; emit(event); }
        ring=[];
      } else record({kind:'integer',value,api:pending});
    } else {
      const ex=getExports();
      record({kind:'api-exit',name:pending,eip:ex.get_eip()>>>0,eax:ex.get_eax()>>>0,esp:ex.get_esp()>>>0});
      pending=null;
    }
  };
  for (const name of ['log','log_i32','log_api_exit']) {
    if (typeof host[name] !== 'function') continue;
    originals[name]=host[name];
    wrappers[name]=function(...args) {
      try { observe(name,args); if (active && count >= maxEvents) finish('cap'); }
      catch(error) { if (active) try { emit({kind:'observer-error',error:String(error),tid}); } catch (_) {} }
      return originals[name].apply(this,args);
    };
    host[name]=wrappers[name];
  }
  return {
    activate(identity) {
      if (closed || active || (identity.startAddr>>>0)!==0x440330) return;
      active=true; tid=identity.tid; started=now();
      emit({kind:'armed',tid,startAddr:identity.startAddr>>>0,maxMs,maxEvents});
    },
    finish:()=>finish('summary'),
  };
}
if (typeof module !== 'undefined') module.exports={createWinampExceptionObserver};
else globalThis.createWinampExceptionObserver=createWinampExceptionObserver;
