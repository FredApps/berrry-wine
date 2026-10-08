'use strict';
function clickHoldMs(c){const ms=c.holdMs===undefined?(c.launcher===true?100:750):c.holdMs;if(!Number.isInteger(ms)||ms<50||ms>5000)throw Error('click hold bounds');return ms;}
function validate(c,{lastShot,deadline,now=Date.now()}){
 if(!lastShot||c.sceneReviewed!==true||c.sceneReceipt!==lastShot)throw Error('latest personally reviewed scene required');
 if(now+20000>=deadline)throw Error('input deadline reserve');
 if(['click','move'].includes(c.action)){if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||c.x<0||c.x>=1024||c.y<0||c.y>=768)throw Error('coordinate bounds')}
 else if(c.action==='key'){if(!/^(Enter|Escape|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|w|a|s|d)$/.test(c.key)||!Number.isInteger(c.ms)||c.ms<50||c.ms>5000)throw Error('key bounds')}
 else throw Error('input action');
 if(c.action==='click'){const ms=clickHoldMs(c);if(now+ms+20000>=deadline)throw Error('click deadline reserve');}
}
async function pressRelease(down,hold,up){let first;try{await down();await hold()}catch(e){first=e}try{await up()}catch(e){if(!first)first=e;else first.releaseError=String(e)}if(first)throw first}
module.exports={validate,pressRelease,clickHoldMs};
