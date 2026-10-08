'use strict';
function assertBackend(s,expected='webgl'){
 if(!['webgl','software'].includes(expected)||s.queryBackend!==expected||!s.worker)throw Error('explicit backend query/guest Worker missing');
 const host=(s.renderEndpoints||[]).filter(e=>e.api==='gl'),owning=(s.renderWorkerEndpoints||[]).filter(e=>e.api==='gl');
 if(!host.length||!owning.length||host.some(e=>e.backend!==expected||e.closed)||owning.some(e=>e.backend!==expected||e.closed))throw Error('live host AND owning OpenGL endpoints must match explicit backend; fallback refused');
 return {host,owning,backend:expected,scope:'Guest OpenGL endpoint; FPS/audio unknown'};
}
const assertWebGL=s=>assertBackend(s,'webgl');
module.exports={assertBackend,assertWebGL};
