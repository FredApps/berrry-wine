'use strict';
// Pure reads only. No descriptor/ensure/cache-lookup exports may be supplied here.
function readSharedHud({exports:e,owner,memory,buffer,regions,root,child,presentation}) {
  const uint=n=>Number.isInteger(n)&&n>0&&n<=0xffffffff;
  if(!uint(root)||!uint(child)||root===child||typeof e?.wnd_get_style_export!=='function'||typeof e?.wnd_get_parent!=='function')throw Error('Missing native identities');
  const identity=()=>owner?.exports===e&&memory?.buffer===buffer&&presentation.surface?.storage?.buffer===buffer&&presentation.surface.storage.byteOffset===0&&Object.prototype.toString.call(presentation.surface.storage)==='[object Uint8Array]'&&presentation.surface.storage.byteLength===buffer.byteLength;
  if(!identity())throw Error('Owner/memory identity mismatch');
  const view=new DataView(buffer),table=regions.GDI_WINDOW_SURFACE_TABLE,hwm=regions.GDI_WINDOW_SURFACE_HWM;
  const span=(p,n)=>Number.isSafeInteger(p)&&Number.isSafeInteger(n)&&p>0&&n>0&&p+n<=view.byteLength;
  if(!table||!hwm||table.size!==8192||!span(table.base,table.size)||!span(hwm.base,4))throw Error('Invalid pinned surface map');
  function once(){
    if(!identity())throw Error('Owner/memory identity changed');
    const chain=[],seen=new Set();let cur=child;
    for(let i=0;i<32;i++){
      if(!uint(cur)||seen.has(cur))throw Error('Native parent cycle/invalid');seen.add(cur);
      const style=e.wnd_get_style_export(cur)>>>0,parent=e.wnd_get_parent(cur)>>>0;
      chain.push({hwnd:cur,style,parent});
      if(!(style&0x40000000)){if(cur!==root)throw Error('Native root mismatch');break;}
      if(!parent)throw Error('Missing native parent');cur=parent;
    }
    if(chain.at(-1)?.hwnd!==root||(chain.at(-1).style&0x40000000))throw Error('Native parent depth');
    const count=view.getUint32(hwm.base,true);if(count>256)throw Error('Surface high-water cap');
    const records=[];
    for(let i=0;i<count;i++){
      const p=table.base+i*32,hwnd=view.getUint32(p,true);
      if(hwnd===root||seen.has(hwnd))records.push({recordWa:p,hwnd,id:view.getUint32(p+4,true),width:view.getUint32(p+8,true),height:view.getUint32(p+12,true),bits:view.getUint32(p+16,true),stride:view.getUint32(p+20,true)});
    }
    if(records.length!==1||records[0].hwnd!==root)throw Error('Separate/ambiguous native backing');
    const r=records[0];if(!uint(r.id)||!r.width||!r.height||r.stride<r.width*4||!span(r.bits,r.stride*r.height))throw Error('Invalid native backing span');
    if(presentation.id!==r.id||presentation.targetHwnd!==root||presentation.directDraw||presentation.bitsWa!==r.bits||presentation.byteLength!==r.stride*r.height||presentation.surface.storageOffset!==r.bits||presentation.surface.stride!==r.stride||presentation.surface.bpp!==32||presentation.surface.topDown!==true||presentation.canvas?.width!==r.width||presentation.canvas?.height!==r.height)throw Error('Presentation/native backing mismatch');
    return {chain,count,record:r};
  }
  const first=once(),second=once();if(JSON.stringify(first)!==JSON.stringify(second))throw Error('Unstable native metadata');
  return first;
}
module.exports={readSharedHud};
