'use strict';
function install({renderer,layers,inspect,receipt,clock=()=>performance.now(),cap=1000}){
 const surface=renderer.surface,repaint=renderer._repaintOnce,blit=surface.blit,clipped=renderer._drawImageClipped,flush=renderer._flushCanonicalCanvas;
 if(typeof repaint!=='function'||typeof blit!=='function'||typeof clipped!=='function'||typeof flush!=='function'||!layers.length)throw Error('Unsupported methods');
 const last=new Map(layers.map(l=>[l.hwnd,l.p.flushCount]));let active=null,clipLayer=null,stopped=false;
 const sharedHud=receipt?.members?.some(m=>!m.own)===true;
 const result={metric:'visible selected-window-subtree presentations (coalesced canonical GDI updates)',count:0,hudOnlyCount:sharedHud?null:0,hudOnlyAttribution:sharedHud?'unavailable: shared root backing':'separate canonical layers',events:[],errors:[],physicalFps:null};
 const error=s=>{if(result.errors.length<32)result.errors.push(s);if(active)active.invalid=true;};
 const valid=()=>{try{return inspect()===true&&renderer.surface===surface&&renderer._repaintOnce===wrappedRepaint&&surface.blit===wrappedBlit&&renderer._drawImageClipped===wrappedClipped&&renderer._flushCanonicalCanvas===wrappedFlush;}catch(e){error('inspect threw');return false;}};
 function wrappedFlush(...args){const l=layers.find(l=>l.canvas===args[0]);let value;try{value=Reflect.apply(flush,this,args);}catch(e){if(active&&l)error('flush threw');throw e;}if(active&&l){if(this!==renderer||value!==true)error('flush failed');else active.flushed.add(l.hwnd);}return value;}
 function wrappedClipped(...args){const l=layers.find(l=>!l.root&&l.canvas===args[0]);const prev=clipLayer;if(l){if(clipLayer||this!==renderer||args[1]!==l.rect.x||args[2]!==l.rect.y||(args[3]!==undefined&&args[3]!==l.canvas.width)||(args[4]!==undefined&&args[4]!==l.canvas.height)||!args[5]||['x','y','w','h'].some(k=>args[5][k]!==l.clip[k]))error('child clip mismatch');clipLayer=l;}try{return Reflect.apply(clipped,this,args);}finally{clipLayer=prev;}}
 function wrappedBlit(...args){const l=layers.find(l=>l.canvas===args[0]?.canvas),generation=l?.p.flushCount;let value;try{value=Reflect.apply(blit,this,args);}catch(e){if(active)error('blit threw');throw e;}
  if(active&&l){if(this!==surface||(!l.root&&clipLayer!==l)||args[1]!==0||args[2]!==0||args[3]!==l.canvas.width||args[4]!==l.canvas.height||args[5]!==l.rect.x||args[6]!==l.rect.y||args[7]!==l.canvas.width||args[8]!==l.canvas.height||(args[9]!==undefined&&args[9]!==1)||value?.then||!Number.isSafeInteger(generation)||generation<last.get(l.hwnd)||generation!==l.p.flushCount||active.seen.has(l.hwnd)||!active.flushed.has(l.hwnd))error('layer blit mismatch');else active.seen.set(l.hwnd,generation);}
  return value;
 }
 function wrappedRepaint(...args){if(active){error('nested repaint');return Reflect.apply(repaint,this,args);}const pass={invalid:false,seen:new Map(),flushed:new Set()};active=pass;if(stopped||!valid())error('ineligible before repaint');
  try{const value=Reflect.apply(repaint,this,args);if(this!==renderer||value?.then||!valid())error('ineligible completion');
   if((pass.seen.size||layers.some(l=>l.p.flushCount>last.get(l.hwnd)))&&pass.seen.size!==layers.length)error('incomplete subtree composition');
   if(!pass.invalid&&pass.seen.size===layers.length){const changes=layers.map(l=>({hwnd:l.hwnd,root:l.root,generation:pass.seen.get(l.hwnd),delta:pass.seen.get(l.hwnd)-last.get(l.hwnd)}));if(changes.some(c=>c.delta>0)){result.count++;if(!sharedHud&&!changes.some(c=>c.root&&c.delta>0))result.hudOnlyCount++;result.events.push({at:clock(),changes});for(const c of changes)last.set(c.hwnd,c.generation);if(result.events.length>=cap)stop('event cap');}}
   return value;
  }catch(e){error('repaint threw');throw e;}finally{active=null;}
 }
 function stop(reason){if(stopped)return;stopped=true;if(reason)error(reason);for(const [object,key,wrapper,original]of[[renderer,'_repaintOnce',wrappedRepaint,repaint],[surface,'blit',wrappedBlit,blit],[renderer,'_drawImageClipped',wrappedClipped,clipped],[renderer,'_flushCanonicalCanvas',wrappedFlush,flush]])if(object[key]===wrapper)object[key]=original;else error('foreign '+key+' replacement');}
 renderer._repaintOnce=wrappedRepaint;surface.blit=wrappedBlit;renderer._drawImageClipped=wrappedClipped;renderer._flushCanonicalCanvas=wrappedFlush;
 return {result,stop};
}
module.exports={install};
