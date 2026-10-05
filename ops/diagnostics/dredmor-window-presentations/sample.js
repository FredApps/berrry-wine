'use strict';
const {install}=require('./observer');
const {createInspect}=require('./inspect');
async function sample(wine,{hwnd,durationMs=5000}={}) {
 if(durationMs!==5000)throw Error('Only predeclared five-second sample supported');
 const renderer=wine.renderer,win=renderer.windows[hwnd];
 const matches=[...wine._mainImports.gdi.surfacePresentations.values()].filter(p=>p.targetHwnd===hwnd&&p.canvas===win?._backCanvas&&!p.directDraw);
 if(matches.length!==1)throw Error('Ambiguous presentation');
 const p=matches[0],eligibility=createInspect({renderer,presentation:p,hwnd,owner:win.wasm,document});
 const failures=[];const inspect=()=>{const identity=wine.running&&wine.renderer===renderer&&wine._mainImports.gdi.surfacePresentations.get(p.id)===p;if(!identity)eligibility.receipt.reason='runtime/presentation replaced';const ok=identity&&eligibility.inspect();if(!ok&&failures.length<32)failures.push({at:performance.now(),reason:eligibility.receipt.reason});return ok;};
 if(!inspect())throw Error('Initial ineligible: '+eligibility.receipt.reason);
 const observer=install({renderer,presentation:p,inspect,clock:()=>performance.now(),cap:1000});
 const start=performance.now();let timer;
 try {await new Promise(resolve=>{timer=setTimeout(resolve,durationMs);});inspect();}
 finally {clearTimeout(timer);observer.stop();}
 const end=performance.now();return {start,end,wallMs:end-start,...observer.result,ratePerSecond:observer.result.count/((end-start)/1000),qualified:failures.length===0&&observer.result.errors.length===0&&observer.result.count>0,eligibility:{...eligibility.receipt},failures,scope:'Visible selected-window compositions with new canonical GDI updates; includes possible chrome, coalescing, clipping and tearing; not SDL-only or physical FPS'};
}
module.exports={sample};
