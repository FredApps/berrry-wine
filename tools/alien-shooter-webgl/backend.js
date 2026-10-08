'use strict';
function assertWebGL(s) {
  if(s.queryBackend!=='webgl'||!s.worker)throw Error('WebGL query/guest Worker missing');
  const host=s.renderEndpoints.filter(e=>e.api==='neutral');
  const owning=(s.renderWorkerEndpoints||[]).filter(e=>e.api==='neutral');
  if(!host.length||!owning.length||host.some(e=>e.backend!=='webgl'||e.closed)||owning.some(e=>e.backend!=='webgl'))throw Error('live host and owning D3D8/D3D9 neutral WebGL endpoints required');
  return {host,owning,backend:'webgl',scope:'D3D8 adapter through neutral D3D9 WebGL backend; performance/audio unknown'};
}
module.exports={assertWebGL};
