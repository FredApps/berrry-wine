'use strict';
// Serialized into the existing CLI eval scope: keep this function self-contained.
// Supplied BW2Demo.exe's aligned-allocation return block, not Wine source.
function installBwAllocationObserver(instance, exports, ctx, tickState,
  {address=0x009a81c9,request=0x00a58780,regionMap,layoutHash}={}) {
  const original=Object.getOwnPropertyDescriptor(instance,'exports');
  if(exports.get_bp_addr() || ctx.bwAllocRestore || (original&&!original.configurable))
    throw Error('allocation observer conflicts with existing debugger/exports owner');
  const required=['run','get_eip','get_last_run_halt','get_edi','get_eax','guest_read32','clear_bp','set_bp'];
  for(const name of required)if(typeof exports[name]!=='function')throw Error('missing observer export '+name);
  let restored=false,skipped=0;
  const restore=()=>{
    if(restored)return;
    restored=true;exports.clear_bp();
    if(original)Object.defineProperty(instance,'exports',original);
    else delete instance.exports;
    delete ctx.bwAllocRestore;
  };
  const capture=()=>{
    const result={batch:tickState.batch,skipped,...(layoutHash?{layoutHash}:{})};
    // Each diagnostic is optional: a damaged free list or unavailable map
    // must never erase the allocator's return registers and other evidence.
    const section=(name,fn)=>{try{result[name]=fn();}catch(error){
      result[name]={error:String(error)};result.error??=name+': '+String(error);
    }};
    section('regs',()=>Object.fromEntries(['eax','ebx','ecx','edx','esi','edi','ebp','esp','eip']
      .map(n=>[n,exports['get_'+n]()>>>0])));
    section('heap',()=>Object.fromEntries(['heap_ptr','heap_end','heap_sparse_ptr','heap_sparse_end','free_list','virtual_alloc_top']
      .map(n=>[n,exports['get_'+n]()>>>0])));
    const read=p=>exports.guest_read32(p)>>>0;
    section('free',()=>{
    let p=exports.get_free_list()>>>0,total=0,largest=0,bad=null;
    const seen=new Set();
    while(p&&seen.size<65536){
      if(seen.has(p)){bad={cycle:p};break;}
      seen.add(p);const size=read(p);
      if(size<16||size%8){bad={address:p,size};break;}
      total+=size;largest=Math.max(largest,size);p=read(p+4);
    }
    return {count:seen.size,total,largest,bad,truncated:!!p&&!bad};});
    section('stack',()=>Array.from({length:24},(_,i)=>read(result.regs.esp+i*4)));
    section('stream',()=>Array.from({length:32},(_,i)=>read(result.regs.ebp+i*4)));
    if(regionMap){
      const regions=regionMap.REGIONS||regionMap;
      // Only metadata is read, never the backing pool's contents. These are
      // best-effort observations, not an atomic snapshot of worker activity.
      const region=(name,dv)=>{
        const r=regions[name];
        if(!r||!Number.isSafeInteger(r.base)||!Number.isSafeInteger(r.size)||r.base<0||r.size<0||r.base+r.size>dv.byteLength)
          throw Error('unavailable or out-of-bounds region '+name);
        return r;
      };
      section('virtualMaps',()=>{
        const dv=new DataView(ctx._memory.buffer),u=p=>dv.getUint32(p,true);
        const state=region('VIRTUAL_MAP_STATE',dv),table=region('VIRTUAL_MAP_TABLE',dv),pool=region('VIRTUAL_BACKING_BASE',dv);
        if(state.size<12)throw Error('short virtual map state');
        const count=u(state.base),backingCursor=u(state.base+4),reservationTop=u(state.base+8),capacity=Math.floor(table.size/16);
        if(count>capacity||count>2048)return {count,capacity,backingCursor,reservationTop,
          error:'virtual map count exceeds bounded capacity'};
        const intervals=[],records=[];let activeBytes=0;
        for(let i=0;i<count;i++){
          const p=table.base+i*16,size=u(p+4),backing=u(p+8);
          if(!size||backing<pool.base||backing+size>pool.base+pool.size)throw Error('invalid virtual backing record '+i);
          activeBytes+=size;intervals.push([backing,backing+size]);
          records.push([u(p),size,backing,u(p+12)]);
        }
        intervals.sort((a,b)=>a[0]-b[0]);
        let cursor=pool.base,freeBackingBytes=0,largestFreeBackingGap=0,overlap=false;
        for(const [start,end]of [...intervals,[pool.base+pool.size,pool.base+pool.size]]){
          const gap=Math.max(0,start-cursor);freeBackingBytes+=gap;largestFreeBackingGap=Math.max(largestFreeBackingGap,gap);
          if(start<cursor)overlap=true;cursor=Math.max(cursor,end);
        }
        return {count,capacity,backingCursor,reservationTop,activeBytes,freeBackingBytes,largestFreeBackingGap,overlap,
          recordFields:['guest','size','backing','protect'],records,
          backingBase:pool.base,backingBytes:pool.size,consistency:'best-effort',
          stateChanged:u(state.base)!==count||u(state.base+4)!==backingCursor||u(state.base+8)!==reservationTop};
      });
      section('arenas',()=>{
        const dv=new DataView(ctx._memory.buffer),r=region('HEAP_ARENAS',dv);
        if(r.size<16)throw Error('short heap arena table');
        const count=dv.getUint32(r.base,true),capacity=Math.floor((r.size-16)/16),records=[],unpublished=[];
        for(let i=0;i<Math.min(count,capacity,1024);i++){
          const p=r.base+16+i*16,base=dv.getUint32(p,true);
          records.push([base,dv.getUint32(p+4,true),dv.getUint32(p+8,true)]);
          // Count is reserved before publishing base; zero does not imply
          // corruption and must not discard the other diagnostic records.
          if(!base)unpublished.push(i);
        }
        return {count,capacity,overflow:count>capacity,truncated:records.length<count,
          recordFields:['base','end','usedEnd'],records,unpublished,consistency:'best-effort',
          stateChanged:dv.getUint32(r.base,true)!==count};
      });
    }
    return result;
  };
  ctx.bwAllocRestore=restore;
  try{
    Object.defineProperty(instance,'exports',{configurable:true,value:{...exports,run(...args){
      let result;
      try{result=Reflect.apply(exports.run,exports,args);}catch(error){restore();throw error;}
      if(exports.get_eip()===address&&exports.get_last_run_halt()===5){
        // The same return block serves earlier small successful allocations.
        // A persistent native breakpoint skips the current block once itself;
        // do not clear/rearm it until this specific request has been observed.
        if((exports.get_edi()>>>0)!==request){skipped++;return result;}
        try{ctx.bwAllocCapture=capture();}
        catch(error){ctx.bwAllocCapture={batch:tickState.batch,skipped,error:String(error)};}
        finally{
          try{console.log('[BW-ALLOC-CAPTURE] '+JSON.stringify(ctx.bwAllocCapture));}
          catch(error){ctx.bwAllocCapture.logError=String(error);}
          finally{restore();}
        }
      }
      return result;
    }}});
    exports.set_bp(address);
  }catch(error){restore();throw error;}
  return {armed:true,address,request};
}
module.exports={installBwAllocationObserver};
