'use strict';
function consumerBrowser(source) {
  const replace = (anchor, text) => { if (source.split(anchor).length !== 2) throw Error('unique browser anchor ' + anchor); source = source.replace(anchor, text); };
  replace("const {createLifecycle}=require('./lifecycle');", "const {createLifecycle}=require('./lifecycle');\nconst {checkedPreflightLaunch,matchingHttpPreflight}=require('./launch-preflight');");
  replace('browser=await lifecycle.acquire(()=>puppeteer.launch(', "browser=await checkedPreflightLaunch({check:()=>lifecycle.check(),receipt:r=>save('checked-preflight.json',r),preflight:()=>matchingHttpPreflight({plan,port:server.address().port,check:()=>lifecycle.check()}),launch:()=>lifecycle.acquire(()=>puppeteer.launch(");
  replace('protocolTimeout:15000,timeout:30000}));', 'protocolTimeout:15000,timeout:30000}))});');
  replace('finally{await pause(1500);receipt.workerArm', 'finally{await pause(6000);receipt.workerArm');
  return source;
}
module.exports = {consumerBrowser};
