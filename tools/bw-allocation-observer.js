'use strict';
// Serialized into the existing CLI eval scope: keep this function self-contained.
// Supplied BW2Demo.exe's aligned-allocation return block, not Wine source.
function installBwAllocationObserver(instance, exports, ctx, tickState,
  {address=0x009a81c9,request=0x00a58780}={}) {
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
    const regs=Object.fromEntries(['eax','ebx','ecx','edx','esi','edi','ebp','esp','eip']
      .map(n=>[n,exports['get_'+n]()>>>0]));
    const read=p=>exports.guest_read32(p)>>>0;
    let p=exports.get_free_list()>>>0,total=0,largest=0,bad=null;
    const seen=new Set();
    while(p&&seen.size<65536){
      if(seen.has(p)){bad={cycle:p};break;}
      seen.add(p);const size=read(p);
      if(size<16||size%8){bad={address:p,size};break;}
      total+=size;largest=Math.max(largest,size);p=read(p+4);
    }
    return {batch:tickState.batch,skipped,regs,
      heap:Object.fromEntries(['heap_ptr','heap_end','heap_sparse_ptr','heap_sparse_end','free_list','virtual_alloc_top']
        .map(n=>[n,exports['get_'+n]()>>>0])),
      free:{count:seen.size,total,largest,bad,truncated:!!p&&!bad},
      stack:Array.from({length:24},(_,i)=>read(regs.esp+i*4)),
      stream:Array.from({length:32},(_,i)=>read(regs.ebp+i*4))};
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
