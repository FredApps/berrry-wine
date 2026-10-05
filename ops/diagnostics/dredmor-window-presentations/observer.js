'use strict';
// Counts completed page-local compositions, not guest frames or scanout.
function install({renderer,presentation,inspect,clock=()=>performance.now(),cap=1000}) {
  const surface=renderer.surface,canvas=presentation.canvas;
  const repaint=renderer._repaintOnce,blit=surface.blit;
  if(typeof repaint!=='function'||typeof blit!=='function'||!Number.isSafeInteger(presentation.flushCount))throw Error('Unsupported presentation');
  let active=null,last=presentation.flushCount,stopped=false;
  const result={metric:'selected-window presentations (coalesced GDI updates)',count:0,physicalFps:null,events:[],errors:[]};
  function valid(){try{return !stopped&&renderer.surface===surface&&presentation.canvas===canvas&&inspect()===true;}catch(error){result.errors.push('eligibility read failed: '+String(error));return false;}}
  function wrappedBlit(...args){
    const before=presentation.flushCount;
    const value=Reflect.apply(blit,this,args);
    if(active&&this===surface&&args[0]?.canvas===canvas){
      if(args[1]!==0||args[2]!==0||args[3]!==canvas.width||args[4]!==canvas.height||!Number.isFinite(args[7])||args[7]<=0||!Number.isFinite(args[8])||args[8]<=0||(args[9]!==undefined&&args[9]!==1))active.invalid=true;
      else if(value&&typeof value.then==='function')active.invalid=true;
      else if(!Number.isSafeInteger(before)||before<last||presentation.flushCount!==before)active.invalid=true;
      else active.generation=Math.max(active.generation,before);
    }
    return value;
  }
  function wrappedRepaint(...args){
    if(active){active.invalid=true;return Reflect.apply(repaint,this,args);}
    const pass={generation:last,invalid:!valid()};active=pass;
    try {
      const value=Reflect.apply(repaint,this,args);
      if(value&&typeof value.then==='function')pass.invalid=true;
      if(this!==renderer||!valid())pass.invalid=true;
      if(!pass.invalid&&pass.generation>last){
        result.events.push({at:clock(),generation:pass.generation,canonicalUploads:pass.generation-last});
        result.count++;last=pass.generation;
        if(result.events.length>=cap)stop('event cap');
      }
      return value;
    } catch(error){result.errors.push('composition threw');throw error;} finally {active=null;}
  }
  function stop(reason){if(stopped)return;stopped=true;if(reason)result.errors.push(reason);if(renderer._repaintOnce===wrappedRepaint)renderer._repaintOnce=repaint;else result.errors.push('foreign repaint replacement');if(surface.blit===wrappedBlit)surface.blit=blit;else result.errors.push('foreign blit replacement');}
  renderer._repaintOnce=wrappedRepaint;surface.blit=wrappedBlit;
  return {result,stop};
}
module.exports={install};
