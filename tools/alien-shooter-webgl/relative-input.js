'use strict';
const {execFile}=require('node:child_process');
function validateRelative(c,{lastShot,deadline,now=Date.now()}) {
 if(!lastShot||c.sceneReviewed!==true||c.sceneReceipt!==lastShot)throw Error('latest reviewed scene required');
 if(now+25000>=deadline)throw Error('relative input deadline reserve');
 if(c.action==='relative') {
  for(const n of ['dx','dy'])if(!Number.isInteger(c[n])||Math.abs(c[n])>600)throw Error('relative delta bounds');
  if(!c.dx&&!c.dy)throw Error('nonzero relative motion required');
 } else if(c.action==='desktopClick') {
  if(c.targetReviewed!==true)throw Error('game cursor and target highlight review required');
 } else throw Error('relative action');
}
function desktop(args,runner=execFile) {
 return new Promise((resolve,reject)=>runner('/usr/bin/xdotool',args,{env:{...process.env,DISPLAY:':0'},timeout:5000},(e,stdout,stderr)=>e?reject(e):resolve({args,stdout,stderr})));
}
// Passive DOM listener only: no preventDefault, dispatch, focus, cursor or guest writes.
function installMotionObserver() {
 if(globalThis.__crimsonMotion)throw Error('motion observer already installed');
 const rows=[],start=Date.now();let total=0;
 const listener=e=>{total++;if(rows.length<128&&Date.now()-start<300000)rows.push({at:Date.now(),trusted:e.isTrusted,type:e.type,movementX:e.movementX,movementY:e.movementY,clientX:e.clientX,clientY:e.clientY,button:e.button,locked:!!document.pointerLockElement,target:e.target?.tagName});};
 for(const t of ['mousemove','mousedown','mouseup'])document.addEventListener(t,listener,{capture:true,passive:true});
 globalThis.__crimsonMotion={rows,read:()=>({rows:rows.slice(),total,capped:total>rows.length,locked:!!document.pointerLockElement}),stop:()=>{for(const t of ['mousemove','mousedown','mouseup'])document.removeEventListener(t,listener,true);}};
}
module.exports={validateRelative,desktop,installMotionObserver};
