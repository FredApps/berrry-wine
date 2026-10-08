'use strict';
function createLifecycle(cleanup){
 let cancelled=false,finishPromise=null,pending=null,owned=null;
 const check=()=>{if(cancelled)throw Error('lifecycle cancelled')};
 async function acquire(factory){check();if(pending||owned)throw Error('duplicate acquire');
  pending=Promise.resolve().then(factory).then(value=>{owned=value;return value});
  const value=await pending;check();return value;
 }
 function finish(reason){if(finishPromise)return finishPromise;cancelled=true;
  finishPromise=(async()=>{let startupError=null;try{if(pending)await pending}catch(e){startupError=String(e)}return cleanup({owned,reason,startupError})})();return finishPromise;
 }
 return{acquire,finish,check,get cancelled(){return cancelled}};
}
module.exports={createLifecycle};
