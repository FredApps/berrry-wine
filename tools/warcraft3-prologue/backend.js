'use strict';
function assertWebGL(s){
 if(s.queryBackend!=='webgl'||!s.worker)throw Error('WebGL query/guest Worker missing');
 const host=s.renderEndpoints.filter(e=>e.api==='gl'),owning=(s.renderWorkerEndpoints||[]).filter(e=>e.api==='gl');
 if(!host.length||!owning.length||host.some(e=>e.backend!=='webgl'||e.closed)||owning.some(e=>e.backend!=='webgl'))throw Error('live host AND owning OpenGL WebGL endpoints required');
 return {host,owning,backend:'webgl',scope:'OpenGL endpoint; FPS/audio unknown'};
}
module.exports={assertWebGL};
