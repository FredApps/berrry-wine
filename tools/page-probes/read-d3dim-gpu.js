// Page probe: which D3DIM executor every running app actually drew with.
// WebGL is the default, but a device with no WebGL (or a headless Chrome
// without --gpu) silently keeps the software rasterizer, and the picture
// alone cannot tell the two apart. `draws` counts GPU DRAW commands;
// `fallbacks` counts batches that went to software anyway.
//   node tools/web-input-probe.js --app=scr_jazz --gpu \
//     --steps="wait:40000;evalfile:tools/page-probes/read-d3dim-gpu.js;shot:/tmp/jazz.png"
(function () {
  var apps = typeof runningApps !== 'undefined' ? runningApps : [];
  return JSON.stringify(apps.map(function (app) {
    var gpu = app.wine && app.wine.d3dimGpu;
    return {
      name: app.name,
      webglRequested: window.WINE_D3DIM_GPU === true,
      executor: gpu ? 'webgl' : 'software',
      stats: gpu ? gpu.snapshot() : null,
    };
  }));
})();
